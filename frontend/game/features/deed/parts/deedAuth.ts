import type { FeatureContext } from '../../../core/registry/types';

/** The pilot session's bearer token (live session, then the stored pilot, then a trade token); `''` when signed out. */
export function resolveDeedBearerToken(ctx: FeatureContext): string {
  const liveToken = ctx.services.pilot?.view().accessToken?.trim();
  if (liveToken) return liveToken;
  try {
    const raw = localStorage.getItem('ta_active_pilot');
    if (raw) {
      const parsed = JSON.parse(raw) as { accessToken?: unknown };
      if (typeof parsed.accessToken === 'string' && parsed.accessToken.trim()) {
        return parsed.accessToken.trim();
      }
    }
    const tradeToken = localStorage.getItem('ta_trade_token')?.trim();
    if (tradeToken) return tradeToken;
  } catch {
    /* ignore storage errors */
  }
  return '';
}

export function buildAuthenticatedDeedFetch(ctx: FeatureContext): typeof fetch {
  return (input, init) => {
    const token = resolveDeedBearerToken(ctx);
    if (!token) return fetch(input, init);
    const headers = new Headers(init?.headers);
    if (!headers.has('authorization')) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  };
}
