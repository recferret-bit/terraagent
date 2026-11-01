import { describe, expect, it } from 'vitest';
import {
  axialToPlane,
  createPlanet,
  DEPOSIT,
  findPlacementSite,
  GEN_VERSION,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  placementWorldFromState,
  snapshot,
  TERRAIN,
  type PlanetType,
} from '../../src';

const TYPES: PlanetType[] = ['desert', 'temperate', 'ocean'];
const share = (s: ReturnType<typeof createPlanet>, t: number) => (Array.from(s.grid.layers.terrain) as number[]).filter((x) => x === t).length / s.grid.count;

describe('world generation orchestrator (D-38)', () => {
  it('is deterministic per (seed, type) and stamps meta.genVersion', () => {
    for (const planetType of TYPES) {
      const a = createPlanet({ id: 'p', seed: 'world-1', type: 'temperate', planetType, radius: 56 });
      const b = createPlanet({ id: 'p', seed: 'world-1', type: 'temperate', planetType, radius: 56 });
      expect(snapshot(a)).toEqual(snapshot(b));
      expect(a.meta.genVersion).toBe(GEN_VERSION);
    }
  });

  it('the planet type as generator id gives the same planet (`type: planet.type` on hosts)', () => {
    const a = createPlanet({ id: 'p', seed: 'world-2', type: 'desert', radius: 56 });
    const b = createPlanet({ id: 'p', seed: 'world-2', type: 'temperate', planetType: 'desert', radius: 56 });
    expect(a.meta.planetType).toBe('desert');
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('desert: real relief in metres (dunes, mountains, mesas), no forest or water, dune faces and rock present', () => {
    for (const seed of ['golden-1', 'dune-2', 'dune-3']) {
      const s = createPlanet({ id: 'p', seed, type: 'temperate', planetType: 'desert', radius: 56 });
      const h = s.grid.layers.height as Float32Array;
      expect(Math.max(...h)).toBeGreaterThan(5);
      expect(share(s, TERRAIN.forest) + share(s, TERRAIN.shallow) + share(s, TERRAIN.deep)).toBe(0);
      expect(share(s, TERRAIN.slope)).toBeGreaterThan(0.04);
      expect(share(s, TERRAIN.rock)).toBeGreaterThan(0.03);
      expect(share(s, TERRAIN.rock)).toBeLessThan(0.45);
      expect(share(s, TERRAIN.flat)).toBeGreaterThan(0.3);
    }
  });

  it('every spawn slot sits in a levelled, Flat landing zone with a valid Hub site at the slot (all types, many seeds)', () => {
    for (const planetType of TYPES) {
      for (let k = 0; k < 8; k++) {
        const s = createPlanet({ id: 'p', seed: `zone-${planetType}-${k}`, type: 'temperate', planetType, radius: 56 });
        const hex = hexIndex(s.grid.radius);
        const world = placementWorldFromState(s);
        for (const slot of getSpawnSlots(s)) {
          const site = findPlacementSite(world, { colonyId: 0, q: slot.q, r: slot.r, building: 'commandHub', requireBuilder: false }, 3);
          expect(site, `${planetType} ${k} slot ${slot.q},${slot.r}`).not.toBeNull();
          if (planetType !== 'desert') continue;
          const zone: number[] = [];
          // The zone is a round disc of `landingRadius` (7) tiles: check every tile within 6.5 tile spacings.
          const [cx, cy] = axialToPlane(slot.q, slot.r);
          for (let i = 0; i < hex.count; i++) {
            const [x, y] = axialToPlane(hex.q[i], hex.r[i]);
            if (hexDistance(slot.q, slot.r, hex.q[i], hex.r[i]) <= 8 && Math.hypot(x - cx, y - cy) <= 6.5) zone.push(i);
          }
          const hs = zone.map((i) => s.grid.layers.height[i]);
          expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(1e-6); // one level, like terraformed ground
          expect(zone.every((i) => s.grid.layers.terrain[i] === TERRAIN.flat)).toBe(true);
        }
      }
    }
  });

  it('buries a hidden subsurface (deposits under rock / dunes) that never overlaps a visible deposit', () => {
    for (const planetType of TYPES) {
      const s = createPlanet({ id: 'p', seed: 'sub-1', type: 'temperate', planetType, radius: 56 });
      const { subDeposit, subRichness, deposit } = s.grid.layers;
      let n = 0;
      for (let i = 0; i < s.grid.count; i++) {
        if (subDeposit[i] === DEPOSIT.none) { expect(subRichness[i]).toBe(0); continue; }
        n++;
        expect(deposit[i]).toBe(DEPOSIT.none);
        expect(subRichness[i]).toBeGreaterThan(9000);
      }
      expect(n).toBeGreaterThan(50);
    }
  });

  it('is fast: radius 56 well under 250 ms, radius 120 (≈ 43 k tiles) under 1.5 s', () => {
    for (const [radius, budget] of [[56, 250], [120, 1500]] as const) {
      const t0 = performance.now();
      createPlanet({ id: 'p', seed: 'fast', type: 'temperate', planetType: 'desert', radius });
      expect(performance.now() - t0).toBeLessThan(budget);
    }
  });
});

describe('generator fingerprint (bump GEN_VERSION when this changes)', () => {
  it('golden-1 desert: pinned summary of the generated ground for GEN_VERSION', () => {
    const s = createPlanet({ id: 'p', seed: 'golden-1', type: 'temperate', planetType: 'desert', radius: 56 });
    let h = 0x811c9dc5;
    const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0; };
    for (let i = 0; i < s.grid.count; i++) { mix(s.grid.layers.terrain[i]); mix(Math.round(s.grid.layers.height[i] * 100)); mix(s.grid.layers.deposit[i]); }
    // If this fails after a deliberate generator change: bump GEN_VERSION in gen/generators.ts, then update both values.
    expect({ genVersion: GEN_VERSION, fingerprint: h.toString(16) }).toEqual({ genVersion: 3, fingerprint: '45686546' });
  });
});
