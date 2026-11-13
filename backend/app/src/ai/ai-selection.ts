export type AiProviderKind = 'mock' | 'nearai' | 'unknown' | 'nearai-needs-live';

/**
 * `AI_PROVIDER` (AI-13). Unset or `mock` is the mock. Exact `nearai` is live in production, and outside
 * production only when `AI_LIVE=1`. Any other value, including a misspelled provider or a pasted secret, selects
 * `unknown`. `unknown` and `nearai-needs-live` are not registered adapters, so boot fails closed without logging secrets.
 */
export function aiProvider(env: Readonly<Record<string, string | undefined>>): AiProviderKind {
  const raw = env.AI_PROVIDER;
  if (raw === undefined || raw === '' || raw === 'mock') return 'mock';
  if (raw === 'nearai') {
    return env.NODE_ENV === 'production' || env.AI_LIVE === '1' ? 'nearai' : 'nearai-needs-live';
  }
  return 'unknown';
}
