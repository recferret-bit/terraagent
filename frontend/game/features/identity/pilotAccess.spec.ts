// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PilotAccess } from '../../../design/pilot/PilotAccess';
import {
  buildFastAuthLoginUrl,
  buildNearWalletLoginUrl,
  consumeNearWalletCallback,
  readMockToken,
} from '../../../design/pilot/mockToken';
import { renderPlanetsSection } from '../../pages/me/sections/PlanetsHistoryPlaySections';
import { makeW12ProfileFixture } from '../../pages/me/testFixtures';

const controls: PilotAccess[] = [];
afterEach(() => {
  controls.splice(0).forEach((c) => c.dispose());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.replaceChildren();
});

describe('pilot access outside gameplay', () => {
  it('keeps single sign-in button (without Guest pilot text) until refresh confirms a linked pilot', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
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
  });

  it('does not expose ME after failed refresh or accept unsolicited OAuth messages, and opens provider dialog on click', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetcher);
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
    const signInBtn = parent.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]');
    expect(signInBtn).not.toBeNull();
    signInBtn!.click();
    const dialog = parent.querySelector<HTMLDialogElement>('[data-testid="pilot-provider-dialog"]');
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(parent.querySelector('[data-testid="continue-google"]')?.textContent).toBe('Google');
    expect(parent.querySelector('[data-testid="continue-x"]')?.textContent).toBe('X');
    const nearBtn = parent.querySelector<HTMLButtonElement>('[data-testid="continue-near"]');
    expect(nearBtn?.textContent).toBe('NEAR');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    nearBtn!.click();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]?.[0]).toContain('https://testnet.mynearwallet.com/login/');
    expect(openSpy.mock.calls[0]?.[1]).toBe('terra-near-wallet');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('builds real NEAR wallet login URLs and parses near_wallet_callback redirects', () => {
    const url = buildNearWalletLoginUrl('https://terraagent.fun', '/landing.html');
    expect(url).toContain('https://testnet.mynearwallet.com/login/?');
    expect(url).toContain(encodeURIComponent('https://terraagent.fun/landing.html?near_wallet_callback=1'));
    const parsed = consumeNearWalletCallback({
      search: '?near_wallet_callback=1&account_id=alice.testnet&all_keys=ed25519%3Aabc',
      origin: 'https://terraagent.fun',
      pathname: '/landing.html',
      opener: null,
    });
    expect(parsed).toEqual({
      provider: 'fastauth',
      token: 'near-wallet:alice.testnet:ed25519:abc',
    });

    const googleUrl = buildFastAuthLoginUrl('https://terraagent.fun', '/landing.html', 'google', { verifier: 'v123' });
    expect(googleUrl).toContain('https://dev-ep2ml1ryu5jcs8pz.us.auth0.com/authorize?');
    expect(googleUrl).toContain('client_id=GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL');
    expect(googleUrl).toContain('connection=google-oauth2');
    const fastAuthParsed = consumeNearWalletCallback({
      search: '?code=authcode99&state=terra-fastauth%3Agoogle%3Av123%3Ahttps%253A%252F%252Fterraagent.fun%252Flanding.html',
      origin: 'https://terraagent.fun',
      pathname: '/landing.html',
      opener: null,
    });
    expect(fastAuthParsed).toEqual({
      provider: 'google',
      token: 'fastauth-code:authcode99:v123:https%3A%2F%2Fterraagent.fun%2Flanding.html',
    });
  });

  it('supports Google, X, and NEAR tokens in readMockToken', () => {
    const popup = {};
    expect(
      readMockToken(
        { origin: 'http://127.0.0.1:5173', source: popup, data: { type: 'terra:mock-token', provider: 'fastauth', token: 'n.b' } },
        popup,
        'http://127.0.0.1:5173',
      ),
    ).toEqual({ provider: 'fastauth', token: 'n.b' });
  });

  it('routes mocked Dive in through a supported scenario instead of an ignored join parameter', () => {
    const section = renderPlanetsSection(makeW12ProfileFixture());
    expect(section.querySelector('a')?.getAttribute('href')).toBe('/play.html?scenario=w12&as=w12');
  });
});
