import { describe, expect, it } from 'vitest';
import { createPlanet, FAR_HEURISTIC_WEIGHT_BP, findHexPath, HEX_DIRS, hexIndex, tileStepCostBp, type PlanetState } from '../../src';

/** Cheapest cost from `start` to every tile with the same step costs as the A* (Dijkstra, O(n²): small planets only). */
function dijkstra(state: PlanetState, start: number): Float64Array {
  const idx = hexIndex(state.grid.radius);
  const dist = new Float64Array(idx.count).fill(Infinity);
  const done = new Uint8Array(idx.count);
  dist[start] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < idx.count; i++) if (!done[i] && dist[i] < Infinity && (cur < 0 || dist[i] < dist[cur])) cur = i;
    if (cur < 0) return dist;
    done[cur] = 1;
    for (const [dq, dr] of HEX_DIRS) {
      const n = idx.indexOf(idx.q[cur] + dq, idx.r[cur] + dr);
      const c = n < 0 ? 0 : tileStepCostBp(state, n);
      if (c > 0 && dist[cur] + c < dist[n]) dist[n] = dist[cur] + c;
    }
  }
}

// WE-12: the A* heuristic is weighted past 6 tiles (not admissible), so long paths may cost more than the cheapest.
describe('path search optimality bound (weighted A*)', () => {
  it('never exceeds the theoretical bound; pins the measured worst ratio on three temperate planets', () => {
    const bound = FAR_HEURISTIC_WEIGHT_BP / 909;
    let worst = 1, suboptimal = 0, pairs = 0;
    for (const seed of ['bound-1', 'bound-2', 'bound-3']) {
      const s = createPlanet({ type: 'temperate', seed, radius: 30 });
      const idx = hexIndex(s.grid.radius);
      const passable = Array.from({ length: idx.count }, (_, i) => i).filter((i) => tileStepCostBp(s, i) > 0);
      for (let k = 0; k < 40; k++) {
        const a = passable[(k * 173 + 11) % passable.length], b = passable[(k * 389 + 7) % passable.length];
        const best = dijkstra(s, a)[b];
        if (!(best < Infinity) || a === b) continue;
        const res = findHexPath(s, { q: idx.q[a], r: idx.r[a] }, { q: idx.q[b], r: idx.r[b] });
        expect(res.ok).toBe(true);
        pairs++;
        const ratio = res.totalCostBp / best;
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(bound);
        if (ratio > 1) suboptimal++;
        worst = Math.max(worst, ratio);
      }
    }
    // Deterministic: if a change to the search moves these numbers, update them on purpose (and the HEURISTIC doc).
    expect({ pairs, suboptimal, worst: worst.toFixed(4) }).toEqual({ pairs: 120, suboptimal: 54, worst: '1.1679' });
  });
});
