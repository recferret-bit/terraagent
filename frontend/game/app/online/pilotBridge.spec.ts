import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFastAuthPopupDriverForTests } from '../../../design/pilot/fastAuthSpa';
import {
  PENDING_NEP413_STORAGE_KEY,
  RECENT_NEP413_POPUP_KEY,
} from '../../../design/pilot/nearAuthApi';
import { PKCE_STATE_STORAGE_KEY } from '../../../design/pilot/pkceState';
import type { FetchLike, StorageLike } from './bootOnline';
import { GuestBootTarget } from './guestBoot';
import { activeHome } from './homeFixture';
import { PilotBridge } from './pilotBridge';

afterEach(() => {
  setFastAuthPopupDriverForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PLAYER = 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PILOT = 'test-pilot.terraagent.mock';

const mem = (): StorageLike => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function guestFetch(): FetchLike {
  return async (url) => {
    if (url === '/v1/auth/guest') {
      return json(200, { accessToken: 'jwt-guest', expiresIn: 900, player: { id: PLAYER, handle: 'C', isGuest: true } });
    }
    if (url.startsWith('/v1/me/home')) return json(200, activeHome());
    return json(404, {});
  };
}

const socialBody = {
  accessToken: 'jwt-linked',
  expiresIn: 900,
  player: { id: PLAYER, handle: 'test-pilot', isGuest: false },
  accountId: PILOT,
};

async function booted() {
  const target = new GuestBootTarget('ws://127.0.0.1:9/ws', {
    fetch: guestFetch(), storage: mem(), search: '', allowLocalFallback: false, onBooted() {},
  });
  const boot = await target.boot();
  if (!boot) throw new Error('boot failed');
  return { target, boot };
}

describe('PilotBridge scenario token', () => {
  it('uses sessionToken when the guest target is absent', () => {
    const bridge = new PilotBridge({ target: () => null, sessionToken: () => 'dev:w22a' });
    expect(bridge.view().accessToken).toBe('dev:w22a');
  });
});

describe('PilotBridge loginSocial (W06-15)', () => {
  it('posts the guest bearer and replaces the session access token', async () => {
    const { target, boot } = await booted();
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return json(200, socialBody);
    };
    const bridge = new PilotBridge({ fetch, target: () => target });
    bridge.note(boot);
    expect(bridge.view()).toMatchObject({ isGuest: true, accountId: null, accessToken: 'jwt-guest' });

    await bridge.loginSocial('google', 'mock-token');

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('/v1/auth/social');
    expect(seen[0]!.init?.credentials).toBe('include');
    expect(seen[0]!.init?.method).toBe('POST');
    expect((seen[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-guest');
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ provider: 'google', token: 'mock-token' });
    expect(target.accessToken).toBe('jwt-linked');
    expect(target.result).toMatchObject({ isGuest: false, accountId: PILOT, accessToken: 'jwt-linked', handle: 'test-pilot' });
    expect(bridge.view()).toMatchObject({ isGuest: false, accountId: PILOT, accessToken: 'jwt-linked' });
    expect(target.tokenExpiresAtMs).toBeGreaterThan(Date.now());
  });

  it('leaves the guest token in place when the post fails', async () => {
    const { target, boot } = await booted();
    const bridge = new PilotBridge({
      fetch: async () => json(401, { errorCode: 'UNAUTHORIZED' }),
      target: () => target,
    });
    bridge.note(boot);
    await expect(bridge.loginSocial('x', 'nope')).rejects.toThrow('POST /v1/auth/social: 401');
    expect(target.accessToken).toBe('jwt-guest');
    expect(bridge.view().isGuest).toBe(true);
    expect(bridge.view().accountId).toBeNull();
  });

  it('forwards mode: signup to authenticateFastAuthEmailPopup and clears ta_fastauth_pkce + sessionStorage NEP-413 keys on logout', async () => {
    const { target, boot } = await booted();
    const popupCalls: Array<{ email?: string; mode?: string }> = [];
    setFastAuthPopupDriverForTests(async (opts) => {
      popupCalls.push({ email: opts.email, mode: opts.mode });
      return { idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJlbWFpbHw1NSJ9.sig', email: opts.email ?? null };
    });

    const localMap = new Map<string, string>([
      [PKCE_STATE_STORAGE_KEY, '[{"stateId":"pkce-1"}]'],
      [PENDING_NEP413_STORAGE_KEY, '{"challengeId":"ch-1"}'],
      [RECENT_NEP413_POPUP_KEY, '{"payload":{}}'],
    ]);
    const sessionMap = new Map<string, string>([
      [PENDING_NEP413_STORAGE_KEY, '{"challengeId":"ch-1"}'],
      [RECENT_NEP413_POPUP_KEY, '{"payload":{}}'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => localMap.get(k) ?? null,
      setItem: (k: string, v: string) => void localMap.set(k, v),
      removeItem: (k: string) => void localMap.delete(k),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => sessionMap.get(k) ?? null,
      setItem: (k: string, v: string) => void sessionMap.set(k, v),
      removeItem: (k: string) => void sessionMap.delete(k),
    });

    const seenBodies: unknown[] = [];
    const bridge = new PilotBridge({
      fetch: async (url, init) => {
        if (url === '/v1/auth/social') {
          seenBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return json(200, socialBody);
        }
        return json(200, {});
      },
      target: () => target,
    });
    bridge.note(boot);

    await bridge.loginSocial('email', 'signup@terraagent.fun', { mode: 'signup' });
    expect(popupCalls).toEqual([{ email: 'signup@terraagent.fun', mode: 'signup' }]);
    expect(seenBodies).toEqual([
      { provider: 'email', token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJlbWFpbHw1NSJ9.sig' },
    ]);

    await bridge.logout();
    expect(localMap.has(PKCE_STATE_STORAGE_KEY)).toBe(false);
    expect(localMap.has(PENDING_NEP413_STORAGE_KEY)).toBe(false);
    expect(localMap.has(RECENT_NEP413_POPUP_KEY)).toBe(false);
    expect(sessionMap.has(PENDING_NEP413_STORAGE_KEY)).toBe(false);
    expect(sessionMap.has(RECENT_NEP413_POPUP_KEY)).toBe(false);
    expect(bridge.view().isGuest).toBe(true);
  });
});
