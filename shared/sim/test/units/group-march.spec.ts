import { describe, expect, it } from 'vitest';
import {
  assignSlots,
  ENTITY_KIND,
  ENTITY_STATE,
  getMotion,
  getPathStats,
  getUnitCommand,
  hexDistance,
  hexIndex,
  insertRow,
  mobileStats,
  PATH_EXPANSION_BUDGET_PER_STEP,
  placeSpawnedEntity,
  rowOf,
  SimHost,
  spawnHqUnit,
  type PlanetState,
} from '../../src';
import { cmd, w01Host } from './helpers';
import { MarchOracle, pose } from './group-march-oracle';

function dataOf(host: SimHost) {
  return host.pipeline.config.data;
}

function hqSpeed(host: SimHost, id: number, cap?: number): number {
  const row = rowOf(host.state.entities, id);
  const own = mobileStats(host.state.entities.cols.kind[row], dataOf(host))!.speedPerTick;
  return cap !== undefined && cap < own ? cap : own;
}

function spawnKind(state: PlanetState, kind: number, q: number, r: number, hp: number): number {
  const tick = state.meta.tick;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, tick);
  const cols = state.entities.cols;
  cols.kind[row] = kind;
  cols.owner[row] = 0;
  cols.hp[row] = hp;
  cols.hpMax[row] = hp;
  cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, q, r, tick);
  return id;
}

function cluster(state: PlanetState, n: number): number[] {
  const ids: number[] = [];
  for (let r = -4; ids.length < n; r++) {
    for (let q = -4; q <= 4 && ids.length < n; q++) ids.push(spawnHqUnit(state, { owner: 0, q, r }));
  }
  return ids;
}

function runUntil(oracle: MarchOracle, done: () => boolean, max: number): void {
  oracle.step();
  for (let i = 1; i < max && !done(); i++) oracle.step();
  expect(done()).toBe(true);
}

describe('moveGroup time-sampled marches', () => {
  it('sends 50 units to distinct tiles and matches the pose oracle at every future tick', () => {
    const host = w01Host(28);
    const ids = cluster(host.state, 50);
    const lowest = Math.min(...ids);
    const placed = ids.map((id) => {
      const row = rowOf(host.state.entities, id);
      return { id, q: host.state.entities.cols.q[row], r: host.state.entities.cols.r[row] };
    });
    host.submit(cmd('moveGroup', { entityIds: ids, q: 20, r: 0 }));
    const speed = () => hqSpeed(host, ids[0]);
    const oracle = new MarchOracle(host, ids, speed);
    runUntil(oracle, () => ids.every((id) => getUnitCommand(host.state, id) === null && pose(host, id).x === pose(host, id).q), 200);
    const maxExp = Math.max(...oracle.expansions);
    expect(oracle.samples.length).toBeGreaterThan(10);
    const idx = hexIndex(28);
    const expected = assignSlots({ q: 20, r: 0 }, placed, (q, r) => idx.indexOf(q, r) >= 0, {
      maxRing: 28,
      inBounds: (q, r) => idx.indexOf(q, r) >= 0,
    });
    const seen = new Set<string>();
    for (const slot of expected.slots) {
      const at = pose(host, slot.id);
      expect([at.q, at.r, at.x, at.y]).toEqual([slot.q, slot.r, slot.q, slot.r]);
      seen.add(`${at.q},${at.r}`);
    }
    expect(seen.size).toBe(50);
    const centre = expected.slots.find((slot) => slot.q === 20 && slot.r === 0);
    expect(centre).toBeDefined();
    expect(centre!.id).not.toBe(lowest);
    expect(oracle.samples[0].get(centre!.id)).toBeDefined();
    expect(oracle.samples[9].get(centre!.id)).toBeDefined();
    expect(oracle.samples[Math.floor(oracle.samples.length / 2)].get(centre!.id)).toBeDefined();
    expect(oracle.samples.at(-2)!.get(centre!.id)).toBeDefined();
    expect(oracle.samples.at(-1)!.get(centre!.id)).toMatchObject({ q: 20, r: 0 });
    expect(maxExp).toBeLessThanOrEqual(PATH_EXPANSION_BUDGET_PER_STEP);
    expect(getPathStats(host.state).totalResolved).toBe(1);
  });

  it('holds a faster unit to the slowest member without rewriting its cached speed', () => {
    const host = w01Host(24);
    const hq = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const tank = spawnKind(host.state, ENTITY_KIND.demoTank, 1, 0, 500);
    const hqOwn = mobileStats(ENTITY_KIND.hq, dataOf(host))!.speedPerTick;
    const tankOwn = mobileStats(ENTITY_KIND.demoTank, dataOf(host))!.speedPerTick;
    expect(tankOwn).toBeGreaterThan(hqOwn);
    host.submit(cmd('moveGroup', { entityIds: [hq, tank], q: 14, r: 0, pace: 'together' }));
    const oracle = new MarchOracle(host, [hq, tank], () => hqOwn);
    runUntil(oracle, () => getUnitCommand(host.state, hq) === null && getUnitCommand(host.state, tank) === null, 80);
    expect(oracle.samples.length).toBeGreaterThan(10);
    const mid = oracle.samples[9];
    const prev = oracle.samples[8];
    const hqStep = hexDistance(prev.get(hq)!.x, prev.get(hq)!.y, mid.get(hq)!.x, mid.get(hq)!.y);
    const tankStep = hexDistance(prev.get(tank)!.x, prev.get(tank)!.y, mid.get(tank)!.x, mid.get(tank)!.y);
    expect(hqStep).toBeGreaterThan(0);
    expect(tankStep).toBe(hqStep);
    expect(tankStep).toBeLessThan(tankOwn);
    expect(mobileStats(ENTITY_KIND.demoTank, dataOf(host))!.speedPerTick).toBe(tankOwn);
    expect(mobileStats(ENTITY_KIND.hq, dataOf(host))!.speedPerTick).toBe(hqOwn);
    expect(pose(host, hq).q).not.toBe(pose(host, tank).q);
  });

  it('keeps a line in its own lanes and does not walk a rear unit through the anchor', () => {
    const host = w01Host(24);
    const west = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const mid = spawnHqUnit(host.state, { owner: 0, q: 2, r: 0 });
    const east = spawnHqUnit(host.state, { owner: 0, q: 4, r: 0 });
    const ids = [west, mid, east];
    host.submit(cmd('moveGroup', { entityIds: ids, q: 16, r: 0 }));
    const oracle = new MarchOracle(host, ids, (id) => hqSpeed(host, id));
    let westPath: number[] | null = null;
    oracle.step();
    for (let i = 0; i < 80 && !ids.every((id) => getUnitCommand(host.state, id) === null); i++) {
      const motion = getMotion(host.state, west);
      if (motion && motion.path.length > 0) westPath = motion.path.slice();
      oracle.step();
    }
    expect(ids.every((id) => getUnitCommand(host.state, id) === null)).toBe(true);
    expect(pose(host, mid)).toMatchObject({ q: 16, r: 0 });
    expect(pose(host, west).q).toBeLessThan(16);
    expect(pose(host, east).q).toBeGreaterThan(16);
    expect(westPath).not.toBeNull();
    for (let i = 0; i < westPath!.length; i += 2) expect(westPath![i]).toBeLessThanOrEqual(pose(host, west).q);
    for (let i = 2; i < westPath!.length; i += 2) {
      expect(hexDistance(westPath![i - 2], westPath![i - 1], westPath![i], westPath![i + 1])).toBe(1);
    }
    for (const sample of oracle.samples) {
      expect(sample.get(west)!.x).toBeLessThanOrEqual(sample.get(mid)!.x + 1e-4);
      expect(sample.get(mid)!.x).toBeLessThanOrEqual(sample.get(east)!.x + 1e-4);
    }
  });
});
