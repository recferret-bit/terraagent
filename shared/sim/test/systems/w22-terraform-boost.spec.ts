import { parseWaves, type ResourceKey, type SimCommandV1 } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  PREP,
  TERRAIN,
  colonyTerraformOrders,
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  getColonyQueue,
  getTerraformJobCost,
  getTerraformOpSpec,
  hexIndex,
  payProgressiveSlice,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnWorkerUnit,
  startBuildingConstruction,
  step,
  type Pipeline,
  type PlanetState,
} from '../../src';
import { discountTerraformCost, readTreasury, terraformBoostMultiplierBp } from '../../src/systems/treasury';

/** W05 living ops plus the W22 treasury. W08 stays off so Seed is not stage-locked (same as the W05 ops spec). */
const WAVES = '00,01,02,03,04,05,22';
const NO_W05 = '00,01,02,03,04,22';

function pipeOf(spec: string): Pipeline {
  return createRegistryPipeline({ flags: parseWaves(spec) });
}

function floorBill(
  cost: Partial<Record<ResourceKey, number>>,
  multiplierBp = 7500,
): Partial<Record<ResourceKey, number>> {
  const out: Partial<Record<ResourceKey, number>> = {};
  for (const [key, amount] of Object.entries(cost) as [ResourceKey, number][]) {
    out[key] = Math.floor((amount * multiplierBp) / 10_000);
  }
  return out;
}

function boostCmd(untilTick: number, magnitudeBp?: number, commandId = 'cm_boost'): SimCommandV1 {
  return {
    colonyIndex: null,
    source: 'system',
    commandId,
    kind: 'system.treasuryEffect',
    args: {
      kind: 'terraform_boost',
      untilTick,
      ...(magnitudeBp !== undefined ? { params: { magnitudeBp } } : {}),
    },
  };
}

function queueCmd(op: string, q: number, r: number, commandId: string): SimCommandV1 {
  return {
    commandId,
    colonyIndex: 0,
    source: 'player',
    kind: 'enqueueTask',
    args: { taskId: commandId, task: { kind: 'terraform', op, q, r } },
  };
}

function orderCmd(op: string, q: number, r: number, commandId: string): SimCommandV1 {
  return {
    commandId,
    colonyIndex: 0,
    source: 'player',
    kind: 'enqueueTask',
    args: { terraform: { op, tiles: [{ q, r }] } },
  };
}

function fresh(spec = WAVES) {
  const state = createState({ planetId: 'p-w22-boost', planetType: 'temperate', seed: 'w22-boost', radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);
  creditResource(colony, 'metals.t1', 200, 0);
  creditResource(colony, 'minerals.t1', 200, 0);
  creditResource(colony, 'bio.biomass', 200, 0);
  creditResource(colony, 'bio.water', 200, 0);
  colony.powerSupplyOverride = 200;
  const hx = hexIndex(state.grid.radius);
  for (let i = 0; i < state.grid.count; i++) {
    setTileOwner(state.grid, i, 0, 0);
    setTileTerrain(state.grid, i, TERRAIN.flat, 0);
    setTileHeight(state.grid, i, 0, 0);
  }
  const hub = startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {} });
  expect(hub.ok).toBe(true);
  const pipeline = pipeOf(spec);
  return { state, colony, hx, pipeline, data: pipeline.config.data };
}

function applyBoost(state: PlanetState, pipeline: Pipeline, untilTick: number, magnitudeBp?: number): void {
  const applied = step(state, [boostCmd(untilTick, magnitudeBp)], 1, pipeline);
  expect(applied.outcomes[0]?.code).toBeUndefined();
}

function queueCost(state: PlanetState, pipeline: Pipeline, op: string, q: number, r: number, commandId: string) {
  const res = step(state, [queueCmd(op, q, r, commandId)], 1, pipeline);
  expect(res.outcomes[0]?.code).toBeUndefined();
  const entry = getColonyQueue(state, 0, 'terraform').find((e) => e.taskId === commandId);
  expect(entry).toBeDefined();
  return entry!;
}

/** Stock the colony spends to finish one Seed order. No queue entry, so a second bill would show up here. */
function seedOrderDrop(bill: Partial<Record<ResourceKey, number>>): { water: number; minerals: number; energy: number } {
  const { state, colony, hx, pipeline, data } = fresh();
  const target = { q: 3, r: 0 };
  const idx = hx.indexOf(target.q, target.r);
  setTilePrep(state.grid, idx, PREP.irrigated, 0);
  spawnWorkerUnit(state, { tier: 3, owner: 0, q: 2, r: 0 });
  applyBoost(state, pipeline, 1_000_000);
  const startWater = colony.stock['bio.water'];
  const startMinerals = colony.stock['minerals.t1'];
  expect(step(state, [orderCmd('seed', target.q, target.r, 'ord-seed')], 1, pipeline).outcomes[0]?.code).toBeUndefined();
  expect(getColonyQueue(state, 0, 'terraform')).toHaveLength(0);
  const job = colonyTerraformOrders(state, 0)[0]?.jobs[0];
  expect(job?.totalCost).toEqual(bill);
  const energy = job?.totalEnergyE ?? -1;
  expect(energy).toBe(Math.floor((getTerraformOpSpec('seed', data).energyCostE * 7500) / 10_000));
  for (let n = 0; n < 120 && colonyTerraformOrders(state, 0).length > 0; n++) step(state, [], 1, pipeline);
  expect(state.grid.layers.prep[idx]).toBe(PREP.living);
  return { water: startWater - colony.stock['bio.water'], minerals: startMinerals - colony.stock['minerals.t1'], energy };
}

describe('W22-11 terraform_boost', () => {
  it('discounts a queued Seed to floor(base * 7500/10000) per resource, once', () => {
    const { state, colony, pipeline, data } = fresh();
    const base = getTerraformJobCost('seed', data);
    const bill = floorBill(base);
    expect(bill).not.toEqual(base);
    expect(bill).not.toEqual(floorBill(bill));

    applyBoost(state, pipeline, 1_000_000);
    const startWater = colony.stock['bio.water'];
    const startMinerals = colony.stock['minerals.t1'];
    const entry = queueCost(state, pipeline, 'seed', 3, 0, 'q-seed');
    expect(entry.cost).toEqual(bill);
    expect(entry.totalCost).toEqual(bill);
    for (let n = 0; n < 100 && getColonyQueue(state, 0, 'terraform').some((e) => e.taskId === 'q-seed'); n++) {
      step(state, [], 1, pipeline);
    }
    expect(getColonyQueue(state, 0, 'terraform').some((e) => e.taskId === 'q-seed')).toBe(false);
    expect(colonyTerraformOrders(state, 0)).toHaveLength(0);
    expect(startWater - colony.stock['bio.water']).toBe(bill['bio.water']);
    expect(startMinerals - colony.stock['minerals.t1']).toBe(bill['minerals.t1']);

    const drop = seedOrderDrop(bill);
    expect(drop.water).toBe(bill['bio.water']);
    expect(drop.minerals).toBe(bill['minerals.t1']);
  });

  it('discounts a queued Irrigate with the same floor', () => {
    const { state, pipeline, data } = fresh();
    const base = getTerraformJobCost('irrigate', data);
    applyBoost(state, pipeline, 1_000_000);
    const entry = queueCost(state, pipeline, 'irrigate', 3, 0, 'q-irr');
    expect(entry.cost).toEqual(floorBill(base));
    expect(entry.cost).not.toEqual(base);
  });

  it('leaves the Seed cost unchanged without the boost, and clear, break, level and fill full price with it', () => {
    const plain = fresh();
    const base = getTerraformJobCost('seed', plain.data);
    const undisc = queueCost(plain.state, plain.pipeline, 'seed', 3, 0, 'q-plain');
    expect(undisc.cost).toEqual(base);

    const { state, pipeline, data, hx } = fresh();
    applyBoost(state, pipeline, 1_000_000);
    for (const op of ['clear', 'break', 'level', 'fill'] as const) {
      const entry = queueCost(state, pipeline, op, 4, 0, `q-${op}`);
      expect(entry.cost).toEqual(getTerraformJobCost(op, data));
    }

    const clearAt = hx.indexOf(5, 0);
    setTileTerrain(state.grid, clearAt, TERRAIN.forest, 0);
    const slopeAt = hx.indexOf(6, 0);
    setTileTerrain(state.grid, slopeAt, TERRAIN.slope, 0);
    setTileHeight(state.grid, slopeAt, 1.8, 0);
    expect(step(state, [orderCmd('clear', 5, 0, 'ord-clear')], 1, pipeline).outcomes[0]?.code).toBeUndefined();
    expect(step(state, [orderCmd('level', 6, 0, 'ord-level')], 1, pipeline).outcomes[0]?.code).toBeUndefined();
    const orders = colonyTerraformOrders(state, 0);
    const clearJob = orders.find((o) => o.op === 'clear')?.jobs[0];
    const levelJob = orders.find((o) => o.op === 'level')?.jobs[0];
    expect(clearJob?.totalCost).toBeUndefined();
    expect(clearJob?.totalEnergyE).toBe(getTerraformOpSpec('clear', data).energyCostE);
    expect(levelJob?.totalCost).toEqual(getTerraformJobCost('level', data));
    expect(levelJob?.totalEnergyE).toBe(getTerraformOpSpec('level', data).energyCostE);
  });
});

describe('W22-11 terraform_boost corners', () => {
  it('charges full price once the effect has ended, and magnitude 0 changes nothing', () => {
    const ended = fresh();
    const until = 6;
    applyBoost(ended.state, ended.pipeline, until);
    expect(terraformBoostMultiplierBp(ended.state, until - 1)).toBe(7500);
    expect(terraformBoostMultiplierBp(ended.state, until)).toBe(10_000);
    step(ended.state, [], until - ended.state.meta.tick, ended.pipeline);
    expect(ended.state.meta.tick).toBe(until);
    expect(readTreasury(ended.state).effects.terraform_boost).toBeUndefined();
    const after = queueCost(ended.state, ended.pipeline, 'seed', 3, 0, 'q-after');
    expect(after.cost).toEqual(getTerraformJobCost('seed', ended.data));

    const zero = fresh();
    applyBoost(zero.state, zero.pipeline, 1_000_000, 0);
    expect(terraformBoostMultiplierBp(zero.state, zero.state.meta.tick)).toBe(10_000);
    const entry = queueCost(zero.state, zero.pipeline, 'seed', 3, 0, 'q-zero');
    expect(entry.cost).toEqual(getTerraformJobCost('seed', zero.data));
  });

  it('floors a cost of 1 to 0 and does not withdraw below zero', () => {
    const { state, colony, pipeline, data } = fresh();
    applyBoost(state, pipeline, 1_000_000);
    const scaled = discountTerraformCost({ 'bio.water': 1, 'minerals.t1': 0 }, state, state.meta.tick, 'seed', data);
    expect(scaled).toEqual({ 'bio.water': 0, 'minerals.t1': 0 });
    colony.stock['bio.water'] = 3;
    colony.residual['bio.water'] = 0;
    colony.stock['minerals.t1'] = 4;
    colony.residual['minerals.t1'] = 0;
    const paid = payProgressiveSlice(colony, scaled, {}, 1, state.meta.tick);
    expect(paid.ok).toBe(true);
    expect(colony.stock['bio.water']).toBe(3);
    expect(colony.stock['minerals.t1']).toBe(4);
  });

  it('does nothing to Seed when W05 ops are not compiled', () => {
    const { state, pipeline, data } = fresh(NO_W05);
    applyBoost(state, pipeline, 1_000_000);
    expect(terraformBoostMultiplierBp(state, state.meta.tick)).toBe(7500);
    expect('seed' in ((data.tables.opsBasic ?? {}) as Record<string, unknown>)).toBe(false);
    const base = getTerraformJobCost('seed', data);
    expect(discountTerraformCost(base, state, state.meta.tick, 'seed', data)).toEqual(base);
    expect(discountTerraformCost(base, state, state.meta.tick, 'not-an-op', data)).toEqual(base);
    const entry = queueCost(state, pipeline, 'seed', 3, 0, 'q-off');
    expect(entry.cost).toEqual(base);
    expect(entry.cost).not.toEqual(floorBill(base));
  });
});
