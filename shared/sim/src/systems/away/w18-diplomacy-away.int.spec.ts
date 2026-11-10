import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, createPlanet, SimHost, type SimCommand } from '../../index';
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
  sim.load(createPlanet({ type: 'flat', seed: 'w18-15-away-diplomacy', radius: 6 }));
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
) {
  sim.submit({ colonyIndex: 0, source, commandId, kind, args });
  return sim.step(1).outcomes[0];
}

describe('W18-15 integration — SimHost gateAwayCommand for diplomacy & raids', () => {
  it('allows AI proposeTruce and respondTruce while away, and allows player cancelTruce', () => {
    const sim = bootSim(true, false);

    const proposeOut = submitCmd(
      sim,
      'ai',
      'diplomacy.proposeTruce',
      { targetColonyId: 1, hours: 6 },
      'cm_ai_propose',
    );
    expect(proposeOut?.code).toBeUndefined();

    const respondOut = submitCmd(
      sim,
      'ai',
      'diplomacy.respondTruce',
      { offerId: 'offer_0_1_10', accept: true },
      'cm_ai_respond',
    );
    expect(respondOut?.code).toBeUndefined();

    const playerCancelOut = submitCmd(
      sim,
      'player',
      'diplomacy.cancelTruce',
      { truceId: 'truce_0_1_10' },
      'cm_player_cancel',
    );
    expect(playerCancelOut?.code).toBeUndefined();
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
    );
    expect(aiCancel?.code).toBe('away_policy');
    expect(aiCancel?.detail).toBe('AW-13');

    const botCancel = submitCmd(
      sim,
      'bot',
      'diplomacy.cancelTruce',
      { truceId: 'truce_0_1_10' },
      'cm_bot_cancel',
    );
    expect(botCancel?.code).toBe('away_policy');
    expect(botCancel?.detail).toBe('AW-13');
    expect(awayPolicyRejectionCount('AW-13')).toBe(2);
  });
});

describe('W18-15 integration — raid opt-in & present colony boundaries', () => {
  it('gates AI raid and enqueueTask raid by awayRaids while never permitting AI cancelTruce', () => {
    const sim = bootSim(true, false);

    const raidBlocked = submitCmd(sim, 'ai', 'raid', { targetColonyId: 1 }, 'cm_ai_raid_1');
    expect(raidBlocked?.code).toBe('away_policy');
    expect(raidBlocked?.detail).toBe('AW-11');

    const enqueueRaidBlocked = submitCmd(
      sim,
      'ai',
      'enqueueTask',
      { raid: { targetColonyId: 1 } },
      'cm_ai_enq_raid_1',
    );
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
    );
    expect(enqueueRaidAllowed?.code).not.toBe('away_policy');

    const cancelStillBlocked = submitCmd(
      sim,
      'ai',
      'diplomacy.cancelTruce',
      { truceId: 'truce_0_1_10' },
      'cm_ai_cancel_with_raids',
    );
    expect(cancelStillBlocked?.code).toBe('away_policy');
    expect(cancelStillBlocked?.detail).toBe('AW-13');
    expect(awayPolicyRejectionCount('AW-13')).toBe(1);
  });

  it('allows AI cancelTruce when colony is present (away session closed)', () => {
    const sim = bootSim(false, false);

    const presentCancel = submitCmd(
      sim,
      'ai',
      'diplomacy.cancelTruce',
      { truceId: 'truce_0_1_10' },
      'cm_ai_cancel_present',
    );
    expect(presentCancel?.code).toBeUndefined();
    expect(awayPolicyRejectionCount()).toBe(0);
  });
});
