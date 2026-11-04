import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  assignBuilderToSite,
  checkWorkerBuildTier,
  compileData,
  createRegistryPipeline,
  createState,
  creditResource,
  DEPOSIT,
  enqueueHubUnit,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getBuildingJobs,
  computeColonySupply,
  getHubUnitQueue,
  insertRow,
  isWorkerEligibleForJob,
  PREP,
  rowOf,
  spawnBuilderUnit,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  TERRAIN,
  view,
} from '../../src';
import { resourceValue } from '../../src/systems/economy/ledger';

describe('W03-02 Builder Drone in sim: Hub production (12 s / 60 ticks)', () => {
  it('queues a Builder at the Hub -> pays 45/25/10 progressively and spawns after 12 s (60 ticks) with workRate 1.0x', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w03-b1', radius: 10 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    // Spawn active Command Hub T1 at (0, 0)
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = 0;
    state.entities.cols.r[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.hpMax[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    creditResource(colony, 'metals.t1', 500, 0);
    creditResource(colony, 'minerals.t1', 500, 0);
    creditResource(colony, 'bio.biomass', 500, 0);

    // Rejects Builder when W03 wave is off in data
    const w02Data = compileData(parseWaves('..02'));
    expect(enqueueHubUnit(state, { colonyIndex: 0, unit: 'builder', data: w02Data })).toEqual({
      ok: false,
      code: 'invalid_args',
      detail: 'unknown unit',
    });

    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });
    const qRes = enqueueHubUnit(state, { colonyIndex: 0, unit: 'builder', count: 1 });
    expect(qRes.ok).toBe(true);
    if (!qRes.ok) throw new Error('expected ok');
    expect(qRes.entry.unit).toBe('builder');
    expect(qRes.entry.buildTicks).toBe(60);
    expect(qRes.entry.state).toBe('in_progress');

    // Step 59 ticks (11.8 s): not spawned yet, progressive cost deducted
    step(state, [], 59, pipeline);
    expect(getHubUnitQueue(state, 0)).toHaveLength(1);
    expect(resourceValue(colony, 'metals.t1')).toBeCloseTo(500 - 45 * (59 / 60), 3);

    // Step 1 more tick (60 ticks = 12.0 s): Builder spawns at Hub edge
    const doneStep = step(state, [], 1, pipeline);
    expect(doneStep.events.some((e) => e.kind === 'unitProduced' && (e.data as { unit?: string }).unit === 'builder')).toBe(true);
    expect(getHubUnitQueue(state, 0)).toHaveLength(0);
    expect(computeColonySupply(state, 0).units).toBe(1);
    expect(resourceValue(colony, 'metals.t1')).toBeCloseTo(455, 4);
    expect(resourceValue(colony, 'minerals.t1')).toBeCloseTo(475, 4);
    expect(resourceValue(colony, 'bio.biomass')).toBeCloseTo(490, 4);

    // Verify spawned Builder entity and SimView projection
    const simView = view(state);
    const builderEnt = simView.entities.find((e) => e.kind === ENTITY_KIND.builder);
    expect(builderEnt).toBeDefined();
    expect(builderEnt).toMatchObject({
      unit: 'builder',
      label: 'Builder Drone',
      archetype: 'robot.builder',
      hp: 150,
      hpMax: 150,
      workRate: 1.0,
      maxBuildTier: 1,
      supply: 1,
      powerDrainPerS: 3,
      viewRadius: 7,
    });
  });
});

describe('W03-02 Builder Drone in sim: 1.0x parallel build and T1 tier lock', () => {
  it('HQ (1.5x) and Builder (1.0x) build 2 queued buildings in parallel at their respective rates', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w03-b2', radius: 10 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    creditResource(colony, 'metals.t1', 500, 0);
    creditResource(colony, 'minerals.t1', 500, 0);
    creditResource(colony, 'bio.biomass', 200, 0);
    creditResource(colony, 'bio.water', 200, 0);

    // Flatten and prepare the grid so both sites and their approaches are level flat ground
    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.height.fill(0);
    state.grid.layers.deposit.fill(DEPOSIT.none);
    state.grid.layers.prep.fill(PREP.prepared);

    // Spawn HQ at (0, 0) [workRate 1.5x, buildReach 2..3] and Builder at (-4, 0) [workRate 1.0x, buildReach 1..1]
    spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    spawnBuilderUnit(state, { owner: 0, q: -4, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    const b1 = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 2, r: 0 });
    const b2 = startBuildingConstruction(state, { owner: 0, building: 'solar', q: -3, r: 0 });
    expect(b1).toEqual(expect.objectContaining({ ok: true }));
    expect(b2).toEqual(expect.objectContaining({ ok: true }));
    if (!b1.ok || !b2.ok) throw new Error('expected both buildings to start');

    // Step 10 ticks: HQ (1.5x) works b1 and Builder (1.0x) works b2 simultaneously!
    step(state, [], 10, pipeline);

    const jobsAfter10 = getBuildingJobs(state);
    const job1 = jobsAfter10[b1.entityId]!;
    const job2 = jobsAfter10[b2.entityId]!;
    expect(job1).toBeDefined();
    expect(job2).toBeDefined();
    expect(job1.elapsedWeightedTicks).toBeGreaterThan(0);
    expect(job2.elapsedWeightedTicks).toBeGreaterThan(0);
    // HQ advances its site at 1.5 weighted ticks/step; Builder advances its site at 1.0 weighted ticks/step
    expect(job1.elapsedWeightedTicks).toBeGreaterThan(job2.elapsedWeightedTicks);
    expect(job1.elapsedWeightedTicks / job2.elapsedWeightedTicks).toBeCloseTo(1.5, 2);

    // Step 50 more ticks (total 60 ticks = 12 s): HQ's Solar (90 ticks / 1.5x = 60 ticks) completes first while Builder's is at 60/90!
    step(state, [], 50, pipeline);
    const row1 = rowOf(state.entities, b1.entityId);
    const row2 = rowOf(state.entities, b2.entityId);
    expect(state.entities.cols.state[row1]).toBe(ENTITY_STATE.active);
    expect(state.entities.cols.state[row2]).toBe(ENTITY_STATE.constructing);
    expect(state.entities.cols.progress[row2]).toBeCloseTo(60 / 90, 2);
  });

  it('rejects assigning a Builder to a T2 site with worker_tier_locked', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w03-b3', radius: 10 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    const hqId = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const builderId = spawnBuilderUnit(state, { owner: 0, q: 1, r: 0 });

    // Eligibility checks
    expect(isWorkerEligibleForJob(ENTITY_KIND.builder, 1, { kind: 'build', tier: 1 })).toBe(true);
    expect(isWorkerEligibleForJob(ENTITY_KIND.builder, 1, { kind: 'build', tier: 2 })).toBe(false);
    expect(isWorkerEligibleForJob(ENTITY_KIND.builder, 1, { kind: 'linkedPrep' })).toBe(true);
    expect(checkWorkerBuildTier(ENTITY_KIND.builder, 1, 1)).toEqual({ ok: true });
    expect(checkWorkerBuildTier(ENTITY_KIND.builder, 1, 2)).toEqual({ ok: false, code: 'worker_tier_locked' });

    // Assigning Builder to a T2 site returns worker_tier_locked
    const lockRes = assignBuilderToSite(state, builderId, { q: 3, r: 0, tier: 2 });
    expect(lockRes).toEqual({ ok: false, code: 'worker_tier_locked' });

    // Assigning Builder to a T1 site succeeds
    const okRes = assignBuilderToSite(state, builderId, { q: 3, r: 0, tier: 1 });
    expect(okRes.ok).toBe(true);

    // HQ T1 is also tier-locked on T2 until upgraded to T2
    expect(assignBuilderToSite(state, hqId, { q: 3, r: 0, tier: 2 })).toEqual({
      ok: false,
      code: 'worker_tier_locked',
    });
  });
});

describe('W03-02 Builder Drone in sim: linked site prep and Hub batch count', () => {
  it('supports linked prep by Builder Drone and count/repeat in Hub Units lane', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w03-b4', radius: 10 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    state.grid.layers.terrain.fill(TERRAIN.flat);
    state.grid.layers.height.fill(0);
    state.grid.layers.deposit.fill(DEPOSIT.none);
    state.grid.layers.prep.fill(PREP.wild);

    creditResource(colony, 'metals.t1', 500, 0);
    creditResource(colony, 'minerals.t1', 500, 0);
    creditResource(colony, 'bio.biomass', 200, 0);
    creditResource(colony, 'bio.water', 200, 0);

    // Spawn Builder Drone at (0, 0) without an HQ: Builder prepares the 2x2 footprint and then builds Solar T1!
    spawnBuilderUnit(state, { owner: 0, q: 0, r: 0 });
    const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });

    const b1 = startBuildingConstruction(state, { owner: 0, building: 'solar', q: 2, r: 0 });
    expect(b1.ok).toBe(true);
    if (!b1.ok) throw new Error('expected ok');

    // Step 220 ticks (1 tick per step): Builder grades all 4 footprint tiles (`job:<entityId>/prep`) and completes Solar T1 (`job:<entityId>`)
    for (let t = 0; t < 220; t++) step(state, [], 1, pipeline);
    expect(getBuildingJobs(state)[b1.entityId]).toBeUndefined();
    const bRow = rowOf(state.entities, b1.entityId);
    expect(state.entities.cols.state[bRow]).toBe(ENTITY_STATE.active);

    // Queue 2 Builders with count = 2 -> produces 2 more Builders (120 ticks total)
    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.q[hubRow] = -4;
    state.entities.cols.r[hubRow] = 0;
    state.entities.cols.footprintW[hubRow] = 3;
    state.entities.cols.footprintD[hubRow] = 3;
    state.entities.cols.hp[hubRow] = 1500;
    state.entities.cols.hpMax[hubRow] = 1500;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    const q2 = enqueueHubUnit(state, { colonyIndex: 0, unit: 'builder', count: 2 });
    expect(q2.ok).toBe(true);
    for (let t = 0; t < 120; t++) step(state, [], 1, pipeline);
    expect(computeColonySupply(state, 0).units).toBe(3);
  });
});
