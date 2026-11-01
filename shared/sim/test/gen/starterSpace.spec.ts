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
  landingBlock,
  spawnColonyLanding,
  starterHubSiteBlocked,
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
          s.grid.layers.terrain[i] = TERRAIN.rock; // hostile but land: pods never land on water (D-39)
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

describe('starter Hub space next to foreign territory (WE-23)', () => {
  /** Rough ground (Rock) around (0, 0); colony 1 owns every tile matching `foreign` within 5 of the centre. */
  function rough(foreign: (q: number, r: number) => boolean): ReturnType<typeof createPlanet> {
    const s = createPlanet({ id: 'pl', seed: 'foreign-hub', type: 'temperate', radius: 56 });
    const hex = hexIndex(s.grid.radius);
    for (let i = 0; i < hex.count; i++) {
      const d = hexDistance(0, 0, hex.q[i], hex.r[i]);
      if (d <= 5) { s.grid.layers.terrain[i] = TERRAIN.rock; s.grid.layers.prep[i] = PREP.wild; }
      s.grid.layers.owner[i] = d <= 5 && foreign(hex.q[i], hex.r[i]) ? 1 : -1;
    }
    return s;
  }
  const owned = (s: ReturnType<typeof createPlanet>) => Array.from(s.grid.layers.owner).filter((o) => o === 1).length;

  it("levels a footprint outside the other colony's land and leaves its tiles owned", () => {
    const s = rough((q) => q >= 1);
    const before = owned(s);
    expect(landingBlock(s, 0, 0, 0)).toBeNull();
    expect(spawnColonyLanding(s, { colonyId: 0, q: 0, r: 0 }).ok).toBe(true);
    expect(owned(s)).toBe(before);
    expect(hasReadySite(s, 0, 0)).toBe(true);
  });

  it('refuses a landing whose every starter Hub site touches foreign territory', () => {
    const s = rough((q, r) => q !== 0 || r !== 0);
    expect(starterHubSiteBlocked(s, 0, 0, 0)).toBe(true);
    expect(ensureStarterHubSpace(s, 0, 0, 0)).toBeNull();
    expect(landingBlock(s, 0, 0, 0)).toBe('landing_site_taken');
  });
});
