import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  chainStandRule,
  createPlanet,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  getSpawnSlots,
  getUnitRecord,
  hexDistance,
  hexIndex,
  isHexTile,
  isTileUneven,
  pickNextChainTile,
  PREP,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  step,
  TERRAIN,
  type PlanetState,
  type SimCommand,
  type WorkJobRecord,
} from '../../src';

/**
 * Owner report 2026-11-06: "a hill targeted for terraforming, one row of non-hex tiles between the grid and the
 * target, impossible to terraform". The HQ (reach 2) could not stand within reach of a dune disc's centre, the order was
 * dropped as `no_path`. Rule (`chain.ts` E1–E3): wild ground is worked from the edge inward.
 */

const PIPELINE = createRegistryPipeline({ flags: parseWaves('..05') });
const work = (id: string, tiles: Array<{ q: number; r: number }>): SimCommand => ({
  commandId: id, colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles } },
});
const jobsOf = (s: PlanetState) => (s.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};

function withColony(state: PlanetState, q: number, r: number) {
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  const hq = spawnHqUnit(state, { owner: 0, q, r }) as number;
  const hx = hexIndex(state.grid.radius);
  const at = (tq: number, tr: number) => hx.indexOf(tq, tr);
  const run = (cmds: SimCommand[] = []) => step(state, cmds, 1, PIPELINE);
  /** Steps until `done()` or `max` ticks; the tick count, or -1. */
  const runUntil = (done: () => boolean, max = 8000) => {
    for (let t = 1; t <= max; t++) { run(); if (done()) return t; }
    return -1;
  };
  return { state, hq, hx, at, run, runUntil, L: state.grid.layers };
}

/**
 * Level ground west of q = 4, a dune (slope, 2.5 m and rising) from q = 4 east. Hex tiles end at q = 2; q = 3 is the
 * one row of walkable Flat that is not a hex tile (it touches the dune). HQ at (-2, 0).
 */
function duneEdgeWorld(seed: string) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 12 });
  const L = state.grid.layers;
  const hx = hexIndex(12);
  for (let k = 0; k < state.grid.count; k++) {
    const q = hx.q[k]!;
    setTileTerrain(state, k, q >= 4 ? TERRAIN.slope : TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.wild, 0);
    L.height[k] = q >= 4 ? 2.5 + 0.4 * (q - 4) : 0;
    L.owner[k] = -1;
    L.deposit[k] = 0;
    L.subDeposit[k] = 0;
  }
  return withColony(state, -2, 0);
}

describe('dune worked from the edge inward (chain E1–E3)', () => {
  it('owner case: a disc whose edge lies one non-hex row beyond the grid (centre 3 from the last stand) is cleared', () => {
    const w = duneEdgeWorld('dune-edge-row');
    const layers = { terrain: w.L.terrain, prep: w.L.prep, height: w.L.height };
    expect(isHexTile(12, w.at(2, 0), layers)).toBe(true);
    expect(isHexTile(12, w.at(3, 0), layers)).toBe(false); // the one row with no hexagons…
    expect(isTileUneven(12, w.at(3, 0), w.L.terrain, w.L.height)).toBe(false); // …is walkable ground
    const target = { q: 6, r: 0 }; // its disc's west edge is q = 4, right after the row
    w.run([work('w1', [target])]);
    expect(jobsOf(w.state)['w1']).toMatchObject({ terrainKey: 'slope', chain: true });
    expect(w.runUntil(() => w.L.terrain[w.at(6, 0)] !== TERRAIN.slope)).toBeGreaterThan(0);
    expect(w.L.terrain[w.at(6, 0)]).toBe(TERRAIN.flat);
    expect(w.L.height[w.at(6, 0)]).toBe(0); // joined the level ground (R4)
    expect(getUnitRecord(w.state, w.hq)?.lastFailure ?? null).toBeNull(); // not reported as no_path
  });

  it('a hilltop deep in the dune is reached ring by ring; the cleared ground is a stand for the next disc', () => {
    const w = duneEdgeWorld('dune-edge-deep');
    const target = { q: 10, r: 0 }; // 7 from the last stand at q = 3
    w.run([work('w1', [target])]);
    const worked: string[] = [];
    const t = w.runUntil(() => {
      for (const j of Object.values(jobsOf(w.state))) if (!worked.includes(`${j.q},${j.r}`)) worked.push(`${j.q},${j.r}`);
      return w.L.terrain[w.at(10, 0)] !== TERRAIN.slope;
    });
    expect(t).toBeGreaterThan(0);
    expect(w.L.height[w.at(10, 0)]).toBe(0);
    // the clicked tile had no stand (E2): the HQ cut the disc at the edge (stand q = 3), then the next one from the
    // ground that disc levelled (stand q = 7), whose disc took the clicked tile
    expect(worked.slice(0, 2)).toEqual(['5,0', '9,0']);
    expect(getUnitRecord(w.state, w.hq)?.lastFailure ?? null).toBeNull();
  });

  it('a brushed stroke of several dune tiles out of reach (the owner\'s outline) is cleared from the edge, silently', () => {
    const w = duneEdgeWorld('dune-edge-stroke');
    const stroke = [{ q: 6, r: 0 }, { q: 7, r: 0 }, { q: 6, r: 1 }, { q: 7, r: -1 }];
    w.run([work('s1', stroke)]);
    expect(Object.keys(jobsOf(w.state))).toHaveLength(4);
    const followUps: number[] = [];
    const t = w.runUntil(() => {
      for (const j of Object.values(jobsOf(w.state))) if (j.jobId.includes('~') && !followUps.includes(j.q)) followUps.push(j.q);
      return stroke.every((s) => w.L.terrain[w.at(s.q, s.r)] !== TERRAIN.slope);
    });
    expect(t).toBeGreaterThan(0);
    expect(followUps[0]).toBeLessThanOrEqual(5); // the first disc is at the dune's edge, in reach of the stand row
    expect(getUnitRecord(w.state, w.hq)?.lastFailure ?? null).toBeNull();
  });

  it('E1: the chain never picks a dune tile with no stand within the HQ reach (2)', () => {
    const w = duneEdgeWorld('dune-edge-stand');
    const stand = chainStandRule(w.state, w.hq, PIPELINE.config.data)!;
    expect(stand(w.at(5, 0))).toBe(true); // 2 from the stand row q = 3
    expect(stand(w.at(6, 0))).toBe(false);
    const at = { origin: { q: 8, r: 0 }, last: { q: 8, r: 0 } };
    const pick = pickNextChainTile(w.state, 0, at, new Set(), PIPELINE.config.data, stand);
    expect(hexDistance(8, 0, w.hx.q[pick]!, w.hx.r[pick]!)).toBe(3); // (5, 0): the closest tile to the click with a stand
    expect(w.hx.q[pick]).toBe(5);
  });

  it('E3: a dune island no unit can stand next to still ends the order with no_path', () => {
    const w = duneEdgeWorld('dune-edge-island');
    for (let k = 0; k < w.state.grid.count; k++) {
      const d = hexDistance(8, 0, w.hx.q[k]!, w.hx.r[k]!);
      if (w.hx.q[k]! >= 3 && d > 1) setTileTerrain(w.state, k, TERRAIN.deep, 0); // deep water (T2 only) all round
    }
    w.run([work('w1', [{ q: 8, r: 0 }])]);
    expect(w.runUntil(() => Object.keys(jobsOf(w.state)).length === 0, 400)).toBeGreaterThan(0);
    expect(w.L.terrain[w.at(8, 0)]).toBe(TERRAIN.slope);
    expect(getUnitRecord(w.state, w.hq)?.lastFailure?.code).toBe('no_path');
  });
});

describe('dune worked from the edge inward: generated desert (golden-1, slot 0; tracks the current GEN_VERSION output)', () => {
  it('dune tiles 8 hexes out on both sides of the landing pad, beyond any stand in reach, are cleared', () => {
    for (const dq of [8, -8]) {
      const state = createPlanet({ id: 'p', seed: 'golden-1', type: 'temperate', planetType: 'desert', radius: 56 });
      const slot = getSpawnSlots(state)[0]!;
      const w = withColony(state, slot.q, slot.r);
      const i = w.at(slot.q + dq, slot.r);
      expect(w.L.terrain[i]).toBe(TERRAIN.slope);
      const stand = chainStandRule(w.state, w.hq, PIPELINE.config.data)!;
      expect(stand(i), `${dq}: no stand in reach yet`).toBe(false);
      w.run([work(`w${dq}`, [{ q: slot.q + dq, r: slot.r }])]);
      expect(w.runUntil(() => w.L.terrain[i] !== TERRAIN.slope), `${dq}`).toBeGreaterThan(0);
      expect(getUnitRecord(w.state, w.hq)?.lastFailure ?? null).toBeNull();
    }
  });
});
