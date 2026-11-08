import { describe, expect, it } from 'vitest';
import {
  BuildingDestroyedDataSchema,
  FaunaKilledDataSchema,
  NestDestroyedDataSchema,
  parseWaves,
  UnitDestroyedDataSchema,
} from '@terra/contracts';
import {
  applyDamage,
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getFootprintTileIndices,
  getUnitCommand,
  hexDistance,
  hexIndex,
  insertRow,
  issueUnitCommand,
  placeSpawnedEntity,
  PREP,
  rowOf,
  SimHost,
  spawnHqUnit,
  startBuildingConstruction,
  stepHqSelfRepair,
  TERRAIN,
  type SimEvent,
  type StepContext,
} from '../../src';

function makeW07Host(radius = 16) {
  const flags = parseWaves('..07');
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-w07-dmg', planetType: 'temperate', seed: 'w07-dmg', radius });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.wild);
  const colony = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  colony.status = 'active';
  colony.stock['metals.t1'] = 600;
  colony.stock['minerals.t1'] = 500;
  colony.stock['bio.biomass'] = 500;
  colony.stock['bio.water'] = 500;
  host.load(state);
  return { host, state, pipeline };
}

function makeStepCtx(host: SimHost, events: SimEvent[] = []): StepContext {
  const tick = host.tick + 1;
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

describe('W07-02 · unit damage and destruction', () => {
  it('reduces unit HP on non-lethal damage and removes the unit at <= 0 HP, emitting unitDestroyed / faunaKilled', () => {
    const { host, state } = makeW07Host();
    const events: SimEvent[] = [];
    const ctx = makeStepCtx(host, events);

    const reconId = state.meta.nextEntityId++;
    const reconRow = insertRow(state.entities, reconId, 0);
    state.entities.cols.kind[reconRow] = ENTITY_KIND.recon;
    state.entities.cols.owner[reconRow] = 0;
    state.entities.cols.hp[reconRow] = 160;
    state.entities.cols.hpMax[reconRow] = 160;
    placeSpawnedEntity(state.entities, reconRow, 2, -1, 0);

    const harvId = state.meta.nextEntityId++;
    const harvRow = insertRow(state.entities, harvId, 0);
    state.entities.cols.kind[harvRow] = ENTITY_KIND.worker;
    state.entities.cols.owner[harvRow] = 0;
    state.entities.cols.hp[harvRow] = 350;
    state.entities.cols.hpMax[harvRow] = 350;
    placeSpawnedEntity(state.entities, harvRow, 3, -1, 0);

    const hit1 = applyDamage(state, reconId, 60, { attackerId: 99, ctx });
    expect(hit1).toEqual({
      applied: 60,
      hpAfter: 100,
      destroyed: false,
      clampedHq: false,
      retreatedHq: false,
    });
    expect(rowOf(state.entities, reconId)).toBeGreaterThanOrEqual(0);
    expect(events).toHaveLength(0);

    const hit2 = applyDamage(state, reconId, 120, { attackerId: 99, ctx });
    expect(hit2).toEqual({
      applied: 100,
      hpAfter: 0,
      destroyed: true,
      clampedHq: false,
      retreatedHq: false,
    });
    expect(rowOf(state.entities, reconId)).toBe(-1);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('unitDestroyed');
    expect(() => UnitDestroyedDataSchema.parse(events[0]?.data)).not.toThrow();
    expect(events[0]?.data).toMatchObject({
      entityId: reconId,
      unit: 'recon',
      kind: ENTITY_KIND.recon,
      attackerId: 99,
      q: 2,
      r: -1,
    });

    const hitHarv = applyDamage(state, harvId, 500, { ctx });
    expect(hitHarv.destroyed).toBe(true);
    expect(rowOf(state.entities, harvId)).toBe(-1);

    const antId = state.meta.nextEntityId++;
    const antRow = insertRow(state.entities, antId, 0);
    state.entities.cols.kind[antRow] = ENTITY_KIND.blackAnt;
    state.entities.cols.owner[antRow] = -1;
    state.entities.cols.hp[antRow] = 120;
    state.entities.cols.hpMax[antRow] = 120;
    placeSpawnedEntity(state.entities, antRow, 5, 2, 0);

    const hitAnt = applyDamage(state, antId, 150, { attackerId: 1, attackerOwner: 0, ctx });
    expect(hitAnt.destroyed).toBe(true);
    expect(rowOf(state.entities, antId)).toBe(-1);
    const faunaEv = events.find((e) => e.kind === 'faunaKilled');
    expect(faunaEv).toBeDefined();
    expect(() => FaunaKilledDataSchema.parse(faunaEv?.data)).not.toThrow();
    expect(faunaEv?.data).toMatchObject({
      entityId: antId,
      species: 'blackAnt',
      attackerId: 1,
      q: 5,
      r: 2,
    });
  });
});

describe('W07-02 · building destruction leaves Prepared ground (UO-TF-04)', () => {
  it('destroys a building at <= 0 HP, removes it, and leaves all footprint tiles Prepared, never bare terrain', () => {
    const { host, state } = makeW07Host();
    const events: SimEvent[] = [];
    const ctx = makeStepCtx(host, events);
    const idx = hexIndex(state.grid.radius);

    const solarRes = startBuildingConstruction(state, {
      owner: 0,
      building: 'solar',
      q: 4,
      r: 0,
      instant: true,
      costOverride: {},
    });
    expect(solarRes.ok).toBe(true);
    const solarId = solarRes.ok ? solarRes.entityId : -1;
    const solarFp = getFootprintTileIndices(state, 4, 0, 2, 2, 0);
    expect(solarFp.indices).toHaveLength(4);
    for (const tileIdx of solarFp.indices) {
      state.grid.layers.prep[tileIdx] = PREP.wild;
    }

    const facId = state.meta.nextEntityId++;
    const facRow = insertRow(state.entities, facId, 0);
    state.entities.cols.kind[facRow] = ENTITY_KIND.roboticsFactory;
    state.entities.cols.owner[facRow] = 0;
    state.entities.cols.footprintW[facRow] = 3;
    state.entities.cols.footprintD[facRow] = 3;
    state.entities.cols.hp[facRow] = 800;
    state.entities.cols.hpMax[facRow] = 800;
    state.entities.cols.state[facRow] = ENTITY_STATE.active;
    placeSpawnedEntity(state.entities, facRow, -4, 2, 0);
    const facFp = getFootprintTileIndices(state, -4, 2, 3, 3, 0);
    expect(facFp.indices).toHaveLength(9);

    const epochBefore = state.meta.pathEpoch ?? 0;

    const resSolar = applyDamage(state, solarId, 999, { attackerId: 77, ctx });
    expect(resSolar.destroyed).toBe(true);
    expect(resSolar.hpAfter).toBe(0);
    expect(rowOf(state.entities, solarId)).toBe(-1);
    for (const tileIdx of solarFp.indices) {
      expect(state.grid.layers.prep[tileIdx]).toBe(PREP.prepared);
    }
    expect(state.meta.pathEpoch).toBeGreaterThan(epochBefore);

    const resFac = applyDamage(state, facId, 800, { attackerId: 77, ctx });
    expect(resFac.destroyed).toBe(true);
    expect(rowOf(state.entities, facId)).toBe(-1);
    for (const tileIdx of facFp.indices) {
      expect(state.grid.layers.prep[tileIdx]).toBe(PREP.prepared);
    }

    const bEvents = events.filter((e) => e.kind === 'buildingDestroyed');
    expect(bEvents).toHaveLength(2);
    for (const ev of bEvents) {
      expect(() => BuildingDestroyedDataSchema.parse(ev.data)).not.toThrow();
    }
    expect(bEvents[0]?.data).toMatchObject({ entityId: solarId, building: 'solar', q: 4, r: 0 });
    expect(bEvents[1]?.data).toMatchObject({ entityId: facId, building: 'roboticsFactory', q: -4, r: 2 });

    const hiveId = state.meta.nextEntityId++;
    const hiveRow = insertRow(state.entities, hiveId, 0);
    state.entities.cols.kind[hiveRow] = ENTITY_KIND.hiveBlackAnt;
    state.entities.cols.owner[hiveRow] = -1;
    state.entities.cols.hp[hiveRow] = 1500;
    state.entities.cols.hpMax[hiveRow] = 1500;
    placeSpawnedEntity(state.entities, hiveRow, 8, -4, 0);
    const hiveTileIdx = idx.indexOf(8, -4);

    const resHive = applyDamage(state, hiveId, 1500, { attackerId: 1, attackerOwner: 0, ctx });
    expect(resHive.destroyed).toBe(true);
    expect(rowOf(state.entities, hiveId)).toBe(-1);
    expect(state.grid.layers.prep[hiveTileIdx]).toBe(PREP.wild);
    const nestEv = events.find((e) => e.kind === 'nestDestroyed');
    expect(nestEv).toBeDefined();
    expect(() => NestDestroyedDataSchema.parse(nestEv?.data)).not.toThrow();
    expect(nestEv?.data).toMatchObject({ hiveId, species: 'blackAnt', q: 8, r: -4 });
  });
});

describe('W07-02 · HQ survival, retreat below 40% HP, and 1%/s self-repair (UO-HQ-03)', () => {
  it('clamps HQ at 1 HP on lethal damage, drops work orders, retreats to the nearest Hub/pod below 40% HP, and self-repairs at 1% max HP/s out of combat', () => {
    const { host, state } = makeW07Host();
    const idx = hexIndex(state.grid.radius);

    for (let q = -4; q <= 10; q++) {
      for (let r = -4; r <= 4; r++) {
        const ti = idx.indexOf(q, r);
        if (ti >= 0) {
          state.grid.layers.terrain[ti] = TERRAIN.flat;
          state.grid.layers.prep[ti] = PREP.prepared;
          state.grid.layers.owner[ti] = 0;
        }
      }
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

    const hqId = spawnHqUnit(state, { owner: 0, q: 8, r: 0 });
    const hqRow = rowOf(state.entities, hqId);
    state.entities.cols.hp[hqRow] = 600;
    state.entities.cols.hpMax[hqRow] = 600;

    const forestIdx = idx.indexOf(9, 0);
    state.grid.layers.terrain[forestIdx] = TERRAIN.forest;
    state.grid.layers.prep[forestIdx] = PREP.wild;
    host.submit({
      commandId: 'tf-hq-work',
      colonyIndex: 0,
      source: 'player',
      kind: 'enqueueTask',
      args: { terraform: { op: 'clear', tiles: [{ q: 9, r: 0 }] } },
    });
    host.step(2);
    expect(getUnitCommand(state, hqId)?.kind).toBe('terraform');

    const ctx1 = makeStepCtx(host);
    const dmg35 = applyDamage(state, hqId, 390, { tick: host.tick, ctx: ctx1 });
    expect(dmg35).toEqual({
      applied: 390,
      hpAfter: 210,
      destroyed: false,
      clampedHq: false,
      retreatedHq: true,
    });
    expect(getUnitCommand(state, hqId)).toMatchObject({
      kind: 'move',
      q: 0,
      r: 0,
    });
    expect(state.entities.cols.state[hqRow]).toBe(ENTITY_STATE.moving);

    const distBefore = hexDistance(state.entities.cols.x[hqRow], state.entities.cols.y[hqRow], 0, 0);
    host.step(10);
    const distAfter = hexDistance(state.entities.cols.x[hqRow], state.entities.cols.y[hqRow], 0, 0);
    expect(distAfter).toBeLessThan(distBefore);

    const lethal = applyDamage(state, hqId, 9999, { tick: host.tick, ctx: makeStepCtx(host) });
    expect(lethal.destroyed).toBe(false);
    expect(lethal.clampedHq).toBe(true);
    expect(lethal.hpAfter).toBe(1);
    expect(rowOf(state.entities, hqId)).toBe(hqRow);
    expect(state.entities.cols.hp[hqRow]).toBe(1);

    stepHqSelfRepair(state, { tick: host.tick, dt: 1, data: host['pipeline'].config.data });
    expect(state.entities.cols.hp[hqRow]).toBe(1);

    host.step(5);
    expect(state.entities.cols.hp[hqRow]).toBeCloseTo(7, 4);

    host.step(10);
    expect(state.entities.cols.hp[hqRow]).toBeCloseTo(19, 4);
  });
});

describe('W07-02 · godMode immunity and attackCommand integration', () => {
  it('respects colony godMode in applyDamage and integrates with attackCommand under W07', () => {
    const { host, state } = makeW07Host();
    const ctx = makeStepCtx(host);

    const hq0 = spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
    const targetId = state.meta.nextEntityId++;
    const targetRow = insertRow(state.entities, targetId, 0);
    state.entities.cols.kind[targetRow] = ENTITY_KIND.recon;
    state.entities.cols.owner[targetRow] = 1;
    state.entities.cols.hp[targetRow] = 10;
    state.entities.cols.hpMax[targetRow] = 160;
    placeSpawnedEntity(state.entities, targetRow, 2, 0, 0);

    (state.colonies[0] as { godMode?: boolean }).godMode = true;
    const blocked = applyDamage(state, hq0, 500, { ctx });
    expect(blocked.applied).toBe(0);

    expect(issueUnitCommand(state, rowOf(state.entities, hq0), { kind: 'attack', source: 'player', targetId }, ctx)).toBeUndefined();
    host.step(5);
    expect(rowOf(state.entities, targetId)).toBe(-1);
  });
});
