import { describe, expect, it } from 'vitest';
import {
  createPlanet,
  ensureStarterHubSpace,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  PREP,
  STARTER_HUB_SEARCH_RADIUS,
  TERRAIN,
  getHubFootprintTiles,
  spawnColonyLanding,
  type PlanetType,
} from '../../src';

const BIOMES: PlanetType[] = ['desert', 'ocean', 'temperate'];

function hasReadySite(state: ReturnType<typeof createPlanet>, q: number, r: number): boolean {
  const R = STARTER_HUB_SEARCH_RADIUS;
  const hex = hexIndex(state.grid.radius);
  const { terrain, prep } = state.grid.layers;
  for (let dr = -R; dr <= R; dr++) {
    for (let dq = -R; dq <= R; dq++) {
      if (hexDistance(0, 0, dq, dr) > R) continue;
      const tiles = getHubFootprintTiles(q + dq, r + dr).map((p) => hex.indexOf(p.q, p.r));
      if (tiles.some((i) => i < 0)) continue;
      if (tiles.every((i) => terrain[i] === TERRAIN.flat && prep[i] !== PREP.ridge && prep[i] !== PREP.moat)) return true;
    }
  }
  return false;
}

describe('starter Hub space at landing', () => {
  it('every spawn slot has a valid, clear 3x3 Hub site nearby (all biomes, many seeds)', () => {
    for (const planetType of BIOMES) {
      for (let i = 0; i < 20; i++) {
        const state = createPlanet({ id: 'pl', seed: `starter-${planetType}-${i}`, type: 'temperate', planetType, radius: 56 });
        for (const slot of getSpawnSlots(state)) {
          expect(hasReadySite(state, slot.q, slot.r)).toBe(true);
        }
      }
    }
  });

  it('spawnColonyLanding levels a site even at an arbitrary explicit (bad) tile, deterministically', () => {
    const mk = () => createPlanet({ id: 'pl', seed: 'bad-site', type: 'temperate', radius: 56 });
    const a = mk();
    const b = mk();
    // Pick a tile far from any slot and make it hostile.
    const hex = hexIndex(a.grid.radius);
    for (const s of [a, b]) {
      for (let dr = -4; dr <= 4; dr++) for (let dq = -4; dq <= 4; dq++) {
        const i = hex.indexOf(3 + dq, 3 + dr);
        if (i >= 0 && hexDistance(0, 0, dq, dr) <= 4) {
          s.grid.layers.terrain[i] = TERRAIN.deep;
          s.grid.layers.prep[i] = PREP.wild;
        }
      }
    }
    spawnColonyLanding(a, { colonyId: 0, q: 3, r: 3 });
    spawnColonyLanding(b, { colonyId: 0, q: 3, r: 3 });
    expect(hasReadySite(a, 3, 3)).toBe(true);
    expect(Array.from(a.grid.layers.terrain)).toEqual(Array.from(b.grid.layers.terrain));
    expect(ensureStarterHubSpace(a, 3, 3, 0)).not.toBeNull();
  });
});
