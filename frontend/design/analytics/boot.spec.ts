// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyAuthFailure, succeedAuth, beginAuth } from './auth';

const track = vi.fn();
vi.mock('../../game/core/analytics', () => ({
  track: (...args: unknown[]) => track(...args),
  setConsent: vi.fn(),
  getConsent: () => false,
  flush: async () => undefined,
}));

async function bootLanding(): Promise<void> {
  vi.resetModules();
  const { bootProductAnalytics } = await import('./boot');
  bootProductAnalytics('landing');
}

describe('product analytics boot', () => {
  beforeEach(() => {
    track.mockClear();
    document.body.innerHTML = '';
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
});
