import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  cancelTerraformOrder,
  colonyTerraformOrders,
  colonyTerraformStats,
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyLedger,
  ENTITY_STATE,
  groundMoveMultiplierBp,
  hexIndex,
  isGroundMoveBlocked,
  PREP,
  rowOf,
  setTileHeight,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  spawnWorkerUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
} from '../../src';

function createW05Colony(planetType: 'temperate' | 'desert' = 'temperate') {
  const state = createState({ planetId: `p-w05-ops-${planetType}`, planetType, seed: 'w05-ops', radius: 12 });
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
  const hubRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: 0,
    r: 0,
    instant: true,
    costOverride: {},
  });
  expect(hubRes.ok).toBe(true);
  const pipeline = createRegistryPipeline({ flags: parseWaves('..05') });
  return { state, colony, hx, pipeline };
}

describe('W05-03 · Level op (Slope -> Flat, 8 s, 60 E, 2 Min)', () => {
  it('Acceptance: Brush Level on a slope -> after 8 s (40 ticks) at 1.0x the tile is Flat and 2 Min are spent', () => {
    const { state, colony, hx, pipeline } = createW05Colony();
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTileTerrain(state.grid, tIdx, TERRAIN.slope, 0);
    setTileHeight(state.grid, tIdx, 1.8, 0);

    // Spawn a Worker Drone (1.0x work rate) adjacent to the slope tile so it works immediately
    spawnWorkerUnit(state, { tier: 3, owner: 0, q: 2, r: 0 });
    const startMin = colony.stock['minerals.t1'];

    const enqRes = step(
      state,
      [
        {
          commandId: 'cmd-level-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'level', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqRes.outcomes[0]?.code).toBeUndefined();
    expect(colonyTerraformOrders(state, 0)).toHaveLength(1);
    expect(colonyTerraformOrders(state, 0)[0]!.jobs[0]!.baseTimeS).toBe(8);
    expect(colonyTerraformOrders(state, 0)[0]!.jobs[0]!.totalEnergyE).toBe(60);

    // At 39 ticks of work (1 dispatch tick + 39 work ticks = 40 ticks total, or 39/40 progress), tile is still slope
    const events: Array<{ kind: string; data: unknown }> = [];
    for (let t = 0; t < 38; t++) {
      const r = step(state, [], 1, pipeline);
      events.push(...r.events);
    }
    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.slope);
    expect(colony.stock['minerals.t1']).toBeLessThan(startMin);
    expect(colony.stock['minerals.t1']).toBeGreaterThan(startMin - 2);

    // Complete the remaining ticks to reach 8.0 s (40 work ticks at 1.0x)
    for (let t = 0; t < 3; t++) {
      const r = step(state, [], 1, pipeline);
      events.push(...r.events);
    }

    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[tIdx]).toBe(PREP.flat);
    expect(state.grid.layers.height[tIdx]).toBe(0);
    expect(colony.stock['minerals.t1']).toBeCloseTo(startMin - 2, 5);
    expect(colonyTerraformOrders(state, 0)).toHaveLength(0);

    const removed = events.find((e) => e.kind === 'obstacleRemoved');
    expect(removed?.data).toMatchObject({ op: 'level', count: 1, q: target.q, r: target.r });
    const stateChanged = events.find((e) => e.kind === 'tileStateChanged');
    expect(stateChanged?.data).toMatchObject({
      op: 'level',
      q: target.q,
      r: target.r,
      prevTerrain: 'slope',
      terrain: 'flat',
    });
  });
});

describe('W05-03 · Level op resource wait & cancel refund', () => {
  it('waits on resources if minerals.t1 runs out mid-op, and refunds 50% of spentCost on cancel', () => {
    const { state, colony, hx, pipeline } = createW05Colony();
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTileTerrain(state.grid, tIdx, TERRAIN.slope, 0);
    colony.stock['minerals.t1'] = 1; // Only half of the 2 Min needed

    const hqId = spawnHqUnit(state, { owner: 0, q: 2, r: 0 });
    step(
      state,
      [
        {
          commandId: 'cmd-level-half',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'level', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );

    for (let t = 0; t < 30; t++) {
      step(state, [], 1, pipeline);
    }
    const order = colonyTerraformOrders(state, 0)[0]!;
    expect(order.jobs[0]!.progress).toBeCloseTo(0.5, 2);
    expect(order.jobs[0]!.waitReason).toBe('resources');
    expect(state.entities.cols.state[rowOf(state.entities, hqId)]).toBe(ENTITY_STATE.waiting);
    expect(colony.stock['minerals.t1']).toBeCloseTo(0, 5);

    // Cancelling refunds 50% of the 1 Min spent (= 0.5 Min)
    expect(cancelTerraformOrder(state, 0, order.orderId, state.meta.tick)).toBe(true);
    expect(colony.stock['minerals.t1']).toBeCloseTo(0.5, 5);
  });
});

describe('W05-04 · Fill op (Hole -> Flat, 10 s, 100 E, 10 M + 5 Min)', () => {
  it('Acceptance: Fill a crater tile -> Flat after 10 s (50 ticks) at 1.0x; stock drops by 10 M / 5 Min', () => {
    const { state, colony, hx, pipeline } = createW05Colony();
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTileTerrain(state.grid, tIdx, TERRAIN.hole, 0);
    setTileHeight(state.grid, tIdx, -1.4, 0);

    spawnWorkerUnit(state, { tier: 3, owner: 0, q: 2, r: 0 });
    const startMetals = colony.stock['metals.t1'];
    const startMinerals = colony.stock['minerals.t1'];

    const enqRes = step(
      state,
      [
        {
          commandId: 'cmd-fill-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'fill', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqRes.outcomes[0]?.code).toBeUndefined();
    expect(colonyTerraformOrders(state, 0)[0]!.jobs[0]!.baseTimeS).toBe(10);
    expect(colonyTerraformOrders(state, 0)[0]!.jobs[0]!.totalEnergyE).toBe(100);

    const events: Array<{ kind: string; data: unknown }> = [];
    for (let t = 0; t < 48; t++) {
      const r = step(state, [], 1, pipeline);
      events.push(...r.events);
    }
    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.hole);

    for (let t = 0; t < 3; t++) {
      const r = step(state, [], 1, pipeline);
      events.push(...r.events);
    }

    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[tIdx]).toBe(PREP.flat);
    expect(state.grid.layers.height[tIdx]).toBe(0);
    expect(colony.stock['metals.t1']).toBeCloseTo(startMetals - 10, 5);
    expect(colony.stock['minerals.t1']).toBeCloseTo(startMinerals - 5, 5);
    expect(colonyTerraformOrders(state, 0)).toHaveLength(0);

    const removed = events.find((e) => e.kind === 'obstacleRemoved');
    expect(removed?.data).toMatchObject({ op: 'fill', count: 1, q: target.q, r: target.r });
    const stateChanged = events.find((e) => e.kind === 'tileStateChanged');
    expect(stateChanged?.data).toMatchObject({
      op: 'fill',
      q: target.q,
      r: target.r,
      prevTerrain: 'hole',
      terrain: 'flat',
    });
  });
});

describe('W05-05 · Reclaim op (Shallow water -> Flat, 14 s, 200 E, 20 M + 10 Min)', () => {
  it('Acceptance: Reclaim 1 shallow tile -> Flat after 14 s (70 ticks) at 1.0x; passability becomes 1.0x', () => {
    const { state, colony, hx, pipeline } = createW05Colony();
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTileTerrain(state.grid, tIdx, TERRAIN.shallow, 0);
    setTileHeight(state.grid, tIdx, -0.35, 0);

    // Before Reclaim: shallow water has 0.5x passability (5000 bp) and blocks normal ground movement
    expect(groundMoveMultiplierBp(state.grid, tIdx)).toBe(5000);
    expect(isGroundMoveBlocked(state.grid.layers.terrain[tIdx], state.grid.layers.deposit[tIdx])).toBe(true);

    spawnWorkerUnit(state, { tier: 3, owner: 0, q: 2, r: 0 });
    const startMetals = colony.stock['metals.t1'];
    const startMinerals = colony.stock['minerals.t1'];

    const enqRes = step(
      state,
      [
        {
          commandId: 'cmd-reclaim-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'reclaim', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqRes.outcomes[0]?.code).toBeUndefined();
    expect(colonyTerraformOrders(state, 0)[0]!.jobs[0]!.baseTimeS).toBe(14);
    expect(colonyTerraformOrders(state, 0)[0]!.jobs[0]!.totalEnergyE).toBe(200);

    for (let t = 0; t < 68; t++) {
      step(state, [], 1, pipeline);
    }
    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.shallow);

    for (let t = 0; t < 3; t++) {
      step(state, [], 1, pipeline);
    }

    expect(state.grid.layers.terrain[tIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[tIdx]).toBe(PREP.flat);
    expect(state.grid.layers.height[tIdx]).toBe(0);
    expect(groundMoveMultiplierBp(state.grid, tIdx)).toBe(10000); // 1.0x passability
    expect(isGroundMoveBlocked(state.grid.layers.terrain[tIdx], state.grid.layers.deposit[tIdx])).toBe(false);
    expect(colony.stock['metals.t1']).toBeCloseTo(startMetals - 20, 5);
    expect(colony.stock['minerals.t1']).toBeCloseTo(startMinerals - 10, 5);
  });
});

describe('W05-05 · Deep Reclaim worker tier gate', () => {
  it('rejects Deep Reclaim with worker_tier_locked when no T2 worker exists, and accepts it when a T2 worker exists', () => {
    const { state, hx, pipeline } = createW05Colony();
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTileTerrain(state.grid, tIdx, TERRAIN.deep, 0);

    const tfId = spawnWorkerUnit(state, { owner: 0, q: 2, r: 0, tier: 1 });
    const rLocked = step(
      state,
      [
        {
          commandId: 'cmd-deep-reclaim-locked',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'deepReclaim', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(rLocked.outcomes[0]?.code).toBe('worker_tier_locked');

    state.entities.cols.tier[rowOf(state.entities, tfId)] = 2;
    const rUnlocked = step(
      state,
      [
        {
          commandId: 'cmd-deep-reclaim-ok',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'deepReclaim', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(rUnlocked.outcomes[0]?.code).toBeUndefined();
  });
});

describe('W05-07 · Irrigate and Seed -> Living, and building footprint revert', () => {
  it('Acceptance: Irrigate then Seed 1 tile -> Living; build over it -> Prepared again and Terraform % drops', () => {
    const { state, colony, hx, pipeline } = createW05Colony('temperate');
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTilePrep(state.grid, tIdx, PREP.prepared, 0);

    spawnWorkerUnit(state, { tier: 3, owner: 0, q: 2, r: 0 });
    const startWater = colony.stock['bio.water'];
    const startMinerals = colony.stock['minerals.t1'];

    // 1. Irrigate (10 s = 50 ticks, 80 E, 15 bio.water on temperate)
    const rIrr = step(
      state,
      [
        {
          commandId: 'cmd-irr-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'irrigate', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(rIrr.outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 55; t++) step(state, [], 1, pipeline);

    expect(state.grid.layers.prep[tIdx]).toBe(PREP.irrigated);
    expect(colony.stock['bio.water']).toBeCloseTo(startWater - 15, 5);

    // 2. Seed (15 s = 75 ticks, 90 E, 10 bio.water + 5 minerals.t1) -> Living
    const rSeed = step(
      state,
      [
        {
          commandId: 'cmd-seed-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'seed', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(rSeed.outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 80; t++) step(state, [], 1, pipeline);

    expect(state.grid.layers.prep[tIdx]).toBe(PREP.living);
    expect(colony.stock['bio.water']).toBeCloseTo(startWater - 25, 5);
    expect(colony.stock['minerals.t1']).toBeCloseTo(startMinerals - 5, 5);

    const statsBeforeBuild = colonyTerraformStats(state, 0);
    expect(statsBeforeBuild.livingTiles).toBe(1);
    expect(statsBeforeBuild.percent).toBeGreaterThan(0);

    // 3. Build over the Living tile -> reverts to Prepared and Terraform % drops
    const buildRes = startBuildingConstruction(state, {
      owner: 0,
      building: 'pylon',
      q: target.q,
      r: target.r,
    });
    expect(buildRes.ok).toBe(true);
    expect(state.grid.layers.prep[tIdx]).toBe(PREP.prepared);
    const statsAfterBuild = colonyTerraformStats(state, 0);
    expect(statsAfterBuild.livingTiles).toBe(0);
    expect(statsAfterBuild.percent).toBe(0);
  });
});

describe('W05-07 · Desert 2x water cost on Irrigate', () => {
  it('charges 2x water (30 bio.water) for Irrigate on desert planets', () => {
    const { state, colony, hx, pipeline } = createW05Colony('desert');
    const target = { q: 3, r: 0 };
    const tIdx = hx.indexOf(target.q, target.r);
    setTilePrep(state.grid, tIdx, PREP.prepared, 0);

    spawnWorkerUnit(state, { tier: 3, owner: 0, q: 2, r: 0 });
    const startWater = colony.stock['bio.water'];

    const rIrr = step(
      state,
      [
        {
          commandId: 'cmd-irr-desert',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'irrigate', tiles: [target] } },
        },
      ],
      1,
      pipeline,
    );
    expect(rIrr.outcomes[0]?.code).toBeUndefined();
    for (let t = 0; t < 55; t++) step(state, [], 1, pipeline);

    expect(state.grid.layers.prep[tIdx]).toBe(PREP.irrigated);
    expect(colony.stock['bio.water']).toBeCloseTo(startWater - 30, 5);
  });
});



