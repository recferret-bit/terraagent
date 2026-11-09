import { describe, expect, it } from 'vitest';
import type { PriorityKey } from '@terra/contracts';
import { awayPolicy, withinDirective } from '../../src/systems/away';
import type { AwayCommand, AwayPolicyView } from '../../src/systems/away';

const priorities = { economy: 40, expansion: 40, defense: 40, power: 40, terraform: 40 } as Record<PriorityKey, number>;

function family(pct = 40, start = 100, spent = 0) {
  return { perDirectivePct: pct, perSessionPct: 60, stock: { start, spent } };
}

function view(over: Partial<AwayPolicyView> = {}): AwayPolicyView {
  const budget = { metals: family(), minerals: family(), bio: family() };
  return {
    away: true,
    guardPoints: 10,
    mode: 'director',
    awayRaids: false,
    unlockStage: 4,
    priorities,
    budget,
    baseline: [{ kind: 'turret', tier: 1, q: 2, r: 3, destroyed: true }],
    queuedTaskIds: ['job-1'],
    queuedBeacons: [{ q: 4, r: 1 }],
    ownedUnitKinds: ['robot.worker'],
    lossKinds: ['robot.worker'],
    threat: { underAttack: false, brownout: false },
    ...over,
  };
}

function cmd(kind: string, args: unknown, extra: Partial<AwayCommand> = {}): AwayCommand {
  return { kind, actor: 'ai', args, ...extra };
}

const rebuild = cmd('enqueueTask', { build: { building: 'turret', q: 2, r: 3, tier: 1 } });
const extractor = (cost: number) => cmd('enqueueTask', { build: { building: 'metalsExtractor', q: 5, r: 0, tier: 1 } }, { cost: { metals: cost } });

describe('W09-09 awayPolicy allow list', () => {
  it('allows a rebuild of a destroyed turret on the same tile', () => {
    expect(awayPolicy(view(), rebuild)).toEqual({ decision: 'allow', rule: 'AW-02' });
  });

  it('allows a T1 extractor whose cost is inside the directive budget', () => {
    expect(awayPolicy(view(), extractor(30))).toEqual({ decision: 'allow', rule: 'AW-01' });
    expect(withinDirective(view(), { metals: 40 })).toBe(true);
  });

  it('rejects an extractor cost over the directive cap', () => {
    expect(awayPolicy(view(), extractor(41))).toEqual({ decision: 'reject', rule: 'AW-15', code: 'away_policy' });
    expect(withinDirective(view(), { metals: 41 })).toBe(false);
  });

  it('allows the exact cap and a zero spend at 0 %, and abstains on a 0 % spend of 1', () => {
    const zero = view({ budget: { metals: family(0), minerals: family(0), bio: family(0) } });
    expect(awayPolicy(view(), extractor(40)).decision).toBe('allow');
    expect(awayPolicy(zero, extractor(0)).decision).toBe('allow');
    expect(awayPolicy(zero, extractor(1))).toEqual({ decision: 'reject', rule: 'AW-15', code: 'away_policy' });
  });

  it('does not treat a turret on another tile as a rebuild', () => {
    const other = cmd('enqueueTask', { build: { building: 'turret', q: 9, r: 9, tier: 1 } });
    expect(awayPolicy(view(), other)).toEqual({ decision: 'reject', rule: 'AW-15', code: 'away_policy' });
  });

  it('allows a player demolish while away, and any command when the colony is present', () => {
    const demolish = cmd('demolish', { entityId: 1 }, { actor: 'player' });
    expect(awayPolicy(view(), demolish)).toEqual({ decision: 'allow', rule: 'player' });
    expect(awayPolicy(view({ away: false }), cmd('demolish', { entityId: 1 }))).toEqual({ decision: 'allow', rule: 'present' });
  });

  it('keeps a priority move inside one guard step and abstains past it', () => {
    const ok = cmd('setPriorities', { defense: 50 });
    const far = cmd('setPriorities', { defense: 51 });
    expect(awayPolicy(view(), ok)).toEqual({ decision: 'allow', rule: 'AW-06' });
    expect(awayPolicy(view(), far)).toEqual({ decision: 'reject', rule: 'AW-15', code: 'away_policy' });
  });

  it('allows a repair, a replacement unit, a shed, and a queued beacon', () => {
    expect(awayPolicy(view(), cmd('repair', { repair: { entityId: 4 } }))).toEqual({ decision: 'allow', rule: 'AW-02' });
    expect(awayPolicy(view(), cmd('enqueueTask', { buildUnit: { unit: 'robot.worker', tier: 1 } }))).toEqual({ decision: 'allow', rule: 'AW-04' });
    expect(awayPolicy(view(), cmd('shedLoad', {}))).toEqual({ decision: 'allow', rule: 'AW-05' });
    expect(awayPolicy(view(), cmd('enqueueTask', { build: { building: 'claimBeacon', q: 4, r: 1 } }))).toEqual({ decision: 'allow', rule: 'AW-07' });
  });

  it('abstains on a T2 extractor and a unit the colony does not own', () => {
    const t2 = cmd('enqueueTask', { build: { building: 'metalsExtractor', q: 1, r: 1, tier: 2 } }, { cost: { metals: 1 } });
    expect(awayPolicy(view(), t2)).toEqual({ decision: 'reject', rule: 'AW-15', code: 'away_policy' });
    const stranger = cmd('enqueueTask', { buildUnit: { unit: 'robot.combat', tier: 1 } });
    expect(awayPolicy(view(), stranger)).toEqual({ decision: 'reject', rule: 'AW-15', code: 'away_policy' });
  });
});

