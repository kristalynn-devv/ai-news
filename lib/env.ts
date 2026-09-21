export type AppConfig = { source: 'mock' } | { source: 'supabase'; url: string; publishableKey: string };

export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  const source = env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';
  if (source === 'mock') return { source };
  if (source !== 'supabase') throw new Error('NEXT_PUBLIC_DATA_SOURCE must be mock or supabase');
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
  let url: URL;
  try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? ''); }
  catch { throw new Error('Set a valid NEXT_PUBLIC_SUPABASE_URL'); }
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Supabase URL must be an HTTPS origin (HTTP allowed only on localhost)');
  }
  // Accept only the explicitly public key format. Never put a service-role/provider key here.
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) throw new Error('Use a Supabase publishable key, never a secret or service-role key');
  return { source, url: url.origin, publishableKey: key };
}

export const appConfig = parseEnv({
  NEXT_PUBLIC_DATA_SOURCE: process.env.NEXT_PUBLIC_DATA_SOURCE,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
