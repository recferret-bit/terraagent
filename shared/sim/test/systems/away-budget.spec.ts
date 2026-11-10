import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { createPlanet, SimHost, type SimCommand } from '../../src';
import { chargeAwaySpend, openAwaySession } from '../../src/systems/away/session';
import { readAwaySettings } from '../../src/systems/away/store';
import { awayPolicy } from '../../src/systems/away';
import type { AwayPolicyView } from '../../src/systems/away';
import type { PriorityKey } from '@terra/contracts';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function host(): SimHost {
  const sim = new SimHost({ flags: parseWaves('..09') });
  sim.load(createPlanet({ type: 'flat', seed: 'w09-budget', radius: 4 }));
  const cmd: SimCommand = {
    colonyIndex: 0, source: 'player', commandId: 'cm_budget', kind: 'setAutopilot',
    args: { awayBudget: { metals: { perDirectivePct: 40, perSessionPct: 30 } } },
  };
  sim.submit(cmd);
  sim.step(1);
  openAwaySession(sim.state, 0, COLONY, { metals: 100, minerals: 80, bio: 50 }, sim.tick);
  return sim;
}

describe('W09-11 away session budget', () => {
  it('stops automated metals spend at 30% and still allows a turret rebuild', () => {
    const sim = host();
    const events: { kind: string; data?: { resource?: string; colonyId?: string } }[] = [];
    const emit = (e: { kind: string; data?: { resource?: string; colonyId?: string } }) => events.push(e);
    expect(chargeAwaySpend(sim.state, 0, 'metals', 30, 'auto', 2, emit).allowed).toBe(true);
    const over = chargeAwaySpend(sim.state, 0, 'metals', 1, 'auto', 3, emit);
    expect(over).toEqual({ allowed: false, emitted: true, reason: 'budget' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'awayBudgetExhausted', data: { resource: 'metals', colonyId: COLONY } });
    expect(chargeAwaySpend(sim.state, 0, 'metals', 1, 'auto', 4, emit).emitted).toBe(false);
    expect(chargeAwaySpend(sim.state, 0, 'metals', 80, 'defense', 5, emit).allowed).toBe(true);
    expect(chargeAwaySpend(sim.state, 0, 'metals', 40, 'repair', 6, emit).allowed).toBe(true);
    expect(readAwaySettings(sim.state, 0)?.session.spent.metals).toBe(30);
    expect(events).toHaveLength(1);
  });

  it('allows a spend that lands on the cap and refuses a negative amount', () => {
    const sim = host();
    const emit = () => undefined;
    expect(chargeAwaySpend(sim.state, 0, 'metals', 30, 'auto', 2, emit).allowed).toBe(true);
    expect(chargeAwaySpend(sim.state, 0, 'metals', -1, 'auto', 3, emit)).toMatchObject({ allowed: false, reason: 'bad-amount' });
  });

  it('does not spend when the session is closed, and exhausts minerals on their own cap', () => {
    const sim = new SimHost({ flags: parseWaves('..09') });
    sim.load(createPlanet({ type: 'flat', seed: 'w09-closed', radius: 4 }));
    sim.submit({ colonyIndex: 0, source: 'player', commandId: 'cm_b2', kind: 'setAutopilot', args: { mode: 'director' } });
    sim.step(1);
    const emit = () => undefined;
    expect(chargeAwaySpend(sim.state, 0, 'metals', 1, 'auto', 2, emit)).toMatchObject({ reason: 'not-away' });
    openAwaySession(sim.state, 0, COLONY, { metals: 100, minerals: 10, bio: 10 }, sim.tick);
    const events: unknown[] = [];
    expect(chargeAwaySpend(sim.state, 0, 'minerals', 11, 'auto', 3, (e) => events.push(e)).emitted).toBe(true);
    expect(readAwaySettings(sim.state, 0)?.session.spent.metals).toBe(0);
    expect(events).toHaveLength(1);
  });
});

const priorities = { economy: 40, expansion: 40, defense: 40, power: 40, terraform: 40 } as Record<PriorityKey, number>;

describe('W09-11 policy sees session spend', () => {
  it('rejects an extractor once session spend is already at the cap', () => {
    const family = { perDirectivePct: 40, perSessionPct: 30, stock: { start: 100, spent: 30 } };
    const view: AwayPolicyView = {
      away: true, guardPoints: 10, mode: 'director', awayRaids: false, unlockStage: 4, priorities,
      budget: { metals: family, minerals: family, bio: family },
      baseline: [], queuedTaskIds: [], queuedBeacons: [], ownedUnitKinds: [], lossKinds: [],
      threat: { underAttack: false, brownout: false },
    };
    const command = {
      kind: 'enqueueTask', actor: 'ai' as const,
      args: { build: { building: 'metalsExtractor', q: 1, r: 1, tier: 1 } },
      cost: { metals: 1 },
    };
    expect(awayPolicy(view, command)).toEqual({ decision: 'reject', rule: 'AW-15', code: 'away_policy' });
  });
});
