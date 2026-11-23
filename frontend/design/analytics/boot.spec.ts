// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyAuthFailure, consentedAuthHeaders, rememberAuthProvider, succeedAuth, beginAuth,
} from './auth';
import { noteProfileSection } from './profile';

const track = vi.fn();
const flush = vi.fn(async () => undefined);
let consentAllowed = false;
vi.mock('../../game/core/analytics', () => ({
  track: (...args: unknown[]) => track(...args),
  setConsent: vi.fn((allowed: boolean) => { consentAllowed = allowed; }),
  getConsent: () => consentAllowed,
  flush: () => flush(),
}));

async function bootLanding(): Promise<void> {
  vi.resetModules();
  const { bootProductAnalytics } = await import('./boot');
  bootProductAnalytics('landing');
}

describe('product analytics boot', () => {
  beforeEach(async () => {
    track.mockClear();
    flush.mockClear();
    consentAllowed = false;
    document.body.innerHTML = '';
    const { resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
    document.cookie = 'ta_consent=; Path=/; Max-Age=0';
    document.cookie = 'ta_ft=; Path=/; Max-Age=0';
    document.cookie = 'ta_aid=; Path=/; Max-Age=0';
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: false });
    window.history.pushState({}, '', '/landing.html?utm_source=newsletter&utm_medium=bad%20utm&utm_campaign=spring');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
  });

  it('pings the surface without consent and does not track or mint an anon id', async () => {
    await bootLanding();
    expect(fetch).toHaveBeenCalledWith('/v1/analytics/surface', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ surface: 'landing', consent: 'unknown' }),
    }));
    expect(track).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('ta_aid');
    expect(document.querySelector('[data-testid="analytics-consent-allow"]')).not.toBeNull();
  });

  it('Allow tracks consent_granted then surface_viewed and drops a bad utm', async () => {
    await bootLanding();
    document.querySelector<HTMLButtonElement>('[data-testid="analytics-consent-allow"]')!.click();
    expect(track.mock.calls.map((call) => call[0])).toEqual(['consent_granted', 'surface_viewed']);
    expect(track.mock.calls[0]?.[1]).toMatchObject({ surface: 'landing', runtime: 'local' });
    expect(track.mock.calls[1]?.[1]).toMatchObject({
      surface: 'landing',
      runtime: 'local',
      viewport: 'desktop',
      referrer_class: 'direct',
      path_group: 'landing',
      utm_source: 'newsletter',
      utm_campaign: 'spring',
      first_touch: '1',
    });
    expect(track.mock.calls[1]?.[1]).not.toHaveProperty('utm_medium');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('does not offer Allow when Global Privacy Control is set and pings decline', async () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    await bootLanding();
    expect(fetch).toHaveBeenCalledWith('/v1/analytics/surface', expect.objectContaining({
      body: JSON.stringify({ surface: 'landing', consent: 'decline' }),
    }));
    expect(document.querySelector('[data-testid="analytics-consent-allow"]')).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});

describe('product analytics auth & ui boot', () => {
  it('maps every auth failure reason and never sends auth_completed', () => {
    expect(classifyAuthFailure({ popupBlocked: true })).toEqual({ stage: 'popup', reason: 'popup_blocked' });
    expect(classifyAuthFailure({ dismissed: true })).toEqual({ stage: 'popup', reason: 'dismissed' });
    expect(classifyAuthFailure({ oauth: true })).toEqual({ stage: 'oauth', reason: 'oauth_error' });
    expect(classifyAuthFailure({ status: 401 })).toEqual({ stage: 'verify', reason: 'rejected' });
    expect(classifyAuthFailure({ status: 400 })).toEqual({ stage: 'verify', reason: 'invalid' });
    expect(classifyAuthFailure({ network: true })).toEqual({ stage: 'verify', reason: 'network' });
    expect(classifyAuthFailure({ timeout: true })).toEqual({ stage: 'verify', reason: 'timeout' });
    expect(classifyAuthFailure({})).toEqual({ stage: 'verify', reason: 'unknown' });
    expect(classifyAuthFailure({ restore: true, network: true })).toEqual({ stage: 'restore', reason: 'network' });
    track.mockClear();
    beginAuth('email', 'none');
    succeedAuth();
    expect(track.mock.calls.map((call) => call[0])).toEqual(['auth_started', 'auth_succeeded']);
    expect(track.mock.calls.map((call) => call[0])).not.toContain('auth_completed');
  });

  it('tracks UI actions, HUD panel opens, and skips consent banner buttons', async () => {
    vi.resetModules();
    document.cookie = 'ta_consent=analytics:1; Path=/';
    const { bootProductAnalytics } = await import('./boot');
    const { noteHudPanelOpened, resetUiDelegationForTest } = await import('./ui');
    resetUiDelegationForTest();
    bootProductAnalytics('landing');
    track.mockClear();

    const playCta = document.createElement('a');
    playCta.className = 'btn btn-play-header';
    playCta.href = '/play.html?planet=dune';
    playCta.addEventListener('click', (e) => e.preventDefault());
    document.body.appendChild(playCta);
    playCta.click();

    const scenarioBtn = document.createElement('button');
    scenarioBtn.setAttribute('data-scenario-card', 'raid_defense');
    document.body.appendChild(scenarioBtn);
    scenarioBtn.click();

    noteHudPanelOpened('dock', 'build');

    expect(track.mock.calls.map((call) => call[0])).toEqual(['ui_action_clicked', 'ui_action_clicked', 'hud_panel_opened']);
    expect(track.mock.calls[0]?.[1]).toMatchObject({ surface: 'landing', area: 'nav', action: 'play_cta', target: 'play' });
    expect(track.mock.calls[1]?.[1]).toMatchObject({ surface: 'landing', area: 'director', action: 'select_scenario', target: 'raid_defense' });
    expect(track.mock.calls[2]?.[1]).toMatchObject({ book: 'dock', panel: 'build' });
  });
});

describe('product analytics pathGroup', () => {
  it('maps subdomain roots and 404 routes to their real path_group surface', async () => {
    const { pathGroup } = await import('./context');
    expect(pathGroup('/', 'play')).toBe('play');
    expect(pathGroup('/index.html', 'whitepaper')).toBe('whitepaper');
    expect(pathGroup('/', 'pitchdeck')).toBe('pitchdeck');
    expect(pathGroup('/foundations.html', 'design')).toBe('design');
    expect(pathGroup('/missing-sector', 'not_found')).toBe('not_found');
    expect(pathGroup('/', 'landing')).toBe('landing');
    expect(pathGroup('/', 'hub')).toBe('hub');
  });

  it('tracks staking profile section and preserves wallet_kind on wallet redirect recovery', () => {
    track.mockClear();
    consentAllowed = true;
    document.cookie = 'ta_aid=3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11; Path=/';
    noteProfileSection('staking');
    noteProfileSection('not-a-section');
    rememberAuthProvider('near-wallet', 'my-near-wallet');
    expect(consentedAuthHeaders()).toEqual({
      'x-terra-anon': '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c11',
      'x-terra-wallet': 'my-near-wallet',
    });
    succeedAuth();
    expect(track.mock.calls.map(([n, p]) => [n, p])).toEqual([
      ['profile_section_opened', { section: 'staking', runtime: 'local' }],
      ['auth_started', expect.objectContaining({ method: 'near-wallet', wallet_kind: 'my-near-wallet' })],
      ['auth_succeeded', expect.objectContaining({ method: 'near-wallet', wallet_kind: 'my-near-wallet' })],
    ]);
  });

  afterEach(() => { consentAllowed = false; });
});
