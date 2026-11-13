import {
  OAUTH_CALLBACK_STORAGE_KEY,
  OAUTH_ERROR_STORAGE_KEY,
  PKCE_STATE_STORAGE_KEY,
} from '../../design/pilot/mockToken';
import {
  PENDING_NEP413_STORAGE_KEY,
  RECENT_NEP413_POPUP_KEY,
} from '../../design/pilot/nearAuthApi';
import { refreshPilotSession } from '../../design/pilot/PilotAccess';
import { signOutNearWalletSelector } from '../../design/pilot/walletSelectorRuntime';
import { readActivePilot } from '../../game/features/achievements/activePilot';

/** Where the page keeps a token it minted from the OAuth redirect. */
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
  const pilot = readActivePilot();
  if (pilot?.isGuest === true) {
    try { store()?.removeItem(TRADE_TOKEN_KEY); } catch { /* ignore */ }
    return null;
  }
  const own = store()?.getItem(TRADE_TOKEN_KEY);
  if (own && !own.startsWith('player:')) {
    return { token: own, label: pilot?.accountId ?? pilot?.handle ?? 'session' };
  }
  if (pilot?.accessToken && !pilot.accessToken.startsWith('player:')) {
    return { token: pilot.accessToken, label: pilot.accountId ?? pilot.handle ?? pilot.playerId };
  }
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
  const body = (await res.json()) as { accessToken?: string; accountId?: string; player?: { id?: string; handle?: string } };
  if (!body.accessToken) return null;
  try { store()?.setItem(TRADE_TOKEN_KEY, body.accessToken); } catch { /* private mode */ }
  return { token: body.accessToken, label: body.accountId ?? body.player?.handle ?? body.player?.id ?? 'session' };
}

/** A refresh-cookie session (no storage needed). Rejects unlinked guest sessions so the user is prompted to sign in. */
export async function refreshSession(doFetch: typeof fetch = fetch): Promise<Identity | null> {
  try {
    const body = await refreshPilotSession(
      (input, init) => doFetch(input, init),
      doFetch === fetch,
    );
    if (!body?.accessToken) return null;
    if (body.player?.isGuest !== false) {
      try { store()?.removeItem(TRADE_TOKEN_KEY); } catch { /* ignore */ }
      return null;
    }
    try {
      store()?.setItem(TRADE_TOKEN_KEY, body.accessToken);
      store()?.setItem(
        'ta_active_pilot',
        JSON.stringify({
          playerId: body.player.id,
          accessToken: body.accessToken,
          updatedAt: Date.now(),
          isGuest: false,
          handle: body.player.handle,
          ...(body.accountId ? { accountId: body.accountId } : {}),
        }),
      );
    } catch { /* private mode */ }
    return { token: body.accessToken, label: body.accountId ?? body.player?.handle ?? body.player?.id ?? 'session' };
  } catch { return null; }
}

export async function probeTradeAuthMode(doFetch: typeof fetch = fetch): Promise<'mock' | 'testnet' | 'mainnet'> {
  try {
    const res = await doFetch('/v1/near/status', { headers: { accept: 'application/json' } });
    if (!res.ok) return 'mock';
    const data = (await res.json()) as {
      nearMode?: string;
      ports?: ReadonlyArray<{ port?: string; mode?: string }> | Record<string, string>;
    };
    if (Array.isArray(data?.ports)) {
      const identityPort = data.ports.find((p) => p?.port === 'Identity');
      if (identityPort?.mode === 'testnet' || identityPort?.mode === 'mainnet') return identityPort.mode;
      if (identityPort?.mode === 'mock') return 'mock';
    } else if (data?.ports && typeof data.ports === 'object') {
      const mode = (data.ports as Record<string, string>).Identity;
      if (mode === 'testnet' || mode === 'mainnet') return mode;
      if (mode === 'mock') return 'mock';
    }
    if (data?.nearMode === 'testnet' || data?.nearMode === 'mainnet') return data.nearMode;
  } catch {
    /* ignore */
  }
  return 'mock';
}

export function signOut(): void {
  try {
    store()?.removeItem(TRADE_TOKEN_KEY);
    store()?.removeItem('ta_active_pilot');
    store()?.removeItem(OAUTH_CALLBACK_STORAGE_KEY);
    store()?.removeItem(OAUTH_ERROR_STORAGE_KEY);
    store()?.removeItem(PKCE_STATE_STORAGE_KEY);
    store()?.removeItem(PENDING_NEP413_STORAGE_KEY);
    store()?.removeItem(RECENT_NEP413_POPUP_KEY);
  } catch { /* ignore */ }
  try {
    globalThis.sessionStorage?.removeItem(PENDING_NEP413_STORAGE_KEY);
    globalThis.sessionStorage?.removeItem(RECENT_NEP413_POPUP_KEY);
  } catch { /* ignore */ }
  void signOutNearWalletSelector().catch(() => undefined);
  void fetch('/v1/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
}
