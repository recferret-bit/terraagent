export type AiProviderKind = 'mock' | 'zai' | 'unknown' | 'zai-needs-live';

/**
 * `AI_PROVIDER` (AI-13). Unset or `mock` is the mock. Exact `zai` is live in production, and outside production only
 * when `AI_LIVE=1`. Any other value, including a misspelled provider or a pasted secret, selects `unknown`.
 * `unknown` and `zai-needs-live` are not registered adapters, so boot fails closed and the raw value is not logged.
 */
export function aiProvider(env: Readonly<Record<string, string | undefined>>): AiProviderKind {
  const raw = env.AI_PROVIDER;
  if (raw === undefined || raw === '' || raw === 'mock') return 'mock';
  if (raw !== 'zai') return 'unknown';
  if (env.NODE_ENV === 'production' || env.AI_LIVE === '1') return 'zai';
  return 'zai-needs-live';
}
