// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PilotAccess } from '../../../design/pilot/PilotAccess';
import { renderPlanetsSection } from '../../pages/me/sections/PlanetsHistoryPlaySections';
import { makeW12ProfileFixture } from '../../pages/me/testFixtures';

const controls: PilotAccess[] = [];
afterEach(() => {
  controls.splice(0).forEach((c) => c.dispose());
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('pilot access outside gameplay', () => {
  it('keeps guest controls until refresh confirms a linked pilot', async () => {
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
    expect(parent.querySelector('a')).toBeNull();
    await vi.waitFor(() => expect(parent.querySelector('a')?.target).toBe('_blank'));
    expect(parent.querySelector('a')?.rel).toBe('noopener noreferrer');
    expect(parent.querySelector('a')?.getAttribute('href')).toBe('/me.html');
    expect(JSON.parse(localStorage.getItem('ta_active_pilot')!).playerId).toBe('p');
  });

  it('does not expose ME after failed refresh or accept unsolicited OAuth messages', async () => {
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
    expect(parent.querySelectorAll('button')).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('routes mocked Dive in through a supported scenario instead of an ignored join parameter', () => {
    const section = renderPlanetsSection(makeW12ProfileFixture());
    expect(section.querySelector('a')?.getAttribute('href')).toBe('/play.html?scenario=w12&as=w12');
  });
});
