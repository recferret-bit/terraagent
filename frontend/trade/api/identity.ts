import { readActivePilot } from '../../game/features/achievements/activePilot';

/** Where the page keeps a token it minted from the mock OAuth redirect (own key: the game's pilot record is not touched). */
export const TRADE_TOKEN_KEY = 'ta_trade_token';

export interface Identity {
  /** Bearer for `/v1/trade/*`: `dev:<name>` (`?as=`), `player:<id>` (`?playerId=`), a stored session token. */
  readonly token: string;
  readonly label: string;
}

const store = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

/** Same precedence as `/me.html`: `?playerId=`, `?as=`, then the stored pilot / trade session. Empty token = not signed in. */
export function resolveIdentity(search: string, hash: string): Identity | null {
  const params = new URLSearchParams(search);
  const pid = params.get('playerId')?.trim();
  if (pid) return { token: `player:${pid}`, label: pid };
  const as = params.get('as')?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (as) return { token: `dev:${as}`, label: as };
  void hash;
  const own = store()?.getItem(TRADE_TOKEN_KEY);
  if (own) return { token: own, label: 'session' };
  const pilot = readActivePilot();
  if (pilot?.accessToken) return { token: pilot.accessToken, label: pilot.playerId };
  if (pilot?.playerId) return { token: `player:${pilot.playerId}`, label: pilot.playerId };
  return null;
}

export const mockOauthUrl = (returnTo: string): string => `/dev/mock-oauth?provider=google&return=${encodeURIComponent(returnTo)}`;

/** Reads `#mock_token=` (left by the mock OAuth page), trades it for an access token and stores it. Returns the identity or null. */
export async function consumeMockToken(hash: string, doFetch: typeof fetch = fetch): Promise<Identity | null> {
  const m = /(?:^|[#&])mock_token=([^&]+)/.exec(hash);
  if (!m) return null;
  const res = await doFetch('/v1/auth/social', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'google', token: decodeURIComponent(m[1]!) }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { accessToken?: string; player?: { id?: string } };
  if (!body.accessToken) return null;
  try { store()?.setItem(TRADE_TOKEN_KEY, body.accessToken); } catch { /* private mode */ }
  return { token: body.accessToken, label: body.player?.id ?? 'session' };
}

/** A refresh-cookie session (no storage needed). */
export async function refreshSession(doFetch: typeof fetch = fetch): Promise<Identity | null> {
  try {
    const res = await doFetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const body = (await res.json()) as { accessToken?: string };
    if (!body.accessToken) return null;
    try { store()?.setItem(TRADE_TOKEN_KEY, body.accessToken); } catch { /* private mode */ }
    return { token: body.accessToken, label: 'session' };
  } catch { return null; }
}

export function signOut(): void {
  try { store()?.removeItem(TRADE_TOKEN_KEY); } catch { /* ignore */ }
}
