import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  DEPOSIT,
  enqueueQueueTask,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyQueue,
  hexDistance,
  hexIndex,
  insertRow,
  mobileStats,
  placeSpawnedEntity,
  PRODUCER_BUFFER_LIMIT,
  setFactoryRallyPoint,
  setTileDeposit,
  setTileTerrain,
  step,
  TERRAIN,
} from '../../src';

function createFactoryTestState(seed = 'w07-factory') {
  const state = createState({ planetId: 'p-w07', planetType: 'temperate', seed, radius: 12 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Alpha',
    color: 0xff6b00,
    status: 'active',
    unlockStage: 3,
    stage: 3,
    changedAt: 0,
  });
  state.colonies.push(colony);

  creditResource(colony, 'metals.t1', 500, 0);
  creditResource(colony, 'minerals.t1', 500, 0);
  creditResource(colony, 'bio.biomass', 200, 0);
  creditResource(colony, 'bio.water', 200, 0);
  colony.powerSupplyOverride = 40;

  // Active Command Hub T1 at (-5, 0) for base unit supply cap
  const hubId = state.meta.nextEntityId++;
  const hubRow = insertRow(state.entities, hubId, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  placeSpawnedEntity(state.entities, hubRow, -5, 0, 0);
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  // Active Robotics Factory T1 at (0, 0) (3x3 footprint)
  const factoryId = state.meta.nextEntityId++;
  const facRow = insertRow(state.entities, factoryId, 0);
  state.entities.cols.kind[facRow] = ENTITY_KIND.roboticsFactory;
  state.entities.cols.owner[facRow] = 0;
  placeSpawnedEntity(state.entities, facRow, 0, 0, 0);
  state.entities.cols.footprintW[facRow] = 3;
  state.entities.cols.footprintD[facRow] = 3;
  state.entities.cols.hp[facRow] = 800;
  state.entities.cols.hpMax[facRow] = 800;
  state.entities.cols.state[facRow] = ENTITY_STATE.active;

  return { state, colony, hubId, factoryId, facRow };
}

describe('W07-10 Robotics Factory T1 Recon Drone production, buffer cap, brownout pause, and rally walk', () => {
  it('enqueueTask {buildUnit:"recon"} -> Recon spawns at Factory edge after 10 s (50 ticks) and walks over hover terrain to rally point', () => {
    const { state, colony, factoryId } = createFactoryTestState('w07-factory-1');
    const pipeline = createRegistryPipeline({ flags: parseWaves('..07') });

    // Place shallow water, forest, rock, and deposit along (3, 0)..(6, 0) to verify hover pathing
    const idx = hexIndex(state.grid.radius);
    setTileTerrain(state, idx.indexOf(3, 0), TERRAIN.shallow, 0);
    setTileTerrain(state, idx.indexOf(4, 0), TERRAIN.forest, 0);
    setTileTerrain(state, idx.indexOf(5, 0), TERRAIN.rock, 0);
    setTileDeposit(state, idx.indexOf(6, 0), DEPOSIT.metals, 10000, 0);

    // Set rally point at (7, 0)
    setFactoryRallyPoint(state, 0, 7, 0, factoryId, 0);

    // Enqueue Recon Drone via enqueueTask command on step 1
    const firstStep = step(
      state,
      [
        {
          commandId: 'cmd-recon-1',
          kind: 'enqueueTask',
          source: 'player',
          colonyIndex: 0,
          args: { buildUnit: 'recon' },
        },
      ],
      1,
      pipeline,
    );
    expect(firstStep.outcomes[0]?.code).toBeUndefined();

    const unitsQueue = getColonyQueue(state, 0, 'units');
    expect(unitsQueue).toHaveLength(1);
    expect(unitsQueue[0].task).toMatchObject({ kind: 'buildUnit', unit: 'recon', producerId: factoryId });
    expect(unitsQueue[0].buildTicks).toBe(50);
    expect(unitsQueue[0].state).toBe('in_progress');

    // Step through tick 49 (9.8 s): not spawned yet
    for (let t = 2; t <= 49; t++) {
      step(state, [], 1, pipeline);
    }
    expect(getColonyQueue(state, 0, 'units')).toHaveLength(1);

    // Step tick 50 (10.0 s): Recon spawns at Factory perimeter edge (distance 2 from (0, 0))
    const spawnStep = step(state, [], 1, pipeline);
    expect(getColonyQueue(state, 0, 'units')).toHaveLength(0);

    const producedEvt = spawnStep.events.find((e) => e.kind === 'unitProduced');
    expect(producedEvt).toBeDefined();
    expect(producedEvt?.data).toMatchObject({ unit: 'recon', unitKind: 'recon', producerId: factoryId });

    // Progressive resource cost (35 Metals, 15 Minerals, 5 Water) was deducted
    expect(colony.stock['metals.t1']).toBeCloseTo(465, 3);
    expect(colony.stock['minerals.t1']).toBeCloseTo(485, 3);
    expect(colony.stock['bio.water']).toBeCloseTo(195, 3);

    // Find the spawned Recon entity
    let reconRow = -1;
    for (let r = 0; r < state.entities.count; r++) {
      if (state.entities.cols.kind[r] === ENTITY_KIND.recon) {
        reconRow = r;
        break;
      }
    }
    expect(reconRow).toBeGreaterThanOrEqual(0);
    expect(hexDistance(0, 0, state.entities.cols.q[reconRow], state.entities.cols.r[reconRow])).toBe(2);
    expect(state.entities.cols.state[reconRow]).toBe(ENTITY_STATE.moving);
    expect(state.entities.cols.targetQ[reconRow]).toBe(7);
    expect(state.entities.cols.targetR[reconRow]).toBe(0);

    const stats = mobileStats(ENTITY_KIND.recon, pipeline.config.data);
    expect(stats?.profile).toBe('hover');
    expect(stats?.speedPerTick).toBeCloseTo(0.7, 4);

    // Step 15 more ticks so Recon walks across shallow water / forest / rock / deposit and arrives at rally (7, 0)
    for (let i = 0; i < 15; i++) {
      step(state, [], 1, pipeline);
    }
    expect(state.entities.cols.q[reconRow]).toBe(7);
    expect(state.entities.cols.r[reconRow]).toBe(0);
    expect(state.entities.cols.state[reconRow]).toBe(ENTITY_STATE.idle);
  });
});

describe('W07-10 Robotics Factory T1 producer buffer cap and brownout pause', () => {
  it('enforces the 5-item per-producer buffer cap on Robotics Factory and balances across multiple factories', () => {
    const { state, factoryId } = createFactoryTestState('w07-factory-buffer');

    for (let i = 0; i < PRODUCER_BUFFER_LIMIT; i++) {
      const res = enqueueQueueTask(state, {
        colonyIndex: 0,
        taskId: `recon-${i}`,
        task: { kind: 'buildUnit', unit: 'recon' },
      });
      expect(res.ok).toBe(true);
      if (res.ok && res.entry.task.kind === 'buildUnit') {
        expect(res.entry.task.producerId).toBe(factoryId);
      }
    }

    // 6th item on the single Robotics Factory is rejected with queue_full
    const sixth = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'recon-over',
      task: { kind: 'buildUnit', unit: 'recon' },
    });
    expect(sixth).toEqual({ ok: false, code: 'queue_full', detail: 'producer buffer full' });

    // Spawn a second active Robotics Factory at (0, 5)
    const factory2Id = state.meta.nextEntityId++;
    const fac2Row = insertRow(state.entities, factory2Id, 0);
    state.entities.cols.kind[fac2Row] = ENTITY_KIND.roboticsFactory;
    state.entities.cols.owner[fac2Row] = 0;
    placeSpawnedEntity(state.entities, fac2Row, 0, 5, 0);
    state.entities.cols.footprintW[fac2Row] = 3;
    state.entities.cols.footprintD[fac2Row] = 3;
    state.entities.cols.hp[fac2Row] = 800;
    state.entities.cols.hpMax[fac2Row] = 800;
    state.entities.cols.state[fac2Row] = ENTITY_STATE.active;

    const routedToSecond = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'recon-f2',
      task: { kind: 'buildUnit', unit: 'recon' },
    });
    expect(routedToSecond.ok).toBe(true);
    if (routedToSecond.ok && routedToSecond.entry.task.kind === 'buildUnit') {
      expect(routedToSecond.entry.task.producerId).toBe(factory2Id);
    }
  });

  it('pauses Recon production on Robotics Factory brownout and resumes when power is restored', () => {
    const { state, colony, facRow } = createFactoryTestState('w07-factory-brownout');
    const pipeline = createRegistryPipeline({ flags: parseWaves('..07') });

    const enq = enqueueQueueTask(state, {
      colonyIndex: 0,
      taskId: 'recon-brownout',
      task: { kind: 'buildUnit', unit: 'recon' },
      data: pipeline.config.data,
    });
    expect(enq.ok).toBe(true);

    // Advance 20 ticks (4.0 s -> 40% progress)
    step(state, [], 20, pipeline);
    let q = getColonyQueue(state, 0, 'units');
    expect(q[0].state).toBe('in_progress');
    expect(q[0].elapsedTicks).toBe(20);

    // Put Robotics Factory into offlineBrownout
    colony.powerSupplyOverride = 5;
    state.entities.cols.state[facRow] = ENTITY_STATE.offlineBrownout;
    step(state, [], 10, pipeline);

    q = getColonyQueue(state, 0, 'units');
    expect(q[0].state).toBe('waiting');
    expect(q[0].waitReason).toBe('power');
    expect(q[0].waitDetail).toBe('waiting: power');
    expect(q[0].elapsedTicks).toBe(20);

    // Restore Robotics Factory to active -> resumes and finishes after remaining 30 ticks
    colony.powerSupplyOverride = 40;
    state.entities.cols.state[facRow] = ENTITY_STATE.active;
    const resumeStep = step(state, [], 30, pipeline);
    expect(getColonyQueue(state, 0, 'units')).toHaveLength(0);
    expect(resumeStep.events.some((e) => e.kind === 'unitProduced' && (e.data as { unitKind?: string }).unitKind === 'recon')).toBe(true);
  });
});
