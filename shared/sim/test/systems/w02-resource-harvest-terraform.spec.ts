import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  cancelQueueTask,
  consumeDepositRichness,
  createRegistryPipeline,
  createState,
  creditResource,
  DEPOSIT,
  DEPOSIT_MAX_RICHNESS_BP,
  DEPOSIT_MAX_UNITS,
  depositRemainingUnits,
  depositStageFromRichness,
  DISMANTLE_REFUND_RATE,
  enqueueHubUnit,
  enqueueWorkAtTile,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  evaluatePlacement,
  executeDismantleAtTile,
  rowOf,
  getUnitRecord,
  hexDistance,
  hexIndex,
  insertRow,
  placementWorldFromState,
  PREP,
  REPAIR_COST_RATE,
  RESOURCE_INCOME_TABLE,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnHarvesterUnit,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  TERRAFORM_TIME_TABLE,
  TERRAIN,
} from '../../src';
import { readyBuilder } from '../helpers/builder';

describe('W02 Authoritative Data Tables & Finite Resource Deposits', () => {
  it('exposes TERRAFORM_TIME_TABLE and RESOURCE_INCOME_TABLE with authoritative durations, energy, yields, and rates', () => {
    expect(TERRAFORM_TIME_TABLE.flat).toEqual({ durationTicks: 40, durationSec: 2.0, energyCost: 6 });
    expect(TERRAFORM_TIME_TABLE.slope).toEqual({ durationTicks: 80, durationSec: 4.0, energyCost: 12 });
    expect(TERRAFORM_TIME_TABLE.hole).toEqual({ durationTicks: 80, durationSec: 4.0, energyCost: 12 });
    expect(TERRAFORM_TIME_TABLE.forest).toEqual({ durationTicks: 60, durationSec: 3.0, energyCost: 8 });
    expect(TERRAFORM_TIME_TABLE.rock).toEqual({ durationTicks: 100, durationSec: 5.0, energyCost: 15 });
    expect(TERRAFORM_TIME_TABLE.dismantle).toEqual({ durationTicks: 60, durationSec: 3.0, energyCost: 5, refundRate: 0.5 });
    expect(TERRAFORM_TIME_TABLE.repair).toEqual({ durationTicks: 80, durationSec: 4.0, energyCost: 0, costRate: 0.4 });
    expect(DISMANTLE_REFUND_RATE).toBe(0.5);
    expect(REPAIR_COST_RATE).toBe(0.4);

    expect(RESOURCE_INCOME_TABLE.forest).toEqual({ 'bio.biomass': 15 });
    expect(RESOURCE_INCOME_TABLE.rock).toEqual({ 'metals.t1': 8, 'minerals.t1': 4 });
    expect(RESOURCE_INCOME_TABLE['harvester.metals']).toEqual({
      resourceId: 'metals.t1',
      ratePerSec: 1.875,
      cycleYield: 7.5,
      cycleSec: 4,
    });
    expect(RESOURCE_INCOME_TABLE['harvester.minerals']).toEqual({
      resourceId: 'minerals.t1',
      ratePerSec: 1.5,
      cycleYield: 6.0,
      cycleSec: 4,
    });
    expect(RESOURCE_INCOME_TABLE['harvester.oil']).toEqual({
      resourceId: 'bio.biomass',
      ratePerSec: 1.25,
      cycleYield: 5.0,
      cycleSec: 4,
    });
  });

  it('tracks finite 500-unit deposits across full/half/depleted stages while keeping depleted deposits occupying 1 hex', () => {
    expect(DEPOSIT_MAX_UNITS).toBe(500);
    expect(DEPOSIT_MAX_RICHNESS_BP).toBe(10000);
    expect(depositRemainingUnits(10000)).toBe(500);
    expect(depositRemainingUnits(5000)).toBe(250);
    expect(depositRemainingUnits(0)).toBe(0);
    expect(depositStageFromRichness(10000)).toBe('full');
    expect(depositStageFromRichness(5001)).toBe('full');
    expect(depositStageFromRichness(5000)).toBe('half');
    expect(depositStageFromRichness(1)).toBe('half');
    expect(depositStageFromRichness(0)).toBe('depleted');

    const state = createState({ planetId: 'p-dep', planetType: 'temperate', seed: 'dep', radius: 8 });
    const idx = hexIndex(state.grid.radius);
    const tileIdx = idx.indexOf(2, 0);
    setTileDeposit(state, tileIdx, DEPOSIT.metals);
    expect(state.grid.layers.richness[tileIdx]).toBe(10000);

    const ext1 = consumeDepositRichness(state, tileIdx, 250, 5);
    expect(ext1).toBe(250);
    expect(state.grid.layers.richness[tileIdx]).toBe(5000);
    expect(depositStageFromRichness(state.grid.layers.richness[tileIdx])).toBe('half');
    expect(state.grid.changedAt?.[tileIdx]).toBe(5);

    const ext2 = consumeDepositRichness(state, tileIdx, 300, 10);
    expect(ext2).toBe(250);
    expect(state.grid.layers.richness[tileIdx]).toBe(0);
    expect(state.grid.layers.deposit[tileIdx]).toBe(DEPOSIT.metals);
    expect(depositStageFromRichness(state.grid.layers.richness[tileIdx])).toBe('depleted');

    state.grid.layers.owner[tileIdx] = 0;
    state.grid.layers.prep[tileIdx] = PREP.prepared;
    const world = placementWorldFromState(state);
    const solarCheck = evaluatePlacement(world, { colonyId: 0, building: 'solar', q: 2, r: 0 });
    expect(solarCheck.ok).toBe(false);
    const extCheck = evaluatePlacement(world, { colonyId: 0, building: 'metalsExtractor', q: 2, r: 0 });
    expect(extCheck.ok).toBe(false);
  });
});

describe('W02 Multi-Harvester Adjacency & UnitBook Preservation', () => {
  it('keeps UnitBook intact during syncHarvesterView, blocks harvesters from entering deposit tiles, and allows multiple harvesters on adjacent hexes', () => {
    const state = createState({ planetId: 'p-harv', planetType: 'temperate', seed: 'harv', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    const idx = hexIndex(state.grid.radius);
    const depIdx = idx.indexOf(2, 0);
    setTileDeposit(state, depIdx, DEPOSIT.minerals, 10000, 0);

    const hqId = spawnHqUnit(state, { owner: 0, q: -2, r: 0 });
    const h1 = spawnHarvesterUnit(state, { owner: 0, q: 0, r: 0 });
    spawnHarvesterUnit(state, { owner: 0, q: 0, r: 1 });
    spawnHarvesterUnit(state, { owner: 0, q: 1, r: -1 });

    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    const stepRes = step(
      state,
      [{ commandId: 'm-hq', colonyIndex: 0, source: 'player', kind: 'moveUnit', args: { entityId: hqId, q: -1, r: 0 } }],
      10,
      pipeline,
    );
    expect(stepRes.outcomes[0].code).toBeUndefined();

    const unitsBlob = state.blobs.units?.value as { byId?: Record<string, unknown> } | undefined;
    expect(unitsBlob?.byId).toBeDefined();
    expect(getUnitRecord(state, hqId)).toBeDefined();

    const harvPositions = new Set<string>();
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] !== ENTITY_KIND.harvester) continue;
      const q = state.entities.cols.q[r];
      const rCoord = state.entities.cols.r[r];
      expect(hexDistance(q, rCoord, 2, 0)).toBe(1);
      harvPositions.add(`${q},${rCoord}`);
      expect(state.entities.cols.state[r]).toBe(ENTITY_STATE.harvesting);
      expect(state.entities.cols.progress[r]).toBeGreaterThan(0);
    }
    expect(harvPositions.size).toBe(3);

    const depIdx2 = idx.indexOf(-2, 2);
    setTileDeposit(state, depIdx2, DEPOSIT.metals, 10000, state.meta.tick);
    const moveDepRes = step(
      state,
      [
        { commandId: 'm-h1-dep', colonyIndex: 0, source: 'player', kind: 'moveUnit', args: { entityId: h1, q: -2, r: 2 } },
        { commandId: 'm-hq-dep', colonyIndex: 0, source: 'player', kind: 'moveUnit', args: { entityId: hqId, q: -2, r: 2 } },
      ],
      15,
      pipeline,
    );
    expect(moveDepRes.outcomes.map((o) => o.code)).toEqual([undefined, undefined]);
    const h1Row = [0, 1, 2, 3].find((r) => state.entities.cols.id[r] === h1)!;
    const hqRow = [0, 1, 2, 3].find((r) => state.entities.cols.id[r] === hqId)!;
    expect(hexDistance(state.entities.cols.q[h1Row], state.entities.cols.r[h1Row], -2, 2)).toBe(1);
    expect(hexDistance(state.entities.cols.q[hqRow], state.entities.cols.r[hqRow], -2, 2)).toBe(1);
  });
});

describe('W02 Progressive Cost Subtraction & 50% Cancel Refunds', () => {
  it('subtracts resources progressively and refunds 50% of spentCost on cancel (building:<id>, harvester:<id>, and all)', () => {
    const state = createState({ planetId: 'p-prog', planetType: 'temperate', seed: 'prog', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    creditResource(colony, 'metals.t1', 30, 0);
    creditResource(colony, 'minerals.t1', 100, 0);
    creditResource(colony, 'bio.biomass', 50, 0);
    creditResource(colony, 'bio.water', 50, 0);

    const hqId = readyBuilder(state, [{ q: 2, r: 1 }]); // a prepared site, the HQ in build reach (W02-16)
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    const started = startBuildingConstruction(state, {
      owner: 0,
      building: 'solar',
      q: 2,
      r: 1,
      workerEntityId: hqId,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error('expected ok');

    step(state, [], 35, pipeline);
    expect(colony.stock['metals.t1']).toBeCloseTo(0, 4);
    const solarRow = [0, 1].find((r) => state.entities.cols.id[r] === started.entityId)!;
    expect(state.entities.cols.progress[solarRow]).toBeCloseTo(0.5, 4);

    const cancelRes = step(
      state,
      [{ commandId: 'c-b', colonyIndex: 0, source: 'player', kind: 'cancelTask', args: { taskId: `building:${started.entityId}` } }],
      1,
      pipeline,
    );
    expect(cancelRes.outcomes[0].code).toBeUndefined();
    expect(colony.stock['metals.t1']).toBeCloseTo(15, 4);

    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    creditResource(colony, 'metals.t1', 100, state.meta.tick);
    const uRes = enqueueHubUnit(state, { colonyIndex: 0, unit: 'harvester' });
    expect(uRes.ok).toBe(true);
    if (!uRes.ok) throw new Error('expected ok');

    step(state, [], 25, pipeline);
    const metalsBeforeCancel = colony.stock['metals.t1'];
    const cAll = cancelQueueTask(state, 'all', 0, state.meta.tick);
    expect(cAll).toEqual({ ok: true, refunded: true });
    expect(colony.stock['metals.t1'] - metalsBeforeCancel).toBeCloseTo(10, 4);
  });
});

describe('W02 Simplified Terraform: Dismantle & Work (Repair + Ground)', () => {
  it('supports op: dismantle (50% refund, rejects HQ/CommandHub) and op: work (repairs damaged entities at 40% cost + terraforms ground with yields)', () => {
    const state = createState({ planetId: 'p-tf', planetType: 'temperate', seed: 'tf', radius: 8 });
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
    creditResource(colony, 'bio.biomass', 50, 0);
    creditResource(colony, 'bio.water', 50, 0);

    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const harvId = spawnHarvesterUnit(state, { owner: 0, q: 1, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    const disHq = executeDismantleAtTile(state, 0, 0, 0);
    expect(disHq).toEqual({ ok: false, reason: 'cannot_dismantle_hq' });

    const sol = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 2, r: 1, instant: true });
    expect(sol.ok).toBe(true);
    if (!sol.ok) throw new Error('expected ok');
    const solRow = [0, 1, 2].find((r) => state.entities.cols.id[r] === sol.entityId)!;
    const hpMax = state.entities.cols.hpMax[solRow];
    state.entities.cols.hp[solRow] = hpMax / 2;

    const metalsBeforeRepair = colony.stock['metals.t1'];
    const workRepair = step(
      state,
      [{ commandId: 'w-rep', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'work', tiles: [{ q: 2, r: 1 }] } } }],
      1,
      pipeline,
    );
    expect(workRepair.outcomes[0].code).toBeUndefined();

    step(state, [], 45, pipeline);
    expect(state.entities.cols.hp[solRow]).toBe(hpMax);
    expect(state.entities.cols.progress[solRow]).toBe(0);
    expect(metalsBeforeRepair - colony.stock['metals.t1']).toBeCloseTo(12, 4);

    const idx = hexIndex(state.grid.radius);
    const forestIdx = idx.indexOf(1, 1);
    setTileTerrain(state, forestIdx, TERRAIN.forest, state.meta.tick);
    setTilePrep(state.grid, forestIdx, PREP.wild, state.meta.tick);
    const bioBefore = colony.stock['bio.biomass'];

    const workForest = enqueueWorkAtTile(state, 0, 1, 1, { workerId: harvId, tick: state.meta.tick });
    expect(workForest.ok).toBe(true);
    step(state, [], 65, pipeline);
    expect(state.grid.layers.terrain[forestIdx]).toBe(TERRAIN.flat);
    expect(state.grid.layers.prep[forestIdx]).toBe(PREP.prepared);
    expect(colony.stock['bio.biomass'] - bioBefore).toBeCloseTo(15, 4);

    const metalsBeforeDis = colony.stock['metals.t1'];
    const disSol = step(
      state,
      [{ commandId: 'd-sol', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { terraform: { op: 'dismantle', tiles: [{ q: 2, r: 1 }] } } }],
      1,
      pipeline,
    );
    expect(disSol.outcomes[0].code).toBeUndefined();
    // A dismantle is builder work now (owner feedback W03 #6): the HQ walks over, the solar comes down in half its
    // build time and the 50 % refund arrives step by step.
    expect(rowOf(state.entities, sol.entityId)).toBeGreaterThanOrEqual(0);
    expect(colony.stock['metals.t1'] - metalsBeforeDis).toBeLessThan(30);
    step(state, [], 200, pipeline);
    expect(rowOf(state.entities, sol.entityId)).toBe(-1);
    expect(colony.stock['metals.t1'] - metalsBeforeDis).toBeCloseTo(30, 4);
  });
});
