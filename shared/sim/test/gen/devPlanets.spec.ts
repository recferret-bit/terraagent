import { describe, expect, it } from 'vitest';
import { DEV_PLANET_TYPE, DEV_PLANET_TYPES, devPlanetIdFor, devPlanetTypeOf, isDevPlanetType } from '../../src';

describe('dev planet families, one per planet type (owner 2026-11-01)', () => {
  it('desert keeps pl_dev, pl_dev_2…; ocean / temperate get their own families', () => {
    expect(DEV_PLANET_TYPE).toBe('desert');
    expect([1, 2, 3].map((i) => devPlanetIdFor('desert', i))).toEqual(['pl_dev', 'pl_dev_2', 'pl_dev_3']);
    expect([1, 2].map((i) => devPlanetIdFor('ocean', i))).toEqual(['pl_dev_ocean', 'pl_dev_ocean_2']);
    expect([1, 2].map((i) => devPlanetIdFor('temperate', i))).toEqual(['pl_dev_temperate', 'pl_dev_temperate_2']);
  });

  it('devPlanetTypeOf inverts devPlanetIdFor and rejects everything else', () => {
    for (const t of DEV_PLANET_TYPES) for (const i of [1, 2, 17]) expect(devPlanetTypeOf(devPlanetIdFor(t, i))).toBe(t);
    for (const id of ['pl_devx', 'pl_dev_', 'pl_dev_moon', 'pl_dev_ocean_x', 'pl_0000000000000000000000000A', 'pl_dev_2_3']) {
      expect(devPlanetTypeOf(id)).toBeNull();
    }
    expect(isDevPlanetType('ocean')).toBe(true);
    expect(isDevPlanetType('lava')).toBe(false);
    expect(isDevPlanetType(undefined)).toBe(false);
  });
});
