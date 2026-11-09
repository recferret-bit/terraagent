import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { resourceValue } from '../../src/systems/economy/ledger';
import {
  calculateUnitDemand,
  DEPOSIT,
  enqueueHubUnit,
  setTileDeposit,
  spawnWorkerUnit,
  claimTerritoryRadius,
  collectWorkLoad,
  compileData,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getUnitCommand,
  hexIndex,
  isWorkerEligibleForJob,
  PREP,
  revealVision,
  rowOf,
  setField,
  startBuildingConstruction,
  step,
  TERRAIN,
} from '../../src';

function setupColonyWithHub(seed = 'w05-tf-test') {
  const flags = parseWaves('..05');
  const data = compileData(flags);
  const state = createState({ planetId: 'p-w05-02', planetType: 'temperate', seed, radius: 12 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.height.fill(0);
  state.grid.layers.prep.fill(PREP.wild);

  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stock['metals.t1'] = 400;
  colony.stock['minerals.t1'] = 400;
  colony.stock['bio.biomass'] = 400;
  colony.stock['bio.water'] = 400;
  colony.powerSupplyOverride = 50;

  const hubRes = startBuildingConstruction(state, {
    owner: 0,
    building: 'commandHub',
    q: 0,
    r: 0,
    instant: true,
    costOverride: {},
    data,
  });
  expect(hubRes.ok).toBe(true);
  claimTerritoryRadius(state, { colonyId: 0, q: 0, r: 0, tick: 0, data });
  revealVision(state, 0, 0, 0, 10, 0);

  const pipeline = createRegistryPipeline({ flags, data });
  return { state, colony, data, pipeline };
}

describe('W05-02 Worker drone in sim', () => {
  it('orders a Worker at the Hub -> it spawns and takes the next Terraform-lane entry at 1.0x rate', () => {
    const { state, pipeline } = setupColonyWithHub('w05-02-spawn');
    const idx = hexIndex(state.grid.radius);
    const targetTile = idx.indexOf(3, 0);
    expect(state.grid.layers.prep[targetTile]).toBe(PREP.wild);

    // Enqueue a manual Terraform-lane order (Grade at (3, 0)) while no terraform worker is on the map
    const enqTf = step(
      state,
      [
        {
          commandId: 'tf-grade-1',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'grade', tiles: [{ q: 3, r: 0 }] } },
        },
        {
          commandId: 'order-tf-drone',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { buildUnit: { unit: 'worker', tier: 3, count: 1 } },
        },
      ],
      1,
      pipeline,
    );
    expect(enqTf.outcomes.every((o) => !o.code)).toBe(true);

    // Step 59 single ticks so the 12 s (60-tick) Worker Drone finishes printing on tick 60
    for (let i = 0; i < 59; i++) step(state, [], 1, pipeline);

    let tfEntityId = -1;
    let tfRow = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.worker) {
        tfRow = r;
        tfEntityId = state.entities.cols.id[r];
        break;
      }
    }
    expect(tfEntityId).toBeGreaterThan(0);
    expect(state.entities.cols.workRate[tfRow]).toBeCloseTo(1.0, 5);
    expect(getUnitCommand(state, tfEntityId)).toMatchObject({
      kind: 'terraform',
      q: 3,
      r: 0,
    });

    // Step 15 more 1-tick steps so the Worker finishes the 3 s (15 ticks at 1.0x) Grade op
    for (let i = 0; i < 15; i++) step(state, [], 1, pipeline);
    expect(state.grid.layers.prep[targetTile]).toBe(PREP.prepared);
  });
});

describe('W05-02 Worker eligibility & power drain', () => {
  it('enforces terraform-lane-only eligibility and 2.5 E/s + op energy power drain', () => {
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 1, { kind: 'terraform', op: 'grade' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 1, { kind: 'terraform', op: 'level' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 1, { kind: 'terraform', op: 'deepReclaim' })).toBe(false);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 2, { kind: 'terraform', op: 'deepReclaim' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 3, { kind: 'build', tier: 3 })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 3, { kind: 'build', tier: 4 })).toBe(false);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 1, { kind: 'linkedPrep', op: 'grade' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 1, { kind: 'build', tier: 1 })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 1, { kind: 'terraform', op: 'dismantle' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.worker, 1, { kind: 'terraform', op: 'repair' })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.devProbe, 3, { kind: 'terraform', op: 'clear' })).toBe(false);

    const { state, data, pipeline } = setupColonyWithHub('w05-02-drain');
    step(
      state,
      [
        {
          commandId: 'order-tf-2',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { buildUnit: { unit: 'worker', tier: 3, count: 1 } },
        },
      ],
      65,
      pipeline,
    );

    let tfEntityId = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.worker) {
        tfEntityId = state.entities.cols.id[r];
        break;
      }
    }
    expect(tfEntityId).toBeGreaterThan(0);
    const tfRow = rowOf(state.entities, tfEntityId);

    // Active unit demand = 2.5 E/s
    setField(state.entities, tfRow, 'state', ENTITY_STATE.moving, state.meta.tick);
    expect(calculateUnitDemand(state, 0, data)).toBeCloseTo(2.5, 5);

    // Enqueue a Grade op (20 E over 3 s = 6.6667 E/s at 1.0x) on the tile right next to the Worker
    const tfQ = state.entities.cols.q[tfRow];
    const tfR = state.entities.cols.r[tfRow];
    step(
      state,
      [
        {
          commandId: 'tf-adj-grade',
          colonyIndex: 0,
          source: 'player',
          kind: 'enqueueTask',
          args: { terraform: { op: 'grade', tiles: [{ q: tfQ + 1, r: tfR }] } },
        },
      ],
      2,
      pipeline,
    );

    expect(state.entities.cols.state[tfRow]).toBe(ENTITY_STATE.working);
    const workLoad = collectWorkLoad(state, 0, data);
    expect(workLoad.demand).toBeCloseTo(20 / 3, 3);
    expect(calculateUnitDemand(state, 0, data) + workLoad.demand).toBeCloseTo(2.5 + 20 / 3, 3);
  });
});

describe('W05-02 Worker Drone T3: wave gate and harvest', () => {
  it('without W05 (TA_WAVES ..04) a tier-3 order is rejected on both order paths; T2 still goes', () => {
    const flags = parseWaves('..04');
    const data = compileData(flags);
    const state = createState({ planetId: 'p-w05-02-gate', planetType: 'temperate', seed: 'w05-02-gate', radius: 10 });
    const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
    colony.status = 'active';
    Object.assign(colony.stock, { 'metals.t1': 400, 'minerals.t1': 400, 'bio.biomass': 400, 'bio.water': 400 });
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: 0, r: 0, instant: true, costOverride: {}, data }).ok).toBe(true);
    expect(enqueueHubUnit(state, { colonyIndex: 0, unit: 'worker', tier: 3, data })).toMatchObject({ ok: false, code: 'invalid_args' });

    const pipeline = createRegistryPipeline({ flags, data });
    const order = (tier: number, commandId: string) =>
      ({ commandId, colonyIndex: 0, source: 'player' as const, kind: 'enqueueTask', args: { buildUnit: { unit: 'worker', tier, count: 1 } } });
    const res = step(state, [order(3, 't3'), order(2, 't2')], 1, pipeline);
    expect(res.outcomes.find((o) => o.commandId === 't3')?.code).toBe('invalid_args');
    expect(res.outcomes.find((o) => o.commandId === 't2')?.code).toBeUndefined();
  });

  it('a Worker Drone T3 harvests (1.5x the T1 rate) next to a deposit', () => {
    const flags = parseWaves('..05');
    const state = createState({ planetId: 'p-w05-02-harvest', planetType: 'temperate', seed: 'w05-02-harvest', radius: 8 });
    state.grid.layers.terrain.fill(TERRAIN.flat);
    const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
    colony.status = 'active';
    colony.powerSupplyOverride = 50;
    setTileDeposit(state, hexIndex(state.grid.radius).indexOf(1, 0), DEPOSIT.metals, 10000, 0);
    const id = spawnWorkerUnit(state, { tier: 3, owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags });
    step(state, [], 1, pipeline);
    expect(state.entities.cols.state[rowOf(state.entities, id)]).toBe(ENTITY_STATE.harvesting);
    const before = resourceValue(colony, 'metals.t1');
    step(state, [], 5, pipeline); // 1 s
    expect(resourceValue(colony, 'metals.t1') - before).toBeCloseTo(0.75, 5); // T1 credits 0.5/s (harvest.spec.ts)
  });
});
