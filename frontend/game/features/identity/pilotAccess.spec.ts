// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureBrowserPolyfills } from '../../../design/pilot/browserPolyfills';
import { setFastAuthPopupDriverForTests } from '../../../design/pilot/fastAuthSpa';
import {
  buildFastAuthLoginUrl,
  buildNearWalletSignMessageUrl,
  consumeNearWalletCallback,
  consumePendingOAuthError,
  readMockToken,
  readOAuthError,
} from '../../../design/pilot/mockToken';
import { decodeNep413SocialToken, savePendingNep413Redirect } from '../../../design/pilot/nearAuthApi';
import { PilotAccess } from '../../../design/pilot/PilotAccess';
import {
  getTestnetWalletSelector,
  setWalletSelectorDriverForTests,
  WalletNotInstalledError,
  type WalletSelectorModuleId,
} from '../../../design/pilot/walletSelectorRuntime';
import { renderPlanetsSection } from '../../pages/me/sections/PlanetsHistoryPlaySections';
import { makeW12ProfileFixture } from '../../pages/me/testFixtures';

const SAMPLE_PUBKEY = 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp';
const SAMPLE_SIG_B64 = btoa('a'.repeat(64));
const SAMPLE_NONCE_B64 = btoa('n'.repeat(32));

function makeChallengeResponse(id = 'ch_0123456789abcdef0123456789abcdef') {
  return {
    challengeId: id,
    message: `Sign in to TerraAgent\nNetwork: testnet\nChallenge: ${id}`,
    nonce: SAMPLE_NONCE_B64,
    recipient: 'terraagent.testnet',
    network: 'testnet' as const,
    expiresAt: Date.now() + 300_000,
  };
}

const controls: PilotAccess[] = [];
afterEach(() => {
  controls.splice(0).forEach((c) => c.dispose());
  setWalletSelectorDriverForTests(null);
  setFastAuthPopupDriverForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.replaceChildren();
});

describe('pilot access session restore & near-cli-rs verification', () => {
  it('keeps single sign-in button (without Guest pilot text) until refresh confirms a linked pilot', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ accessToken: 'jwt', player: { id: 'p', handle: 'pilot', isGuest: false } }),
      }),
    );
    const parent = document.createElement('div');
    controls.push(new PilotAccess(parent));
    expect(parent.textContent).not.toContain('Guest pilot');
    expect(parent.querySelector('[data-testid="pilot-sign-in"]')?.textContent).toBe('Sign in');
    expect(parent.querySelector('a')).toBeNull();
    await vi.waitFor(() => expect(parent.querySelector('a')?.target).toBe('_blank'));
    expect(parent.querySelector('a')?.rel).toBe('noopener noreferrer');
    expect(parent.querySelector('a')?.getAttribute('href')).toBe('/me.html');
    expect(JSON.parse(localStorage.getItem('ta_active_pilot')!).playerId).toBe('p');
    const signOutBtn = parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-out"]');
    expect(signOutBtn?.textContent).toBe('Sign out');
    signOutBtn!.click();
    await vi.waitFor(() => expect(parent.querySelector('[data-testid="pilot-sign-in"]')?.textContent).toBe('Sign in'));
    expect(localStorage.getItem('ta_active_pilot')).toBeNull();
  });

  it('rejects unsolicited OAuth messages, renders Sign In / Sign Up + 6 Testnet wallets, and verifies near-cli-rs NEP-413 output', async () => {
    const verifyBodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/v1/auth/refresh') return { ok: false };
        if (url === '/v1/auth/near/challenge') {
          return { ok: true, json: async () => makeChallengeResponse('ch_cli_challenge_000123456789') };
        }
        if (url === '/v1/auth/near/verify') {
          verifyBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return {
            ok: true,
            json: async () => ({
              accessToken: 'jwt-cli',
              expiresIn: 900,
              accountId: 'commander.testnet',
              player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'commander', isGuest: false },
            }),
          };
        }
        return { ok: false };
      }),
    );
    const parent = document.createElement('div');
    controls.push(new PilotAccess(parent));

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: location.origin,
        data: { type: 'terra:mock-token', provider: 'google', token: 'forged' },
      }),
    );
    await Promise.resolve();
    expect(parent.querySelector('a')).toBeNull();

    parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    expect(parent.querySelector('[data-testid="pilot-mode-signin"]')).not.toBeNull();
    expect(parent.querySelector('[data-testid="pilot-mode-signup"]')).not.toBeNull();
    expect(parent.querySelector('[data-testid="continue-google"]')?.textContent).toBe('Google');
    expect(parent.querySelector('[data-testid="continue-x"]')?.textContent).toBe('X');
    expect(parent.querySelector('[data-testid="continue-email"]')).not.toBeNull();

    parent.querySelector<HTMLButtonElement>('[data-testid="continue-near"]')!.click();
    const nearModal = document.querySelector<HTMLDialogElement>('[data-testid="near-wallet-modal"]')!;
    for (const walletBtn of ['meteor', 'okx', 'mobile', 'cli', 'intear', 'mynearwallet']) {
      expect(nearModal.querySelector(`[data-testid="near-wallet-${walletBtn}"]`)).not.toBeNull();
    }

    nearModal.querySelector<HTMLButtonElement>('[data-testid="near-wallet-cli"]')!.click();
    await vi.waitFor(() =>
      expect(nearModal.querySelector('[data-testid="near-cli-command"]')?.textContent).toContain('sign-nep413'),
    );

    const acctInput = nearModal.querySelector<HTMLInputElement>('[data-testid="near-account-input"]')!;
    acctInput.value = 'commander.near';
    nearModal.querySelector<HTMLButtonElement>('[data-testid="near-account-submit"]')!.click();
    expect(nearModal.querySelector('[data-testid="near-cli-error"]')?.textContent).toContain('Mainnet');
    expect(verifyBodies).toHaveLength(0);

    const sigInput = nearModal.querySelector<HTMLInputElement>('[data-testid="near-signature-input"]')!;
    sigInput.value = JSON.stringify({
      accountId: 'commander.testnet',
      publicKey: SAMPLE_PUBKEY,
      signature: 'ed25519:3s11111111111111111111111111111111111111111111111111111111111111',
    });
    sigInput.dispatchEvent(new Event('input'));
    expect(acctInput.value).toBe('commander.testnet');

    nearModal.querySelector<HTMLButtonElement>('[data-testid="near-account-submit"]')!.click();
    await vi.waitFor(() => expect(parent.querySelector('a')?.textContent).toContain('commander'));
    expect(JSON.parse(localStorage.getItem('ta_active_pilot')!).accountId).toBe('commander.testnet');
    expect(verifyBodies).toHaveLength(1);
  });
});

function installMockWalletVerifyFetch(verifiedPayloads: Array<{ accountId: string; walletId?: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/v1/auth/refresh') return { ok: false };
      if (url === '/v1/auth/near/challenge') {
        return { ok: true, json: async () => makeChallengeResponse(`ch_${Date.now()}_0123456789abcdef`) };
      }
      if (url === '/v1/auth/near/verify') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { accountId: string; walletId?: string };
        verifiedPayloads.push(body);
        return {
          ok: true,
          json: async () => ({
            accessToken: 'jwt-near',
            expiresIn: 900,
            accountId: body.accountId,
            player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: body.accountId.split('.')[0], isGuest: false },
          }),
        };
      }
      if (url === '/v1/auth/logout') return { ok: true };
      return { ok: false };
    }),
  );
}

describe('Wallet Selector Testnet NEP-413 & FastAuth Email popup flows', () => {
  it('signs NEP-413 challenges for NEAR Mobile, Meteor, Intear, MyNearWallet, and handles missing OKX extension', async () => {
    ensureBrowserPolyfills();
    expect(typeof (globalThis as { Buffer?: { from?: unknown } }).Buffer?.from).toBe('function');

    const signedModules: WalletSelectorModuleId[] = [];
    setWalletSelectorDriverForTests({
      async signChallenge(moduleId, challenge, _callbackUrl, progress) {
        signedModules.push(moduleId);
        progress?.onStep?.(`Signing with ${moduleId}…`);
        if (moduleId === 'okx-wallet') {
          throw new WalletNotInstalledError('OKX Wallet', 'https://web3.okx.com/download');
        }
        return {
          challengeId: challenge.challengeId,
          accountId: `${moduleId.split('-')[0]}.testnet`,
          publicKey: SAMPLE_PUBKEY,
          signature: SAMPLE_SIG_B64,
          walletId: moduleId,
        };
      },
      async signOutActiveWallet() {},
    });

    const verifiedPayloads: Array<{ accountId: string; walletId?: string }> = [];
    installMockWalletVerifyFetch(verifiedPayloads);

    const parent = document.createElement('div');
    controls.push(new PilotAccess(parent));

    parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    parent.querySelector<HTMLButtonElement>('[data-testid="continue-near"]')!.click();
    let nearModal = document.querySelector<HTMLDialogElement>('[data-testid="near-wallet-modal"]')!;
    nearModal.querySelector<HTMLButtonElement>('[data-testid="near-wallet-okx"]')!.click();
    await vi.waitFor(() => expect(nearModal.querySelector('[data-testid="near-wallet-external-link"]')).not.toBeNull());

    nearModal.querySelector<HTMLButtonElement>('[data-testid="near-wallet-mobile"]')!.click();
    await vi.waitFor(() => expect(parent.querySelector('a')?.textContent).toContain('near'));
    expect(verifiedPayloads.at(-1)).toMatchObject({ accountId: 'near.testnet', walletId: 'near-mobile-wallet' });

    for (const [btnTestId, expectedMod, expectedHandle] of [
      ['near-wallet-meteor', 'meteor-wallet', 'meteor'],
      ['near-wallet-intear', 'intear-wallet', 'intear'],
      ['near-wallet-mynearwallet', 'my-near-wallet', 'my'],
    ] as const) {
      parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-out"]')!.click();
      await vi.waitFor(() => expect(parent.querySelector('[data-testid="pilot-sign-in"]')).not.toBeNull());
      parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
      parent.querySelector<HTMLButtonElement>('[data-testid="continue-near"]')!.click();
      nearModal = document.querySelector<HTMLDialogElement>('[data-testid="near-wallet-modal"]')!;
      nearModal.querySelector<HTMLButtonElement>(`[data-testid="${btnTestId}"]`)!.click();
      await vi.waitFor(() => expect(parent.querySelector('a')?.textContent).toContain(expectedHandle));
      expect(signedModules).toContain(expectedMod);
    }
  });

  it('authenticates Email / Passkey in Sign-Up mode via @auth0/auth0-spa-js FastAuth popup', async () => {
    const popupCalls: Array<{ email?: string; mode?: string }> = [];
    setFastAuthPopupDriverForTests(async (opts) => {
      popupCalls.push({ email: opts.email, mode: opts.mode });
      return { idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJlbWFpbHw5OSJ9.sig', email: opts.email ?? null };
    });

    const socialPosts: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/v1/auth/refresh') return { ok: false };
        if (url === '/v1/auth/social') {
          socialPosts.push(JSON.parse(String(init?.body ?? '{}')));
          return {
            ok: true,
            json: async () => ({
              accessToken: 'jwt-email',
              expiresIn: 900,
              accountId: 'newpilot.terraagent.testnet',
              player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'newpilot', isGuest: false },
            }),
          };
        }
        return { ok: false };
      }),
    );

    const parent = document.createElement('div');
    controls.push(new PilotAccess(parent));
    parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    parent.querySelector<HTMLButtonElement>('[data-testid="pilot-mode-signup"]')!.click();
    parent.querySelector<HTMLInputElement>('[data-testid="pilot-email-input"]')!.value = 'NewPilot@TerraAgent.fun';
    parent.querySelector<HTMLButtonElement>('[data-testid="continue-email"]')!.click();

    await vi.waitFor(() => expect(parent.querySelector('a')?.textContent).toContain('newpilot'));
    expect(popupCalls).toEqual([{ email: 'newpilot@terraagent.fun', mode: 'signup' }]);
    expect(socialPosts).toEqual([
      { provider: 'email', token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJlbWFpbHw5OSJ9.sig' },
    ]);
  });
});

describe('NEAR NEP-413 & FastAuth PKCE URL builders and callback security', () => {
  it('rejects unsigned callbacks and parses NEP-413 signed MyNearWallet redirects', () => {
    expect(
      consumeNearWalletCallback({
        search: '?near_wallet_callback=1&account_id=alice.testnet&all_keys=ed25519%3Aabc',
        origin: 'https://terraagent.fun',
        pathname: '/landing.html',
        opener: null,
      }),
    ).toBeNull();

    const signUrl = buildNearWalletSignMessageUrl({
      message: 'Sign in to TerraAgent',
      nonce: SAMPLE_NONCE_B64,
      recipient: 'terraagent.testnet',
      callbackUrl: 'https://terraagent.fun/landing.html',
      state: 'ch_redirect_0123456789abcdef',
    });
    expect(signUrl).toContain('https://testnet.mynearwallet.com/sign-message?');
    savePendingNep413Redirect({
      challengeId: 'ch_redirect_0123456789abcdef',
      callbackUrl: 'https://terraagent.fun/landing.html',
      walletId: 'my-near-wallet',
    });
    const nep413Redirect = consumeNearWalletCallback({
      search: '',
      hash: `#accountId=alice.testnet&publicKey=${encodeURIComponent(SAMPLE_PUBKEY)}&signature=${encodeURIComponent(SAMPLE_SIG_B64)}&state=ch_redirect_0123456789abcdef`,
      origin: 'https://terraagent.fun',
      pathname: '/landing.html',
      opener: null,
    });
    expect(nep413Redirect?.provider).toBe('near-wallet');
    expect(decodeNep413SocialToken(nep413Redirect!.token)).toEqual({
      challengeId: 'ch_redirect_0123456789abcdef',
      accountId: 'alice.testnet',
      publicKey: SAMPLE_PUBKEY,
      signature: SAMPLE_SIG_B64,
      callbackUrl: 'https://terraagent.fun/landing.html',
      walletId: 'my-near-wallet',
    });
  });

  it('keeps PKCE code_verifier out of URLs, enforces single-use CSRF state, and supports Sign-Up screen_hint', () => {
    const googleUrl = buildFastAuthLoginUrl('https://terraagent.fun', '/me.html', 'google', {
      verifier: 'super-secret-pkce-verifier-value',
      stateId: 'state1234567890ab',
      nonce: 'nonce1234567890ab',
    });
    expect(googleUrl).toContain('connection=google-oauth2');
    expect(googleUrl).toContain('code_challenge_method=S256');
    expect(googleUrl).not.toContain('super-secret-pkce-verifier-value');

    expect(
      consumeNearWalletCallback({
        search: '?code=authcode99&state=terra-pkce%3Agoogle%3Aforgedstate',
        origin: 'https://terraagent.fun',
        pathname: '/',
        opener: null,
      }),
    ).toBeNull();

    const pkceParsed = consumeNearWalletCallback({
      search: '?code=authcode99&state=terra-pkce%3Agoogle%3Astate1234567890ab',
      origin: 'https://terraagent.fun',
      pathname: '/',
      opener: null,
    });
    expect(pkceParsed).toEqual({
      provider: 'google',
      token:
        'fastauth-code:authcode99:super-secret-pkce-verifier-value:https%3A%2F%2Fterraagent.fun%2F:nonce1234567890ab',
    });
    expect(
      consumeNearWalletCallback({
        search: '?code=authcode99&state=terra-pkce%3Agoogle%3Astate1234567890ab',
        origin: 'https://terraagent.fun',
        pathname: '/',
        opener: null,
      }),
    ).toBeNull();

    const xSignupUrl = buildFastAuthLoginUrl('https://terraagent.fun', '/trade.html', 'x', {
      mode: 'signup',
      stateId: 'xstate1234567890',
    });
    expect(xSignupUrl).toContain('connection=twitter');
    expect(xSignupUrl).toContain('screen_hint=signup');
    expect(
      consumeNearWalletCallback({
        search:
          '?error=invalid_request&error_description=the%20connection%20is%20not%20enabled&state=terra-pkce%3Ax%3Axstate1234567890',
        origin: 'https://terraagent.fun',
        pathname: '/',
        opener: null,
      }),
    ).toBeNull();
    expect(consumePendingOAuthError()?.message).toContain('X sign-in is not enabled in Auth0 yet');
  });
});

describe('OAuth popup error handling & real @near-wallet-selector/core Testnet bootstrap', () => {
  it('displays popup OAuth errors in PilotAccess instead of silently falling back to Google', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const popupFake = {} as Window;
    vi.spyOn(window, 'open').mockReturnValue(popupFake);
    const parent = document.createElement('div');
    controls.push(new PilotAccess(parent));

    parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    parent.querySelector<HTMLButtonElement>('[data-testid="continue-x"]')!.click();

    const errMsg = 'X sign-in is not enabled in Auth0 yet (enable the "twitter" social connection).';
    expect(
      readOAuthError(
        {
          origin: location.origin,
          source: popupFake,
          data: { type: 'terra:oauth-error', provider: 'x', error: 'invalid_request', message: errMsg },
        },
        popupFake,
        location.origin,
      ),
    ).toEqual({ provider: 'x', error: 'invalid_request', message: errMsg });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: location.origin,
        source: popupFake,
        data: { type: 'terra:oauth-error', provider: 'x', error: 'invalid_request', message: errMsg },
      }),
    );
    expect(parent.querySelector('[role="status"]')?.textContent).toBe(errMsg);
  });

  it('supports Google, X, Email, and NEAR Wallet tokens in readMockToken and routes mocked Dive in', () => {
    const popup = {};
    expect(
      readMockToken(
        {
          origin: 'http://127.0.0.1:5173',
          source: popup,
          data: { type: 'terra:mock-token', provider: 'near-wallet', token: 'nep413:abc' },
        },
        popup,
        'http://127.0.0.1:5173',
      ),
    ).toEqual({ provider: 'near-wallet', token: 'nep413:abc' });

    const section = renderPlanetsSection(makeW12ProfileFixture());
    expect(section.querySelector('a')?.getAttribute('href')).toBe('/play.html?scenario=w12&as=w12');
  });

  it('initializes real @near-wallet-selector/core on Testnet with Meteor, OKX, NEAR Mobile, Intear, and MyNearWallet modules', async () => {
    const selector = await getTestnetWalletSelector();
    expect(selector.options.network.networkId).toBe('testnet');
    const moduleIds = selector.store.getState().modules.map((m) => m.id);
    expect(moduleIds).toEqual([
      'meteor-wallet',
      'okx-wallet',
      'near-mobile-wallet',
      'intear-wallet',
      'my-near-wallet',
    ]);
  });
});
