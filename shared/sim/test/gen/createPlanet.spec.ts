import { describe, expect, it } from 'vitest';
import { createPlanet, PREP, TERRAIN, hexIndex } from '../../src';

describe('createPlanet flat', () => {
  it('makes 9 577 flat, wild tiles and no colonies', () => {
    const s = createPlanet({ type: 'flat', seed: 'dev' });
    expect(s.grid.radius).toBe(56);
    expect(s.grid.count).toBe(9577);
    expect(s.grid.layers.terrain.every((t) => t === TERRAIN.flat)).toBe(true);
    expect(s.grid.layers.prep.every((p) => p === PREP.wild)).toBe(true);
    expect(s.grid.layers.owner.every((o) => o === -1)).toBe(true);
    expect(s.colonies).toEqual([]);
    expect(s.entities.count).toBe(0);
    expect(hexIndex(56).count).toBe(s.grid.count);
  });

  it('is reproducible and honours ids, types and radius', () => {
    const a = createPlanet({ type: 'flat', seed: 's', planetId: 'pl_x', planetType: 'desert', radius: 4 });
    expect(a).toEqual(createPlanet({ type: 'flat', seed: 's', planetId: 'pl_x', planetType: 'desert', radius: 4 }));
    expect(a.meta).toMatchObject({ planetId: 'pl_x', planetType: 'desert', tick: 0 });
    expect(a.grid.count).toBe(61);
  });

  it('refuses an unknown generator', () => {
    expect(() => createPlanet({ type: 'nope', seed: 's' })).toThrow(/unknown planet generator/);
  });
});
