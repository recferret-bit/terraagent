export interface MockTokenMessage {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface MockToken {
  provider: 'google' | 'x';
  token: string;
}

/** Accepts only a `terra:mock-token` from the popup this page opened, on this origin. Anything else is ignored. */
export function readMockToken(event: MockTokenMessage, popup: unknown, origin: string): MockToken | null {
  if (event.origin !== origin || popup == null || event.source !== popup) return null;
  const data = event.data;
  if (!data || typeof data !== 'object') return null;
  const rec = data as { type?: unknown; provider?: unknown; token?: unknown };
  if (rec.type !== 'terra:mock-token') return null;
  if (rec.provider !== 'google' && rec.provider !== 'x') return null;
  if (typeof rec.token !== 'string' || rec.token.length === 0) return null;
  return { provider: rec.provider, token: rec.token };
}
