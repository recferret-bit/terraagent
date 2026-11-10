import { describe, expect, it } from 'vitest';
import type { PriorityKey } from '@terra/contracts';
import {
  allowRule,
  awayPolicy,
  denyRule,
  isCancelTruce,
  isProposeTruce,
  isRaidCommand,
  isRespondTruce,
  isTruceCommand,
  raidOrder,
  withinDiplomacyPolicy,
  type AwayCommand,
  type AwayPolicyView,
} from './index';

const priorities = {
  economy: 50,
  expansion: 50,
  defense: 50,
  power: 50,
  terraform: 50,
} as Record<PriorityKey, number>;

const family = { perDirectivePct: 40, perSessionPct: 60, stock: { start: 100, spent: 0 } };

function makeView(overrides: Partial<AwayPolicyView> = {}): AwayPolicyView {
  return {
    away: true,
    guardPoints: 10,
    mode: 'director',
    awayRaids: false,
    unlockStage: 4,
    priorities,
    budget: { metals: family, minerals: family, bio: family },
    baseline: [],
    queuedTaskIds: ['job-1'],
    queuedBeacons: [],
    ownedUnitKinds: [],
    lossKinds: [],
    threat: { underAttack: false, brownout: false },
    ...overrides,
  };
}

function makeCmd(kind: string, args: unknown = {}, extra: Partial<AwayCommand> = {}): AwayCommand {
  return { kind, actor: 'ai', args, ...extra };
}

describe('W18-15 away policy — positive diplomacy cases (UO-DIP-05, AW-13)', () => {
  it('allows AI to propose a truce within valid durations (2, 6, 24, 72 h) while away', () => {
    for (const hours of [2, 6, 24, 72]) {
      const cmdHours = makeCmd('diplomacy.proposeTruce', { targetColonyId: 'col_1', hours });
      expect(awayPolicy(makeView(), cmdHours)).toEqual({ decision: 'allow', rule: 'AW-01' });
      expect(allowRule(makeView(), cmdHours)).toBe('AW-01');
      expect(withinDiplomacyPolicy(makeView(), cmdHours)).toBe(true);

      const cmdDuration = makeCmd('diplomacy.proposeTruce', { targetColonyId: 'col_1', durationHours: hours });
      expect(awayPolicy(makeView(), cmdDuration)).toEqual({ decision: 'allow', rule: 'AW-01' });
    }
  });

  it('allows AI to respond (accept or decline) to an incoming truce offer while away', () => {
    const acceptCmd = makeCmd('diplomacy.respondTruce', { offerId: 'of_1', accept: true });
    const declineCmd = makeCmd('diplomacy.respondTruce', { offerId: 'of_1', accept: false });
    expect(awayPolicy(makeView(), acceptCmd)).toEqual({ decision: 'allow', rule: 'AW-01' });
    expect(awayPolicy(makeView(), declineCmd)).toEqual({ decision: 'allow', rule: 'AW-01' });
    expect(allowRule(makeView(), acceptCmd)).toBe('AW-01');
    expect(withinDiplomacyPolicy(makeView(), acceptCmd)).toBe(true);
  });

  it('allows player to cancel a truce while away, and allows AI when colony is present', () => {
    const playerCancel = makeCmd('diplomacy.cancelTruce', { truceId: 'tr_1' }, { actor: 'player' });
    expect(awayPolicy(makeView(), playerCancel)).toEqual({ decision: 'allow', rule: 'player' });

    const presentAiCancel = makeCmd('diplomacy.cancelTruce', { truceId: 'tr_1' }, { actor: 'ai' });
    expect(awayPolicy(makeView({ away: false }), presentAiCancel)).toEqual({
      decision: 'allow',
      rule: 'present',
    });
  });
});

describe('W18-15 away policy — negative diplomacy & raid cases (AC-13, AW-11, AW-13)', () => {
  it('always rejects AI or bot cancelTruce while away with AW-13, even with awayRaids or defensive flags', () => {
    const aiCancel = makeCmd('diplomacy.cancelTruce', { truceId: 'tr_1' }, { actor: 'ai' });
    const botCancel = makeCmd('diplomacy.cancelTruce', { truceId: 'tr_1' }, { actor: 'bot' });
    const shortCancel = makeCmd('cancelTruce', { truceId: 'tr_1', taskId: 'job-1' }, { defensive: true });

    expect(awayPolicy(makeView(), aiCancel)).toEqual({
      decision: 'reject',
      rule: 'AW-13',
      code: 'away_policy',
    });
    expect(awayPolicy(makeView({ awayRaids: true }), botCancel)).toEqual({
      decision: 'reject',
      rule: 'AW-13',
      code: 'away_policy',
    });
    expect(awayPolicy(makeView({ awayRaids: true }), shortCancel)).toEqual({
      decision: 'reject',
      rule: 'AW-13',
      code: 'away_policy',
    });
    expect(denyRule(makeView(), aiCancel)).toBe('AW-13');
    expect(allowRule(makeView(), aiCancel)).toBeNull();
  });

  it('rejects AI proposeTruce / respondTruce when outside diplomacy policy or invalid duration', () => {
    const badDuration = makeCmd('diplomacy.proposeTruce', { targetColonyId: 'col_1', hours: 999 });
    const explicitDeny = makeCmd(
      'diplomacy.proposeTruce',
      { targetColonyId: 'col_1', hours: 6 },
      { withinDiplomacy: false },
    );
    const badRespond = makeCmd('diplomacy.respondTruce', { offerId: '', accept: true });

    for (const bad of [badDuration, explicitDeny, badRespond]) {
      expect(withinDiplomacyPolicy(makeView(), bad)).toBe(false);
      expect(denyRule(makeView(), bad)).toBe('AW-13');
      expect(awayPolicy(makeView(), bad)).toEqual({
        decision: 'reject',
        rule: 'AW-13',
        code: 'away_policy',
      });
    }
  });

  it('rejects AI raid enqueueTask and queueGoal when awayRaids is false (AW-11)', () => {
    const enqueueRaid = makeCmd('enqueueTask', { raid: { targetColonyId: 'col_1' } });
    const taskRaid = makeCmd('enqueueTask', { task: { kind: 'raid', targetColonyId: 'col_1' } });
    const goalRaid = makeCmd('queueGoal', { goal: 'raid_target', params: { targetColonyId: 1 } });

    for (const cmd of [enqueueRaid, taskRaid, goalRaid]) {
      expect(isRaidCommand(cmd)).toBe(true);
      expect(awayPolicy(makeView({ awayRaids: false }), cmd)).toEqual({
        decision: 'reject',
        rule: 'AW-11',
        code: 'away_policy',
      });
    }
  });
});

describe('W18-15 away policy — corner & boundary cases', () => {
  it('allows AI raid enqueueTask and queueGoal when awayRaids is true, while still blocking cancelTruce', () => {
    const raidView = makeView({ awayRaids: true });
    const enqueueRaid = makeCmd('enqueueTask', { raid: { targetColonyId: 'col_1' } });
    const taskRaid = makeCmd('enqueueTask', { task: { kind: 'raid', targetColonyId: 'col_1' } });
    const goalRaid = makeCmd('queueGoal', { goal: 'raid_target', params: { targetColonyId: 1 } });

    for (const cmd of [enqueueRaid, taskRaid, goalRaid]) {
      expect(awayPolicy(raidView, cmd)).toEqual({ decision: 'allow', rule: 'raid-opt-in' });
    }
    expect(
      awayPolicy(raidView, makeCmd('diplomacy.cancelTruce', { truceId: 'tr_1' })),
    ).toEqual({ decision: 'reject', rule: 'AW-13', code: 'away_policy' });
  });

  it('classifies truce and raid order shapes accurately across wire aliases', () => {
    expect(raidOrder({ raid: { targetColonyId: 1 } })).toBe(true);
    expect(raidOrder({ task: { kind: 'raid', targetColonyId: 1 } })).toBe(true);
    expect(raidOrder({ goal: 'raid_target' })).toBe(true);
    expect(raidOrder({ build: { building: 'solar', q: 0, r: 0 } })).toBe(false);

    expect(isCancelTruce({ kind: 'diplomacy.cancelTruce', args: {} })).toBe(true);
    expect(isProposeTruce({ kind: 'diplomacy.proposeTruce', args: {} })).toBe(true);
    expect(isRespondTruce({ kind: 'diplomacy.respondTruce', args: {} })).toBe(true);
    expect(isTruceCommand({ kind: 'enqueueTask', args: { cancelTruce: { truceId: 'tr_1' } } })).toBe(true);
  });
});
