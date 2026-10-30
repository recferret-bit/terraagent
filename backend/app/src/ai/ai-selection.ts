export type AiProviderKind = 'mock' | 'zai';

/**
 * `AI_PROVIDER` (AI_ORCHESTRATOR config; the port is `LlmProviderPort`). Exact `zai` selects the real provider, anything
 * else is `mock`. `AI_LIVE` (ARCHITECTURE 15, AI-13): outside production `zai` additionally needs `AI_LIVE=1`, otherwise the
 * mock is used (no accidental paid calls from dev machines or tests); in production `zai` alone is enough.
 */
export function aiProvider(env: Readonly<Record<string, string | undefined>>): AiProviderKind {
  if (env.AI_PROVIDER !== 'zai') return 'mock';
  return env.NODE_ENV === 'production' || env.AI_LIVE === '1' ? 'zai' : 'mock';
}
