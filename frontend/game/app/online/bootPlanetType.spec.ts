import { describe, expect, it } from 'vitest';
import { bootAuthAndHome, createLocalBootFallback, devPlanetTypeOfKind, type FetchLike, type StorageLike } from './bootOnline';

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

  it('sends ?type= with GET /v1/me/home', async () => {
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(String(url));
      const json = String(url).includes('/auth/guest')
        ? { accessToken: 'jwt', expiresIn: 900, player: { id: 'pr_x', handle: 'X', isGuest: true } }
        : { state: 'ACTIVE', planet: { id: 'pl_dev_ocean', type: 'ocean' }, colony: { id: 'col_1', colonyIndex: 0, spawn: { q: 1, r: 2 } } };
      return { ok: true, status: 200, json: async () => json } as unknown as Response;
    };
    const boot = await bootAuthAndHome({ fetch, storage: memory(), search: '', planetType: 'ocean' });
    expect(urls).toContain('/v1/me/home?type=ocean');
    expect([boot.mode, boot.planet.id, boot.planet.type]).toEqual(['online', 'pl_dev_ocean', 'ocean']);
  });

  it('the no-backend local fallback builds the planet of the picked type', () => {
    const fb = createLocalBootFallback('device-secret-0123456789abcdef', undefined, undefined, 'temperate');
    expect([fb.planet.id, fb.planet.type]).toEqual(['pl_dev_temperate', 'temperate']);
    expect(fb.localHost?.state.meta.planetType).toBe('temperate');
    const def = createLocalBootFallback('device-secret-0123456789abcdef');
    expect([def.planet.id, def.planet.type, def.localHost?.state.meta.planetType]).toEqual(['pl_dev', 'desert', 'desert']);
  });
});
