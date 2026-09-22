import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_PROVIDER_CREDENTIALS, readAiRuntimeConfig } from '../supabase/functions/_shared/ai-config.ts';

function reader(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

test('AI runtime config selects only the active provider credential', () => {
  for (const [provider, credentialName] of Object.entries(AI_PROVIDER_CREDENTIALS)) {
    const model = provider === 'openrouter' ? 'vendor/model:free' : 'approved-model';
    const config = readAiRuntimeConfig(reader({
      AI_PROVIDER: provider.toUpperCase(),
      AI_MODEL: model,
      DEEPSEEK_API_KEY: 'unused-deepseek-secret',
      [credentialName]: `${provider}-secret`,
    }));

    assert.deepEqual(config, {
      provider,
      model,
      credentialName,
      apiKey: `${provider}-secret`,
    });
  }
});

test('AI runtime config fails closed without complete settings and never exposes a key', () => {
  for (const values of [
    {},
    { AI_PROVIDER: 'deepseek', AI_MODEL: 'approved-model' },
    { AI_PROVIDER: 'bad provider', AI_MODEL: 'approved-model', DEEPSEEK_API_KEY: 'do-not-echo' },
    { AI_PROVIDER: '__proto__', AI_MODEL: 'approved-model', DEEPSEEK_API_KEY: 'do-not-echo' },
  ]) {
    assert.throws(
      () => readAiRuntimeConfig(reader(values)),
      (error) => error instanceof Error && !error.message.includes('do-not-echo'),
    );
  }
});
