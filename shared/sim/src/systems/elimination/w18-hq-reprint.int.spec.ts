import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  ensureColonyLedger,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getColonyGoals,
  getColonyQueue,
  insertRow,
  placeSpawnedEntity,
  PREP,
  queueColonyGoal,
  rowOf,
  SimHost,
  spawnHqUnit,
  TERRAIN,
} from '../../index';
import { colonyHasAliveHq, getColonyEliminationRecord } from './store';

function createW18Host(waves = '..18') {
  const flags = parseWaves(waves);
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({ planetId: 'pl-w18-07-int', planetType: 'temperate', seed: 'w18-07-int', radius: 14 });
  state.grid.layers.terrain.fill(TERRAIN.flat);
  state.grid.layers.prep.fill(PREP.prepared);

  const col = ensureColonyLedger(ensureColonyRecord(state, 0, 0));
  col.status = 'active';
  col.stock['metals.t1'] = 600;
  col.stock['minerals.t1'] = 600;
  col.stock['bio.biomass'] = 300;
  col.stock['bio.water'] = 300;

  const hubId = state.meta.nextEntityId++;
  const hubRow = insertRow(state.entities, hubId, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  placeSpawnedEntity(state.entities, hubRow, 0, 0, 0);
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.hpMax[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  col.hubEntityId = hubId;

  const hqId = spawnHqUnit(state, { owner: 0, q: 4, r: 0, tick: 0 });
  host.load(state);
  return { host, state, hubId, hqId };
}

describe('W18-07 · HQ destruction & reprint SimHost integration tests', () => {
  it('destroys HQ via dev.killHq, pauses active HQ goal, completes 60s reprint at Hub edge, and resumes goal', () => {
    const { host, state, hqId } = createW18Host('..18');

    queueColonyGoal(state, 0, { goal: 'secure_power' }, 0);
    host.submit({
      commandId: 'kill-hq-1',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHq',
      args: {},
    });
    const stepKill = host.step(1);
    expect(stepKill.outcomes[0]?.code).toBeUndefined();
    expect(rowOf(state.entities, hqId)).toBe(-1);
    expect(colonyHasAliveHq(state, 0)).toBe(false);
    expect(stepKill.events.some((e) => e.kind === 'unitDestroyed' && e.data?.unit === 'hq')).toBe(true);

    const unitsQueue = getColonyQueue(state, 0, 'units');
    expect(unitsQueue.length).toBe(1);
    expect(unitsQueue[0].task).toEqual({ kind: 'buildUnit', unit: 'hq', tier: 1, count: 1 });
    expect(unitsQueue[0].buildTicks).toBe(300);

    // Goal is paused while HQ is down
    expect((getColonyGoals(state, 0)[0] as unknown as { paused?: boolean }).paused).toBe(true);

    // Advance 299 ticks -> still reprinting
    host.step(298);
    expect(colonyHasAliveHq(state, 0)).toBe(false);

    // Advance 2 more ticks -> 60s (300 ticks) elapsed, new T1 HQ spawns at Hub edge
    const finishRes = host.step(2);
    expect(colonyHasAliveHq(state, 0)).toBe(true);
    expect(getColonyEliminationRecord(state, 0)?.hqDown).toBe(false);
    expect(finishRes.events.some((e) => e.kind === 'unitProduced' && e.data?.unit === 'hq')).toBe(true);
    expect((getColonyGoals(state, 0)[0] as unknown as { paused?: boolean }).paused).toBeUndefined();

    // Deducted 200 metals, 100 minerals, 50 biomass, 50 water
    const stock = (state.colonies[0]?.stock ?? {}) as Record<string, number>;
    expect(stock['metals.t1']).toBeCloseTo(400, 3);
    expect(stock['minerals.t1']).toBeCloseTo(500, 3);
    expect(stock['bio.biomass']).toBeCloseTo(250, 3);
    expect(stock['bio.water']).toBeCloseTo(250, 3);

    // Destroy the reprinted HQ within 10 min -> queues 90s (450 ticks) reprint
    host.submit({
      commandId: 'kill-hq-2',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHq',
      args: {},
    });
    host.step(1);
    const secondQueue = getColonyQueue(state, 0, 'units');
    expect(secondQueue.length).toBe(1);
    expect(secondQueue[0].buildTicks).toBe(450);
  });

  it('rejects dev.killHq with wave_disabled on ..17 and invalid_target when HQ is already down', () => {
    const pre = createW18Host('..17');
    pre.host.submit({
      commandId: 'kill-hq-pre',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHq',
      args: {},
    });
    const preRes = pre.host.step(1);
    expect(preRes.outcomes[0]?.code).toBe('wave_disabled');
    expect(colonyHasAliveHq(pre.state, 0)).toBe(true);

    const w18 = createW18Host('..18');
    w18.host.submit({
      commandId: 'kill-hq-first',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHq',
      args: {},
    });
    w18.host.step(1);

    w18.host.submit({
      commandId: 'kill-hq-missing',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHq',
      args: {},
    });
    const secondKill = w18.host.step(1);
    expect(secondKill.outcomes[0]?.code).toBe('invalid_target');
  });
});
