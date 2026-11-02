import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createPlanet, hexDistance, hexIndex, rowOf, setTileDeposit, setTileTerrain, SimHost, spawnHqUnit, TERRAIN, DEPOSIT } from '../../src';
import { cmd } from './helpers';

/** The authority (server or `?host=local` worker): a temperate-style map with trees, rock and deposits. */
function authority(): { host: SimHost; hqId: number } {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'sync', radius: 18 }));
  const idx = hexIndex(host.state.grid.radius);
  let s = 7;
  for (let i = 0; i < idx.count; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    if (hexDistance(idx.q[i], idx.r[i], 0, 0) < 2) continue;
    const roll = s % 10;
    if (roll === 0) setTileTerrain(host.state.grid, i, TERRAIN.forest);
    else if (roll === 1) setTileTerrain(host.state.grid, i, TERRAIN.rock);
    else if (roll === 2) setTileDeposit(host.state.grid, i, DEPOSIT.minerals, 1);
  }
  const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  return { host, hqId };
}

describe('client and server agree on unit movement', () => {
  it('a replica fed client snapshots + diffs, and a prediction stepped from it, match the authority every tick', () => {
    const { host: server, hqId } = authority();
    const replica = new SimHost({ flags: parseWaves('..01') });
    replica.load(server.snapshot()); // the client snapshot only omits hidden subsurface layers (D-38), irrelevant to movement
    const orders: Array<[number, number, number]> = [[1, 9, -3], [12, -6, 8], [30, 4, 4], [31, 4, 5], [55, -10, 0]];
    for (let t = 1; t <= 120; t++) {
      for (const [at, q, r] of orders) if (at === t) server.submit(cmd('moveUnit', { entityId: hqId, q, r }));
      // what the client predicts for this tick: its replica (one tick behind) cloned, the same commands, one step
      const predicted = replica.clone();
      for (const [at, q, r] of orders) if (at === t) predicted.submit(cmd('moveUnit', { entityId: hqId, q, r }));
      predicted.step(1);
      const from = server.tick;
      server.step(1);
      replica.applyDiff(server.diffSince(from));
      const a = server.state.entities.cols;
      const row = rowOf(server.state.entities, hqId);
      for (const other of [replica, predicted]) {
        const b = other.state.entities.cols;
        const rb = rowOf(other.state.entities, hqId);
        expect([b.x[rb], b.y[rb], b.state[rb]], `tick ${t}`).toEqual([a.x[row], a.y[row], a.state[row]]);
      }
    }
  });

  it('long searches that span several steps (budget) stay identical on the replica, blobs included', () => {
    const server = new SimHost({ flags: parseWaves('..01') });
    server.load(createPlanet({ type: 'flat', seed: 'sync-long', radius: 40 }));
    const idx = hexIndex(server.state.grid.radius);
    // a rock ring of radius 25 with one gap on the far side: the way out needs > 2 000 expansions
    for (let i = 0; i < idx.count; i++) {
      if (hexDistance(idx.q[i], idx.r[i], 0, 0) === 25 && !(idx.q[i] === 0 && idx.r[i] === 25)) setTileTerrain(server.state.grid, i, TERRAIN.rock);
    }
    const hqId = spawnHqUnit(server.state, { owner: 0, q: 0, r: -20 });
    const replica = new SimHost({ flags: parseWaves('..01') });
    replica.load(server.snapshot());
    const blobs = (h: SimHost) => JSON.stringify(['units', 'unitMotion', 'pathQueue'].map((k) => h.state.blobs[k]?.value ?? null));
    let multiStep = false;
    for (let t = 1; t <= 60; t++) {
      if (t === 1) server.submit(cmd('moveUnit', { entityId: hqId, q: 0, r: -30 }));
      const predicted = replica.clone();
      if (t === 1) predicted.submit(cmd('moveUnit', { entityId: hqId, q: 0, r: -30 }));
      predicted.step(1);
      const from = server.tick;
      server.step(1);
      if (((server.state.blobs.pathQueue?.value ?? []) as unknown[]).length > 0) multiStep = true;
      replica.applyDiff(server.diffSince(from));
      expect(blobs(replica), `tick ${t}`).toBe(blobs(server));
      expect(blobs(predicted), `tick ${t}`).toBe(blobs(server));
      const a = server.state.entities.cols;
      const b = predicted.state.entities.cols;
      expect([b.x[0], b.y[0], b.state[0]], `tick ${t}`).toEqual([a.x[0], a.y[0], a.state[0]]);
    }
    expect(multiStep).toBe(true);
  });
});
