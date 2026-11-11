import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  createPlanet,
  createRegistryPipeline,
  getOpenColonyGoals,
  hasActiveTruce,
  isColonyRaidProtected,
  isRivalAiColony,
  proposeTruce,
  readDiplomacyBlob,
  respondTruce,
  seedRivalAiColonies,
  shouldAiGovernColony,
  SimHost,
  stepColonyAutonomousGovernor,
} from '../../src';
import { awayPolicyRejectionCount, resetAwayPolicyRejections } from '../../src/systems/away';

function createW22Host() {
  const flags = parseWaves('..22').list;
  const pipeline = createRegistryPipeline({ flags });
  const host = new SimHost(pipeline);
  const state = createPlanet({
    id: 'pl_rivals',
    planetId: 'pl_rivals',
    type: 'temperate',
    planetType: 'temperate',
    seed: 'rival-ai-seed',
    radius: 26,
    capacity: 6,
  });
  host.load(state);
  host.submit({
    colonyIndex: 0,
    source: 'system',
    commandId: 'spawn_human',
    kind: 'system.spawnColony',
    args: { colonyId: 'col_0', colonyIndex: 0, name: 'Human Pioneer', unlockStage: 0 },
  });
  host.step(1);
  return host;
}

describe('Rival AI seeding & human-first governance gate', () => {
  it('keeps online human colony 100% manual by default until AI AUTOPILOT or away', () => {
    const host = createW22Host();
    expect(shouldAiGovernColony(host.state, 0)).toBe(false);
    expect(stepColonyAutonomousGovernor(host.state, 0).action).toBe('idle');

    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'ai_on',
      kind: 'setAiEnabled',
      args: { enabled: true },
    });
    host.step(1);
    expect(shouldAiGovernColony(host.state, 0)).toBe(true);

    host.submit({
      colonyIndex: 0,
      source: 'player',
      commandId: 'ai_off',
      kind: 'setAiEnabled',
      args: { enabled: false },
    });
    host.step(1);
    expect(shouldAiGovernColony(host.state, 0)).toBe(false);

    host.submit({
      colonyIndex: 0,
      source: 'system',
      commandId: 'go_away',
      kind: 'system.presence',
      args: { colonyId: 'col_0', away: true },
    });
    host.step(1);
    expect(shouldAiGovernColony(host.state, 0)).toBe(true);
  });

  it('seeds 2 Stage-4 unshielded Rival AIs at back slots while Stage-0 human keeps Newcomer Shield', () => {
    const host = createW22Host();
    const rivals = seedRivalAiColonies(host.state, { count: 2, capacity: 6, tick: host.tick });
    expect(rivals).toHaveLength(2);
    expect(rivals[0]?.colonyIndex).toBe(4);
    expect(rivals[0]?.persona).toBe('trader');
    expect(rivals[1]?.colonyIndex).toBe(5);
    expect(rivals[1]?.persona).toBe('warlord');
    expect(isColonyRaidProtected(host.state, 0, host.tick)).toBe(true);
    expect(isColonyRaidProtected(host.state, 4, host.tick)).toBe(false);
    expect(isColonyRaidProtected(host.state, 5, host.tick)).toBe(false);
  });
});

describe('Rival AI diplomacy, raids, terraforming, slot yielding & AW-13 block', () => {
  it('Rival AIs negotiate truces, launch raids against unshielded targets, and queue terraform_zone', () => {
    const host = createW22Host();
    host.submit({
      colonyIndex: 0,
      source: 'system',
      commandId: 'seed_cmd',
      kind: 'system.seedRivalAi',
      args: { count: 2, capacity: 6 },
    });
    host.step(1);

    // Trader (col 4) proposes peace truce; Warlord (col 5) responds or raids unshielded Trader once truce cleared
    const traderTurn = stepColonyAutonomousGovernor(host.state, 4, host.tick);
    expect(traderTurn.action).toBe('propose_truce');

    // Clear pending offers to test Warlord raiding unshielded Trader (col 4), never shielded Human (col 0)
    const dip = readDiplomacyBlob(host.state);
    for (const o of Object.values(dip.offers)) o.status = 'declined';
    const warlordTurn = stepColonyAutonomousGovernor(host.state, 5, host.tick);
    expect(warlordTurn.action).toBe('raid_target');
    expect(warlordTurn.targetColonyIndex).toBe(4);
    expect(getOpenColonyGoals(host.state, 5).some((g) => g.goal === 'raid_target')).toBe(true);
  });

  it('yields Rival AI back slot cleanly when a real human player lands there', () => {
    const host = createW22Host();
    seedRivalAiColonies(host.state, { count: 2, capacity: 6, tick: host.tick });
    expect(isRivalAiColony(host.state, 4)).toBe(true);

    host.submit({
      colonyIndex: 4,
      source: 'system',
      commandId: 'human_takes_slot_4',
      kind: 'system.spawnColony',
      args: { colonyId: 'col_4', colonyIndex: 4, playerId: 'pr_realhuman1', name: 'Human Settler' },
    });
    const out = host.step(1);
    expect(out.outcomes[0]?.code).toBeUndefined();
    expect(isRivalAiColony(host.state, 4)).toBe(false);
    expect(host.state.colonies[4]?.name).toBe('Human Settler');
    expect(readDiplomacyBlob(host.state).contactsByColony[4]).toContain(5);
  });

  it('enforces AW-13 hard block: AI and director can NEVER cancel an active truce early even while online', () => {
    resetAwayPolicyRejections();
    const host = createW22Host();
    seedRivalAiColonies(host.state, { count: 2, capacity: 6, tick: host.tick });
    const prop = proposeTruce(host.state, 4, 5, 6, host.tick);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const acc = respondTruce(host.state, 5, prop.offer.offerId, true, host.tick);
    expect(acc.ok && acc.truce).toBeTruthy();
    if (!acc.ok || !acc.truce) return;

    host.submit({
      colonyIndex: 4,
      source: 'ai',
      commandId: 'ai_cancel_truce',
      kind: 'diplomacy.cancelTruce',
      args: { truceId: acc.truce.truceId },
    });
    const out = host.step(1);
    expect(out.outcomes[0]?.code).toBe('away_policy');
    expect(out.outcomes[0]?.detail).toBe('AW-13');
    expect(awayPolicyRejectionCount('AW-13')).toBeGreaterThanOrEqual(1);
    expect(hasActiveTruce(host.state, 4, 5, host.tick)).toBe(true);
  });
});
