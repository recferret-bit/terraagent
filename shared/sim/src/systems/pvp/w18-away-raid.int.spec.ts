import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  getUnitGroupId,
  insertRow,
  placeSpawnedEntity,
  SimHost,
} from '../../index';
import { applyAutopilot, openAwaySession } from '../away';

function bootAwayRaidSim() {
  const sim = new SimHost({ flags: parseWaves('..18') });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-16-int-seed', radius: 28 }));
  const state = sim.state;

  const col0 = ensureColonyRecord(state, 0, 0);
  col0.id = 'col_0';
  col0.status = 'active';
  col0.stage = 4;

  const col1 = ensureColonyRecord(state, 1, 0);
  col1.id = 'col_1';
  col1.status = 'active';
  col1.stage = 4;

  const hub0 = state.meta.nextEntityId++;
  const h0Row = insertRow(state.entities, hub0, 0);
  state.entities.cols.kind[h0Row] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[h0Row] = 0;
  state.entities.cols.hp[h0Row] = 1500;
  state.entities.cols.hpMax[h0Row] = 1500;
  state.entities.cols.state[h0Row] = ENTITY_STATE.active;

  const reconId = state.meta.nextEntityId++;
  const rRow = insertRow(state.entities, reconId, 0);
  state.entities.cols.kind[rRow] = ENTITY_KIND.recon;
  state.entities.cols.owner[rRow] = 0;
  placeSpawnedEntity(state.entities, rRow, 2, 0, 0);
  state.entities.cols.hp[rRow] = 220;
  state.entities.cols.hpMax[rRow] = 220;
  state.entities.cols.state[rRow] = ENTITY_STATE.idle;

  const hub1 = state.meta.nextEntityId++;
  const h1Row = insertRow(state.entities, hub1, 0);
  state.entities.cols.kind[h1Row] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[h1Row] = 1;
  placeSpawnedEntity(state.entities, h1Row, 10, 0, 0);
  state.entities.cols.hp[h1Row] = 1500;
  state.entities.cols.hpMax[h1Row] = 1500;
  state.entities.cols.state[h1Row] = ENTITY_STATE.active;

  return { sim, state, reconId };
}

describe('W18-16 · SimHost integration: AI raid awayPolicy (AW-11)', () => {
  it('Away with awayRaids=false, AI raid / enqueueTask(raid) / queueGoal(raid_target) → rejected away_policy; with awayRaids=true → raid starts', () => {
    const { sim, state, reconId } = bootAwayRaidSim();
    applyAutopilot(state, 0, {}, undefined, 0);
    openAwaySession(state, 0, 'col_0', { metals: 100, minerals: 100, bio: 100 }, 0);
    sim.step(1);

    // 1. AI raid while awayRaids=false -> rejected away_policy
    sim.submit({
      commandId: 'cmd_ai_raid_deny',
      colonyIndex: 0,
      source: 'ai',
      kind: 'raid',
      args: { targetColonyIndex: 1 },
    });
    const denyStep1 = sim.step(1);
    expect(denyStep1.outcomes[0]?.code).toBe('away_policy');
    expect(getUnitGroupId(state, reconId)).toBeNull();

    // 2. AI enqueueTask(raid) while awayRaids=false -> rejected away_policy
    sim.submit({
      commandId: 'cmd_ai_enq_raid_deny',
      colonyIndex: 0,
      source: 'ai',
      kind: 'enqueueTask',
      args: { task: { kind: 'raid', targetColonyIndex: 1 } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('away_policy');

    // 3. AI queueGoal(raid_target) while awayRaids=false -> rejected away_policy
    sim.submit({
      commandId: 'cmd_ai_goal_raid_deny',
      colonyIndex: 0,
      source: 'ai',
      kind: 'queueGoal',
      args: { goal: 'raid_target', params: { targetColonyId: 1 } },
    });
    expect(sim.step(1).outcomes[0]?.code).toBe('away_policy');

    // 4. Enable awayRaids=true -> AI raid starts and dispatches units!
    applyAutopilot(state, 0, { awayRaids: true }, undefined, sim.tick);
    openAwaySession(state, 0, 'col_0', { metals: 100, minerals: 100, bio: 100 }, sim.tick);
    sim.submit({
      commandId: 'cmd_ai_raid_allow',
      colonyIndex: 0,
      source: 'ai',
      kind: 'raid',
      args: { targetColonyIndex: 1 },
    });
    const allowStep = sim.step(1);
    expect(allowStep.outcomes[0]?.code).toBeUndefined();
    expect(allowStep.events.some((e) => e.kind === 'raidStarted')).toBe(true);
    expect(getUnitGroupId(state, reconId)).toBe(1);
  });

  it('player raid stays exempt even when colony is away with awayRaids=false', () => {
    const { sim, state, reconId } = bootAwayRaidSim();
    applyAutopilot(state, 0, {}, undefined, 0);
    openAwaySession(state, 0, 'col_0', { metals: 100, minerals: 100, bio: 100 }, 0);
    sim.step(1);

    sim.submit({
      commandId: 'cmd_player_raid_exempt',
      colonyIndex: 0,
      source: 'player',
      kind: 'raid',
      args: { targetColonyIndex: 1 },
    });
    const stepRes = sim.step(1);
    expect(stepRes.outcomes[0]?.code).toBeUndefined();
    expect(getUnitGroupId(state, reconId)).toBe(1);
  });
});
