export const AI_PROVIDER_CREDENTIALS = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
} as const;

export type AiProvider = keyof typeof AI_PROVIDER_CREDENTIALS;

export type AiRuntimeConfig = Readonly<{
  provider: AiProvider;
  model: string;
  credentialName: (typeof AI_PROVIDER_CREDENTIALS)[AiProvider];
  apiKey: string;
}>;

type ReadEnv = (name: string) => string | undefined;

const providerPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const modelPattern = /^[a-z0-9][a-z0-9._/:-]{0,127}$/i;

export function readAiRuntimeConfig(readEnv: ReadEnv): AiRuntimeConfig {
  const providerInput = readEnv('AI_PROVIDER')?.trim().toLowerCase();
  const model = readEnv('AI_MODEL')?.trim();

  if (!providerInput || !model) {
    throw new Error('AI runtime is not configured');
  }
  if (!providerPattern.test(providerInput) || !modelPattern.test(model)) {
    throw new Error('AI runtime configuration is invalid');
  }
  if (!Object.prototype.hasOwnProperty.call(AI_PROVIDER_CREDENTIALS, providerInput)) {
    throw new Error('AI runtime is not configured');
  }

  const provider = providerInput as AiProvider;
  const credentialName = AI_PROVIDER_CREDENTIALS[provider];
  const apiKey = readEnv(credentialName)?.trim();
  if (!apiKey) {
    throw new Error('AI runtime is not configured');
  }

  return { provider, model, credentialName, apiKey };
}
