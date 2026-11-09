import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  bumpPathEpoch,
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyLedger,
  enqueueWorkAtTile,
  hexIndex,
  insertRow,
  pickNextChainTile,
  PREP,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnWorkerUnit,
  spawnHqUnit,
  step,
  TERRAIN,
  type PlanetState,
  type SimCommand,
  type WorkJobRecord,
} from '../../src';

/** A level wild Flat world (no deposits, nothing buried, unclaimed) with colony 0 and its HQ at (0, 0). */
function flatWorld(seed: string, radius = 10) {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius });
  state.colonies.push(ensureColonyLedger({ index: 0, id: 'col-0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 }));
  const L = state.grid.layers;
  for (let k = 0; k < state.grid.count; k++) {
    setTileTerrain(state, k, TERRAIN.flat, 0);
    setTilePrep(state.grid, k, PREP.wild, 0);
    setTileDeposit(state, k, DEPOSIT.none, 0, 0);
    L.height[k] = 0;
    L.subDeposit[k] = 0;
    L.owner[k] = -1;
  }
  const hx = hexIndex(radius);
  const at = (q: number, r: number) => hx.indexOf(q, r);
  const hq = spawnHqUnit(state, { owner: 0, q: 0, r: 0 }) as number;
  const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });
  const run = (cmds: SimCommand[] = [], n = 1) => step(state, cmds, n, pipeline);
  const setTerrain = (q: number, r: number, t: number) => setTileTerrain(state, at(q, r), t, 0);
  return { state, at, hq, run, setTerrain, terrain: (q: number, r: number) => L.terrain[at(q, r)] };
}

const cmd = (commandId: string, kind: string, args: unknown): SimCommand => ({ commandId, colonyIndex: 0, source: 'player', kind, args });
const work = (id: string, tiles: Array<{ q: number; r: number }>, extra: Record<string, unknown> = {}) =>
  cmd(id, 'enqueueTask', { terraform: { op: 'work', tiles, ...extra } });
const AT_HQ = { origin: { q: 0, r: 0 }, last: { q: 0, r: 0 } };
const jobsOf = (state: PlanetState) => (state.blobs.workJobs?.value as { byId?: Record<string, WorkJobRecord> } | undefined)?.byId ?? {};

/** Steps one tick at a time until `done()` (or `max` ticks). */
function runUntil(run: () => unknown, done: () => boolean, max = 3000): number {
  for (let t = 1; t <= max; t++) {
    run();
    if (done()) return t;
  }
  return -1;
}

describe('terraform chain (infinite terraform): which tiles it takes', () => {
  it('after the ordered tile the worker clears the nearest obstacle, then the next, and goes idle when none is left', () => {
    const w = flatWorld('chain-1');
    w.setTerrain(3, 0, TERRAIN.forest);
    w.setTerrain(5, 0, TERRAIN.rock);
    w.setTerrain(-4, 0, TERRAIN.forest);
    expect(w.run([work('w1', [{ q: 3, r: 0 }])]).outcomes[0].code).toBeUndefined();
    expect(jobsOf(w.state).w1).toMatchObject({ chain: true, chainSeq: 0, mode: 'terraform' });

    expect(runUntil(w.run, () => w.terrain(3, 0) === TERRAIN.flat)).toBeGreaterThan(0);
    expect(jobsOf(w.state)['w1~1']).toMatchObject({ q: 5, r: 0, chainRootId: 'w1', chainSeq: 1, workerEntityId: w.hq });
    expect(w.terrain(5, 0)).toBe(TERRAIN.rock);

    expect(runUntil(w.run, () => w.terrain(5, 0) === TERRAIN.flat)).toBeGreaterThan(0);
    expect(jobsOf(w.state)['w1~2']).toMatchObject({ q: -4, r: 0 });
    expect(w.terrain(-4, 0)).toBe(TERRAIN.forest);

    expect(runUntil(w.run, () => Object.keys(jobsOf(w.state)).length === 0)).toBeGreaterThan(0);
    expect(w.terrain(-4, 0)).toBe(TERRAIN.flat);
    w.run([], 5);
    expect(w.state.entities.cols.state[0]).toBe(ENTITY_STATE.idle);
  });

  it('never takes level wild Flat ground; an uneven Flat tile is an obstacle', () => {
    const w = flatWorld('chain-2');
    w.setTerrain(2, 0, TERRAIN.forest);
    const L = w.state.grid.layers;
    L.height[w.at(-3, 1)] = 3; // a lone raised Flat tile is uneven
    w.run([work('w1', [{ q: 2, r: 0 }])]);
    expect(runUntil(w.run, () => Object.keys(jobsOf(w.state)).length === 0)).toBeGreaterThan(0);
    const prepared = Array.from(L.prep).filter((p) => p === PREP.prepared).length;
    expect(prepared).toBe(2); // the ordered forest and the uneven tile, nothing else
    expect(L.prep[w.at(-3, 1)]).toBe(PREP.prepared);
  });

  it('with territory the chain stays on own tiles (never foreign, never unclaimed)', () => {
    const w = flatWorld('chain-3');
    const L = w.state.grid.layers;
    for (const [q, r] of [[0, 0], [1, 0], [2, 0], [0, -1], [0, -2], [0, -3]] as const) L.owner[w.at(q, r)] = 0;
    L.owner[w.at(4, 0)] = 1;
    w.setTerrain(2, 0, TERRAIN.forest); // own: the order
    w.setTerrain(0, -3, TERRAIN.rock); // own: chained
    w.setTerrain(4, 0, TERRAIN.forest); // foreign
    w.setTerrain(-3, 0, TERRAIN.forest); // unclaimed
    w.run([work('w1', [{ q: 2, r: 0 }])]);
    expect(runUntil(w.run, () => Object.keys(jobsOf(w.state)).length === 0)).toBeGreaterThan(0);
    expect(w.terrain(2, 0)).toBe(TERRAIN.flat);
    expect(w.terrain(0, -3)).toBe(TERRAIN.flat);
    expect(w.terrain(4, 0)).toBe(TERRAIN.forest);
    expect(w.terrain(-3, 0)).toBe(TERRAIN.forest);
  });

  it('before territory the chain stays within preHubTerraformRadius of the pod; ties go to the lowest tile index', () => {
    const w = flatWorld('chain-4', 14);
    const row = insertRow(w.state.entities, w.state.meta.nextEntityId++, 0);
    const cols = w.state.entities.cols;
    cols.kind[row] = ENTITY_KIND.pod;
    cols.owner[row] = 0;
    cols.hp[row] = 1;
    cols.hpMax[row] = 1;
    w.setTerrain(12, 0, TERRAIN.forest); // 12 from the pod at (0, 0): outside the radius (10)
    expect(pickNextChainTile(w.state, 0, AT_HQ, new Set())).toBe(-1);
    w.setTerrain(0, 8, TERRAIN.rock);
    w.setTerrain(0, -8, TERRAIN.rock);
    const pick = pickNextChainTile(w.state, 0, AT_HQ, new Set());
    expect(pick).toBe(Math.min(w.at(0, 8), w.at(0, -8)));
    expect(pickNextChainTile(w.state, 0, AT_HQ, new Set([pick]))).toBe(Math.max(w.at(0, 8), w.at(0, -8)));
  });
});

describe('terraform chain: pathing, ranking, and skipped-tile retries', () => {
  it('a chained tile with no path is skipped and the chain goes on', () => {
    const w = flatWorld('chain-5', 12);
    w.setTerrain(2, 0, TERRAIN.forest);
    const hx = hexIndex(12);
    for (let i = 0; i < w.state.grid.count; i++) {
      const d = Math.max(Math.abs(hx.q[i]! - 6), Math.abs(hx.r[i]!), Math.abs(hx.q[i]! - 6 + hx.r[i]!));
      if (d >= 2 && d <= 3) setTileTerrain(w.state, i, TERRAIN.deep, 0);
    }
    w.setTerrain(6, 0, TERRAIN.forest); // a stand next to it (E1), but walled in by deep water: no path
    w.setTerrain(-4, 0, TERRAIN.forest);
    w.run([work('w1', [{ q: 2, r: 0 }])]);
    expect(runUntil(w.run, () => Boolean(jobsOf(w.state)['w1~2']))).toBeGreaterThan(0);
    expect(jobsOf(w.state)['w1~2']).toMatchObject({ q: -4, r: 0, chainSkipped: [w.at(6, 0)] });
    expect(runUntil(w.run, () => Object.keys(jobsOf(w.state)).length === 0)).toBeGreaterThan(0);
    expect(w.terrain(-4, 0)).toBe(TERRAIN.flat);
    expect(w.terrain(6, 0)).toBe(TERRAIN.forest);
  });

  it('works outward from the clicked tile: a nearby obstacle comes before the far end of a line of trees', () => {
    const w = flatWorld('chain-drift', 12);
    for (let q = 1; q <= 8; q++) w.setTerrain(q, 0, TERRAIN.forest); // a line of trees going east from the click
    w.setTerrain(-1, 0, TERRAIN.rock); // 2 from the click, on the other side
    w.run([work('w1', [{ q: 1, r: 0 }], { workerId: w.hq })]);
    const order: string[] = [];
    runUntil(w.run, () => {
      for (const j of Object.values(jobsOf(w.state))) if (!order.includes(`${j.q},${j.r}`)) order.push(`${j.q},${j.r}`);
      return Object.keys(jobsOf(w.state)).length === 0;
    }, 6000);
    // Closest to the click first; the tie at distance 2 goes to the tile next to the one just finished.
    expect(order.slice(0, 4)).toEqual(['1,0', '2,0', '3,0', '-1,0']);
    expect(order).toHaveLength(9);
    expect(order.indexOf('-1,0')).toBeLessThan(order.indexOf('4,0'));
  });

  it('pickNextChainTile ranks by distance to the click, then to the last tile, then tile index', () => {
    const w = flatWorld('chain-rank', 12);
    w.setTerrain(5, 0, TERRAIN.forest); // 5 from the click at (0, 0), 1 from the last tile
    w.setTerrain(-3, 0, TERRAIN.forest); // 3 from the click
    w.setTerrain(0, 3, TERRAIN.forest); // 3 from the click, closer to the last tile than (-3, 0)
    const at = { origin: { q: 0, r: 0 }, last: { q: 4, r: 0 } };
    expect(pickNextChainTile(w.state, 0, at, new Set())).toBe(w.at(0, 3));
    expect(pickNextChainTile(w.state, 0, at, new Set([w.at(0, 3)]))).toBe(w.at(-3, 0));
  });

  it('a skipped tile is tried again after the chain finishes another tile (no longer unreachable → cleared)', () => {
    const w = flatWorld('chain-retry', 12);
    w.setTerrain(2, 0, TERRAIN.forest);
    const hx = hexIndex(12);
    const wall: number[] = [];
    for (let i = 0; i < w.state.grid.count; i++) {
      const d = Math.max(Math.abs(hx.q[i]! - 6), Math.abs(hx.r[i]!), Math.abs(hx.q[i]! - 6 + hx.r[i]!));
      if (d >= 2 && d <= 3) { setTileTerrain(w.state, i, TERRAIN.deep, 0); wall.push(i); }
    }
    w.setTerrain(6, 0, TERRAIN.forest); // walled in for now (its stand ring is level ground: E1 lets the chain try it)
    w.setTerrain(-4, 0, TERRAIN.forest);
    w.run([work('w1', [{ q: 2, r: 0 }])]);
    expect(runUntil(w.run, () => Boolean(jobsOf(w.state)['w1~2']))).toBeGreaterThan(0);
    expect(jobsOf(w.state)['w1~2']).toMatchObject({ q: -4, r: 0, chainSkipped: [w.at(6, 0)], chainOrigin: { q: 2, r: 0 } });
    for (const i of wall) setTileTerrain(w.state, i, TERRAIN.flat, w.state.meta.tick); // the way opens
    bumpPathEpoch(w.state.meta);
    expect(runUntil(w.run, () => Object.keys(jobsOf(w.state)).length === 0, 6000)).toBeGreaterThan(0);
    expect(w.terrain(-4, 0)).toBe(TERRAIN.flat);
    expect(w.terrain(6, 0)).toBe(TERRAIN.flat);
  });

});

describe('terraform chain: what ends it', () => {
  it('a move order to the worker ends its chain', () => {
    const w = flatWorld('chain-6');
    w.setTerrain(3, 0, TERRAIN.forest);
    w.setTerrain(5, 0, TERRAIN.forest);
    w.run([work('w1', [{ q: 3, r: 0 }])]);
    expect(runUntil(w.run, () => Boolean(jobsOf(w.state)['w1~1']))).toBeGreaterThan(0);
    expect(w.run([cmd('m1', 'moveUnit', { entityId: w.hq, q: -3, r: 0 })]).outcomes[0].code).toBeUndefined();
    expect(Object.keys(jobsOf(w.state))).toHaveLength(0);
    w.run([], 400);
    expect(w.terrain(5, 0)).toBe(TERRAIN.forest);
  });

  it('a stop order, cancelTask by the root id, or a new work order for the worker each end the chain', () => {
    for (const end of ['stop', 'cancel', 'reorder'] as const) {
      const w = flatWorld(`chain-7-${end}`);
      w.setTerrain(3, 0, TERRAIN.forest);
      w.setTerrain(5, 0, TERRAIN.forest);
      w.setTerrain(-3, 0, TERRAIN.rock);
      w.run([work('w1', [{ q: 3, r: 0 }], { workerId: w.hq })]);
      expect(runUntil(w.run, () => Boolean(jobsOf(w.state)['w1~1']))).toBeGreaterThan(0);
      const c = end === 'stop' ? cmd('s1', 'stopUnit', { entityId: w.hq })
        : end === 'cancel' ? cmd('c1', 'cancelTask', { taskId: 'w1' })
          : work('w2', [{ q: -3, r: 0 }], { workerId: w.hq });
      expect(w.run([c]).outcomes[0].code).toBeUndefined();
      expect(Object.keys(jobsOf(w.state))).toEqual(end === 'reorder' ? ['w2'] : []);
    }
  });

  it('several tiles in one order: the chain continues only after the last of them', () => {
    const w = flatWorld('chain-8');
    w.setTerrain(2, 0, TERRAIN.forest);
    w.setTerrain(-2, 0, TERRAIN.forest);
    w.setTerrain(0, 4, TERRAIN.rock);
    w.run([work('w1', [{ q: 2, r: 0 }, { q: -2, r: 0 }], { workerId: w.hq })]);
    expect(runUntil(w.run, () => w.terrain(2, 0) === TERRAIN.flat)).toBeGreaterThan(0);
    expect(Object.keys(jobsOf(w.state))).toEqual(['w1:1']);
    expect(runUntil(w.run, () => Object.keys(jobsOf(w.state)).length === 0)).toBeGreaterThan(0);
    expect(w.terrain(0, 4)).toBe(TERRAIN.flat);
  });
});

describe('work intent: repair vs terraform', () => {
  it("'repair' only repairs, 'terraform' ignores the damaged entity, absent repairs first; repair never chains", () => {
    const w = flatWorld('intent-1');
    const harv = spawnWorkerUnit(w.state, { owner: 0, q: 2, r: 0 }) as number;
    const cols = w.state.entities.cols;
    const row = Array.from(cols.id.slice(0, w.state.entities.count)).indexOf(harv);
    cols.hp[row] = cols.hpMax[row] / 2;

    const tf = enqueueWorkAtTile(w.state, 0, 2, 0, { intent: 'terraform', taskId: 't1', workerId: w.hq });
    expect(tf.ok && tf.job.mode).toBe('terraform');
    const rep = enqueueWorkAtTile(w.state, 0, 2, 0, { intent: 'repair', taskId: 't2', chain: true });
    expect(rep.ok && rep.job.mode).toBe('repair');
    expect(rep.ok && rep.job.chain).toBeUndefined();
    const auto = enqueueWorkAtTile(w.state, 0, 2, 0, { taskId: 't3' });
    expect(auto.ok && auto.job.mode).toBe('repair');
    expect(enqueueWorkAtTile(w.state, 0, 4, 4, { intent: 'repair', taskId: 't4' })).toEqual({ ok: false, reason: 'site_blocked' });
  });

  it('the command carries intent (repair with nothing damaged is rejected; an unknown intent is invalid)', () => {
    const w = flatWorld('intent-2');
    expect(w.run([work('r1', [{ q: 3, r: 3 }], { intent: 'repair' })]).outcomes[0].code).toBe('site_blocked');
    expect(w.run([work('r2', [{ q: 3, r: 3 }], { intent: 'bogus' })]).outcomes[0].code).toBe('invalid_args');
    expect(w.run([work('r3', [{ q: 3, r: 3 }], { intent: 'terraform' })]).outcomes[0].code).toBeUndefined();
    expect(jobsOf(w.state).r3).toMatchObject({ mode: 'terraform', chain: true });
  });
});
