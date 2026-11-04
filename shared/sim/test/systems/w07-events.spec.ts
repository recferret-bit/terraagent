import { describe, expect, it } from 'vitest';
import {
  BuildingDestroyedDataSchema,
  FaunaKilledDataSchema,
  NestDestroyedDataSchema,
  parseWaves,
  RaidRepelledDataSchema,
  RaidStartedDataSchema,
  UnderAttackDataSchema,
  UnitDestroyedDataSchema,
} from '@terra/contracts';
import {
  applyDamage,
  createRegistryPipeline,
  createState,
  emitRaidRepelled,
  emitRaidStarted,
  emitUnderAttackIfDue,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  getCombatEventsBlob,
  insertRow,
  noteColonyBuildingDestroyedDuringRaid,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  startBuildingConstruction,
  TERRAIN,
  UNDER_ATTACK_DEBOUNCE_TICKS,
  type SimEvent,
  type StepContext,
} from '../../src';

function makeW07Host(radius = 16) {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-w07-events', planetType: 'temperate', seed: 'w07-events', radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stock['metals.t1'] = 600;
  colony.stock['minerals.t1'] = 500;
  host.load(state);
  return { host, state, pipeline };
}

function makeStepCtx(host: SimHost, events: SimEvent[] = [], tickOverride?: number): StepContext {
  const tick = tickOverride ?? host.tick + 1;
  return {
    dt: 1,
    tick,
    flags: host['pipeline'].config.flags,
    data: host['pipeline'].config.data,
    events,
    postings: [],
    rng: (s) => host.state.rng[s],
    newEntityId: () => host.state.meta.nextEntityId++,
    emit: (e) => {
      events.push({ severity: 'info', colonyIds: [], data: {}, ...e, atTick: tick });
    },
    record: () => undefined,
  };
}

describe('W07-16 · underAttack debounce acceptance check', () => {
  it('acceptance check: two hits 10 s apart emit one underAttack; hit at 60 s emits second', () => {
    const { host, state } = makeW07Host();
    const events: SimEvent[] = [];

    const reconId = state.meta.nextEntityId++;
    const reconRow = insertRow(state.entities, reconId, 0);
    state.entities.cols.kind[reconRow] = ENTITY_KIND.recon;
    state.entities.cols.owner[reconRow] = 0;
    state.entities.cols.hp[reconRow] = 500;
    state.entities.cols.hpMax[reconRow] = 500;
    placeSpawnedEntity(state.entities, reconRow, 1, 1, 0);

    const antId = state.meta.nextEntityId++;
    const antRow = insertRow(state.entities, antId, 0);
    state.entities.cols.kind[antRow] = ENTITY_KIND.blackAnt;
    state.entities.cols.owner[antRow] = -1;
    state.entities.cols.hp[antRow] = 120;
    state.entities.cols.hpMax[antRow] = 120;
    placeSpawnedEntity(state.entities, antRow, 1, 2, 0);

    // Hit 1: tick = 100 -> emits underAttack
    const ctx100 = makeStepCtx(host, events, 100);
    const hit1 = applyDamage(state, reconId, 20, { attackerId: antId, tick: 100, ctx: ctx100 });
    expect(hit1.applied).toBe(20);

    const underAttackEvents = () => events.filter((e) => e.kind === 'underAttack');
    expect(underAttackEvents()).toHaveLength(1);

    const ev1 = underAttackEvents()[0]!;
    expect(() => UnderAttackDataSchema.parse(ev1.data)).not.toThrow();
    expect(ev1.data).toMatchObject({
      colonyIndex: 0,
      entityId: reconId,
      attackerId: antId,
      q: 1,
      r: 1,
    });
    expect((state.colonies[0] as { underAttackAtTick?: number }).underAttackAtTick).toBe(100);
    expect(getCombatEventsBlob(state).lastUnderAttackByColony[0]).toBe(100);

    // Hit 2: 10 s later (10 s * 5 TPS = +50 ticks -> tick = 150 < 100 + 300) -> debounced!
    const ctx150 = makeStepCtx(host, events, 150);
    const hit2 = applyDamage(state, reconId, 20, { attackerId: antId, tick: 150, ctx: ctx150 });
    expect(hit2.applied).toBe(20);
    expect(underAttackEvents()).toHaveLength(1); // STILL 1!

    // Hit 3: 60 s after first hit (60 s * 5 TPS = +300 ticks -> tick = 400 >= 100 + 300) -> emits second
    const ctx400 = makeStepCtx(host, events, 400);
    const hit3 = applyDamage(state, reconId, 20, { attackerId: antId, tick: 400, ctx: ctx400 });
    expect(hit3.applied).toBe(20);
    expect(underAttackEvents()).toHaveLength(2); // Now 2!

    const ev2 = underAttackEvents()[1]!;
    expect(() => UnderAttackDataSchema.parse(ev2.data)).not.toThrow();
    expect((state.colonies[0] as { underAttackAtTick?: number }).underAttackAtTick).toBe(400);
    expect(getCombatEventsBlob(state).lastUnderAttackByColony[0]).toBe(400);
  });

  it('tracks underAttack debounce independently per colony and ignores negative colony index', () => {
    const { host, state } = makeW07Host();
    const events: SimEvent[] = [];
    const ctx = makeStepCtx(host, events, 100);

    const colony1 = ensureColonyLedger(ensureColonyRecord(state, 1, 0));
    colony1.status = 'active';

    expect(emitUnderAttackIfDue(state, -1, { targetId: 99, q: 0, r: 0, tick: 100 }, ctx)).toBe(false);
    expect(emitUnderAttackIfDue(state, 0, { targetId: 10, q: 2, r: 2, tick: 100 }, ctx)).toBe(true);
    expect(emitUnderAttackIfDue(state, 1, { targetId: 20, q: 5, r: 5, tick: 110 }, ctx)).toBe(true);

    const blob = getCombatEventsBlob(state);
    expect(blob.lastUnderAttackByColony[0]).toBe(100);
    expect(blob.lastUnderAttackByColony[1]).toBe(110);
    expect(UNDER_ATTACK_DEBOUNCE_TICKS).toBe(300);
  });
});

describe('W07-16 · raid lifecycle: raidStarted and unbreached raidRepelled', () => {
  it('records active raid and emits raidRepelled { unbreached: true } when no building was lost', () => {
    const { host, state } = makeW07Host();
    const events: SimEvent[] = [];
    const ctx = makeStepCtx(host, events, 50);

    emitRaidStarted(
      state,
      {
        colonyIndex: 0,
        hiveId: 42,
        species: 'blueBeetle',
        waveNumber: 2,
        count: 4,
        q: 6,
        r: -2,
        raidId: 'raid-alpha',
        tick: 50,
      },
      ctx,
    );

    const blobBefore = getCombatEventsBlob(state);
    expect(blobBefore.activeRaidsByColony?.[0]).toEqual({
      raidId: 'raid-alpha',
      buildingLost: false,
    });

    const startEv = events.find((e) => e.kind === 'raidStarted');
    expect(startEv).toBeDefined();
    expect(() => RaidStartedDataSchema.parse(startEv!.data)).not.toThrow();
    expect(startEv!.data).toMatchObject({
      colonyIndex: 0,
      hiveId: 42,
      species: 'blueBeetle',
      waveIndex: 2,
      count: 4,
      q: 6,
      r: -2,
    });

    const unbreached = emitRaidRepelled(
      state,
      {
        colonyIndex: 0,
        hiveId: 42,
        species: 'blueBeetle',
        raidId: 'raid-alpha',
        count: 4,
        q: 6,
        r: -2,
        tick: 80,
      },
      ctx,
    );

    expect(unbreached).toBe(true);
    const repelEv = events.find((e) => e.kind === 'raidRepelled');
    expect(repelEv).toBeDefined();
    expect(() => RaidRepelledDataSchema.parse(repelEv!.data)).not.toThrow();
    expect(repelEv!.data).toMatchObject({
      colonyIndex: 0,
      unbreached: true,
      hiveId: 42,
      species: 'blueBeetle',
    });

    const blobAfter = getCombatEventsBlob(state);
    expect(blobAfter.activeRaidsByColony?.[0]).toBeUndefined();
  });
});

describe('W07-16 · raid lifecycle: breached raidRepelled on building destroyed', () => {
  it('marks unbreached: false when a colony building is destroyed during an active raid', () => {
    const { host, state } = makeW07Host();
    const events: SimEvent[] = [];
    const ctx = makeStepCtx(host, events, 60);

    const solarRes = startBuildingConstruction(state, {
      owner: 0,
      building: 'solar',
      q: 3,
      r: 1,
      instant: true,
      costOverride: {},
    });
    expect(solarRes.ok).toBe(true);
    const solarId = solarRes.ok ? solarRes.entityId : -1;

    emitRaidStarted(
      state,
      {
        colonyIndex: 0,
        hiveId: 55,
        species: 'greenSpitter',
        count: 3,
        q: 8,
        r: -3,
        raidId: 'raid-beta',
        tick: 60,
      },
      ctx,
    );

    const antId = state.meta.nextEntityId++;
    const antRow = insertRow(state.entities, antId, 0);
    state.entities.cols.kind[antRow] = ENTITY_KIND.greenSpitter;
    state.entities.cols.owner[antRow] = -1;
    state.entities.cols.hp[antRow] = 180;
    state.entities.cols.hpMax[antRow] = 180;
    placeSpawnedEntity(state.entities, antRow, 3, 2, 0);

    const dmgRes = applyDamage(state, solarId, 9999, { attackerId: antId, tick: 70, ctx });
    expect(dmgRes.destroyed).toBe(true);
    expect(rowOf(state.entities, solarId)).toBe(-1);

    const blobDuring = getCombatEventsBlob(state);
    expect(blobDuring.activeRaidsByColony?.[0]?.buildingLost).toBe(true);

    const bDestroyEv = events.find((e) => e.kind === 'buildingDestroyed');
    expect(bDestroyEv).toBeDefined();
    expect(() => BuildingDestroyedDataSchema.parse(bDestroyEv!.data)).not.toThrow();

    const unbreached = emitRaidRepelled(
      state,
      {
        colonyIndex: 0,
        hiveId: 55,
        species: 'greenSpitter',
        raidId: 'raid-beta',
        tick: 90,
      },
      ctx,
    );

    expect(unbreached).toBe(false);
    const repelEv = events.find((e) => e.kind === 'raidRepelled');
    expect(repelEv).toBeDefined();
    expect(() => RaidRepelledDataSchema.parse(repelEv!.data)).not.toThrow();
    expect(repelEv!.data).toMatchObject({
      colonyIndex: 0,
      unbreached: false,
      hiveId: 55,
      species: 'greenSpitter',
    });
  });
});

describe('W07-16 · destruction schema validation: unitDestroyed, faunaKilled, nestDestroyed', () => {
  it('validates schema compliance for unitDestroyed, faunaKilled, and nestDestroyed events', () => {
    const { host, state } = makeW07Host();
    const events: SimEvent[] = [];
    const ctx = makeStepCtx(host, events, 20);

    // 1. Colony unit destroyed
    const reconId = state.meta.nextEntityId++;
    const reconRow = insertRow(state.entities, reconId, 0);
    state.entities.cols.kind[reconRow] = ENTITY_KIND.recon;
    state.entities.cols.owner[reconRow] = 0;
    state.entities.cols.hp[reconRow] = 50;
    state.entities.cols.hpMax[reconRow] = 160;
    placeSpawnedEntity(state.entities, reconRow, 0, 1, 0);

    applyDamage(state, reconId, 100, { attackerId: 999, ctx, tick: 20 });
    const unitEv = events.find((e) => e.kind === 'unitDestroyed');
    expect(unitEv).toBeDefined();
    expect(() => UnitDestroyedDataSchema.parse(unitEv!.data)).not.toThrow();
    expect(unitEv!.data).toMatchObject({
      entityId: reconId,
      unit: 'recon',
      kind: ENTITY_KIND.recon,
      attackerId: 999,
      q: 0,
      r: 1,
    });

    // 2. Fauna killed
    const beetleId = state.meta.nextEntityId++;
    const beetleRow = insertRow(state.entities, beetleId, 0);
    state.entities.cols.kind[beetleRow] = ENTITY_KIND.blueBeetle;
    state.entities.cols.owner[beetleRow] = -1;
    state.entities.cols.hp[beetleRow] = 100;
    state.entities.cols.hpMax[beetleRow] = 200;
    placeSpawnedEntity(state.entities, beetleRow, 4, -2, 0);

    applyDamage(state, beetleId, 300, { attackerId: 1, attackerOwner: 0, ctx, tick: 21 });
    const faunaEv = events.find((e) => e.kind === 'faunaKilled');
    expect(faunaEv).toBeDefined();
    expect(() => FaunaKilledDataSchema.parse(faunaEv!.data)).not.toThrow();
    expect(faunaEv!.data).toMatchObject({
      entityId: beetleId,
      species: 'blueBeetle',
      attackerId: 1,
      q: 4,
      r: -2,
    });

    // 3. Nest destroyed
    const hiveId = state.meta.nextEntityId++;
    const hiveRow = insertRow(state.entities, hiveId, 0);
    state.entities.cols.kind[hiveRow] = ENTITY_KIND.hiveGreenSpitter;
    state.entities.cols.owner[hiveRow] = -1;
    state.entities.cols.hp[hiveRow] = 500;
    state.entities.cols.hpMax[hiveRow] = 2000;
    placeSpawnedEntity(state.entities, hiveRow, 7, -3, 0);

    applyDamage(state, hiveId, 1000, { attackerId: 1, attackerOwner: 0, ctx, tick: 22 });
    const nestEv = events.find((e) => e.kind === 'nestDestroyed');
    expect(nestEv).toBeDefined();
    expect(() => NestDestroyedDataSchema.parse(nestEv!.data)).not.toThrow();
    expect(nestEv!.data).toMatchObject({
      hiveId,
      entityId: hiveId,
      species: 'greenSpitter',
      attackerId: 1,
      q: 7,
      r: -3,
    });
  });
});
