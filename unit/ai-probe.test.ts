import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AiRuntimeConfig } from '../supabase/functions/_shared/ai-config.ts';
import {
  PROBE_BODY_LIMIT,
  PROBE_MAX_TOKENS,
  PROBE_REPLY_LIMIT,
  PROBE_TIMEOUT_MS,
  ProbeError,
  buildProbeRequest,
  interpretProbeResponse,
  runProbe,
} from '../supabase/functions/_shared/ai-probe.ts';

const SECRET = 'do-not-echo-secret';

const deepseek: AiRuntimeConfig = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  credentialName: 'DEEPSEEK_API_KEY',
  apiKey: SECRET,
};

function reply(content: unknown, usage?: unknown) {
  return { choices: [{ message: { content } }], usage };
}

test('probe request targets the provider endpoint and stays bounded', () => {
  const { url, init } = buildProbeRequest(deepseek);
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${SECRET}`);

  const body = JSON.parse(init.body as string);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.max_tokens, PROBE_MAX_TOKENS);
  assert.equal(body.stream, false);
  assert.match(body.messages[0].content, /ภาษาไทย/);
});

test('the limits that keep one probe cheap are pinned, not incidental', () => {
  assert.equal(PROBE_TIMEOUT_MS, 20_000);
  assert.equal(PROBE_MAX_TOKENS, 64);
  assert.equal(PROBE_REPLY_LIMIT, 500);
  assert.equal(PROBE_BODY_LIMIT, 64 * 1024);
});

test('probe refuses a provider that has no tested client instead of guessing an endpoint', () => {
  assert.throws(
    () => buildProbeRequest({ ...deepseek, provider: 'anthropic', credentialName: 'ANTHROPIC_API_KEY' }),
    (error: unknown) => error instanceof ProbeError && error.code === 'provider_not_wired',
  );
});

test('a healthy Thai answer is reported with its usage', () => {
  const result = interpretProbeResponse(
    200,
    reply('  พร้อมช่วยสรุปข่าว AI ครับ  ', { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }),
    134,
    deepseek,
  );

  assert.equal(result.reply, 'พร้อมช่วยสรุปข่าว AI ครับ');
  assert.equal(result.repliedInThai, true);
  assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 8, totalTokens: 20 });
  assert.equal(result.latencyMs, 134);
  assert.equal(result.credentialName, 'DEEPSEEK_API_KEY');
});

test('a non-Thai answer still succeeds but is flagged, and long replies are truncated', () => {
  const english = interpretProbeResponse(200, reply('Ready to summarise AI news.'), 5, deepseek);
  assert.equal(english.repliedInThai, false);

  const long = interpretProbeResponse(200, reply('ก'.repeat(PROBE_REPLY_LIMIT + 250)), 5, deepseek);
  assert.equal(long.reply.length, PROBE_REPLY_LIMIT);
});

test('usage is null rather than invented when the provider omits or corrupts it', () => {
  assert.equal(interpretProbeResponse(200, reply('ok ครับ'), 1, deepseek).usage, null);
  assert.equal(
    interpretProbeResponse(200, reply('ok ครับ', { prompt_tokens: -3, completion_tokens: 8 }), 1, deepseek).usage,
    null,
  );
  assert.deepEqual(
    interpretProbeResponse(200, reply('ok ครับ', { prompt_tokens: 4, completion_tokens: 6 }), 1, deepseek).usage,
    { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
  );
});

test('every provider failure maps to a code and never echoes the credential', () => {
  const cases: ReadonlyArray<readonly [number, unknown, string]> = [
    [401, { error: SECRET }, 'credential_rejected'],
    [403, { error: SECRET }, 'credential_rejected'],
    [402, { error: SECRET }, 'provider_payment_required'],
    [429, { error: SECRET }, 'provider_rate_limited'],
    [500, { error: SECRET }, 'provider_error'],
    [200, { choices: [] }, 'unreadable_response'],
    [200, reply(''), 'unreadable_response'],
    [200, null, 'unreadable_response'],
    // Hostile shapes: the provider body is untrusted and must never crash the probe.
    [200, { choices: 'nope' }, 'unreadable_response'],
    [200, { choices: [{ message: [] }] }, 'unreadable_response'],
    [200, { choices: [{ message: { content: 42 } }] }, 'unreadable_response'],
    [200, 'a bare string', 'unreadable_response'],
    [200, [1, 2, 3], 'unreadable_response'],
    [200, { choices: [null] }, 'unreadable_response'],
  ];

  for (const [status, payload, code] of cases) {
    assert.throws(
      () => interpretProbeResponse(status, payload, 1, deepseek),
      (error: unknown) =>
        error instanceof ProbeError &&
        error.code === code &&
        !error.message.includes(SECRET),
      `${status} should fail as ${code} without leaking the credential`,
    );
  }
});

test('a failing status surfaces the provider error code but never its message', () => {
  assert.throws(
    () =>
      interpretProbeResponse(
        400,
        { error: { code: 'invalid_model', message: `bad request for key ${SECRET}` } },
        1,
        deepseek,
      ),
    (error: unknown) =>
      error instanceof ProbeError &&
      error.message.includes('invalid_model') &&
      !error.message.includes(SECRET) &&
      !error.message.includes('bad request'),
  );

  // A code that is not enum-shaped is prose in disguise, so it is dropped rather than echoed.
  assert.throws(
    () => interpretProbeResponse(400, { error: { code: `leaking ${SECRET} here` } }, 1, deepseek),
    (error: unknown) => error instanceof ProbeError && !error.message.includes(SECRET),
  );
});

test('the Thai check reads the whole answer, not the truncated one', () => {
  const late = interpretProbeResponse(200, reply('a'.repeat(PROBE_REPLY_LIMIT + 50) + 'พร้อมครับ'), 1, deepseek);
  assert.equal(late.reply.length, PROBE_REPLY_LIMIT);
  assert.equal(late.reply.includes('พร้อม'), false);
  assert.equal(late.repliedInThai, true);
});

test('an oversized provider body is refused instead of being parsed', async () => {
  const flood = (() =>
    Promise.resolve(
      new Response('x'.repeat(PROBE_BODY_LIMIT + 1), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch;

  await assert.rejects(
    () => runProbe(deepseek, flood),
    (error: unknown) => error instanceof ProbeError && error.code === 'response_too_large',
  );
});

test('a transport failure is reported without forwarding an error that carries the key', async () => {
  const leaky = (() =>
    Promise.reject(new Error(`connect failed with authorization Bearer ${SECRET}`))) as unknown as typeof fetch;

  await assert.rejects(
    () => runProbe(deepseek, leaky),
    (error: unknown) =>
      error instanceof ProbeError &&
      error.code === 'provider_unreachable' &&
      error.status === 504 &&
      !error.message.includes(SECRET),
  );
});

test('runProbe measures latency from the injected clock and passes an abort signal', async () => {
  let ticks = 1000;
  let sawSignal = false;

  const fakeFetch = ((_url: string, init: RequestInit) => {
    sawSignal = init.signal instanceof AbortSignal;
    ticks += 250;
    return Promise.resolve(
      new Response(JSON.stringify(reply('พร้อมแล้วครับ', { prompt_tokens: 1, completion_tokens: 2 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;

  const result = await runProbe(deepseek, fakeFetch, () => ticks);
  assert.equal(sawSignal, true);
  assert.equal(result.latencyMs, 250);
  assert.equal(result.repliedInThai, true);
});
