// @vitest-environment jsdom
import { Auth0Client } from '@auth0/auth0-spa-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateFastAuthEmailPopup, setFastAuthPopupDriverForTests } from '../../../design/pilot/fastAuthSpa';
import { jwtStillValid, PilotAccess } from '../../../design/pilot/PilotAccess';

function makeFakeJwt(expEpochSec: number, sub = 'pr_guest_1'): string {
  const toB64Url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${toB64Url({ alg: 'HS256', typ: 'JWT' })}.${toB64Url({ sub, exp: expEpochSec })}.fakesig`;
}

afterEach(() => {
  setFastAuthPopupDriverForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('PilotAccess.resolveUpgradeBearer guest token expiry & storage guards', () => {
  it('clears expired guest bearer tokens, loads valid guest JWTs when skipRestore=true, and ignores linked pilot records', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const validGuestJwt = makeFakeJwt(nowSec + 600, 'pr_guest_valid');
    const expiredGuestJwt = makeFakeJwt(nowSec - 30, 'pr_guest_expired');

    expect(jwtStillValid(validGuestJwt)).toBe(true);
    expect(jwtStillValid(expiredGuestJwt)).toBe(false);
    expect(jwtStillValid('not-a-jwt')).toBe(false);

    const seenAuthHeaders: Array<string | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/v1/auth/refresh') {
          return new Response(
            JSON.stringify({
              accessToken: expiredGuestJwt,
              player: { id: 'pr_guest_expired', handle: 'guest-1', isGuest: true },
            }),
            { status: 200 },
          );
        }
        if (url === '/v1/auth/social') {
          const h = (init?.headers ?? {}) as Record<string, string | undefined>;
          seenAuthHeaders.push(h.Authorization);
          return new Response(
            JSON.stringify({
              accessToken: makeFakeJwt(nowSec + 900, 'pr_linked'),
              expiresIn: 900,
              accountId: 'pilot.terraagent.testnet',
              player: { id: 'pr_linked', handle: 'pilot', isGuest: false },
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 200 });
      }),
    );

    setFastAuthPopupDriverForTests(async () => ({ idToken: 'a.b.c', email: 'pilot@terraagent.fun' }));
    const host1 = document.createElement('div');
    const pa1 = new PilotAccess(host1);
    await vi.waitFor(() => expect(localStorage.getItem('ta_active_pilot')).not.toBeNull());
    host1.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    host1.querySelector<HTMLInputElement>('[data-testid="pilot-email-input"]')!.value = 'pilot@terraagent.fun';
    host1.querySelector<HTMLButtonElement>('[data-testid="continue-email"]')!.click();
    await vi.waitFor(() => expect(seenAuthHeaders).toHaveLength(1));
    expect(seenAuthHeaders[0]).toBeUndefined();
    pa1.dispose();

    localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_guest_valid', accessToken: validGuestJwt, isGuest: true, handle: 'guest-2' }),
    );
    const host2 = document.createElement('div');
    const pa2 = new PilotAccess(host2, { skipRestore: true });
    expect(pa2.resolveUpgradeBearer()).toBe(validGuestJwt);
    host2.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    host2.querySelector<HTMLInputElement>('[data-testid="pilot-email-input"]')!.value = 'pilot@terraagent.fun';
    host2.querySelector<HTMLButtonElement>('[data-testid="continue-email"]')!.click();
    await vi.waitFor(() => expect(seenAuthHeaders).toHaveLength(2));
    expect(seenAuthHeaders[1]).toBe(`Bearer ${validGuestJwt}`);
    pa2.dispose();

    localStorage.setItem(
      'ta_active_pilot',
      JSON.stringify({ playerId: 'pr_linked_1', accessToken: validGuestJwt, accountId: 'alice.testnet' }),
    );
    const pa3 = new PilotAccess(document.createElement('div'), { skipRestore: true });
    expect(pa3.resolveUpgradeBearer()).toBe('');
    pa3.dispose();
  });
});

describe('FastAuth Email popup dynamic redirect_uri, cleanup & popup-blocker error', () => {
  it('passes dynamic pathname redirect_uri to Auth0 loginWithPopup, closes popup on error, and throws when blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValueOnce(null);
    await expect(authenticateFastAuthEmailPopup({ email: 'pilot@terraagent.fun' })).rejects.toThrow(
      'Popup window was blocked by the browser. Allow popups for this site and try again.',
    );

    const closablePopup = { closed: false, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValueOnce(closablePopup);
    vi.spyOn(Auth0Client.prototype, 'loginWithPopup').mockRejectedValueOnce(new Error('OIDC exchange failed'));
    await expect(authenticateFastAuthEmailPopup({ email: 'pilot@terraagent.fun' })).rejects.toThrow(
      'OIDC exchange failed',
    );
    expect(closablePopup.close).toHaveBeenCalledTimes(1);

    const fakePopup = {} as Window;
    vi.spyOn(window, 'open').mockReturnValue(fakePopup);
    let capturedNonce = '';
    const loginSpy = vi
      .spyOn(Auth0Client.prototype, 'loginWithPopup')
      .mockImplementation(async (options) => {
        capturedNonce = String(options?.authorizationParams?.nonce ?? '');
      });
    loginSpy.mockClear();
    vi.spyOn(Auth0Client.prototype, 'getIdTokenClaims').mockImplementation(
      async () => ({ __raw: 'id.jwt.token', email: 'pilot@terraagent.fun', nonce: capturedNonce }) as never,
    );

    history.replaceState(null, '', '/landing.html');
    await authenticateFastAuthEmailPopup({ email: 'pilot@terraagent.fun', mode: 'signin' });
    history.replaceState(null, '', '/me.html');
    await authenticateFastAuthEmailPopup({ email: 'pilot@terraagent.fun', mode: 'signup' });

    expect(loginSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        authorizationParams: expect.objectContaining({
          redirect_uri: `${location.origin}/landing.html`,
          login_hint: 'pilot@terraagent.fun',
        }),
      }),
      { popup: fakePopup },
    );
    expect(loginSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        authorizationParams: expect.objectContaining({
          redirect_uri: `${location.origin}/me.html`,
          screen_hint: 'signup',
        }),
      }),
      { popup: fakePopup },
    );
  });
});
