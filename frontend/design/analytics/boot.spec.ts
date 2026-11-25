// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserDeps, resetBrowserAnalyticsForTest } from '../../game/core/analytics/browser';
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
    resetBrowserAnalyticsForTest();
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

  it('boots cookieless immediately with no dialog, writes zero cookies, tracks surface_viewed and drops a bad utm', async () => {
    consentAllowed = true;
    await bootLanding();
    expect(fetch).toHaveBeenCalledWith('/v1/analytics/surface', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ surface: 'landing', consent: 'allow' }),
    }));
    expect(document.querySelector('[data-testid="analytics-consent"]')).toBeNull();
    expect(document.querySelector('[data-testid="analytics-consent-allow"]')).toBeNull();
    expect(document.cookie).not.toContain('ta_aid');
    expect(document.cookie).not.toContain('ta_consent');
    expect(document.cookie).not.toContain('ta_ft');
    expect(track.mock.calls.map((call) => call[0])).toEqual(['surface_viewed']);
    expect(track.mock.calls[0]?.[1]).toMatchObject({
      surface: 'landing',
      runtime: 'local',
      viewport: 'desktop',
      referrer_class: 'direct',
      path_group: 'landing',
      utm_source: 'newsletter',
      utm_campaign: 'spring',
      first_touch: '1',
    });
    expect(track.mock.calls[0]?.[1]).not.toHaveProperty('utm_medium');
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('honors Global Privacy Control by pinging decline and tracking nothing', async () => {
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    await bootLanding();
    expect(fetch).toHaveBeenCalledWith('/v1/analytics/surface', expect.objectContaining({
      body: JSON.stringify({ surface: 'landing', consent: 'decline' }),
    }));
    expect(document.querySelector('[data-testid="analytics-consent"]')).toBeNull();
    expect(track).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('honors a legacy ta_consent=analytics:0 opt-out cookie', async () => {
    document.cookie = 'ta_consent=analytics:0; Path=/';
    await bootLanding();
    expect(fetch).toHaveBeenCalledWith('/v1/analytics/surface', expect.objectContaining({
      body: JSON.stringify({ surface: 'landing', consent: 'decline' }),
    }));
    expect(track).not.toHaveBeenCalled();
  });

  it('marks intra-site navigation from terraagent.fun as first_touch 0 without cookies', async () => {
    const { firstTouchBit } = await import('./context');
    expect(firstTouchBit('')).toBe('1');
    expect(firstTouchBit('https://google.com/')).toBe('1');
    expect(firstTouchBit('https://terraagent.fun/landing.html')).toBe('0');
    expect(firstTouchBit('https://play.terraagent.fun/')).toBe('0');
    expect(document.cookie).not.toContain('ta_ft');
  });

  it('browserDeps defaults to cookieless enabled, writes zero cookies, and honors GPC and opt-out', () => {
    const deps = browserDeps();
    expect(deps.readConsent()).toBe(true);
    const id = deps.anonId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(deps.anonId()).toBe(id);
    expect(document.cookie).not.toContain('ta_aid');
    expect(document.cookie).not.toContain('ta_consent');

    deps.writeConsent(false);
    expect(deps.readConsent()).toBe(false);
    expect(document.cookie).not.toContain('ta_consent');

    deps.writeConsent(true);
    expect(deps.readConsent()).toBe(true);
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true });
    expect(deps.readConsent()).toBe(false);
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

  it('tracks staking profile section and preserves wallet_kind on wallet redirect recovery without writing cookies', () => {
    track.mockClear();
    consentAllowed = true;
    noteProfileSection('staking');
    noteProfileSection('not-a-section');
    rememberAuthProvider('near-wallet', 'my-near-wallet');
    const headers = consentedAuthHeaders();
    expect(headers).toEqual({
      'x-terra-anon': expect.stringMatching(/^[0-9a-f-]{36}$/i),
      'x-terra-wallet': 'my-near-wallet',
    });
    expect(consentedAuthHeaders()['x-terra-anon']).toBe(headers['x-terra-anon']);
    expect(document.cookie).not.toContain('ta_aid');
    succeedAuth();
    expect(track.mock.calls.map(([n, p]) => [n, p])).toEqual([
      ['profile_section_opened', { section: 'staking', runtime: 'local' }],
      ['auth_started', expect.objectContaining({ method: 'near-wallet', wallet_kind: 'my-near-wallet' })],
      ['auth_succeeded', expect.objectContaining({ method: 'near-wallet', wallet_kind: 'my-near-wallet' })],
    ]);
  });

  afterEach(() => { consentAllowed = false; });
});
