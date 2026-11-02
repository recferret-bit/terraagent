import { describe, expect, it } from 'vitest';
import {
  cancelPathRequest,
  createPlanet,
  enqueuePathRequest,
  findHexPath,
  getPathQueue,
  hexIndex,
  PREP,
  restore,
  setTilePrep,
  setTileTerrain,
  snapshot,
  stepPathQueue,
  TERRAIN,
  type AxialCoord,
  type CompiledDataLike,
  type PathQueueResult,
  type PlanetState,
} from '../../src';

const FROM: AxialCoord = { q: -10, r: 0 };
const TO: AxialCoord = { q: 10, r: 0 };

// Per-step budget: 32 expansions + the 64-node pocket check fit in the first step (a budget below 64 would defer the
// pocket check forever, WE-28). Every route below needs about 200 expansions, so it pauses at least once.
const B = 96;

/** Steps the queue with `budget` until it is empty; returns everything resolved, in order. */
function drain(state: PlanetState, budget: number, data?: CompiledDataLike): PathQueueResult[] {
  const out: PathQueueResult[] = [];
  for (let n = 0; getPathQueue(state).length > 0 && n < 500; n++) out.push(...stepPathQueue(state, budget, data, n + 1).resolved);
  return out;
}

/** A Deep wall across q = 0 that leaves only the tiles with `r <= gapR` open, so the straight route must detour. */
function buildWall(state: PlanetState, gapR: number): void {
  const idx = hexIndex(state.grid.radius);
  for (let i = 0; i < idx.count; i++) if (idx.q[i] === 0 && idx.r[i] > gapR) setTileTerrain(state.grid, i, TERRAIN.deep);
}

/** A radius-12 flat planet with the wall open at r <= -9 (the route needs about 200 expansions). */
function walled(seed: string): PlanetState {
  const s = createPlanet({ type: 'flat', seed, radius: 12 });
  buildWall(s, -9);
  return s;
}

const strip = (r: PathQueueResult) => ({ ok: r.ok, path: r.path, totalCostBp: r.totalCostBp });

describe('path queue: ground changes while a search is paused (WE-15)', () => {
  it('a live host and a restored copy resolve the same path as a fresh search on the new ground', () => {
    const live = walled('epoch');
    enqueuePathRequest(live, { id: 'a', from: FROM, to: TO });
    expect(stepPathQueue(live, B).resolved).toHaveLength(0); // paused mid-search
    const epoch = live.meta.pathEpoch ?? 0;
    buildWall(live, -11); // narrows the gap; setTileTerrain bumps meta.pathEpoch
    expect(live.meta.pathEpoch).toBeGreaterThan(epoch);
    const copyAfter = restore(snapshot(live));
    expect(stepPathQueue(live, B).resolved).toHaveLength(0); // restarted on the new ground, paused again
    const copyPausedAgain = restore(snapshot(live));

    const fresh = findHexPath(live, FROM, TO);
    expect(fresh.ok).toBe(true);
    expect(fresh.path.some((p) => p.q === 0 && p.r <= -11)).toBe(true); // goes through the narrowed gap
    const [a] = drain(live, B);
    expect(strip(a)).toEqual(strip({ ...fresh, id: 'a', from: FROM, to: TO, resolvedAtTick: 0 }));
    expect(drain(copyAfter, B).map(strip)).toEqual([strip(a)]);
    expect(drain(copyPausedAgain, B).map(strip)).toEqual([strip(a)]);
  });

  it('a prep wall (Ridge) placed while paused restarts the search the same way', () => {
    const live = walled('epoch-prep');
    enqueuePathRequest(live, { id: 'a', from: FROM, to: TO });
    stepPathQueue(live, B);
    const idx = hexIndex(live.grid.radius);
    for (let i = 0; i < idx.count; i++) if (idx.q[i] === -4 && idx.r[i] > -6) setTilePrep(live.grid, i, PREP.ridge);
    const copy = restore(snapshot(live));
    const [a] = drain(live, B);
    expect(strip(a)).toEqual(strip({ ...findHexPath(live, FROM, TO), id: 'a', from: FROM, to: TO, resolvedAtTick: 0 }));
    expect(drain(copy, B).map(strip)).toEqual([strip(a)]);
  });
});

describe('path queue: cancel and default ids (WE-14, WE-15)', () => {
  it('cancelling the paused head drops its cached search: a new request under the same id searches afresh', () => {
    const live = walled('cancel');
    enqueuePathRequest(live, { id: 'a', from: FROM, to: TO });
    enqueuePathRequest(live, { id: 'b', from: { q: 0, r: -5 }, to: { q: 0, r: 5 } });
    expect(stepPathQueue(live, B).resolved).toHaveLength(0);
    expect(cancelPathRequest(live, 'a', 2)).toBe(true);
    expect(cancelPathRequest(live, 'a', 2)).toBe(false);
    const other: AxialCoord = { q: -10, r: 10 };
    enqueuePathRequest(live, { id: 'a', from: FROM, to: other });
    const copy = restore(snapshot(live));
    const res = drain(live, B);
    expect(res.map((r) => r.id)).toEqual(['b', 'a']);
    expect(strip(res[1])).toEqual(strip({ ...findHexPath(live, FROM, other), id: 'a', from: FROM, to: other, resolvedAtTick: 0 }));
    expect(drain(copy, B).map(strip)).toEqual(res.map(strip));
  });

  it('default ids never repeat after a cancel', () => {
    const s = createPlanet({ type: 'flat', seed: 'ids', radius: 6 });
    const a = enqueuePathRequest(s, { from: { q: 0, r: 0 }, to: { q: 3, r: 0 } });
    const b = enqueuePathRequest(s, { from: { q: 0, r: 0 }, to: { q: 0, r: 3 } });
    cancelPathRequest(s, a.id, 1);
    const c = enqueuePathRequest(s, { from: { q: 0, r: 0 }, to: { q: -3, r: 0 } });
    enqueuePathRequest(s, { id: 'mine', from: { q: 0, r: 0 }, to: { q: 1, r: 0 } });
    drain(s, 2000);
    const d = enqueuePathRequest(s, { from: { q: 0, r: 0 }, to: { q: 2, r: 0 } });
    expect([a.id, b.id, c.id, d.id]).toEqual(['path_1', 'path_2', 'path_3', 'path_4']);
  });
});

describe('path queue: step-cost data changes while a search is paused (WE-16)', () => {
  it('a new data hash restarts the search on every host alike', () => {
    const before: CompiledDataLike = { hash: 'before', tables: {} };
    const after: CompiledDataLike = { hash: 'after', tables: { terrain: { flat: { moveMult: 0.5 }, rock: { moveMult: 1 } } } };
    const live = walled('tune');
    const idx = hexIndex(live.grid.radius);
    // a band of Rock along the straight route: expensive before, cheaper than Flat after
    for (let i = 0; i < idx.count; i++) if (idx.q[i] !== 0 && Math.abs(idx.r[i]) <= 1) setTileTerrain(live.grid, i, TERRAIN.rock);
    enqueuePathRequest(live, { id: 'a', from: FROM, to: TO });
    expect(stepPathQueue(live, B, before).resolved).toHaveLength(0);
    const copy = restore(snapshot(live));
    const [a] = drain(live, B, after);
    const fresh = findHexPath(live, FROM, TO, { data: after });
    expect(strip(a)).toEqual(strip({ ...fresh, id: 'a', from: FROM, to: TO, resolvedAtTick: 0 }));
    expect(drain(copy, B, after).map(strip)).toEqual([strip(a)]);
  });
});

describe('findHexPath budget (WE-13)', () => {
  it('a maxExpansions between 33 and 95 is spent in full instead of stopping after 32', () => {
    const s = walled('budget');
    for (const max of [40, 60, 95]) {
      const res = findHexPath(s, FROM, TO, { maxExpansions: max });
      expect(res).toEqual({ ok: false, path: [], expansions: max, totalCostBp: 0 });
    }
  });
});
