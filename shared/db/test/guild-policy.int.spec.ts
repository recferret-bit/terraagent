import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWaves, type ParamValue } from '@terra/contracts';
import { compileData, compileProfile, guildAgentParams, quoteColony, ratio, tryCompileProfile, validatePatch, type AgentColonyInput } from '@terra/sim';
import { createTestDatabase, type TestDatabase } from '../src/testing';
import { EconomyProfileRepository, contentHashOf } from '../src/economy';
import seed, { guildProfileContent } from '../seeds/0003_guild_policy';

let db: TestDatabase;
let repo: EconomyProfileRepository;
const logs: string[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  repo = new EconomyProfileRepository(db.prisma);
  await seed({ prisma: db.prisma, log: (m) => logs.push(m) });
}, 90_000);
afterAll(async () => { await db?.drop(); });

const input = (): AgentColonyInput => ({
  resource: 'bio.water', quote: 'USDC', need: { planned: 100n, reserve: 0n, available: 0n, expectedOwn: 0n }, inventory: 500n, target: 500n,
  freeUnits: 800n, keepUnits: 500n, reference: { price: ratio(400_000n), ageS: 60, eligibleVolume: 100, basis: 'organic' },
  walkAway: { localUnitCost: ratio(1_000_000n), localMinutesPerUnit: null, minuteValue: null, needValue: null }, ownUnitCost: ratio(300_000n),
  transportPerUnit: ratio(0n), freeQuote: 10n ** 12n, budgetLeft: null, platformFeeBp: 100, maxStallFeeBp: 100, lotUnits: 1, minNotionalAtomic: 1n,
});

const bidFrom = (parameters: Readonly<Record<string, ParamValue>>): bigint => {
  const flags = parseWaves('..15').list;
  const compiled = compileProfile({ parameters }, flags);
  const q = quoteColony(input(), guildAgentParams(compileData(new Set(flags), compiled.overrides)));
  if (!q.bid) throw new Error(q.bidReasons.join(','));
  return q.bid.priceAmount;
};

describe('W15-02 guild profile version', () => {
  it('seeds guild@1 once, approved, with cash disabled and both NPCs', async () => {
    const before = await db.prisma.economyProfileVersion.count({ where: { profileId: 'guild' } });
    await seed({ prisma: db.prisma, log: (m) => logs.push(m) });
    const stored = await repo.exportVersion('guild@1');
    expect(await db.prisma.economyProfileVersion.count({ where: { profileId: 'guild' } })).toBe(before);
    expect(stored.version).toMatchObject({ status: 'APPROVED', version: 1, profileId: 'guild' });
    expect(contentHashOf(stored.content)).toBe(stored.version.contentHash);
    expect(contentHashOf(stored.content)).toBe(contentHashOf(guildProfileContent()));
    expect(await db.prisma.economyActivation.count({ where: { versionId: 'guild@1' } })).toBe(0);
    expect(stored.content.parameters['guild.policy.cashEnabled']).toBe(0);
    expect(stored.content.parameters['guild.policy.policyVersion']).toBe('guild-mock-1');
    expect(stored.content.agentPolicies.map((a) => a.actorId)).toEqual(['kestrel', 'vanguard']);
    expect(logs.some((l) => l.includes('already present'))).toBe(true);
  });

  it('a stored spread edit round-trips into a different quote; 0 and 9999 stay ordered', async () => {
    const stored = (await repo.exportVersion('guild@1')).content.parameters;
    const draft = await repo.cloneVersion('guild@1', { author: 'test', rationale: 'wider spread' });
    const patched = await repo.patchDraft(draft.version.id, draft.revision, [{ op: 'set', path: 'guild.policy.bidHalfSpreadBp', value: 800 }]);
    const again = await repo.exportVersion(patched.version.id);
    expect(again.content.parameters['guild.policy.bidHalfSpreadBp']).toBe(800);
    expect(again.content.parameters['guild.policy.cashEnabled']).toBe(0);
    expect(bidFrom(again.content.parameters)).toBeLessThan(bidFrom(stored));
    expect(bidFrom({ ...stored, 'guild.policy.bidHalfSpreadBp': 0 })).toBeGreaterThan(bidFrom(stored));
    expect(bidFrom(stored)).toBeGreaterThan(bidFrom({ ...stored, 'guild.policy.bidHalfSpreadBp': 9999 }));
  });

  it('rejects a spread past 9999 and a Guild override while W15 is off', async () => {
    const flags = parseWaves('..15');
    const ops = (value: number) => ({ schemaVersion: 1 as const, requestId: 'g', expectedVersion: 1, ops: [{ op: 'set' as const, path: 'guild.policy.bidHalfSpreadBp', value }] });
    expect(validatePatch({}, ops(10_000), flags).map((e) => e.code)).toEqual(['out_of_bounds']);
    expect(validatePatch({}, ops(-1), flags).map((e) => e.code)).toEqual(['out_of_bounds']);
    expect(validatePatch({}, ops(0), flags)).toEqual([]);
    expect(validatePatch({}, ops(9999), flags)).toEqual([]);
    const stored = (await repo.exportVersion('guild@1')).content.parameters;
    const disabled = tryCompileProfile({ parameters: { ...stored, 'guild.policy.bidHalfSpreadBp': 800 } }, parseWaves('..14').list);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.errors.map((e) => e.code)).toContain('wave_disabled');
  });
});
