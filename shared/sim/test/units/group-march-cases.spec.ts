import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  ENTITY_KIND,
  getMotion,
  getPathQueue,
  getUnitCommand,
  getUnitRecord,
  hexIndex,
  issueUnitCommand,
  restore,
  setTileTerrain,
  SimHost,
  snapshot,
  spawnHqUnit,
  TERRAIN,
} from '../../src';
import { cmd, w01Host } from './helpers';
import { ctxOf, runUntil, spawnKind, speed } from './group-march-fixture';
import { MarchOracle, pose } from './group-march-oracle';

function settled(host: SimHost, ids: readonly number[]): boolean {
  return ids.every((id) => getUnitCommand(host.state, id) === null);
}

describe('moveGroup restore, blocks, and command priority', () => {
  it('rebuilds local slot routes after a terrain edit inside the arrival disk', () => {
    const host = w01Host(12);
    const ids = Array.from({ length: 20 }, () => spawnHqUnit(host.state, { owner: 0, q: 1, r: 0 }));
    host.submit(cmd('moveGroup', { entityIds: ids, q: 0, r: 0 }));
    host.step(1);
    const goals = ids.map(id => ({ id, ...getMotion(host.state, id)?.goal }));
    setTileTerrain(host.state.grid, hexIndex(12).indexOf(0, -1), TERRAIN.rock);
    for (let tick = 0; tick < 120; tick++) host.step(1);
    // A slot that became a rock may fail; every other reachable slot must still settle.
    for (const goal of goals) {
      if (goal.q === undefined || (goal.q === 0 && goal.r === -1)) continue;
      expect(pose(host, goal.id)).toMatchObject({ q: goal.q, r: goal.r });
    }
  });

  it('a restored snapshot and a clone share every future pose while a field is still paused', () => {
    const host = w01Host(48);
    const ids = [0, 1, 2, 3].map((r) => spawnHqUnit(host.state, { owner: 0, q: -36, r }));
    host.submit(cmd('moveGroup', { entityIds: ids, q: 36, r: 0 }));
    host.step(1);
    expect(getPathQueue(host.state).length).toBeGreaterThan(0);
    const twin = host.clone();
    const restored = new SimHost(host.pipeline);
    restored.load(restore(snapshot(host.state)));
    for (let t = 0; t < 25; t++) {
      host.step(1);
      twin.step(1);
      restored.step(1);
      for (const id of ids) {
        expect(pose(twin, id)).toEqual(pose(host, id));
        expect(pose(restored, id)).toEqual(pose(host, id));
      }
    }
  });

  it('never stands on a rock anchor or its blocked neighbours', () => {
    const host = w01Host(16);
    const idx = hexIndex(16);
    const rocks = [[8, 0], [9, 0], [8, -1]] as const;
    for (const [q, r] of rocks) setTileTerrain(host.state.grid, idx.indexOf(q, r), TERRAIN.rock);
    const spawned = [[0, 0], [1, 0], [0, 1], [2, 0]] as const;
    const ids = spawned.map(([q, r]) => spawnHqUnit(host.state, { owner: 0, q, r }));
    host.submit(cmd('moveGroup', { entityIds: ids, q: 8, r: 0 }));
    const oracle = new MarchOracle(host, ids, (id) => speed(host, id));
    runUntil(oracle, () => settled(host, ids), 80);
    const banned = new Set(rocks.map(([q, r]) => `${q},${r}`));
    for (const sample of oracle.samples) {
      for (const id of ids) expect(banned.has(`${sample.get(id)!.q},${sample.get(id)!.r}`)).toBe(false);
    }
    const expected = assignSlots({ q: 8, r: 0 }, ids.map((id, i) => ({ id, q: spawned[i][0], r: spawned[i][1] })), (q, r) => {
      const tile = idx.indexOf(q, r);
      return tile >= 0 && host.state.grid.layers.terrain[tile] !== TERRAIN.rock;
    }, { maxRing: 16 });
    for (const slot of expected.slots) expect(pose(host, slot.id)).toMatchObject({ q: slot.q, r: slot.r });
    expect(oracle.samples.length).toBeGreaterThan(10);
  });

  it('replans the unit whose future tile turns to rock and leaves the others on their routes', () => {
    const host = w01Host(20);
    const ids = [[0, 0], [0, 1], [14, 2]].map(([q, r]) => spawnHqUnit(host.state, { owner: 0, q, r }));
    host.submit(cmd('moveGroup', { entityIds: ids, q: 10, r: 0 }));
    const oracle = new MarchOracle(host, ids, (id) => speed(host, id));
    runUntil(oracle, () => ids.every((id) => (getMotion(host.state, id)?.path.length ?? 0) > 4), 20);
    const victim = ids[ids.length - 1];
    const tile = uniqueFutureTile(host, ids, victim);
    setTileTerrain(host.state.grid, hexIndex(20).indexOf(tile.q, tile.r), TERRAIN.rock);
    oracle.loose.add(victim);
    runUntil(oracle, () => settled(host, ids), 120);
    for (const sample of oracle.samples) {
      expect(`${sample.get(victim)!.q},${sample.get(victim)!.r}`).not.toBe(`${tile.q},${tile.r}`);
    }
    expect(new Set(ids.map((id) => `${pose(host, id).q},${pose(host, id).r}`)).size).toBe(ids.length);
  });

  it('keeps overflow units still and reports no_path when two tiles are free', () => {
    const host = w01Host(3);
    const idx = hexIndex(3);
    for (let i = 0; i < idx.count; i++) {
      const open = (idx.q[i] === 0 && idx.r[i] === 0) || (idx.q[i] === 1 && idx.r[i] === 0);
      if (!open) setTileTerrain(host.state.grid, i, TERRAIN.rock);
    }
    const ids = [0, 1, 2, 3].map(() => spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 }));
    const overflow = ids.slice(2);
    const start = overflow.map((id) => pose(host, id));
    host.submit(cmd('moveGroup', { entityIds: ids, q: 0, r: 0 }));
    const oracle = new MarchOracle(host, ids, (id) => speed(host, id));
    runUntil(oracle, () => settled(host, ids), 40);
    oracle.steps(10);
    overflow.forEach((id, i) => {
      expect(pose(host, id)).toEqual(start[i]);
      expect(getUnitRecord(host.state, id)?.lastFailure?.code).toBe('no_path');
    });
    expect(new Set(ids.slice(0, 2).map((id) => `${pose(host, id).q},${pose(host, id).r}`)).size).toBe(2);
  });
});

describe('moveGroup priority, a second group, and a single move', () => {
  it('replaces an auto move, then lets one member be moved or stopped on its own', () => {
    const host = w01Host(18);
    const a = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const b = spawnHqUnit(host.state, { owner: 0, q: 0, r: 1 });
    issueUnitCommand(host.state, rowOf(host, a), { kind: 'move', source: 'auto', q: 12, r: 0 }, ctxOf(host));
    host.step(1);
    expect(getUnitCommand(host.state, a)?.source).toBe('auto');
    host.submit(cmd('moveGroup', { entityIds: [a, b], q: 8, r: 0 }));
    const oracle = new MarchOracle(host, [a, b], (id) => speed(host, id));
    oracle.step();
    const order = getUnitCommand(host.state, a);
    expect(order).toMatchObject({ source: 'player', kind: 'move' });
    expect(order?.kind === 'move' ? order.q : 12).not.toBe(12);
    oracle.steps(3);
    const stoppedAt = pose(host, a);
    host.submit(cmd('stopUnit', { entityId: a }));
    host.submit(cmd('moveUnit', { entityId: b, q: 4, r: 4 }));
    oracle.loose.add(b);
    oracle.steps(5);
    expect(pose(host, a)).toEqual(stoppedAt);
    runUntil(oracle, () => getUnitCommand(host.state, b) === null, 40);
    expect(pose(host, b)).toMatchObject({ q: 4, r: 4 });
    expect(pose(host, a)).toEqual(stoppedAt);
  });

  it('gives two groups ordered the same tick disjoint tiles', () => {
    const host = w01Host(16);
    const left = [0, 1, 2].map((r) => spawnHqUnit(host.state, { owner: 0, q: 0, r }));
    const right = [0, 1, 2].map((r) => spawnHqUnit(host.state, { owner: 0, q: 2, r }));
    host.submit(cmd('moveGroup', { entityIds: left, q: 6, r: 0 }));
    host.submit(cmd('moveGroup', { entityIds: right, q: 6, r: 0 }));
    const ids = [...left, ...right];
    const oracle = new MarchOracle(host, ids, (id) => speed(host, id));
    runUntil(oracle, () => settled(host, ids), 80);
    const tiles = ids.map((id) => `${pose(host, id).q},${pose(host, id).r}`);
    expect(new Set(tiles).size).toBe(ids.length);
    expect(oracle.samples[0].size).toBe(6);
    expect(oracle.samples[9]).toBeDefined();
    expect(oracle.samples.at(-1)!.get(left[0])).toBeDefined();
  });

  it('a single moveUnit still arrives on that hex at its own speed', () => {
    const host = w01Host();
    const hq = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const own = speed(host, hq);
    host.submit(cmd('moveUnit', { entityId: hq, q: 8, r: 0 }));
    const oracle = new MarchOracle(host, [hq], () => own);
    runUntil(oracle, () => settled(host, [hq]), 40);
    expect(pose(host, hq)).toMatchObject({ q: 8, r: 0, x: 8, y: 0 });
    expect(oracle.samples.length).toBeGreaterThan(10);
    expect(oracle.samples[9].get(hq)).toBeDefined();
    expect(speed(host, hq)).toBe(own);
  });

  it('rejects a deep-water anchor and a mixed-profile group without moving anyone', () => {
    const host = w01Host();
    const hq = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const harvester = spawnKind(host.state, ENTITY_KIND.worker, 1, 0, 120);
    const startHq = pose(host, hq);
    const startHarvester = pose(host, harvester);
    setTileTerrain(host.state.grid, hexIndex(host.state.grid.radius).indexOf(5, 0), TERRAIN.deep);
    host.submit(cmd('moveGroup', { entityIds: [hq], q: 5, r: 0 }));
    host.step(1);
    expect(host.lastStep?.outcomes[0]?.code).toBe('site_blocked');
    host.submit(cmd('moveGroup', { entityIds: [hq, harvester], q: 4, r: 0 }));
    host.step(1);
    expect(host.lastStep?.outcomes[0]?.code).toBe('invalid_args');
    for (let i = 0; i < 8; i++) host.step(1);
    expect(pose(host, hq)).toEqual(startHq);
    expect(pose(host, harvester)).toEqual(startHarvester);
  });
});

function rowOf(host: SimHost, id: number): number {
  return host.state.entities.cols.id.indexOf(id);
}

function uniqueFutureTile(host: SimHost, ids: readonly number[], victim: number): { q: number; r: number } {
  const counts = new Map<string, number>();
  const slots = new Set<string>();
  for (const id of ids) {
    const motion = getMotion(host.state, id);
    const path = motion?.path ?? [];
    const next = motion?.next ?? 0;
    if (path.length >= 2) slots.add(`${path[path.length - 2]},${path[path.length - 1]}`);
    for (let i = next; i < path.length / 2 - 1; i++) {
      const key = `${path[i * 2]},${path[i * 2 + 1]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const motion = getMotion(host.state, victim);
  const path = motion?.path ?? [];
  const next = motion?.next ?? 0;
  for (let i = path.length / 2 - 2; i >= next; i--) {
    const q = path[i * 2];
    const r = path[i * 2 + 1];
    const key = `${q},${r}`;
    if (counts.get(key) === 1 && !slots.has(key)) return { q, r };
  }
  throw new Error('no unique future tile');
}
