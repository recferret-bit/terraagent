import { expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  BUILDING_KIND,
  ENTITY_STATE,
  SimHost,
  TICKS_PER_SECOND,
  createState,
  ensureColonyRecord,
  insertRow,
  placeSpawnedEntity,
  spawnHqUnit,
  threatOf,
} from '../../src';

it('W08-09: enforces S3 + 5 min raid start floor: S3 + 4 min -> raidsAllowed=false; S3 + 6 min -> raidsAllowed=true and size=5', () => {
  const host = new SimHost({
    flags: parseWaves('..08'),
  });
  const state = createState({
    planetId: 'pl_w08_09_raids',
    planetType: 'temperate',
    seed: 'w08-09-raids',
    radius: 14,
  });
  const colony = ensureColonyRecord(state, 0, 0);
  colony.status = 'active';
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  host.load(state);

  const facId = state.meta.nextEntityId++;
  const facRow = insertRow(state.entities, facId, 0);
  state.entities.cols.kind[facRow] = BUILDING_KIND.roboticsFactory;
  state.entities.cols.owner[facRow] = 0;
  state.entities.cols.tier[facRow] = 1;
  state.entities.cols.state[facRow] = ENTITY_STATE.idle;
  state.entities.cols.progress[facRow] = 1;
  state.entities.cols.hp[facRow] = 600;
  state.entities.cols.hpMax[facRow] = 600;
  placeSpawnedEntity(state.entities, facRow, 2, 0, 0);

  host.submit({
    commandId: 'cmd_stage_3',
    source: 'dev',
    kind: 'dev.stage',
    colonyIndex: 0,
    args: { op: 'set', stage: 3 },
  });
  host.step(1);

  host.step(4 * 60 * TICKS_PER_SECOND);
  const at4Min = threatOf(host.state, 0);
  expect(at4Min.threatStage).toBe(3);
  expect(at4Min.raidsAllowed).toBe(false);

  host.step(2 * 60 * TICKS_PER_SECOND);
  const at6Min = threatOf(host.state, 0);
  expect(at6Min.threatStage).toBe(3);
  expect(at6Min.raidsAllowed).toBe(true);
  expect(at6Min.raidSize).toBe(5);
  expect(at6Min.size).toBe(5);
  expect(at6Min.composition).toEqual({
    tier: 'skitters',
    skitters: 5,
    brutes: 0,
    drifterFlocks: 0,
  });
});

it('W08-09: enforces S2 + 10 min meteor floor: S2 + 9 min -> meteorsAllowed=false; S2 + 10 min -> meteorsAllowed=true', () => {
  const host = new SimHost({
    flags: parseWaves('..08'),
  });
  const state = createState({
    planetId: 'pl_w08_09_meteors',
    planetType: 'temperate',
    seed: 'w08-09-meteors',
    radius: 14,
  });
  const colony = ensureColonyRecord(state, 0, 0);
  colony.status = 'active';
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  host.load(state);

  host.submit({
    commandId: 'cmd_stage_2',
    source: 'dev',
    kind: 'dev.stage',
    colonyIndex: 0,
    args: { op: 'set', stage: 2 },
  });
  host.step(1);

  host.step(9 * 60 * TICKS_PER_SECOND);
  expect(threatOf(host.state, 0).meteorsAllowed).toBe(false);

  host.step(1 * 60 * TICKS_PER_SECOND);
  expect(threatOf(host.state, 0).meteorsAllowed).toBe(true);
});

it('W08-09: scales raid size with thermalGenerators (capped at 12) and updates composition for S6-S7 Brutes and S8+ Drifters', () => {
  const s6 = threatOf({
    stage: 6,
    threatStage: 6,
    timeInS3S: 6 * 60,
    thermalGenerators: 2,
  });
  expect(s6.raidsAllowed).toBe(true);
  expect(s6.raidSize).toBe(10);
  expect(s6.composition).toEqual({
    tier: 'skitters_and_brutes',
    skitters: 8,
    brutes: 2,
    drifterFlocks: 0,
  });

  const s8 = threatOf({
    stage: 8,
    threatStage: 8,
    timeInS3S: 10 * 60,
    thermalGenerators: 5,
  });
  expect(s8.raidSize).toBe(12);
  expect(s8.composition).toEqual({
    tier: 'drifter_flock',
    skitters: 9,
    brutes: 3,
    drifterFlocks: 1,
  });
});

it('W08-09: enforces newcomer raid protection (< S6 and < 6 h old unless colony attacks first)', () => {
  expect(threatOf({ stage: 3, threatStage: 3, ageS: 2 * 3600, startedRaid: false }).raidProtected).toBe(true);
  expect(threatOf({ stage: 6, threatStage: 6, ageS: 2 * 3600, startedRaid: false }).raidProtected).toBe(false);
  expect(threatOf({ stage: 3, threatStage: 3, ageS: 6 * 3600, startedRaid: false }).raidProtected).toBe(false);
  expect(threatOf({ stage: 3, threatStage: 3, ageS: 600, startedRaid: true }).raidProtected).toBe(false);
});
