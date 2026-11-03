import { describe, expect, it } from 'vitest';
import {
  axialToPlane,
  collectPodBlastTiles,
  createPlanet,
  DEPOSIT,
  findPlacementSite,
  GEN_VERSION,
  getSpawnSlots,
  hexDistance,
  hexIndex,
  placementWorldFromState,
  PREP,
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

  it('desert: real relief in metres (dunes, mountains, mesas), no forest or water, dunes dominate wild ground and Flat is only around pod drop zones', () => {
    for (const seed of ['golden-1', 'dune-2', 'dune-3']) {
      const s = createPlanet({ id: 'p', seed, type: 'temperate', planetType: 'desert', radius: 56 });
      const h = s.grid.layers.height as Float32Array;
      expect(Math.max(...h)).toBeGreaterThan(5);
      expect(share(s, TERRAIN.forest) + share(s, TERRAIN.shallow) + share(s, TERRAIN.deep)).toBe(0);
      expect(share(s, TERRAIN.slope)).toBeGreaterThan(0.6);
      expect(share(s, TERRAIN.rock)).toBeGreaterThan(0.03);
      expect(share(s, TERRAIN.rock)).toBeLessThan(0.45);
      expect(share(s, TERRAIN.flat)).toBeGreaterThan(0.05);
      expect(share(s, TERRAIN.flat)).toBeLessThan(0.15);
    }
  });

  it('every spawn slot sits in a levelled, Flat landing zone with a valid Hub site at the slot (all types, many seeds)', () => {
    for (const planetType of TYPES) {
      for (let k = 0; k < 8; k++) {
        const s = createPlanet({ id: 'p', seed: `zone-${planetType}-${k}`, type: 'temperate', planetType, radius: 56 });
        const hex = hexIndex(s.grid.radius);
        const world = placementWorldFromState(s);
        const slots = getSpawnSlots(s);
        for (const slot of slots) {
          const site = findPlacementSite(world, { colonyId: 0, q: slot.q, r: slot.r, building: 'commandHub', requireBuilder: false }, 3);
          expect(site, `${planetType} ${k} slot ${slot.q},${slot.r}`).not.toBeNull();
          const blast = collectPodBlastTiles(hex, slot.q, slot.r);
          const blastHs = blast.map((i) => s.grid.layers.height[i]);
          expect(Math.max(...blastHs) - Math.min(...blastHs)).toBeLessThan(1e-6);
          expect(blast.every((i) => s.grid.layers.terrain[i] === TERRAIN.flat && s.grid.layers.prep[i] === PREP.flat)).toBe(true);
          expect(blast.every((i) => s.grid.layers.deposit[i] === DEPOSIT.none)).toBe(true);
          if (planetType !== 'desert') continue;
          const zone: number[] = [];
          // The zone is a round disc of `landingRadius` (5.2) tiles: check every tile within 4.8 tile spacings.
          const [cx, cy] = axialToPlane(slot.q, slot.r);
          for (let i = 0; i < hex.count; i++) {
            const [x, y] = axialToPlane(hex.q[i], hex.r[i]);
            if (hexDistance(slot.q, slot.r, hex.q[i], hex.r[i]) <= 6 && Math.hypot(x - cx, y - cy) <= 4.8) zone.push(i);
          }
          const hs = zone.map((i) => s.grid.layers.height[i]);
          expect(Math.max(...hs) - Math.min(...hs)).toBeLessThan(1e-6); // one level, like terraformed ground
          expect(zone.every((i) => s.grid.layers.terrain[i] === TERRAIN.flat)).toBe(true);
        }
        if (planetType === 'desert') {
          for (let i = 0; i < hex.count; i++) {
            const farFromAllSlots = slots.every((sl) => hexDistance(sl.q, sl.r, hex.q[i], hex.r[i]) > 8);
            if (farFromAllSlots) expect(s.grid.layers.terrain[i]).not.toBe(TERRAIN.flat);
          }
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

  // Wall-clock budget (D-38 performance target): flaky on a loaded runner, so it runs only with `SIM_PERF=1` (WE-21).
  it.runIf(process.env.SIM_PERF === '1')('is fast: radius 56 well under 250 ms, radius 120 (≈ 43 k tiles) under 1.5 s', () => {
    for (const [radius, budget] of [[56, 250], [120, 1500]] as const) {
      const t0 = performance.now();
      createPlanet({ id: 'p', seed: 'fast', type: 'temperate', planetType: 'desert', radius });
      expect(performance.now() - t0).toBeLessThan(budget);
    }
  });
});

/** FNV-1a over every generated layer (hidden ones with a fixed salt) and the spawn slot coordinates (WE-02). */
function fingerprint(planetType: PlanetType, seed: string): string {
  const s = createPlanet({ id: 'p', seed, type: 'temperate', planetType, radius: 56, worldSalt: 'fingerprint-salt' });
  const L = s.grid.layers;
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0; };
  for (let i = 0; i < s.grid.count; i++) {
    mix(L.terrain[i]); mix(L.prep[i]); mix(Math.round(L.height[i] * 100)); mix(L.deposit[i]); mix(L.richness[i]);
    mix(L.subDeposit[i]); mix(L.subRichness[i]);
  }
  for (const slot of getSpawnSlots(s)) { mix(slot.q); mix(slot.r); }
  return h.toString(16);
}

describe('generator fingerprint (bump GEN_VERSION when this changes)', () => {
  it('one planet per profile: pinned summary of the generated ground and spawn slots for GEN_VERSION', () => {
    const got = { genVersion: GEN_VERSION, desert: fingerprint('desert', 'golden-1'), temperate: fingerprint('temperate', 'golden-2'), ocean: fingerprint('ocean', 'golden-3') };
    // If this fails after a deliberate generator change: bump GEN_VERSION in gen/generators.ts, then update the values.
    expect(got).toEqual({ genVersion: 9, desert: '437bd25f', temperate: '8ea0d6d3', ocean: '706ff3d8' });
  });
});
