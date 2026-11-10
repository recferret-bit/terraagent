import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  agentParamsFromData, compileData, compileProfile, describeSchema, guildAgentParams, guildPolicy, quoteColony, ratio,
  setOverride, tryCompileProfile, validatePatch, type AgentColonyInput, type BalanceOverrides,
} from '../../src';

const on = parseWaves('..15');
const off = parseWaves('..14');
const MAX_LEGAL = 9999;
const data = () => compileData(on);
const withSpread = (bid: number, ask = bid): BalanceOverrides =>
  setOverride(setOverride({}, 'guild.policy.bidHalfSpreadBp', bid), 'guild.policy.askHalfSpreadBp', ask);

/** Colony input that quotes both sides. minNotional is 1 so a 9999 bp bid still clears. */
const input = (): AgentColonyInput => ({
  resource: 'bio.water', quote: 'USDC', need: { planned: 100n, reserve: 0n, available: 0n, expectedOwn: 0n }, inventory: 500n, target: 500n,
  freeUnits: 800n, keepUnits: 500n, reference: { price: ratio(400_000n), ageS: 60, eligibleVolume: 100, basis: 'organic' },
  walkAway: { localUnitCost: ratio(1_000_000n), localMinutesPerUnit: null, minuteValue: null, needValue: null }, ownUnitCost: ratio(300_000n),
  transportPerUnit: ratio(0n), freeQuote: 10n ** 12n, budgetLeft: null, platformFeeBp: 100, maxStallFeeBp: 100, lotUnits: 1, minNotionalAtomic: 1n,
});

const bidOf = (overrides: BalanceOverrides = {}): bigint => {
  const q = quoteColony(input(), guildAgentParams(compileData(on, overrides)));
  if (!q.bid) throw new Error(`bid paused: ${q.bidReasons.join(',')}`);
  return q.bid.priceAmount;
};
const askOf = (overrides: BalanceOverrides = {}): bigint => {
  const q = quoteColony(input(), guildAgentParams(compileData(on, overrides)));
  if (!q.ask) throw new Error(`ask paused: ${q.askReasons.join(',')}`);
  return q.ask.priceAmount;
};

const patch = (value: unknown) => ({ schemaVersion: 1 as const, requestId: 'guild', expectedVersion: 1, ops: [{ op: 'set' as const, path: 'guild.policy.bidHalfSpreadBp', value }] });

describe('W15-02 guild roster and quote policy', () => {
  it('exposes kestrel and vanguard, Tier-1 pairs, and a default quote equal to the W13 library', () => {
    const policy = guildPolicy(data());
    expect(policy.roster.map((n) => n.id)).toEqual(['kestrel', 'vanguard']);
    expect(policy.roster.map((n) => n.accountId)).toEqual(['guild-1.npc.terraagent.mock', 'guild-2.npc.terraagent.mock']);
    expect(policy.roster.every((n) => n.pairs.join() === 'metals.t1,minerals.t1,bio.water,bio.biomass')).toBe(true);
    expect(policy.roster.every((n) => n.routeLoop === 1 && n.route.join() === 'loop-local')).toBe(true);
    expect(policy.cashEnabled).toBe(0);
    expect(policy.killSwitch).toBe(0);
    expect(policy.npcNearFloatCap).toBe(5);
    expect(policy.globalNearFloatCap).toBe(10);
    expect(policy.dockWindowS).toBe(720);
    expect(policy.visitGapS).toBe(1800);
    expect(policy.policyVersion).toBe('guild-mock-1');
    expect(guildAgentParams(data())).toEqual(agentParamsFromData(data()));
    expect(quoteColony(input(), guildAgentParams(data()))).toEqual(quoteColony(input(), agentParamsFromData(data())));
  });

  it('changes the bid and the ask when only the compiled spread changes', () => {
    const bid = bidOf();
    const ask = askOf();
    expect(bidOf(setOverride({}, 'guild.policy.bidHalfSpreadBp', 800))).toBeLessThan(bid);
    expect(askOf(setOverride({}, 'guild.policy.askHalfSpreadBp', 800))).toBeGreaterThan(ask);
    const viaProfile = compileProfile({ parameters: { 'guild.policy.bidHalfSpreadBp': 800, 'guild.policy.askHalfSpreadBp': 800 } }, on.list);
    expect(bidOf(viaProfile.overrides)).toBeLessThan(bid);
    expect(askOf(viaProfile.overrides)).toBeGreaterThan(ask);
  });

  it('hides the roster when W15 is off and rejects a bad spread, a T2 pair and a float cap below the per-NPC cap', () => {
    expect(compileData(off).tables.guild).toEqual({});
    expect(() => guildPolicy(compileData(off))).toThrow(/W15/);
    expect(() => guildAgentParams(compileData(on, setOverride({}, 'guild.policy.bidHalfSpreadBp', 10_000)))).toThrow(/0\.\.9999/);
    expect(() => guildAgentParams(compileData(on, setOverride({}, 'guild.policy.askHalfSpreadBp', -1)))).toThrow(/0\.\.9999/);
    expect(() => guildAgentParams(compileData(on, setOverride({}, 'guild.policy.bidHalfSpreadBp', 1.5)))).toThrow(/0\.\.9999/);
    expect(() => compileData(on, setOverride({}, 'guild.policy.policyVersion', 'other'))).toThrow(/cannot be tuned/);
    expect(() => guildPolicy(compileData(on, setOverride({}, 'guild.kestrel.pairs', ['metals.t2'])))).toThrow(/Tier-1|metals\.t1/);
    expect(() => guildPolicy(compileData(on, setOverride({}, 'guild.policy.globalNearFloatCap', 1)))).toThrow(/globalNearFloatCap/);
    expect(() => compileData(on, setOverride({}, 'guild.policy.inventoryCapUnits', 1.5))).toThrow(/whole/);
    const disabled = tryCompileProfile({ parameters: { 'guild.policy.bidHalfSpreadBp': 800 } }, off.list);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.errors[0]?.code).toBe('wave_disabled');
    expect(validatePatch({}, patch(10_000), on).map((e) => e.code)).toEqual(['out_of_bounds']);
  });

  it('quotes at spread 0 and at the max legal spread, and keeps 0 wider on the bid than 9999', () => {
    const zero = bidOf(withSpread(0));
    const mid = bidOf();
    const max = bidOf(withSpread(MAX_LEGAL));
    expect(zero).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(max);
    expect(askOf(withSpread(0))).toBeLessThan(askOf());
    expect(askOf()).toBeLessThan(askOf(withSpread(MAX_LEGAL)));
    expect(validatePatch({}, patch(0), on)).toEqual([]);
    expect(validatePatch({}, patch(MAX_LEGAL), on)).toEqual([]);
    const schema = describeSchema(off).properties as Record<string, Record<string, unknown>>;
    expect(schema['guild.policy.bidHalfSpreadBp']['x-requiredWave']).toBe('W15');
    expect(schema['guild.policy.bidHalfSpreadBp']['x-enabled']).toBe(false);
    expect((describeSchema(on).properties as Record<string, Record<string, unknown>>)['guild.policy.cashEnabled']['x-enabled']).toBe(true);
  });
});
