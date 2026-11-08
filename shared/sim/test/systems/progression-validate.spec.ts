import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  checkItemUnlockStage,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyQueue,
  insertRow,
  placeSpawnedEntity,
  resolveEffectiveUnlockStage,
  resolveItemUnlockStage,
  SimHost,
  spawnHqUnit,
  startBuildingConstruction,
  step,
  type CommandOutcome,
} from '../../src';

function createStagePlanet(stage: number, unlockStage = stage, waves = '..08') {
  const state = createState({ planetId: `pl-val-s${stage}`, planetType: 'temperate', seed: `val-s${stage}`, radius: 12 });
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stage = stage;
  colony.unlockStage = unlockStage;
  colony.stock['metals.t1'] = 500;
  colony.stock['minerals.t1'] = 500;
  colony.stock['bio.biomass'] = 500;
  colony.stock['bio.water'] = 500;
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  if (stage > 0) {
    expect(startBuildingConstruction(state, { owner: 0, building: 'commandHub', q: -2, r: 0, instant: true, costOverride: {} }).ok).toBe(true);
  }
  const pipeline = createRegistryPipeline({ flags: parseWaves(waves) });
  return { state, colony, pipeline };
}

describe('W08-10 · placeBuilding unlock-stage validation', () => {
  it('Acceptance check: at S2 (stage = 2, unlockStage = 2), placeBuilding robotics_factory is rejected with { code: "stage_locked", unlocksAt: "S3" }', () => {
    const { state, pipeline } = createStagePlanet(2, 2);

    const resSnake = step(
      state,
      [
        {
          commandId: 'pb-rf-snake',
          colonyIndex: 0,
          source: 'player',
          kind: 'placeBuilding',
          args: { building: 'robotics_factory', q: 2, r: 0 },
        },
      ],
      1,
      pipeline,
    );
    expect(resSnake.outcomes[0]).toMatchObject({
      commandId: 'pb-rf-snake',
      kind: 'placeBuilding',
      code: 'stage_locked',
      detail: 'S3',
      unlocksAt: 'S3',
    });

    const resCamel = step(
      state,
      [
        {
          commandId: 'pb-rf-camel',
          colonyIndex: 0,
          source: 'player',
          kind: 'placeBuilding',
          args: { building: 'roboticsFactory', q: 2, r: 0 },
        },
      ],
      1,
      pipeline,
    );
    expect(resCamel.outcomes[0]).toMatchObject({
      commandId: 'pb-rf-camel',
      kind: 'placeBuilding',
      code: 'stage_locked',
      detail: 'S3',
      unlocksAt: 'S3',
    });
  });

  it('publishes CommandOutcome { code: "stage_locked", unlocksAt: "S3" } via SimHost.onOutcomes when placeBuilding robotics_factory is submitted at S2', () => {
    const { state, pipeline } = createStagePlanet(2, 2);
    const host = new SimHost(pipeline);
    host.load(state);
    const outcomes: CommandOutcome[] = [];
    host.onOutcomes((o) => outcomes.push(...o));

    host.submit({
      commandId: 'cm_rf_s2',
      colonyIndex: 0,
      source: 'player',
      kind: 'placeBuilding',
      args: { building: 'robotics_factory', q: 2, r: 0 },
    });
    host.step(1);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      commandId: 'cm_rf_s2',
      kind: 'placeBuilding',
      code: 'stage_locked',
      detail: 'S3',
      unlocksAt: 'S3',
    });
  });
});

describe('grid buildings share the stage table with placement', () => {
  it('locks Pylon, Wind, Water, Petroleum, Capacitor and Supply Depot at S1, and Thermal until S3', () => {
    const { state } = createStagePlanet(1, 1, '..08');
    const flags = parseWaves('..08');
    for (const id of ['pylon', 'wind', 'waterExtractor', 'petroleumWell', 'capacitor', 'supplyDepot']) {
      expect(resolveItemUnlockStage(id)).toBe(2);
      expect(checkItemUnlockStage(state, 0, id, flags)).toMatchObject({ ok: false, code: 'stage_locked', unlocksAt: 'S2' });
    }
    expect(checkItemUnlockStage(state, 0, 'metalsExtractor', flags)).toEqual({ ok: true });
    expect(checkItemUnlockStage(state, 0, 'solar', flags)).toEqual({ ok: true });
    expect(resolveItemUnlockStage('thermal')).toBe(3);
    expect(checkItemUnlockStage(state, 0, 'thermal', flags)).toMatchObject({ ok: false, unlocksAt: 'S3' });
  });
});

describe('W08-10 · enqueueTask S2 and S3/S4 unlock-stage validation', () => {
  it('rejects S2 items (pylon, depot, fill, bridge) via enqueueTask at S1 with unlocksAt: "S2", and accepts them once unlockStage = 2', () => {
    const { state, colony, pipeline } = createStagePlanet(1, 1);
    const s2Orders = [
      { commandId: 'eq-pylon', colonyIndex: 0, source: 'player' as const, kind: 'enqueueTask' as const, args: { build: { building: 'pylon', q: 2, r: 0 } } },
      { commandId: 'eq-depot', colonyIndex: 0, source: 'player' as const, kind: 'enqueueTask' as const, args: { build: { building: 'depot', q: 3, r: 0 } } },
      { commandId: 'eq-fill', colonyIndex: 0, source: 'player' as const, kind: 'enqueueTask' as const, args: { terraform: { op: 'fill', tiles: [{ q: 1, r: 0 }] } } },
      { commandId: 'eq-bridge', colonyIndex: 0, source: 'player' as const, kind: 'enqueueTask' as const, args: { task: { kind: 'terraform', op: 'bridge', q: 1, r: 1 } } },
    ];

    const rLocked = step(state, s2Orders, 1, pipeline);
    for (const outcome of rLocked.outcomes) {
      expect(outcome).toMatchObject({ code: 'stage_locked', detail: 'S2', unlocksAt: 'S2' });
    }
    expect(getColonyQueue(state, 0)).toHaveLength(0);

    colony.stage = 2;
    colony.unlockStage = 2;
    const rUnlocked = step(
      state,
      s2Orders.map((cmd, idx) => ({ ...cmd, commandId: `${cmd.commandId}-s2-${idx}` })),
      1,
      pipeline,
    );
    // Fill on plain flat ground would change nothing: the shared terraform rule refuses it (`already_at_target`).
    expect(rUnlocked.outcomes.map((o) => o.code)).toEqual([undefined, undefined, 'already_at_target', undefined]);
    expect(getColonyQueue(state, 0).length).toBe(3);
  });

  it('rejects S3 and S4 items at S2, and unlocks them when unlockStage is raised (including inherited unlockStage > stage)', () => {
    const { state, colony, pipeline } = createStagePlanet(2, 2);
    const rS2 = step(
      state,
      [
        { commandId: 'eq-rf', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { build: { building: 'robotics_factory', q: 2, r: 0 } } },
        { commandId: 'eq-turret', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { build: { building: 'turret', q: 3, r: 0 } } },
        { commandId: 'eq-scout', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { buildUnit: { unit: 'scout', count: 1 } } },
        { commandId: 'eq-beacon', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { build: { building: 'outpostBeacon', q: 4, r: 0 } } },
        { commandId: 'eq-ce', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { buildUnit: { unit: 'combatEngineer', count: 1 } } },
      ],
      1,
      pipeline,
    );

    expect(rS2.outcomes.map((o) => ({ code: o.code, unlocksAt: o.unlocksAt }))).toEqual([
      { code: 'stage_locked', unlocksAt: 'S3' },
      { code: 'stage_locked', unlocksAt: 'S3' },
      { code: 'stage_locked', unlocksAt: 'S3' },
      { code: 'stage_locked', unlocksAt: 'S4' },
      { code: 'stage_locked', unlocksAt: 'S4' },
    ]);

    colony.stage = 0;
    colony.unlockStage = 3;
    const rInheritedS3 = step(
      state,
      [
        { commandId: 'eq-rf-ok', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { build: { building: 'robotics_factory', q: 2, r: 0 } } },
        { commandId: 'eq-scout-ok', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { buildUnit: { unit: 'scout', count: 1 } } },
        { commandId: 'eq-beacon-still-locked', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { build: { building: 'outpostBeacon', q: 4, r: 0 } } },
      ],
      1,
      pipeline,
    );

    expect(rInheritedS3.outcomes.map((o) => ({ code: o.code, unlocksAt: o.unlocksAt }))).toEqual([
      { code: undefined, unlocksAt: undefined },
      { code: 'invalid_args', unlocksAt: undefined }, // scout is still a preview; stage unlock does not add its production row
      { code: 'stage_locked', unlocksAt: 'S4' },
    ]);
  });
});

describe('W08-10 · S0 / S1 Command Hub and HQ precedence unlock rules', () => {
  it('blocks S1 items at S0 before Command Hub completion, allows hq-precedence goal orders, and unlocks S1 items once Hub is completed', () => {
    const { state, pipeline } = createStagePlanet(0, 0);

    const rS0Locked = step(
      state,
      [
        { commandId: 's0-solar', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { build: { building: 'solar', q: 2, r: 0 } } },
        { commandId: 's0-worker', colonyIndex: 0, source: 'player', kind: 'enqueueTask', args: { buildUnit: { unit: 'worker', count: 1 } } },
      ],
      1,
      pipeline,
    );
    expect(rS0Locked.outcomes.map((o) => ({ code: o.code, unlocksAt: o.unlocksAt }))).toEqual([
      { code: 'stage_locked', unlocksAt: 'S1' },
      { code: 'stage_locked', unlocksAt: 'S1' },
    ]);

    const rHq = step(
      state,
      [
        {
          commandId: 's0-hq-solar',
          colonyIndex: 0,
          source: 'system',
          kind: 'enqueueTask',
          args: { precedence: 'hq', task: { kind: 'build', building: 'solar', q: 2, r: 0 } },
        } as never,
      ],
      1,
      pipeline,
    );
    expect(rHq.outcomes[0]?.code).toBe('outside_power_zone'); // HQ precedence bypasses stage locks, not grid placement

    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.tier[hubRow] = 1;
    placeSpawnedEntity(state.entities, hubRow, 0, 0, state.meta.tick);
    state.entities.cols.hp[hubRow] = 2000;
    state.entities.cols.hpMax[hubRow] = 2000;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    expect(resolveEffectiveUnlockStage(state, 0)).toBe(1);
    expect(checkItemUnlockStage(state, 0, 'worker')).toEqual({ ok: true });
    expect(checkItemUnlockStage(state, 0, 'pylon')).toEqual({
      ok: false,
      code: 'stage_locked',
      detail: 'S2',
      unlocksAt: 'S2',
    });
    expect(resolveItemUnlockStage('robotics_factory')).toBe(3);
  });
});
