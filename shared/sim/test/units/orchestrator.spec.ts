import { describe, expect, it } from 'vitest';
import {
  enqueuePathRequest,
  ENTITY_STATE,
  getMotion,
  getPathQueue,
  getPathStats,
  hexDistance,
  hexIndex,
  PATH_EXPANSION_BUDGET_PER_STEP,
  restore,
  rowOf,
  setTileTerrain,
  snapshot,
  spawnHqUnit,
  stepPathQueue,
  TERRAIN,
} from '../../src';
import { cmd, w01Host } from './helpers';

describe('movement orchestrator → pathfinding service', () => {
  it('a move order becomes a queued path request, solved the same step, then followed waypoint by waypoint', () => {
    const host = w01Host();
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    host.submit(cmd('moveUnit', { entityId: hqId, q: 6, r: 0 }));
    host.step(1);
    const motion = getMotion(state, hqId)!;
    expect(motion.status).toBe('following');
    expect(motion.goal).toEqual({ q: 6, r: 0, minDist: 0, maxDist: 0 });
    expect(motion.path.slice(-2)).toEqual([6, 0]);
    expect(getPathQueue(state)).toHaveLength(0);
    expect(getPathStats(state).totalResolved).toBe(1);
  });

  it('re-plans when the next waypoint becomes blocked mid-route instead of walking through it', () => {
    const host = w01Host();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const row = rowOf(state.entities, hqId);
    host.submit(cmd('moveUnit', { entityId: hqId, q: 8, r: 0 }));
    host.step(1);
    for (const r of [-3, -2, -1, 0, 1, 2]) setTileTerrain(state.grid, idx.indexOf(4, r), TERRAIN.rock); // wall across the route
    const cols = state.entities.cols;
    for (let t = 0; t < 120 && cols.state[row] === ENTITY_STATE.moving; t++) {
      host.step(1);
      expect(state.grid.layers.terrain[idx.indexOf(cols.q[row], cols.r[row])]).not.toBe(TERRAIN.rock);
    }
    expect([cols.q[row], cols.r[row], cols.state[row]]).toEqual([8, 0, ENTITY_STATE.idle]);
  });

  it('spends at most 2 000 expansions per step; a long search pauses and resumes', () => {
    const host = w01Host(40);
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    // the goal sits inside a closed rock ring of radius 6: too big for the pocket shortcut, so A* floods the map
    for (let i = 0; i < idx.count; i++) if (hexDistance(idx.q[i], idx.r[i], 20, 0) === 6) setTileTerrain(state.grid, i, TERRAIN.rock);
    const hqId = spawnHqUnit(state, { owner: 0, q: -20, r: 0 });
    host.submit(cmd('moveUnit', { entityId: hqId, q: 20, r: 0 }));
    let steps = 0;
    do {
      host.step(1);
      steps++;
      expect(getPathStats(state).lastStepExpansions).toBeLessThanOrEqual(PATH_EXPANSION_BUDGET_PER_STEP);
    } while (getMotion(state, hqId)?.status === 'pending' && steps < 20);
    expect(steps).toBeGreaterThan(1);
    expect(getMotion(state, hqId)).toBeNull(); // the move failed and was dropped
    const row = rowOf(state.entities, hqId);
    expect([state.entities.cols.x[row], state.entities.cols.y[row]]).toEqual([-20, 0]);
  });

  it('a restored snapshot resolves a half-done search on the same step with the same result (replay)', () => {
    const host = w01Host(40);
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    // a deep-water ring with one gap on the far side: the search floods the inside before it finds the way out
    for (let i = 0; i < idx.count; i++) {
      if (hexDistance(idx.q[i], idx.r[i], 0, 0) === 30 && !(idx.q[i] === 0 && idx.r[i] === 30)) setTileTerrain(state.grid, i, TERRAIN.deep);
    }
    enqueuePathRequest(state, { id: 'long', from: { q: -10, r: 0 }, to: { q: 0, r: -35 }, radius: 40 }, 1);
    const a = stepPathQueue(state, 700);
    expect(a.resolvedCount).toBe(0);
    const copy = restore(snapshot(state)); // no live search object: the queue must replay the 700 expansions
    let ra = a;
    let rb = a;
    let n = 0;
    while (ra.resolvedCount === 0 && n++ < 50) {
      ra = stepPathQueue(state, 700);
      rb = stepPathQueue(copy, 700);
      expect(rb.expansionsUsed).toBe(ra.expansionsUsed);
    }
    expect(ra.resolved[0].ok).toBe(true);
    expect(rb.resolved[0]).toEqual(ra.resolved[0]);
  });

  it('a unit mid-route in a restored snapshot arrives on the same tick at the same tile', () => {
    const host = w01Host();
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    host.submit(cmd('moveUnit', { entityId: hqId, q: 9, r: -4 }));
    host.step(7);
    const twin = host.clone();
    for (let t = 0; t < 40; t++) {
      host.step(1);
      twin.step(1);
      const a = host.state.entities.cols;
      const b = twin.state.entities.cols;
      expect([b.x[0], b.y[0], b.state[0]]).toEqual([a.x[0], a.y[0], a.state[0]]);
    }
    expect([host.state.entities.cols.q[0], host.state.entities.cols.r[0]]).toEqual([9, -4]);
  });
});
