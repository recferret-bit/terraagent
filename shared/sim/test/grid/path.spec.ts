import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  enqueuePathRequest,
  findHexPath,
  getPathQueue,
  getPathStats,
  hexDistance,
  hexIndex,
  isGroundPassable,
  PATH_EXPANSION_BUDGET_PER_STEP,
  PREP,
  restore,
  setTilePrep,
  setTileTerrain,
  SimHost,
  snapshot,
  stepPathQueue,
  TERRAIN,
  tileStepCostBp,
  type AxialCoord,
} from '../../src';

describe('W01-12 A* hex pathfinding: terrain multipliers and obstacle routing', () => {
  it('computes exact step costs from terrain multipliers and routes around Deep Water, Ridge and Moat', () => {
    const state = createPlanet({ type: 'flat', seed: 'path-costs', radius: 6 });
    const idx = hexIndex(state.grid.radius);

    const t0 = idx.indexOf(0, 0);
    setTileTerrain(state.grid, t0, TERRAIN.flat);
    setTilePrep(state.grid, t0, PREP.wild);
    expect(tileStepCostBp(state.grid, t0)).toBe(1000);

    setTilePrep(state.grid, t0, PREP.living);
    expect(tileStepCostBp(state.grid, t0)).toBe(909);

    setTilePrep(state.grid, t0, PREP.wild);
    setTileTerrain(state.grid, t0, TERRAIN.slope);
    expect(tileStepCostBp(state.grid, t0)).toBe(1429);

    setTileTerrain(state.grid, t0, TERRAIN.forest);
    expect(tileStepCostBp(state.grid, t0)).toBe(1667);

    setTileTerrain(state.grid, t0, TERRAIN.rock);
    expect(tileStepCostBp(state.grid, t0)).toBe(2000);

    setTileTerrain(state.grid, t0, TERRAIN.hole);
    expect(tileStepCostBp(state.grid, t0)).toBe(2000);

    setTileTerrain(state.grid, t0, TERRAIN.shallow);
    expect(tileStepCostBp(state.grid, t0)).toBe(2000);

    setTileTerrain(state.grid, t0, TERRAIN.deep);
    expect(tileStepCostBp(state.grid, t0)).toBe(0);

    setTileTerrain(state.grid, t0, TERRAIN.flat);
    setTilePrep(state.grid, t0, PREP.ridge);
    expect(tileStepCostBp(state.grid, t0)).toBe(0);

    setTilePrep(state.grid, t0, PREP.moat);
    expect(tileStepCostBp(state.grid, t0)).toBe(0);

    setTilePrep(state.grid, t0, PREP.flat);
    setTileTerrain(state.grid, idx.indexOf(1, 0), TERRAIN.deep);
    setTilePrep(state.grid, idx.indexOf(2, -1), PREP.ridge);
    setTilePrep(state.grid, idx.indexOf(2, 0), PREP.moat);

    const res = findHexPath(state.grid, { q: 0, r: 0 }, { q: 4, r: 0 });
    expect(res.ok).toBe(true);
    expect(res.path[0]).toEqual({ q: 0, r: 0 });
    expect(res.path[res.path.length - 1]).toEqual({ q: 4, r: 0 });

    for (let i = 0; i < res.path.length; i++) {
      const p = res.path[i];
      const pIdx = idx.indexOf(p.q, p.r);
      expect(isGroundPassable(state.grid, pIdx)).toBe(true);
      if (i > 0) {
        const prev = res.path[i - 1];
        expect(hexDistance(prev.q, prev.r, p.q, p.r)).toBe(1);
      }
    }
  });

  it('prefers Living and Flat bypasses over shorter Rock/Forest/Shallow paths', () => {
    const state = createPlanet({ type: 'flat', seed: 'path-prefer', radius: 6 });
    const idx = hexIndex(state.grid.radius);

    setTileTerrain(state.grid, idx.indexOf(1, 0), TERRAIN.rock);
    setTileTerrain(state.grid, idx.indexOf(1, -1), TERRAIN.rock);
    setTileTerrain(state.grid, idx.indexOf(2, -1), TERRAIN.rock);
    setTilePrep(state.grid, idx.indexOf(0, 1), PREP.living);
    setTilePrep(state.grid, idx.indexOf(1, 1), PREP.living);

    const res = findHexPath(state.grid, { q: 0, r: 0 }, { q: 2, r: 0 });
    expect(res.ok).toBe(true);
    expect(res.totalCostBp).toBe(2818);
    expect(res.path).toEqual([
      { q: 0, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: 1 },
      { q: 2, r: 0 },
    ]);
  });
});

describe('W01-12 A* hex pathfinding: unreachable targets and edge cases', () => {
  it('returns ok: false when the target is walled off by Deep Water or Moat', () => {
    const state = createPlanet({ type: 'flat', seed: 'path-walled', radius: 8 });
    const idx = hexIndex(state.grid.radius);
    const target = { q: 4, r: 0 };

    for (let i = 0; i < idx.count; i++) {
      if (hexDistance(target.q, target.r, idx.q[i], idx.r[i]) === 2) {
        if (i % 2 === 0) {
          setTileTerrain(state.grid, i, TERRAIN.deep);
        } else {
          setTilePrep(state.grid, i, PREP.moat);
        }
      }
    }

    const res = findHexPath(state.grid, { q: 0, r: 0 }, target);
    expect(res.ok).toBe(false);
    expect(res.path).toEqual([]);
    expect(res.totalCostBp).toBe(0);
    expect(res.expansions).toBeGreaterThan(0);
    expect(res.expansions).toBeLessThan(200);
  });

  it('handles trivial start===goal, out-of-bounds coords, maxExpansions cap, and deterministic tie-breaking', () => {
    const state = createPlanet({ type: 'flat', seed: 'path-edge', radius: 6 });

    const same = findHexPath(state.grid, { q: 2, r: -1 }, { q: 2, r: -1 });
    expect(same).toEqual({ ok: true, path: [{ q: 2, r: -1 }], expansions: 0, totalCostBp: 0 });

    const oob = findHexPath(state.grid, { q: 0, r: 0 }, { q: 99, r: 99 });
    expect(oob).toEqual({ ok: false, path: [], expansions: 0, totalCostBp: 0 });

    const capped = findHexPath(state.grid, { q: -5, r: 0 }, { q: 5, r: 0 }, { maxExpansions: 4 });
    expect(capped.ok).toBe(false);
    expect(capped.expansions).toBe(4);
    expect(capped.path).toEqual([]);

    const runA = findHexPath(state.grid, { q: -4, r: 2 }, { q: 3, r: -2 });
    const runB = findHexPath(state, { q: -4, r: 2 }, { q: 3, r: -2 });
    expect(runA.ok).toBe(true);
    expect(runB).toEqual(runA);
  });
});

describe('W01-12 acceptance: 50 queued paths on temperate golden-1 within 2000 expansions/step and <= 15 steps', () => {
  function pickPassableEndpoints(seedState = createPlanet({ type: 'temperate', seed: 'golden-1' })): Array<[AxialCoord, AxialCoord]> {
    const idx = hexIndex(seedState.grid.radius);
    const passable: AxialCoord[] = [];
    for (let i = 0; i < idx.count; i++) {
      if (isGroundPassable(seedState.grid, i)) {
        passable.push({ q: idx.q[i], r: idx.r[i] });
      }
    }
    const pairs: Array<[AxialCoord, AxialCoord]> = [];
    const strideA = 173;
    const strideB = 389;
    for (let k = 0; k < 50; k++) {
      const from = passable[(k * strideA + 19) % passable.length];
      const to = passable[(k * strideB + Math.floor(passable.length / 2)) % passable.length];
      pairs.push([from, to]);
    }
    return pairs;
  }

  it('queues 50 paths at once on golden-1, never exceeds 2000 expansions/step, and resolves all 50 within <= 15 steps', () => {
    const host = new SimHost({ flags: parseWaves('..01') });
    host.load(createPlanet({ type: 'temperate', seed: 'golden-1' }));
    const state = host.state;
    const pairs = pickPassableEndpoints(state);

    for (let i = 0; i < 50; i++) {
      const [from, to] = pairs[i];
      enqueuePathRequest(state, { id: `req_${i}`, entityId: i + 1, from, to });
    }

    expect(getPathQueue(state)).toHaveLength(50);
    expect(getPathStats(state).queueLength).toBe(50);
    expect(restore(snapshot(state))).toEqual(state);

    let steps = 0;
    while (getPathQueue(state).length > 0 && steps < 20) {
      host.step(1);
      steps += 1;
      const stats = getPathStats(state);
      expect(stats.lastStepExpansions).toBeLessThanOrEqual(PATH_EXPANSION_BUDGET_PER_STEP);
      expect(stats.lastStepExpansions).toBeGreaterThan(0);
    }

    expect(steps).toBeLessThanOrEqual(15);
    expect(getPathQueue(state)).toHaveLength(0);
    expect(getPathStats(state).totalResolved).toBe(50);
    expect(getPathStats(state).queueLength).toBe(0);
  });

  it('stepPathQueue directly returns resolved paths in FIFO order and pauses mid-search when hitting the step budget', () => {
    const state = createPlanet({ type: 'temperate', seed: 'golden-1' });
    const pairs = pickPassableEndpoints(state);
    for (let i = 0; i < 50; i++) {
      const [from, to] = pairs[i];
      enqueuePathRequest(state, { id: i, from, to });
    }

    const allResolvedIds: Array<string | number> = [];
    let steps = 0;
    while (getPathQueue(state).length > 0 && steps < 20) {
      const stepRes = stepPathQueue(state, PATH_EXPANSION_BUDGET_PER_STEP);
      steps += 1;
      expect(stepRes.expansionsUsed).toBeLessThanOrEqual(PATH_EXPANSION_BUDGET_PER_STEP);
      for (const r of stepRes.resolved) {
        allResolvedIds.push(r.id);
        if (r.ok) {
          expect(r.path[0]).toEqual(r.from);
          expect(r.path[r.path.length - 1]).toEqual(r.to);
        }
      }
    }

    expect(steps).toBeLessThanOrEqual(15);
    expect(allResolvedIds).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});
