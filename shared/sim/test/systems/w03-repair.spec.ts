import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  enqueueQueueTask,
  ensureColonyLedger,
  getColonyQueue,
  getWorkJobsMap,
  hexIndex,
  insertRow,
  PREP,
  rowOf,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnWorkerUnit,
  spawnHqUnit,
  step,
  TERRAIN,
  type PlanetState,
} from '../../src';
import { resourceValue } from '../../src/systems/economy/ledger';

function createW03RepairWorld(seed = 'w03-repair') {
  const state = createState({ planetId: `p-${seed}`, planetType: 'temperate', seed, radius: 10 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Colony 0',
    color: 0xff6b00,
    status: 'active',
    active: true,
    changedAt: 0,
  });
  colony.stock['metals.t1'] = 500;
  colony.stock['minerals.t1'] = 500;
  colony.stock['bio.biomass'] = 200;
  colony.stock['bio.water'] = 200;
  state.colonies.push(colony);

  const L = state.grid.layers;
  for (let i = 0; i < state.grid.count; i++) {
    setTileTerrain(state, i, TERRAIN.flat, 0);
    setTilePrep(state.grid, i, PREP.prepared, 0);
    setTileDeposit(state, i, DEPOSIT.none, 0, 0);
    L.height[i] = 0;
    L.owner[i] = 0;
  }

  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  const cols = state.entities.cols;
  cols.kind[hubRow] = ENTITY_KIND.commandHub;
  cols.owner[hubRow] = 0;
  cols.q[hubRow] = 0;
  cols.r[hubRow] = 0;
  cols.x[hubRow] = 0;
  cols.y[hubRow] = 0;
  cols.hp[hubRow] = 2000;
  cols.hpMax[hubRow] = 2000;
  cols.footprintW[hubRow] = 3;
  cols.footprintD[hubRow] = 3;
  cols.state[hubRow] = ENTITY_STATE.active;
  cols.progress[hubRow] = 1;

  const pipeline = createRegistryPipeline({ flags: parseWaves('..03') });
  return { state, colony, pipeline, hx: hexIndex(10) };
}

function spawnConstructedExtractor(state: PlanetState, q: number, r: number, hp = 300, hpMax = 300, tier = 1): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const cols = state.entities.cols;
  cols.kind[row] = ENTITY_KIND.metalsExtractor;
  cols.owner[row] = 0;
  cols.q[row] = q;
  cols.r[row] = r;
  cols.x[row] = q;
  cols.y[row] = r;
  cols.hp[row] = hp;
  cols.hpMax[row] = hpMax;
  cols.tier[row] = tier;
  cols.footprintW[row] = 2;
  cols.footprintD[row] = 2;
  cols.state[row] = ENTITY_STATE.active;
  cols.progress[row] = 1;
  return id;
}

describe('W03-03 critical auto-repair and Builder 1.5x repair rate', () => {
  it('auto-queues a system repair at 40% HP; Builder walks to it, repairs at 1.5x, and pays 24% base build cost progressively', () => {
    const { state, colony, pipeline } = createW03RepairWorld('w03-rep-crit');
    spawnHqUnit(state, { owner: 0, q: -4, r: 0 });
    const builderId = spawnWorkerUnit(state, { tier: 2, owner: 0, q: 2, r: 0 });
    expect(builderId).toBeGreaterThan(0);

    // Place a constructed Metals Extractor at (5, 0) damaged to 40% HP (120 / 300 HP, missing 60%).
    const extId = spawnConstructedExtractor(state, 5, 0, 120, 300, 1);
    const startMetals = resourceValue(colony, 'metals.t1');
    const startMinerals = resourceValue(colony, 'minerals.t1');

    // Step 1 tick: auto-repair detects 40% HP (< 50%) and queues a 'system' repair entry assigned to the Builder.
    step(state, [], 1, pipeline);
    const qEntries = getColonyQueue(state, 0, 'construction');
    const repEntry = qEntries.find((e) => e.task.kind === 'repair' && e.task.entityId === extId);
    expect(repEntry).toBeDefined();
    expect(repEntry?.precedence).toBe('system');
    expect(repEntry?.workerEntityId).toBe(builderId);

    // Base cost of Metals Extractor is 65 Metals, 20 Minerals -> 40% * 60% = 24% = 15.6 Metals, 4.8 Minerals.
    expect(repEntry?.totalCost?.['metals.t1']).toBeCloseTo(15.6, 4);
    expect(repEntry?.totalCost?.['minerals.t1']).toBeCloseTo(4.8, 4);

    // Step until the Builder walks from (2, 0) to within reach of (5, 0) and completes the repair.
    let ticks = 1;
    let midStockChecked = false;
    while (ticks < 120 && state.entities.cols.hp[rowOf(state.entities, extId)] < 300) {
      step(state, [], 1, pipeline);
      ticks++;
      const curHp = state.entities.cols.hp[rowOf(state.entities, extId)];
      if (curHp > 120 && curHp < 300) {
        midStockChecked = true;
        expect(resourceValue(colony, 'metals.t1')).toBeLessThan(startMetals);
        expect(resourceValue(colony, 'metals.t1')).toBeGreaterThan(startMetals - 15.6);
      }
    }

    expect(midStockChecked).toBe(true);
    expect(state.entities.cols.hp[rowOf(state.entities, extId)]).toBe(300);
    // 48 base ticks at 1.5x = 32 work ticks + ~7 walk ticks < 45 total ticks (vs >= 54 ticks at 1.0x).
    expect(ticks).toBeLessThanOrEqual(45);
    expect(startMetals - resourceValue(colony, 'metals.t1')).toBeCloseTo(15.6, 4);
    expect(startMinerals - resourceValue(colony, 'minerals.t1')).toBeCloseTo(4.8, 4);
    expect(getColonyQueue(state, 0, 'construction').some((e) => e.task.kind === 'repair')).toBe(false);
  });
});

describe('W03-03 precedence rules, tier freedom, and fallback workers', () => {
  it('queues non-critical damage (>= 50% HP) at auto precedence and upgrades to system when HP drops below 50%', () => {
    const { state, pipeline } = createW03RepairWorld('w03-rep-upgrade');
    spawnWorkerUnit(state, { tier: 2, owner: 0, q: -4, r: 0 });
    const extId = spawnConstructedExtractor(state, 5, 0, 210, 300, 1); // 70% HP

    step(state, [], 1, pipeline);
    const entry1 = getColonyQueue(state, 0, 'construction').find((e) => e.task.kind === 'repair' && e.task.entityId === extId);
    expect(entry1?.precedence).toBe('auto');

    // Damage further to 30% HP (90 / 300 HP) -> upgrades open queue entry to 'system'.
    state.entities.cols.hp[rowOf(state.entities, extId)] = 90;
    step(state, [], 1, pipeline);
    const entry2 = getColonyQueue(state, 0, 'construction').find((e) => e.task.kind === 'repair' && e.task.entityId === extId);
    expect(entry2?.precedence).toBe('system');
  });

  it('allows Worker Drone T2 to repair any tier at 1.5x rate, and HQ or another tier at 1.0x', () => {
    const { state, pipeline } = createW03RepairWorld('w03-rep-t2');
    spawnHqUnit(state, { owner: 0, q: -5, r: 0 });
    const builderId = spawnWorkerUnit(state, { tier: 2, owner: 0, q: 3, r: 0 });
    // Spawn a T2 structure adjacent at (4, 0) at 50% HP (missing 50% -> 40 base repair ticks).
    const t2Id = spawnConstructedExtractor(state, 4, 0, 150, 300, 2);

    step(state, [], 1, pipeline);
    expect(Object.values(getWorkJobsMap(state))[0]).toMatchObject({ mode: 'repair', targetEntityId: t2Id });
    let builderTicks = 1;
    while (builderTicks < 60 && state.entities.cols.hp[rowOf(state.entities, t2Id)] < 300) {
      step(state, [], 1, pipeline);
      builderTicks++;
    }
    expect(state.entities.cols.hp[rowOf(state.entities, t2Id)]).toBe(300);
    // 40 base ticks / 1.5 = 27 ticks when already adjacent at dist 1.
    expect(builderTicks).toBe(27);
    expect(rowOf(state.entities, builderId)).toBeGreaterThanOrEqual(0);

    // Verify HQ / Worker repairs at 1.0x (40 ticks for 50% missing HP) when no Builder exists.
    const w2 = createW03RepairWorld('w03-rep-harv');
    spawnHqUnit(w2.state, { owner: 0, q: -6, r: 0 });
    const harvId = spawnWorkerUnit(w2.state, { owner: 0, q: 3, r: 0 }) as number;
    const ext2Id = spawnConstructedExtractor(w2.state, 4, 0, 150, 300, 1);
    let harvTicks = 0;
    while (harvTicks < 60 && w2.state.entities.cols.hp[rowOf(w2.state.entities, ext2Id)] < 300) {
      step(w2.state, [], 1, w2.pipeline);
      harvTicks++;
    }
    expect(w2.state.entities.cols.hp[rowOf(w2.state.entities, ext2Id)]).toBe(300);
    expect(harvTicks).toBe(40);
    expect(getWorkJobsMap(w2.state)).toEqual({});
    expect(harvId).toBeGreaterThan(0);
  });

  it('spawns a Worker Drone T2 when buildUnit { unit: worker, tier: 2 } finishes in the W03 queue', () => {
    const { state, pipeline } = createW03RepairWorld('w03-queue-builder');
    const enq = enqueueQueueTask(state, {
      colonyIndex: 0,
      task: { kind: 'buildUnit', unit: 'worker', tier: 2, count: 1 },
      tick: 0,
    });
    expect(enq.ok).toBe(true);
    for (let t = 0; t < 65; t++) step(state, [], 1, pipeline);
    let builders = 0;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.worker) builders++;
    }
    expect(builders).toBe(1);
  });
});
