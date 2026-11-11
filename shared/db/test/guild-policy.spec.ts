import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { compileData, compileProfile, guildAgentParams, quoteColony, ratio, type AgentColonyInput } from '@terra/sim';
import { contentHashOf } from '../src/economy';
import { guildProfileContent } from '../seeds/0003_guild_policy';

const content = () => guildProfileContent();
const input = (): AgentColonyInput => ({
  resource: 'bio.water', quote: 'USDC', need: { planned: 100n, reserve: 0n, available: 0n, expectedOwn: 0n }, inventory: 500n, target: 500n,
  freeUnits: 800n, keepUnits: 500n, reference: { price: ratio(400_000n), ageS: 60, eligibleVolume: 100, basis: 'organic' },
  walkAway: { localUnitCost: ratio(1_000_000n), localMinutesPerUnit: null, minuteValue: null, needValue: null }, ownUnitCost: ratio(300_000n),
  transportPerUnit: ratio(0n), freeQuote: 10n ** 12n, budgetLeft: null, platformFeeBp: 100, maxStallFeeBp: 100, lotUnits: 1, minNotionalAtomic: 1n,
});

describe('W15-02 guild profile document', () => {
  it('names guild-mock-1, keeps cash and the kill switch off, and lists both NPCs', () => {
    const c = content();
    expect(c.parameters['guild.policy.policyVersion']).toBe('guild-mock-1');
    expect(c.parameters['guild.policy.cashEnabled']).toBe(0);
    expect(c.parameters['guild.policy.killSwitch']).toBe(0);
    expect(c.parameters['guild.policy.dockWindowS']).toBe(720);
    expect(c.parameters['guild.policy.visitGapS']).toBe(1800);
    expect(c.parameters['guild.policy.npcNearFloatCap']).toBe(5);
    expect(c.parameters['guild.policy.globalNearFloatCap']).toBe(10);
    expect(c.agentPolicies.map((a) => a.actorId)).toEqual(['kestrel', 'vanguard']);
    expect(c.agentPolicies.every((a) => a.cashLimitAtomic === (5n * 10n ** 24n).toString())).toBe(true);
    expect(c.agentPolicies.every((a) => a.targets['metals.t1'] === 2500 && a.inventoryLimits['metals.t1'] === '5000')).toBe(true);
    expect(c.agentPolicies.every((a) => Object.keys(a.targets).sort().join() === 'bio.biomass,bio.water,metals.t1,minerals.t1')).toBe(true);
    expect(JSON.stringify(c.agentPolicies)).not.toMatch(/\.t2|\.t3/);
    expect(contentHashOf(c)).toBe(contentHashOf(content()));
  });

  it('does not turn cash on, and a spread override on the same document changes the quote', () => {
    const c = content();
    expect(c.parameters['guild.policy.cashEnabled']).not.toBe(1);
    const flags = parseWaves('..15').list;
    const base = compileProfile({ parameters: c.parameters }, flags);
    expect(base.overrides).toEqual({});
    const wider = compileProfile({ parameters: { ...c.parameters, 'guild.policy.bidHalfSpreadBp': 800 } }, flags);
    const price = (overrides: typeof base.overrides): bigint => {
      const q = quoteColony(input(), guildAgentParams(compileData(new Set(flags), overrides)));
      if (!q.bid) throw new Error(q.bidReasons.join(','));
      return q.bid.priceAmount;
    };
    expect(price(wider.overrides)).toBeLessThan(price(base.overrides));
    expect(compileProfile({ parameters: { ...c.parameters, 'guild.policy.bidHalfSpreadBp': 0 } }, flags).overrides.guild).toEqual({ policy: { bidHalfSpreadBp: 0 } });
    expect(compileProfile({ parameters: { ...c.parameters, 'guild.policy.bidHalfSpreadBp': 9999 } }, flags).overrides.guild).toEqual({ policy: { bidHalfSpreadBp: 9999 } });
  });
});
