import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  compileData,
  createPlanet,
  ensureColonyRecord,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  placeSpawnedEntity,
  SimHost,
  type SimCommand,
} from '../../index';
import { markColonyContact } from '../diplomacy';
import {
  applyAutopilot,
  awayPolicyRejectionCount,
  openAwaySession,
  readAwaySettings,
  resetAwayPolicyRejections,
} from './index';

const COLONY_ID = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function bootSim(away = true, awayRaids = false): SimHost {
  resetAwayPolicyRejections();
  const sim = new SimHost({ flags: parseWaves('..18') });
  sim.load(createPlanet({ type: 'flat', seed: 'w18-15-away-diplomacy', radius: 12 }));
  for (const idx of [0, 1]) {
    const col = ensureColonyRecord(sim.state, idx, sim.tick);
    col.status = 'active';
    const r = insertRow(sim.state.entities, sim.state.meta.nextEntityId++, sim.tick);
    sim.state.entities.cols.kind[r] = ENTITY_KIND.hq;
    sim.state.entities.cols.owner[r] = idx;
    sim.state.entities.cols.tier[r] = 1;
    sim.state.entities.cols.hp[r] = 500;
    sim.state.entities.cols.hpMax[r] = 500;
    sim.state.entities.cols.state[r] = ENTITY_STATE.idle;
    placeSpawnedEntity(sim.state.entities, r, idx * 8, 0, sim.tick);
  }
  markColonyContact(sim.state, 0, 1, sim.tick);
  sim.submit({
    colonyIndex: 0,
    source: 'player',
    commandId: 'cm_autopilot_init',
    kind: 'setAutopilot',
    args: { mode: 'director', awayRaids },
  });
  sim.step(1);
  if (away) {
    openAwaySession(sim.state, 0, COLONY_ID, { metals: 200, minerals: 200, bio: 200 }, sim.tick);
  }
  return sim;
}

function submitCmd(
  sim: SimHost,
  source: SimCommand['source'],
  kind: string,
  args: unknown,
  commandId: string,
  colonyIndex = 0,
) {
  sim.submit({ colonyIndex, source, commandId, kind, args });
  return sim.step(1);
}

describe('W18-15 integration — SimHost gateAwayCommand for diplomacy & raids', () => {
  it('allows AI proposeTruce and respondTruce while away, and allows player cancelTruce', () => {
    const sim = bootSim(true, false);

    const proposeStep = submitCmd(
      sim,
      'ai',
      'diplomacy.proposeTruce',
      { targetColonyId: 1, hours: 6 },
      'cm_ai_propose',
    );
    expect(proposeStep.outcomes[0]?.code).toBeUndefined();

    submitCmd(sim, 'dev', 'dev.offerTruce', { fromColony: 1, toColony: 0, hours: 6 }, 'cm_dev_of');
    const respondStep = submitCmd(
      sim,
      'ai',
      'diplomacy.respondTruce',
      { offerId: 'of_2', accept: true },
      'cm_ai_respond',
    );
    expect(respondStep.outcomes[0]?.code).toBeUndefined();

    const playerCancelStep = submitCmd(
      sim,
      'player',
      'diplomacy.cancelTruce',
      { truceId: 'tr_1' },
      'cm_player_cancel',
    );
    expect(playerCancelStep.outcomes[0]?.code).toBeUndefined();
    expect(awayPolicyRejectionCount('AW-13')).toBe(0);
  });

  it('rejects AI and bot cancelTruce while away with away_policy (AW-13) and increments counter', () => {
    const sim = bootSim(true, false);

    const aiCancel = submitCmd(
      sim,
      'ai',
      'diplomacy.cancelTruce',
      { truceId: 'truce_0_1_10' },
      'cm_ai_cancel',
    ).outcomes[0];
    expect(aiCancel?.code).toBe('away_policy');
    expect(aiCancel?.detail).toBe('AW-13');

    const botCancel = submitCmd(
      sim,
      'bot',
      'diplomacy.cancelTruce',
      { truceId: 'truce_0_1_10' },
      'cm_bot_cancel',
    ).outcomes[0];
    expect(botCancel?.code).toBe('away_policy');
    expect(botCancel?.detail).toBe('AW-13');
    expect(awayPolicyRejectionCount('AW-13')).toBe(2);
  });
});

describe('W18-15 integration — raid opt-in & present colony boundaries', () => {
  it('gates AI raid and enqueueTask raid by awayRaids while never permitting AI cancelTruce', () => {
    const sim = bootSim(true, false);

    const raidBlocked = submitCmd(sim, 'ai', 'raid', { targetColonyId: 1 }, 'cm_ai_raid_1').outcomes[0];
    expect(raidBlocked?.code).toBe('away_policy');
    expect(raidBlocked?.detail).toBe('AW-11');

    const enqueueRaidBlocked = submitCmd(
      sim,
      'ai',
      'enqueueTask',
      { raid: { targetColonyId: 1 } },
      'cm_ai_enq_raid_1',
    ).outcomes[0];
    expect(enqueueRaidBlocked?.code).toBe('away_policy');
    expect(enqueueRaidBlocked?.detail).toBe('AW-11');
    expect(awayPolicyRejectionCount('AW-11')).toBe(2);

    applyAutopilot(sim.state, 0, { awayRaids: true }, compileData(parseWaves('..18')), sim.tick);
    expect(readAwaySettings(sim.state, 0)?.awayRaids).toBe(true);

    const enqueueRaidAllowed = submitCmd(
      sim,
      'ai',
      'enqueueTask',
      { raid: { targetColonyId: 1 } },
      'cm_ai_enq_raid_2',
    ).outcomes[0];
    expect(enqueueRaidAllowed?.code).not.toBe('away_policy');

    const cancelStillBlocked = submitCmd(
      sim,
      'ai',
      'diplomacy.cancelTruce',
      { truceId: 'truce_0_1_10' },
      'cm_ai_cancel_with_raids',
    ).outcomes[0];
    expect(cancelStillBlocked?.code).toBe('away_policy');
    expect(cancelStillBlocked?.detail).toBe('AW-13');
    expect(awayPolicyRejectionCount('AW-13')).toBe(1);
  });

  it('still blocks AI cancelTruce when colony is present (AW-13), while allowing player cancelTruce', () => {
    const sim = bootSim(false, false);
    submitCmd(sim, 'dev', 'dev.offerTruce', { fromColony: 1, toColony: 0, hours: 6 }, 'cm_dev_of_pres');
    submitCmd(sim, 'ai', 'diplomacy.respondTruce', { offerId: 'of_1', accept: true }, 'cm_ai_acc_pres');

    const presentAiCancel = submitCmd(
      sim,
      'ai',
      'diplomacy.cancelTruce',
      { truceId: 'tr_1' },
      'cm_ai_cancel_present',
    ).outcomes[0];
    expect(presentAiCancel?.code).toBe('away_policy');
    expect(presentAiCancel?.detail).toBe('AW-13');
    expect(awayPolicyRejectionCount('AW-13')).toBe(1);

    const presentPlayerCancel = submitCmd(
      sim,
      'player',
      'diplomacy.cancelTruce',
      { truceId: 'tr_1' },
      'cm_player_cancel_present',
    ).outcomes[0];
    expect(presentPlayerCancel?.code).toBeUndefined();
    expect(awayPolicyRejectionCount('AW-13')).toBe(1);
  });
});
