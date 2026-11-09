import { describe, expect, it } from 'vitest';
import type { PriorityKey } from '@terra/contracts';
import { AWAY_POLICY_VERSION } from '@terra/contracts';
import { awayPolicy } from '../../src/systems/away';
import type { AwayCommand, AwayPolicyView } from '../../src/systems/away';

const priorities = { economy: 40, expansion: 40, defense: 40, power: 40, terraform: 40 } as Record<PriorityKey, number>;
const family = { perDirectivePct: 40, perSessionPct: 60, stock: { start: 100, spent: 0 } };

function view(over: Partial<AwayPolicyView> = {}): AwayPolicyView {
  return {
    away: true,
    guardPoints: 10,
    mode: 'director',
    awayRaids: false,
    unlockStage: 4,
    priorities,
    budget: { metals: family, minerals: family, bio: family },
    baseline: [],
    queuedTaskIds: [],
    queuedBeacons: [],
    ownedUnitKinds: [],
    lossKinds: [],
    threat: { underAttack: false, brownout: false },
    ...over,
  };
}

function cmd(kind: string, args: unknown = {}, extra: Partial<AwayCommand> = {}): AwayCommand {
  return { kind, actor: 'ai', args, ...extra };
}

const reject = (rule: string) => ({ decision: 'reject', rule, code: 'away_policy' });

describe('W09-10 away deny rules', () => {
  it('rejects demolish while away', () => {
    expect(awayPolicy(view(), cmd('demolish', { entityId: 3 }))).toEqual(reject('AW-10'));
  });

  it('rejects a raid when awayRaids is off and allows it when the player opted in', () => {
    expect(awayPolicy(view(), cmd('raid', { target: 'co_other' }))).toEqual(reject('AW-11'));
    expect(awayPolicy(view({ awayRaids: true }), cmd('raid', { target: 'co_other' }))).toEqual({
      decision: 'allow',
      rule: 'raid-opt-in',
    });
  });

  it('rejects a high-tier build and a rocket, and still allows a defensive shot', () => {
    const t3 = cmd('enqueueTask', { build: { building: 'metalsExtractor', q: 1, r: 1, tier: 3 } });
    expect(awayPolicy(view(), t3)).toEqual(reject('AW-15'));
    expect(awayPolicy(view(), cmd('launchRocket'))).toEqual(reject('AW-12'));
    expect(awayPolicy(view(), cmd('attack', { entityId: 9 }, { defensive: true }))).toEqual({
      decision: 'allow',
      rule: 'defensive',
    });
  });

  it('rejects a trade outside autoTrade and an AI setAutopilot, and allows a trade inside the limits', () => {
    expect(awayPolicy(view(), cmd('trade', { give: 'metals.t1' }))).toEqual(reject('AW-13'));
    expect(awayPolicy(view(), cmd('trade', { give: 'metals.t1' }, { withinAutoTrade: true }))).toEqual({
      decision: 'allow',
      rule: 'AW-01',
    });
    expect(awayPolicy(view(), cmd('setAutopilot', { mode: 'rules_only' }))).toEqual(reject('AW-14'));
  });

  it('keeps the policy version constant at 1', () => {
    expect(AWAY_POLICY_VERSION).toBe(1);
  });
});
