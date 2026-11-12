// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PilotAccess } from '../../../design/pilot/PilotAccess';
import { readMockToken } from '../../../design/pilot/mockToken';
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
    expect(parent.querySelector('[data-testid="continue-near"]')?.textContent).toBe('NEAR');
    expect(fetcher).toHaveBeenCalledTimes(1);
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
