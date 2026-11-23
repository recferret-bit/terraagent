import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  compileData, createPlanet, createState, DEPOSIT, ensureColonyLedger, ensureColonyRecord, ENTITY_KIND,
  findGeneratorSiteForGoal, findHexPath, getFootprintTileIndices, hexDistance, hexIndex,
  occupiesGround, PREP, seedRivalAiColonies, setTileDeposit, setTileOwner, setTilePrep, setTileTerrain, spawnHqUnit,
  startBuildingConstruction, TERRAIN, type PlanetState,
} from '../../src';
import { occupiedGroundTiles } from '../../src/systems/construction/occupancy';
import { entityFootprint } from '../../src/systems/construction/placement';
import {
  buildGapField, evaluateFootprintPassability, footprintGap, LANE_GAP, organicTarget, WIDE_LANE_GAP,
} from '../../src/systems/construction/siteSpacing';
import { selectDeterministicBuildSite, shouldExpandPowerZoneWithPylon } from '../../src/systems/rule-engine';

function baseWithHub(): PlanetState {
  const state = createState({ planetId: 'spacing', planetType: 'temperate', seed: 'spacing', radius: 14 });
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: -3, r: 0, instant: true }).ok).toBe(true);
  return state;
}

function footprintsOf(placed: Array<{ q: number; r: number; size: number }>, state: PlanetState): number[][] {
  return placed.map((b) => getFootprintTileIndices(state, b.q, b.r, b.size, b.size, 0).indices);
}

/** Smallest hex distance between the tiles of two footprints. */
function gapBetween(state: PlanetState, a: number[], b: number[]): number {
  const hx = hexIndex(state.grid.radius);
  let min = Infinity;
  for (const i of a) for (const j of b) min = Math.min(min, hexDistance(hx.q[i], hx.r[i], hx.q[j], hx.r[j]));
  return min;
}

describe('bot site spacing (natural base layout)', () => {
  it('gap field measures hex distance between footprints, capped and 0 on blocked tiles', () => {
    const state = baseWithHub();
    const hx = hexIndex(state.grid.radius);
    const field = buildGapField(state.grid.radius, [hx.indexOf(0, 0)]);
    expect(field[hx.indexOf(0, 0)]).toBe(0);
    expect(field[hx.indexOf(1, 0)]).toBe(1);
    expect(field[hx.indexOf(2, 0)]).toBe(2);
    expect(footprintGap(field, [hx.indexOf(2, 0), hx.indexOf(3, 0)])).toBe(2);
  });

  it('organic target is deterministic and varies with the building count', () => {
    const a = organicTarget({ q: 0, r: 0 }, 0, 3);
    expect(organicTarget({ q: 0, r: 0 }, 0, 3)).toEqual(a);
    const dists = new Set<number>();
    for (let n = 0; n < 8; n++) {
      const t = organicTarget({ q: 0, r: 0 }, 0, n);
      dists.add(hexDistance(0, 0, t.q, t.r));
    }
    expect(dists.size).toBeGreaterThan(1);
  });

  it('goal builder keeps a walkable lane between buildings, passes placement, and varies distance from the hub', () => {
    const state = baseWithHub();
    const placed: Array<{ q: number; r: number; size: number }> = [{ q: -3, r: 0, size: 3 }];
    const dists: number[] = [];
    for (let n = 0; n < 6; n++) {
      const building = n % 2 === 0 ? 'solar' : 'depot';
      const site = findGeneratorSiteForGoal(state, 0, undefined, building);
      expect(site, `site ${n}`).not.toBeNull();
      // The same state gives the same site (no RNG draw, so a picker called every tick never flips).
      expect(findGeneratorSiteForGoal(state, 0, undefined, building)).toEqual(site);
      expect(startBuildingConstruction(state, { owner: 0, building, q: site!.q, r: site!.r, instant: true }).ok).toBe(true);
      placed.push({ ...site!, size: 2 });
      dists.push(hexDistance(-3, 0, site!.q, site!.r));
    }
    const fps = footprintsOf(placed, state);
    for (let i = 0; i < fps.length; i++) {
      for (let j = i + 1; j < fps.length; j++) {
        expect(gapBetween(state, fps[i], fps[j]), `buildings ${i} and ${j}`).toBeGreaterThanOrEqual(LANE_GAP);
      }
    }
    expect(new Set(dists).size).toBeGreaterThan(1);
  });

  it('autopilot site selection also keeps a lane around existing buildings', () => {
    const state = baseWithHub();
    const first = selectDeterministicBuildSite(state, 0, 'solar', { requireOwned: false });
    expect(first).not.toBeNull();
    expect(startBuildingConstruction(state, { owner: 0, building: 'solar', q: first!.q, r: first!.r, instant: true }).ok).toBe(true);
    const second = selectDeterministicBuildSite(state, 0, 'depot', { requireOwned: false });
    expect(second).not.toBeNull();
    const [a, b] = footprintsOf([{ q: first!.q, r: first!.r, size: 2 }, { q: second!.q, r: second!.r, size: 2 }], state);
    expect(gapBetween(state, a, b)).toBeGreaterThanOrEqual(LANE_GAP);
    const hub = getFootprintTileIndices(state, -3, 0, 3, 3, 0).indices;
    expect(gapBetween(state, hub, b)).toBeGreaterThanOrEqual(LANE_GAP);
  });
});

describe('corridor passability, pylon expansion & rival seeding spacing', () => {
  it('strongly prefers WIDE_LANE_GAP (3) over tight 2-hex lanes on open ground', () => {
    const state = baseWithHub();
    const placed: Array<{ q: number; r: number; size: number }> = [{ q: -3, r: 0, size: 3 }];
    for (let n = 0; n < 3; n++) {
      const building = n % 2 === 0 ? 'solar' : 'depot';
      const site = selectDeterministicBuildSite(state, 0, building, { requireOwned: false });
      expect(site).not.toBeNull();
      expect(startBuildingConstruction(state, { owner: 0, building, q: site!.q, r: site!.r, instant: true }).ok).toBe(true);
      placed.push({ q: site!.q, r: site!.r, size: 2 });
    }
    const fps = footprintsOf(placed, state);
    for (let i = 0; i < fps.length; i++) {
      for (let j = i + 1; j < fps.length; j++) {
        expect(gapBetween(state, fps[i], fps[j]), `open ground buildings ${i} and ${j}`).toBeGreaterThanOrEqual(WIDE_LANE_GAP);
      }
    }
  });

  it('rejects corridor-pinching sites and preserves walkable hex paths for units', () => {
    const state = createState({ planetId: 'corridor', planetType: 'temperate', seed: 'corridor', radius: 10 });
    const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
    colony.status = 'active';
    const hx = hexIndex(state.grid.radius);
    for (let i = 0; i < state.grid.count; i++) {
      setTileOwner(state.grid, i, 0);
      setTileTerrain(state.grid, i, TERRAIN.flat);
      setTilePrep(state.grid, i, PREP.prepared);
    }
    spawnHqUnit(state, { owner: 0, q: -1, r: 0 });
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: -4, r: 0, instant: true }).ok).toBe(true);

    // Rock corridor barriers along r = -2 and r = 1 for q = 1..5 leave a 2-tile-high strip (r = -1, 0) leading to (5, 0).
    for (let q = 1; q <= 5; q++) {
      for (const r of [-2, 1]) {
        const ti = hx.indexOf(q, r);
        if (ti >= 0) setTileTerrain(state.grid, ti, TERRAIN.rock);
      }
    }

    // A 2x2 footprint at (2, -1) occupies (2,-1),(3,-1),(2,0),(3,0), completely plugging the corridor!
    const chokeFp = getFootprintTileIndices(state, 2, -1, 2, 2, 0).indices;
    const chokePass = evaluateFootprintPassability(state.grid, occupiedGroundTiles(state), chokeFp);
    expect(chokePass.pinchesCorridor).toBe(true);

    const autoSite = selectDeterministicBuildSite(state, 0, 'solar');
    expect(autoSite).not.toBeNull();
    expect(startBuildingConstruction(state, { owner: 0, building: 'solar', q: autoSite!.q, r: autoSite!.r, instant: true }).ok).toBe(true);
    const goalSite = findGeneratorSiteForGoal(state, 0, undefined, 'depot');
    expect(goalSite).not.toBeNull();
    expect(startBuildingConstruction(state, { owner: 0, building: 'depot', q: goalSite!.q, r: goalSite!.r, instant: true }).ok).toBe(true);

    const blocked = occupiedGroundTiles(state);
    const corridorPath = findHexPath(state.grid, { q: -1, r: 0 }, { q: 5, r: 0 }, { blocked: (ti) => blocked.has(ti) });
    expect(corridorPath.ok).toBe(true);
  });
});

describe('pylon expansion & rival seeding spacing', () => {
  it('recommends Pylon expansion when owned deposits sit outside Hub power zone', () => {
    const flags = parseWaves(null);
    const data = compileData(flags);
    const state = createPlanet({ type: 'temperate', seed: 'pylon-expand', radius: 14 });
    const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
    colony.status = 'active';
    colony.stage = 2;
    colony.unlockStage = 2;
    const hx = hexIndex(state.grid.radius);
    for (let i = 0; i < state.grid.count; i++) {
      const q = hx.q[i]!;
      const r = hx.r[i]!;
      if (hexDistance(0, 0, q, r) <= 10) setTileOwner(state.grid, i, 0);
      setTileTerrain(state.grid, i, TERRAIN.flat);
      setTilePrep(state.grid, i, PREP.prepared);
      setTileDeposit(state.grid, i, DEPOSIT.none);
    }
    spawnHqUnit(state, { owner: 0, q: -1, r: 0 });
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data }).ok).toBe(true);

    expect(shouldExpandPowerZoneWithPylon(state, 0, data, flags).needed).toBe(false);

    // Place a metals deposit at (8, 0), outside Hub power zone radius 6
    const depIdx = hx.indexOf(8, 0);
    setTileDeposit(state.grid, depIdx, DEPOSIT.metals);
    state.grid.layers.richness[depIdx] = 5000;

    const expansion = shouldExpandPowerZoneWithPylon(state, 0, data, flags);
    expect(expansion.needed).toBe(true);
    expect(expansion.site).not.toBeNull();
  });

  it('seedRivalAiColonies spaces starter buildings >= LANE_GAP and places units on clear walkable tiles', () => {
    const data = compileData(parseWaves(null));
    const state = createPlanet({ type: 'temperate', seed: 'rival-base-spacing', radius: 32, capacity: 8 });
    const rivals = seedRivalAiColonies(state, { count: 2, capacity: 8, tick: 0, data });
    expect(rivals).toHaveLength(2);

    const occupied = occupiedGroundTiles(state, data);
    const hx = hexIndex(state.grid.radius);
    const { count, cols } = state.entities;

    for (const rival of rivals) {
      const colFps: number[][] = [];
      let sawPylon = false;
      for (let row = 0; row < count; row++) {
        if (cols.owner[row] !== rival.colonyIndex || cols.hp[row] <= 0) continue;
        const kind = cols.kind[row];
        if (kind === ENTITY_KIND.pylon) sawPylon = true;
        if (occupiesGround({ kind, hp: cols.hp[row], hpMax: cols.hpMax[row] })) {
          const size = entityFootprint(kind, data);
          colFps.push(getFootprintTileIndices(state, cols.q[row], cols.r[row], size, size, 0).indices);
        } else if (kind === ENTITY_KIND.hq || kind === ENTITY_KIND.worker || kind === ENTITY_KIND.recon) {
          const uIdx = hx.indexOf(cols.q[row], cols.r[row]);
          expect(occupied.has(uIdx)).toBe(false);
          expect(findHexPath(state.grid, { q: cols.q[row], r: cols.r[row] }, { q: rival.anchorQ + 2, r: rival.anchorR }, {
            blocked: (ti) => occupied.has(ti),
            band: { minDist: 0, maxDist: 4 },
          }).ok).toBe(true);
        }
      }
      expect(sawPylon).toBe(true);
      expect(colFps.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < colFps.length; i++) {
        for (let j = i + 1; j < colFps.length; j++) {
          expect(gapBetween(state, colFps[i], colFps[j]), `rival ${rival.colonyIndex} buildings ${i},${j}`).toBeGreaterThanOrEqual(LANE_GAP);
        }
      }
    }
  });
});
