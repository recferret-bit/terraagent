import { describe, expect, it } from 'vitest';
import { enqueueTerraformOrder, getUnitRecord, hexDistance, hexIndex, setTileTerrain, spawnHqUnit, TERRAIN } from '../../src';
import { w01Host } from '../helpers/host';

describe('GP-21: unreachable auto work backs off exponentially', () => {
  it('each failed search of the same job doubles its skip (25, 50 ticks …), capped at retryBlockedMaxS', () => {
    const host = w01Host({ seed: 'backoff', radius: 14 });
    const state = host.state;
    const hqId = spawnHqUnit(state, { owner: 0, q: -8, r: 0 });
    const idx = hexIndex(state.grid.radius);
    // An island: the job tile (6, 0) behind three rings of deep water, so no tile within terraform reach is standable.
    for (let i = 0; i < idx.count; i++) {
      const d = hexDistance(6, 0, idx.q[i], idx.r[i]);
      if (d >= 1 && d <= 3) setTileTerrain(state.grid, i, TERRAIN.deep);
    }
    expect(enqueueTerraformOrder(state, { colonyId: 0, op: 'grade', tiles: [{ q: 6, r: 0 }], allowUnclaimed: true }).ok).toBe(true);
    const skips: number[] = [];
    let lastFails = 0;
    for (let t = 0; t < 400 && skips.length < 3; t++) {
      host.step(1);
      const rec = getUnitRecord(state, hqId)!;
      const fails = Object.values(rec.fails ?? {})[0] ?? 0;
      if (fails > lastFails) {
        skips.push(Object.values(rec.skip)[0] - host.tick);
        lastFails = fails;
      }
    }
    expect(skips).toEqual([25, 50, 100]);
  });
});
