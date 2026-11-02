// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { loadFeatures } from '../../core/registry';
import type { TextClipboard } from './copyText';
import identity from './index';
import { readMockToken } from './mockToken';

interface PilotDouble {
  calls: Array<['google' | 'x', string]>;
  view(): { isGuest: boolean; handle: string; accountId: string | null; accessToken: string };
  subscribe(fn: () => void): () => void;
  loginSocial(provider: 'google' | 'x', token: string): Promise<void>;
}

function fakePilot(): PilotDouble {
  let state = { isGuest: true, handle: 'Colonist', accountId: null as string | null, accessToken: 'jwt-guest' };
  const listeners = new Set<() => void>();
  const calls: PilotDouble['calls'] = [];
  return {
    calls,
    view: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async loginSocial(provider, token) {
      calls.push([provider, token]);
      state = { isGuest: false, handle: 'Test Pilot', accountId: 'test-pilot.terraagent.mock', accessToken: 'jwt-linked' };
      for (const fn of listeners) fn();
    },
  };
}

function mount(pilot?: PilotDouble, clipboard?: TextClipboard) {
  document.body.replaceChildren();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const services = { ...(pilot ? { pilot } : {}), ...(clipboard ? { clipboard } : {}) };
  const ctx = { flags: new Set(['W06']), host: 'server', services } as unknown as FeatureContext;
  const panel = identity.hud![0]!.mount(el, ctx);
  return { el, panel };
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('identity pilot chip (W06-15)', () => {
  it('is server-only and off unless W06 is on', () => {
    expect(identity).toMatchObject({ id: 'identity', wave: 'W06', hostOnly: 'server' });
    expect(identity.hud?.[0]).toMatchObject({ slot: 'top-left', order: 20 });
    const on = (flags: string[], host: 'server' | 'local') => loadFeatures({ flags: new Set(flags), host }).some((f) => f.id === 'identity');
    expect(on(['W00'], 'server')).toBe(false);
    expect(on(['W00', 'W06'], 'local')).toBe(false);
    expect(on(['W06'], 'server')).toBe(true);
  });

  it('starts as Guest pilot, opens the provider plate, then shows the Pilot ID when loginSocial resolves', async () => {
    const pilot = fakePilot();
    const { el, panel } = mount(pilot);
    expect(el.querySelector('.ta-pilot__label')!.textContent).toBe('Guest pilot');
    expect(el.querySelector('[data-testid="save-progress"]')!.textContent).toBe('Save progress');
    expect(el.querySelector('[data-testid="pilot-chip"]')!.textContent).toContain('Guest pilot');
    expect(el.querySelector('[data-testid="pilot-chip"]')!.textContent).toContain('·');
    expect(el.querySelector('[data-testid="pilot-chip"]')!.textContent).toContain('Save progress');
    expect(el.querySelector('[data-testid="pilot-id"]')).toBeNull();
    expect(el.querySelector('[data-testid="continue-google"]')).toBeNull();

    (el.querySelector('[data-testid="save-progress"]') as HTMLButtonElement).click();
    expect(el.querySelector('[data-testid="continue-google"]')!.textContent).toBe('Continue with Google (mock)');
    expect(el.querySelector('[data-testid="continue-x"]')!.textContent).toBe('Continue with X (mock)');

    await pilot.loginSocial('google', 'unused-by-the-chip');
    expect(el.querySelector('[data-testid="pilot-id"]')!.textContent).toBe('Pilot ID test-pilot.terraagent.mock');
    expect(el.textContent).not.toContain('Guest pilot');
    expect(el.querySelector('[data-testid="save-progress"]')).toBeNull();
    panel.dispose();
  });

  it('ignores a mock token from the wrong origin or the wrong window', async () => {
    const pilot = fakePilot();
    const { el, panel } = mount(pilot);
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const popup = frame.contentWindow as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);

    (el.querySelector('[data-testid="save-progress"]') as HTMLButtonElement).click();
    (el.querySelector('[data-testid="continue-google"]') as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith(
      '/dev/mock-oauth?provider=google&return=' + encodeURIComponent(location.pathname + location.search),
      'terra-mock-oauth',
      'popup,width=480,height=640',
    );

    const token = { type: 'terra:mock-token', provider: 'google', token: 'tok-1' };
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', source: popup, data: token }));
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data: token }));
    await Promise.resolve();
    expect(pilot.calls).toEqual([]);

    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: popup, data: token }));
    await Promise.resolve();
    expect(pilot.calls).toEqual([['google', 'tok-1']]);
    expect(el.querySelector('[data-testid="pilot-id"]')!.textContent).toBe('Pilot ID test-pilot.terraagent.mock');
    panel.dispose();
  });

  it('readMockToken drops a bad origin, a foreign source, and a malformed body', () => {
    const popup = { name: 'popup' };
    const good = { type: 'terra:mock-token', provider: 'x' as const, token: 't' };
    expect(readMockToken({ origin: 'https://evil.example', source: popup, data: good }, popup, 'http://play.test')).toBeNull();
    expect(readMockToken({ origin: 'http://play.test', source: {}, data: good }, popup, 'http://play.test')).toBeNull();
    expect(readMockToken({ origin: 'http://play.test', source: popup, data: { type: 'other', provider: 'x', token: 't' } }, popup, 'http://play.test')).toBeNull();
    expect(readMockToken({ origin: 'http://play.test', source: popup, data: good }, popup, 'http://play.test')).toEqual({ provider: 'x', token: 't' });
  });

  it('copies only the account id and marks the button ok', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const pilot = fakePilot();
    const { el, panel } = mount(pilot, { writeText });
    await pilot.loginSocial('google', 'unused-by-the-chip');
    expect(el.textContent).toContain('Pilot ID test-pilot.terraagent.mock');
    const copy = el.querySelector('[data-testid="pilot-copy"]') as HTMLButtonElement;
    expect(copy.textContent).toBe('Copy');
    expect(copy.className).toContain('btn-ghost');
    copy.click();
    await vi.waitFor(() => expect(copy.getAttribute('data-copied')).toBe('ok'));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('test-pilot.terraagent.mock');
    panel.dispose();
  });

  it('marks the copy button fail when the clipboard rejects and does not throw', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const pilot = fakePilot();
    const { el, panel } = mount(pilot, { writeText });
    await pilot.loginSocial('google', 'unused-by-the-chip');
    const copy = el.querySelector('[data-testid="pilot-copy"]') as HTMLButtonElement;
    expect(() => copy.click()).not.toThrow();
    await vi.waitFor(() => expect(copy.getAttribute('data-copied')).toBe('fail'));
    expect(writeText).toHaveBeenCalledWith('test-pilot.terraagent.mock');
    panel.dispose();
  });
});
