import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  enqueueAutoPrepares,
  compileData,
  evaluateTerraform,
  getColonyStock,
  getColonyTerraformOrders,
  getConstructionOrders,
  getHubFootprintTiles,
  hexIndex,
  PREP,
  setColonyStock,
  setTilePrep,
  setTileOwner,
  setTileTerrain,
  spawnColonyLanding,
  spawnHqUnit,
  TERRAIN,
  terraformWorldFromState,
  type SimEvent,
  type SimHost,
} from '../../src';
import { playerCmd, w01Host } from '../helpers/host';

const send = (host: SimHost, kind: string, args: unknown, colony: number | null = 0, id?: string) => {
  const c = playerCmd(kind, args, colony, 'tr');
  if (id) c.commandId = id;
  host.submit(c);
  const res = host.step(1);
  return { outcome: res.outcomes.find((o) => o.commandId === c.commandId)!, events: res.events };
};

function rig(radius = 12): { host: SimHost; idx: ReturnType<typeof hexIndex> } {
  const host = w01Host({ seed: 'terraform-rules', radius });
  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  return { host, idx: hexIndex(host.state.grid.radius) };
}

function runUntilIdle(host: SimHost, max = 400): SimEvent[] {
  const events: SimEvent[] = [];
  for (let t = 0; t < max && getColonyTerraformOrders(host.state, 0).length > 0; t++) events.push(...host.step(1).events);
  for (let t = 0; t < 3; t++) events.push(...host.step(1).events);
  return events;
}

describe('GP-01: one tile pays its yield once', () => {
  it('a tile repeated in one order and queued again in a second order is cleared once: 1 obstacleRemoved, 15 biomass', () => {
    const { host, idx } = rig();
    setTileTerrain(host.state.grid, idx.indexOf(2, 0), TERRAIN.forest);
    const tile = { q: 2, r: 0 };
    expect(send(host, 'enqueueTask', { terraform: { op: 'clear', tiles: [tile, tile, tile, tile, tile] } }).outcome.code).toBeUndefined();
    const [order] = getColonyTerraformOrders(host.state, 0);
    expect(order.jobs).toHaveLength(1);
    expect(order.skippedCount).toBe(4);
    // The same tile again: already queued for Clear, so nothing is left to queue.
    expect(send(host, 'enqueueTask', { terraform: { op: 'clear', tiles: [tile] } }).outcome.code).toBe('site_blocked');
    const events = runUntilIdle(host);
    expect(events.filter((e) => e.kind === 'obstacleRemoved')).toHaveLength(1);
    expect(getColonyStock(host.state, 0)['bio.biomass']).toBe(15);
  });

  it('a queued job whose tile changed before it completes is dropped without yield', () => {
    const { host, idx } = rig();
    const tileIdx = idx.indexOf(2, 0);
    setTileTerrain(host.state.grid, tileIdx, TERRAIN.rock);
    expect(send(host, 'enqueueTask', { terraform: { op: 'break', tiles: [{ q: 2, r: 0 }] } }).outcome.code).toBeUndefined();
    setTileTerrain(host.state.grid, tileIdx, TERRAIN.flat); // e.g. dev.cell / another order broke it meanwhile
    const events = runUntilIdle(host);
    expect(events.filter((e) => e.kind === 'obstacleRemoved')).toEqual([]);
    expect(getColonyStock(host.state, 0)['metals.t1']).toBe(0);
    expect(getColonyTerraformOrders(host.state, 0)).toEqual([]);
  });

  it('a manual job on a tile that another colony claimed after it was queued is dropped (re-checked at execution)', () => {
    const { host, idx } = rig();
    const tileIdx = idx.indexOf(3, 0);
    setTileTerrain(host.state.grid, tileIdx, TERRAIN.forest);
    expect(send(host, 'enqueueTask', { terraform: { op: 'clear', tiles: [{ q: 3, r: 0 }] } }).outcome.code).toBeUndefined();
    setTileOwner(host.state.grid, tileIdx, 1);
    runUntilIdle(host);
    expect(host.state.grid.layers.terrain[tileIdx]).toBe(TERRAIN.forest);
    expect(getColonyStock(host.state, 0)['bio.biomass']).toBe(0);
  });
});

describe('GP-02: terraform lane limits', () => {
  it('a colony past hq.t1.terraformMaxOrders open manual orders is refused queue_full', () => {
    const data = compileData(parseWaves('..01'), { hq: { t1: { terraformMaxOrders: 2 } } });
    const h2 = w01Host({ seed: 'terraform-rules', data });
    spawnHqUnit(h2.state, { owner: 0, q: 0, r: 0 });
    expect(send(h2, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 2, r: 0 }] } }).outcome.code).toBeUndefined();
    expect(send(h2, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 3, r: 0 }] } }).outcome.code).toBeUndefined();
    expect(send(h2, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 4, r: 0 }] } }).outcome.code).toBe('queue_full');
  });

  it('jobs over hq.t1.terraformMaxJobs (all orders) are refused queue_full', () => {
    const data = compileData(parseWaves('..01'), { hq: { t1: { terraformMaxJobs: 3 } } });
    const host = w01Host({ seed: 'terraform-rules', data });
    spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const tiles = [{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }, { q: 5, r: 0 }];
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles } }).outcome.code).toBe('queue_full');
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: tiles.slice(0, 3) } }).outcome.code).toBeUndefined();
  });
});

describe('GP-03: before its Hub a colony terraforms only near its landing', () => {
  it('unclaimed tiles beyond hq.startingKit.preHubTerraformRadius of the pod are not_own_territory', () => {
    const host = w01Host({ seed: 'terraform-rules', radius: 20 });
    const landed = spawnColonyLanding(host.state, { colonyId: 0, q: 0, r: 0 });
    expect(landed.ok).toBe(true);
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 10, r: 0 }] } }).outcome.code).toBeUndefined();
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 11, r: 0 }] } }).outcome.code).toBe('not_own_territory');
  });
});

describe('GP-09 / GP-10: order ids and cancel lanes', () => {
  it('order ids are made by the sim; the client id is kept as taskId; a reused client id is invalid_args', () => {
    const { host } = rig();
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 2, r: 0 }] } }, 0, 'stroke_1').outcome.code).toBeUndefined();
    const [order] = getColonyTerraformOrders(host.state, 0);
    expect(order.orderId).toMatch(/^tf#\d+$/);
    expect(order.taskId).toBe('stroke_1');
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 3, r: 0 }] } }, 0, 'stroke_1').outcome.code).toBe('invalid_args');
    expect(send(host, 'cancelTask', { taskId: 'stroke_1' }).outcome.code).toBeUndefined();
    expect(getColonyTerraformOrders(host.state, 0)).toEqual([]);
  });

  it("'active' cancels only a terraform order and 'current' only a construction order; misses are unknown_entity", () => {
    const { host, idx } = rig();
    setColonyStock(host.state, 0, { 'metals.t1': 600, 'minerals.t1': 350, 'bio.biomass': 200, 'bio.water': 200 });
    for (const t of getHubFootprintTiles(-4, 0)) setTilePrep(host.state.grid, idx.indexOf(t.q, t.r), PREP.prepared);
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: -4, r: 0 }).outcome.code).toBeUndefined();
    // No terraform order: 'active' must not cancel the Hub.
    expect(send(host, 'cancelTask', { taskId: 'active' }).outcome.code).toBe('unknown_entity');
    expect(getConstructionOrders(host.state, 0)).toHaveLength(1);
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 3, r: 0 }] } }).outcome.code).toBeUndefined();
    expect(send(host, 'cancelTask', { taskId: 'current' }).outcome.code).toBeUndefined();
    expect(getConstructionOrders(host.state, 0)).toEqual([]);
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(1);
    expect(send(host, 'cancelTask', { taskId: 'current' }).outcome.code).toBe('unknown_entity');
    expect(send(host, 'cancelTask', { taskId: 'nope' }).outcome.code).toBe('unknown_entity');
    expect(send(host, 'cancelTask', { taskId: 'active' }).outcome.code).toBeUndefined();
    expect(getColonyTerraformOrders(host.state, 0)).toEqual([]);
  });

  it("cancelling a Hub's linked prep by its id cancels the Hub's construction order (never the prep alone)", () => {
    const { host } = rig();
    setColonyStock(host.state, 0, { 'metals.t1': 600 });
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 }).outcome.code).toBeUndefined();
    const [prep] = getColonyTerraformOrders(host.state, 0);
    expect(prep.isLinkedPrep).toBe(true);
    expect(send(host, 'cancelTask', { taskId: prep.orderId }).outcome.code).toBeUndefined();
    expect(getConstructionOrders(host.state, 0)).toEqual([]);
    expect(getColonyTerraformOrders(host.state, 0)).toEqual([]);
  });
});

describe('GP-18 / GP-19: commands carry their colony and only contract args', () => {
  it('a terraform command without a colony is not_own_colony; options outside the contract are invalid_args', () => {
    const { host } = rig();
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 2, r: 0 }] } }, null).outcome.code).toBe('not_own_colony');
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles: [{ q: 2, r: 0 }], allowUnclaimed: true } }).outcome.code).toBe('invalid_args');
    expect(send(host, 'enqueueTask', { op: 'grade', q: 2, r: 0 }).outcome.code).toBe('invalid_args');
    expect(send(host, 'placeBuilding', { building: 'commandHub', q: 4, r: 0 }, null).outcome.code).toBe('not_own_colony');
    expect(send(host, 'cancelTask', { taskId: 'active' }, null).outcome.code).toBe('not_own_colony');
  });
});

describe('GP-32 / GP-34: one pure terraform rule, mapping from the data rows', () => {
  it('evaluateTerraform over the read-only world plans exactly what the handler queues (auto ops from opsBasic)', () => {
    const { host, idx } = rig();
    setTileTerrain(host.state.grid, idx.indexOf(2, 0), TERRAIN.forest);
    setTileTerrain(host.state.grid, idx.indexOf(3, 0), TERRAIN.rock);
    setTileOwner(host.state.grid, idx.indexOf(4, 0), 1);
    const tiles = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }, { q: 1, r: 0 }];
    const plan = evaluateTerraform(terraformWorldFromState(host.state, 0), { colonyId: 0, op: 'grade', tiles, auto: true });
    expect(plan.jobs).toEqual([{ q: 1, r: 0, op: 'grade' }, { q: 2, r: 0, op: 'clear' }, { q: 3, r: 0, op: 'break' }]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['not_own_territory', 'site_blocked']);
    expect(send(host, 'enqueueTask', { terraform: { op: 'grade', tiles } }).outcome.code).toBeUndefined();
    const [order] = getColonyTerraformOrders(host.state, 0);
    expect(order.jobs.map(({ q, r, op }) => ({ q, r, op }))).toEqual(plan.jobs);
    expect(order.skippedCount).toBe(2);
  });

  it('a tuned opsBasic row changes the tile rule (fromTerrain / toPrep are read)', () => {
    const data = compileData(parseWaves('..01'), { opsBasic: { clear: { toPrep: 'prepared' } } });
    const host = w01Host({ seed: 'terraform-rules', data });
    spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const tileIdx = hexIndex(host.state.grid.radius).indexOf(2, 0);
    setTileTerrain(host.state.grid, tileIdx, TERRAIN.forest);
    expect(send(host, 'enqueueTask', { terraform: { op: 'clear', tiles: [{ q: 2, r: 0 }] } }).outcome.code).toBeUndefined();
    runUntilIdle(host);
    expect([host.state.grid.layers.terrain[tileIdx], host.state.grid.layers.prep[tileIdx]]).toEqual([TERRAIN.flat, PREP.prepared]);
  });
});

describe('orders saved before the review fixes (SIM_VERSION 2 saves)', () => {
  it('an old-shape terraform order (no taskId / completedJobs / totalJobs / isLinkedPrep) is worked and cancelled normally', () => {
    const { host } = rig();
    const job = { q: 2, r: 0, op: 'grade', progress: 0, baseTimeS: 3, totalEnergyE: 20, energyDrawnE: 0 };
    host.state.blobs.terraformTasks = { changedAt: 0, value: { byColony: { 0: [{ orderId: 'old_1', colonyId: 0, op: 'grade', jobs: [job, { ...job, q: 3 }], skippedCount: 0 }] } } };
    host.step(30);
    const [order] = getColonyTerraformOrders(host.state, 0);
    expect(order).toMatchObject({ orderId: 'old_1', taskId: 'old_1', totalJobs: 2, isLinkedPrep: false });
    expect(Number.isInteger(order.completedJobs)).toBe(true);
    expect(send(host, 'cancelTask', { taskId: 'old_1' }).outcome.code).toBeUndefined();
    expect(getColonyTerraformOrders(host.state, 0)).toEqual([]);
  });
});

describe('enqueueAutoPrepares (the enqueueTask rule the client brush preview shares)', () => {
  it('only a multi-tile Grade stroke auto-prepares', () => {
    expect([enqueueAutoPrepares('grade', 2), enqueueAutoPrepares('grade', 1), enqueueAutoPrepares('clear', 5), enqueueAutoPrepares('break', 2)]).toEqual([true, false, false, false]);
  });
});
