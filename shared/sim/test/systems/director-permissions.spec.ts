import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData } from '../../src/data';
import {
  evaluateTradeSkillProposal,
  selectDirectorSkills,
  strategyPermitted,
  type BotTradeAllowance,
} from '../../src/systems/director';
import { agentParamsFromData, type AgentColonyInput } from '../../src/systems/trade/agent';

const waves = new Set(['W00', 'W08', 'W16', 'W18']);
const none = { raids: false, upgrades: false, launch: false };

const baseAllowance: BotTradeAllowance = {
  colonyId: 'col_0',
  botKeyId: 'bk_col_0',
  killed: false,
  allowedPairs: ['metals.t1', 'bio.water'],
  openOrders: 0,
  maxOpenOrders: 4,
  maxOrderNotional: 5_000_000n,
  remainingDailyBudget: 10_000_000n,
  minUnitPrice: 1_000n,
  maxUnitPrice: 100_000n,
};

const baseColonyInput: AgentColonyInput = {
  resource: 'metals.t1',
  quote: 'USDC',
  need: { planned: 120n, reserve: 50n, available: 40n, expectedOwn: 10n },
  inventory: 40n,
  target: 150n,
  freeUnits: 0n,
  keepUnits: 50n,
  ownUnitCost: { num: 25_000n, den: 1n },
  transportPerUnit: { num: 0n, den: 1n },
  walkAway: {
    localUnitCost: { num: 60_000n, den: 1n },
    localMinutesPerUnit: null,
    minuteValue: null,
    needValue: null,
  },
  reference: {
    price: { num: 20_000n, den: 1n },
    ageS: 10,
    eligibleVolume: 100,
    basis: 'organic',
  },
  freeQuote: 10_000_000n,
  budgetLeft: 10_000_000n,
  platformFeeBp: 50,
  maxStallFeeBp: 50,
  lotUnits: 1,
  minNotionalAtomic: 1_000n,
};

const agentParams = agentParamsFromData(compileData(parseWaves('..16')));

describe('W16-38 strategy permissions', () => {
  it('omits diplomacy without an executor, and technology and settlement without their waves', () => {
    const ids = selectDirectorSkills({ waves, stage: 5 }).map((skill) => skill.id);
    expect(ids).not.toContain('diplomacy');
    expect(ids).not.toContain('technology');
    expect(ids).not.toContain('settlement');
  });

  it('keeps a raid behind the raids flag', () => {
    expect(strategyPermitted('diplomacy', { raids: false, upgrades: true, launch: true })).toBe(false);
    expect(strategyPermitted('diplomacy', { raids: true, upgrades: false, launch: false })).toBe(true);
  });

  it('keeps an upgrade behind the upgrades flag', () => {
    expect(strategyPermitted('technology', { raids: true, upgrades: false, launch: true })).toBe(false);
    expect(strategyPermitted('technology', { raids: false, upgrades: true, launch: false })).toBe(true);
  });

  it('keeps a launch behind the launch flag', () => {
    expect(strategyPermitted('settlement', { raids: true, upgrades: true, launch: false })).toBe(false);
    expect(strategyPermitted('settlement', { raids: false, upgrades: false, launch: true })).toBe(true);
  });

  it('denies raid, upgrade and launch when every flag is off', () => {
    expect(strategyPermitted('diplomacy', none)).toBe(false);
    expect(strategyPermitted('technology', none)).toBe(false);
    expect(strategyPermitted('settlement', none)).toBe(false);
  });
});

describe('W16-38 trade-skill adapter & W13 quote library enforcement', () => {
  const validStrategy = {
    specialisation: 'balanced',
    risk: 'conservative',
    goals: ['shortfall_cover'],
    reserveTargets: {
      'metals.t1': { reserve: '50', target: '150', keep: '50' },
    },
    maxOrderTtlS: 1800,
  };

  it('prices an in-bounds trade-skill strategy via W13 quote library into a bot order', () => {
    const res = evaluateTradeSkillProposal(validStrategy, baseAllowance, baseColonyInput, agentParams);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.order.source).toBe('bot');
      expect(res.order.actorKind).toBe('bot');
      expect(res.order.colonyId).toBe('col_0');
      expect(res.order.botKeyId).toBe('bk_col_0');
      expect(res.order.resource).toBe('metals.t1');
      expect(res.order.side).toBe('buy');
      expect(res.order.amount).toBeGreaterThan(0);
      expect(res.order.ttlS).toBe(1800);
    }
  });

  it('rejects a free price, an out-of-band price, an over-allowance order, and a killed bot key (D-45)', () => {
    const freePrice = evaluateTradeSkillProposal(
      { ...validStrategy, limitPrice: '15000' },
      baseAllowance,
      baseColonyInput,
      agentParams,
    );
    expect(freePrice).toEqual({ ok: false, reason: 'free_price_forbidden' });

    const escalation = evaluateTradeSkillProposal(
      { ...validStrategy, maxOrderNotional: '999999999' },
      baseAllowance,
      baseColonyInput,
      agentParams,
    );
    expect(escalation).toEqual({ ok: false, reason: 'allowance_escalation_forbidden' });

    const outOfBand = evaluateTradeSkillProposal(
      validStrategy,
      { ...baseAllowance, maxUnitPrice: 500n },
      baseColonyInput,
      agentParams,
    );
    expect(outOfBand).toEqual({ ok: false, reason: 'price_out_of_band' });

    const overAllowance = evaluateTradeSkillProposal(
      validStrategy,
      { ...baseAllowance, maxOrderNotional: 100n },
      baseColonyInput,
      agentParams,
    );
    expect(overAllowance).toEqual({ ok: false, reason: 'over_allowance' });

    const killed = evaluateTradeSkillProposal(
      validStrategy,
      { ...baseAllowance, killed: true },
      baseColonyInput,
      agentParams,
    );
    expect(killed).toEqual({ ok: false, reason: 'bot_key_killed' });
  });
});
