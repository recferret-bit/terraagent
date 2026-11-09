import { describe, expect, it } from 'vitest';
import {
  createState, ensureColonyLedger, ensureColonyRecord, findGeneratorSiteForGoal, getFootprintTileIndices, hexDistance,
  hexIndex, spawnHqUnit, startBuildingConstruction, type PlanetState,
} from '../../src';
import { buildGapField, footprintGap, LANE_GAP, organicTarget } from '../../src/systems/construction/siteSpacing';
import { selectDeterministicBuildSite } from '../../src/systems/rule-engine';

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
