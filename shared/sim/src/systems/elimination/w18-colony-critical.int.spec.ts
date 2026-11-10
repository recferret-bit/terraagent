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
  insertRow,
  PREP,
  queueColonyGoal,
  SimHost,
  spawnHqUnit,
  startBuildingConstruction,
  TERRAIN,
} from '../../index';
import { getColonyEliminationRecord } from './store';

function createW18CriticalHost(waves = '..18') {
  const flags = parseWaves(waves);
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createState({
    planetId: 'pl-w18-08-int',
    planetType: 'temperate',
    seed: 'w18-08-int',
    radius: 16,
  });
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
  state.entities.cols.q[hubRow] = 0;
  state.entities.cols.r[hubRow] = 0;
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

describe('W18-08 · Colony Critical SimHost integration tests', () => {
  it('destroys Hub via dev.killHub -> emits colonyCritical (10-min timer) + inserts Re-establish goal -> rebuilding Hub clears timer', () => {
    const { host, state } = createW18CriticalHost('..18');
    queueColonyGoal(state, 0, { goal: 'secure_power' }, 0);

    host.submit({
      commandId: 'kill-hub-1',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHub',
      args: {},
    });
    const killStep = host.step(1);
    expect(killStep.outcomes[0]?.code).toBeUndefined();
    expect(state.colonies[0]?.status).toBe('critical');

    const critEv = killStep.events.find((e) => e.kind === 'colonyCritical');
    expect(critEv).toBeDefined();
    expect(critEv?.data).toMatchObject({
      colonyIndex: 0,
      remainingSeconds: 600,
      durationSeconds: 600,
    });

    const rec = getColonyEliminationRecord(state, 0);
    expect(rec?.criticalDeadlineTick).toBe(3001);

    const goalsAfterKill = getColonyGoals(state, 0);
    expect(goalsAfterKill[0]?.goal).toBe('establish_colony');
    expect(goalsAfterKill[0]?.status).toBe('active');
    expect((goalsAfterKill[0]?.params as Record<string, unknown>)?.reestablish).toBe(true);

    // Rebuild Command Hub on unclaimed tiles at (6, 0)
    const built = startBuildingConstruction(state, {
      owner: 0,
      building: 'commandHub',
      q: 6,
      r: 0,
      instant: true,
      tick: host.tick,
    });
    expect(built.ok).toBe(true);

    host.step(1);
    expect(state.colonies[0]?.status).toBe('active');
    expect(getColonyEliminationRecord(state, 0)?.criticalDeadlineTick).toBeUndefined();
    const goalsAfterRebuild = getColonyGoals(state, 0);
    expect(goalsAfterRebuild.find((g) => g.goal === 'establish_colony')?.status).toBe('done');
    expect(goalsAfterRebuild.find((g) => g.goal === 'secure_power')?.status).toBe('active');
  });

  it('rejects dev.killHub with wave_disabled on ..17 and invalid_target when Hub is already down', () => {
    const pre = createW18CriticalHost('..17');
    pre.host.submit({
      commandId: 'kill-hub-pre',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHub',
      args: {},
    });
    const preStep = pre.host.step(1);
    expect(preStep.outcomes[0]?.code).toBe('wave_disabled');

    const w18 = createW18CriticalHost('..18');
    w18.host.submit({
      commandId: 'kill-hub-1',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHub',
      args: {},
    });
    w18.host.step(1);

    w18.host.submit({
      commandId: 'kill-hub-2',
      colonyIndex: 0,
      source: 'dev',
      kind: 'dev.killHub',
      args: {},
    });
    const secondStep = w18.host.step(1);
    expect(secondStep.outcomes[0]?.code).toBe('invalid_target');
  });
});
