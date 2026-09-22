import type { AiProvider, AiRuntimeConfig } from './ai-config.ts';

// Only providers with a tested client belong here; an untested endpoint is a claim we cannot back.
const PROBE_ENDPOINTS: Partial<Record<AiProvider, string>> = {
  deepseek: 'https://api.deepseek.com/chat/completions',
};

export const PROBE_PROMPT = 'ตอบกลับเป็นภาษาไทยหนึ่งประโยคสั้น ๆ ว่าคุณพร้อมช่วยคัดและสรุปข่าว AI';
export const PROBE_TIMEOUT_MS = 20_000;
export const PROBE_MAX_TOKENS = 64;
export const PROBE_REPLY_LIMIT = 500;
export const PROBE_BODY_LIMIT = 64 * 1024;

// Provider error bodies can echo the request, so only a short enum-shaped code is ever surfaced.
const ERROR_CODE_PATTERN = /^[a-z0-9_.-]{1,64}$/i;

const THAI_BLOCK_START = 0x0e00;
const THAI_BLOCK_END = 0x0e7f;

function containsThai(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= THAI_BLOCK_START && code <= THAI_BLOCK_END) return true;
  }
  return false;
}

export type ProbeUsage = Readonly<{
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}>;

export type ProbeResult = Readonly<{
  provider: AiProvider;
  model: string;
  credentialName: string;
  reply: string;
  repliedInThai: boolean;
  usage: ProbeUsage | null;
  latencyMs: number;
}>;

export class ProbeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.status = status;
  }
}

function field(source: unknown, name: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined;
  return (source as Record<string, unknown>)[name];
}

function tokenCount(source: unknown, name: string): number | null {
  const value = field(source, name);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function buildProbeRequest(config: AiRuntimeConfig): { url: string; init: RequestInit } {
  const url = PROBE_ENDPOINTS[config.provider];
  if (!url) {
    throw new ProbeError('provider_not_wired', 501, `no probe client exists for provider "${config.provider}"`);
  }

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: PROBE_MAX_TOKENS,
        stream: false,
        messages: [{ role: 'user', content: PROBE_PROMPT }],
      }),
    },
  };
}

export function readProviderErrorCode(payload: unknown): string | null {
  const error = field(payload, 'error');
  for (const name of ['code', 'type']) {
    const value = field(error, name);
    if (typeof value === 'string' && ERROR_CODE_PATTERN.test(value)) return value;
  }
  return null;
}

export function readProbeUsage(payload: unknown): ProbeUsage | null {
  const usage = field(payload, 'usage');
  const promptTokens = tokenCount(usage, 'prompt_tokens');
  const completionTokens = tokenCount(usage, 'completion_tokens');
  if (promptTokens === null || completionTokens === null) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens: tokenCount(usage, 'total_tokens') ?? promptTokens + completionTokens,
  };
}

export function interpretProbeResponse(
  status: number,
  payload: unknown,
  latencyMs: number,
  config: AiRuntimeConfig,
): ProbeResult {
  // Provider bodies can echo the request, so status alone shapes the message.
  if (status === 401 || status === 403) {
    throw new ProbeError('credential_rejected', 502, `${config.provider} rejected ${config.credentialName}`);
  }
  if (status === 429) {
    throw new ProbeError('provider_rate_limited', 502, `${config.provider} rate limited the probe`);
  }
  if (status === 402) {
    throw new ProbeError('provider_payment_required', 502, `${config.provider} reports no usable balance`);
  }
  if (status < 200 || status >= 300) {
    // A wrong AI_MODEL lands here, so the provider's own code is worth surfacing to diagnose it.
    const code = readProviderErrorCode(payload);
    throw new ProbeError(
      'provider_error',
      502,
      `${config.provider} answered with HTTP ${status}${code ? ` (${code})` : ''}`,
    );
  }

  const choice = field(payload, 'choices');
  const content = field(field(Array.isArray(choice) ? choice[0] : undefined, 'message'), 'content');
  if (typeof content !== 'string' || content.trim() === '') {
    throw new ProbeError('unreadable_response', 502, `${config.provider} returned no readable message`);
  }

  const answer = content.trim();
  return {
    provider: config.provider,
    model: config.model,
    credentialName: config.credentialName,
    reply: answer.slice(0, PROBE_REPLY_LIMIT),
    repliedInThai: containsThai(answer),
    usage: readProbeUsage(payload),
    latencyMs,
  };
}

// Single attempt on purpose: this is a diagnostic, and retrying hides the failure it exists to surface.
export async function runProbe(
  config: AiRuntimeConfig,
  fetchImpl: typeof fetch,
  now: () => number = Date.now,
): Promise<ProbeResult> {
  const { url, init } = buildProbeRequest(config);
  const startedAt = now();

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  } catch {
    // The thrown error can carry the request headers, so none of it is forwarded.
    throw new ProbeError('provider_unreachable', 504, `${config.provider} was unreachable within ${PROBE_TIMEOUT_MS} ms`);
  }

  // Bounded by bytes as well as by the abort timeout, so a broken upstream cannot flood the isolate.
  let payload: unknown = null;
  try {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > PROBE_BODY_LIMIT) {
      throw new ProbeError('response_too_large', 502, `${config.provider} declared more than ${PROBE_BODY_LIMIT} bytes`);
    }
    const body = await response.text();
    if (body.length > PROBE_BODY_LIMIT) {
      throw new ProbeError('response_too_large', 502, `${config.provider} returned more than ${PROBE_BODY_LIMIT} bytes`);
    }
    payload = JSON.parse(body);
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    payload = null;
  }

  return interpretProbeResponse(response.status, payload, now() - startedAt, config);
}
