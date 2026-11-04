import { describe, expect, it } from 'vitest';
import { bootAuthAndHome, createLocalBootFallback, devPlanetTypeOfKind, type FetchLike, type StorageLike } from './bootOnline';
import { activeHome } from './homeFixture';

const memory = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

describe('orbit pick → dev planet of that type (one dev planet per type)', () => {
  it('maps the orbit pick to a planet type (no pick → server default)', () => {
    expect(devPlanetTypeOfKind('dune')).toBe('desert');
    expect(devPlanetTypeOfKind('oceanForest')).toBe('ocean');
    expect(devPlanetTypeOfKind('forestRock')).toBe('temperate');
    expect(devPlanetTypeOfKind(null)).toBeUndefined();
  });

  it.each(['', '&colonyId=co_selected'])('sends the planet type and selected colony to home: %s', async (selected) => {
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(String(url));
      const json = String(url).includes('/auth/guest')
        ? { accessToken: 'jwt', expiresIn: 900, player: { id: 'pr_x', handle: 'X', isGuest: true } }
        : activeHome({ planetId: 'pl_dev_ocean', type: 'ocean', spawnQ: 1, spawnR: 2 });
      return { ok: true, status: 200, json: async () => json } as unknown as Response;
    };
    const boot = await bootAuthAndHome({ fetch, storage: memory(), search: `?skip=1${selected}`, planetType: 'ocean' });
    expect(urls).toContain(`/v1/me/home?type=ocean${selected}`);
    expect([boot.mode, boot.planet.id, boot.planet.type]).toEqual(['online', 'pl_dev_ocean', 'ocean']);
  });

  it('the no-backend local fallback builds the planet of the picked type', () => {
    const fb = createLocalBootFallback('device-secret-0123456789abcdef', undefined, undefined, 'temperate');
    expect([fb.planet.id, fb.planet.type]).toEqual(['pl_dev_temperate', 'temperate']);
    expect(fb.localHost?.state.meta.planetType).toBe('temperate');
    const def = createLocalBootFallback('device-secret-0123456789abcdef');
    expect([def.planet.id, def.planet.type, def.localHost?.state.meta.planetType]).toEqual(['pl_dev', 'desert', 'desert']);
    expect(def.isGuest).toBe(true);
    expect(def.accountId).toBeUndefined();
  });

  it('omitted isGuest stays a guest; a pilot id on the auth JSON is kept', async () => {
    const bodies = [
      { accessToken: 'jwt', expiresIn: 900, player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'C' } },
      { accessToken: 'jwt-linked', expiresIn: 900, player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'P', isGuest: false }, accountId: 'test-pilot.terraagent.mock' },
    ];
    let n = 0;
    const fetch: FetchLike = async (url) => {
      const json = String(url).includes('/auth/') ? bodies[n++] : activeHome();
      return { ok: true, status: 200, json: async () => json };
    };
    const guest = await bootAuthAndHome({ fetch, storage: memory(), search: '?as=omit-guest' });
    expect(guest.isGuest).toBe(true);
    expect(guest.accountId).toBeUndefined();
    const linked = await bootAuthAndHome({ fetch, storage: memory(), search: '?as=linked-pilot' });
    expect(linked.isGuest).toBe(false);
    expect(linked.accountId).toBe('test-pilot.terraagent.mock');
    expect(linked.accessToken).toBe('jwt-linked');
  });
});
