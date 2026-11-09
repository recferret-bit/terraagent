import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESOURCE_KEYS, checkProfileContent } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '../src/testing';
import { EconomyProfileRepository, EconomyRepoError, contentHashOf } from '../src/economy';
import seed, { baselineContent } from '../seeds/0002_economy_baseline';

let db: TestDatabase;
let repo: EconomyProfileRepository;
const logs: string[] = [];
beforeAll(async () => {
  db = await createTestDatabase();
  repo = new EconomyProfileRepository(db.prisma);
  await db.prisma.economyProfile.create({ data: { id: 'cand', name: 'cand' } });
}, 90_000);
afterAll(async () => { await db?.drop(); });

const content = () => ({
  parameters: { 'market.policy.platformFeeBp': 80, 'market.policy.ttlOptionsS': [900, 3600] },
  recipes: [{ recipeId: 'prestige-1', activityKind: 'project', durationTicks: 100, eligibility: ['hub'], inputs: { 'metals.t3': '50', 'bio.t3': '7' }, output: { kind: 'fact', factId: 'prestige' }, enabledWave: 'W13' }],
  marketPolicies: [{ pairId: 'bio.water/USDC', tokenMetadataRef: 'USDC', platformFeeBp: 100, stallFeeBp: 50, lotUnits: '1', tickAtomic: '1', minNotionalAtomic: '100000', treasuryShareBp: 2000 }],
  agentPolicies: [{ actorId: 'npc-1', targets: { 'bio.water': 100 }, cashLimitAtomic: '5000000', spendLimitAtomic: '1000000', lossLimitAtomic: '10000', inventoryLimits: { 'bio.water': '500' }, referenceWindowTicks: 600 }],
});
const sql = (q: string) => db.prisma.$executeRawUnsafe(q);
const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

describe('W13-37 economy schema', () => {
  it('seed is idempotent: the second run changes nothing', async () => {
    const ctx = { prisma: db.prisma, log: (m: string) => logs.push(m) };
    await seed(ctx);
    const snap = async () => JSON.stringify(await Promise.all([
      db.prisma.economyProfileVersion.findMany(), db.prisma.economyParameter.count(), db.prisma.economyMarketPolicy.count(), db.prisma.economyActivation.findMany(),
    ]), (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    const first = await snap();
    await seed(ctx);
    expect(await snap()).toBe(first);
    expect(logs.some((l) => l.includes('already present'))).toBe(true);
    const base = await repo.exportVersion('baseline@1');
    expect(base.version.status).toBe('APPROVED');
    expect(checkProfileContent(base.content)).toEqual([]);
    expect(base.content.resourcePolicies.map((p) => p.resource).sort()).toEqual([...RESOURCE_KEYS].sort());
    expect(contentHashOf(base.content)).toBe(base.version.contentHash);
    expect(contentHashOf(base.content)).toBe(contentHashOf(baselineContent()));
  });

  it('clone / export / import round trip keeps the content hash', async () => {
    const v1 = await repo.createVersion('cand', { author: 'ai', rationale: 'first', content: content() });
    expect(v1.content.recipes[0]?.inputs).toEqual({ 'metals.t3': '50', 'bio.t3': '7' });
    expect(contentHashOf(v1.content)).toBe(v1.version.contentHash);
    const clone = await repo.cloneVersion(v1.version.id, { author: 'ai2' });
    expect(clone.version.parentId).toBe(v1.version.id);
    expect(clone.version.version).toBe(2);
    expect(clone.version.contentHash).toBe(v1.version.contentHash);
    const imported = await repo.importVersion('cand', JSON.parse(JSON.stringify(v1.content)), { author: 'ai3' });
    expect(imported.version.contentHash).toBe(v1.version.contentHash);
    expect(imported.content).toEqual(v1.content);
    expect((await repo.findByContentHash(v1.version.contentHash)).length).toBe(3);
  });

  it('rejects FK violations and exact-unit violations', async () => {
    await rejects(sql(`INSERT INTO economy.parameter (version_id, path, value, unit) VALUES ('nope', 'a.b.c', '1', 'bp')`), /23503|foreign key|violates/i);
    await rejects(sql(`INSERT INTO economy.recipe_input (version_id, recipe_id, resource_key, amount_atomic) VALUES ('cand@1', 'ghost', 'metals.t1', 1)`), /23503|foreign key|violates/i);
    await rejects(sql(`INSERT INTO economy.recipe_input (version_id, recipe_id, resource_key, amount_atomic) VALUES ('cand@1', 'prestige-1', 'bio.t2', -1)`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.recipe_input (version_id, recipe_id, resource_key, amount_atomic) VALUES ('cand@1', 'prestige-1', 'gold', 1)`), /23514|check/i);
    // numeric(78,0) would round a fraction; the contract (AtomicAmount) refuses it before it reaches SQL.
    const frac = content();
    frac.recipes[0]!.inputs = { 'metals.t3': '1.5' } as never;
    await expect(repo.importVersion('cand', frac, { author: 'ai' })).rejects.toThrow();
    await rejects(sql(`INSERT INTO economy.market_policy VALUES ('cand@1','x/USDC','USDC',10001,0,1,1,0,0)`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.resource_policy VALUES ('cand@1','gold','{}','{}','{}','{}',0,0,10)`), /23514|check/i);
  });

  it('a VALIDATED version is immutable (content, children, delete) and its status only moves forward', async () => {
    const d = await repo.createVersion('cand', { author: 'ai', content: content() });
    await repo.markValidated(d.version.id);
    await rejects(sql(`UPDATE economy.parameter SET value = '99' WHERE version_id = '${d.version.id}'`), /immutable/);
    await rejects(sql(`DELETE FROM economy.recipe_input WHERE version_id = '${d.version.id}'`), /immutable/);
    await rejects(sql(`INSERT INTO economy.parameter VALUES ('${d.version.id}', 'x.y.z', '1', 'bp')`), /immutable/);
    await rejects(sql(`UPDATE economy.profile_version SET rationale = 'edit' WHERE id = '${d.version.id}'`), /immutable/);
    await rejects(sql(`DELETE FROM economy.profile_version WHERE id = '${d.version.id}'`), /immutable/);
    await rejects(sql(`UPDATE economy.profile_version SET status = 'DRAFT' WHERE id = '${d.version.id}'`), /immutable|illegal/);
    await expect(repo.replaceDraftContent(d.version.id, d.revision, content())).rejects.toBeInstanceOf(EconomyRepoError);
    const approved = await repo.markApproved(d.version.id);
    expect(approved.version.status).toBe('APPROVED');
    await rejects(sql(`UPDATE economy.profile_version SET status = 'VALIDATED' WHERE id = '${d.version.id}'`), /illegal|immutable/);
  });

  it('audit rows are append-only and request ids are idempotent', async () => {
    expect(await repo.recordAudit({ actor: 'ai', action: 'patch', versionId: 'cand@1', requestId: 'req-1', diff: { a: 1 } })).toBe(true);
    expect(await repo.recordAudit({ actor: 'ai', action: 'patch', versionId: 'cand@1', requestId: 'req-1' })).toBe(false);
    await rejects(sql(`UPDATE economy.audit_event SET actor = 'x'`), /append-only/);
    await rejects(sql(`DELETE FROM economy.audit_event`), /append-only/);
  });

});

describe('W13-37 economy schema: concurrency, activation, runs', () => {
  it('concurrent patches with the same expected revision: one wins, the other gets version_conflict', async () => {
    const d = await repo.createVersion('cand', { author: 'ai', content: content() });
    const mk = (n: number) => repo.patchDraft(d.version.id, d.revision, [{ op: 'set', path: 'market.policy.platformFeeBp', value: n }]);
    const results = await Promise.allSettled([mk(70), mk(60)]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0]?.reason as EconomyRepoError).code).toBe('version_conflict');
    const after = await repo.exportVersion(d.version.id);
    expect(after.revision).toBe(d.revision + 1);
    expect([70, 60]).toContain(after.content.parameters['market.policy.platformFeeBp']);
    expect(contentHashOf(after.content)).toBe(after.version.contentHash);
    await expect(repo.patchDraft(d.version.id, d.revision, [])).rejects.toMatchObject({ code: 'version_conflict' });
    const unset = await repo.patchDraft(d.version.id, after.revision, [{ op: 'unset', path: 'market.policy.platformFeeBp' }]);
    expect(unset.content.parameters).not.toHaveProperty('market.policy.platformFeeBp');
  });

  it('rejects a second ACTIVE activation for the same scope; other scopes and SUPERSEDED rows are fine', async () => {
    const mk = (id: string, scope: string, state: string) => sql(`INSERT INTO economy.activation (id, scope, version_id, state, operator) VALUES ('${id}', '${scope}', 'baseline@1', '${state}', 'op')`);
    await rejects(mk('act-dup', 'global', 'ACTIVE'), /23505|already exists/i);
    await mk('act-old', 'global', 'SUPERSEDED');
    await mk('act-planet', 'planet:dune', 'ACTIVE');
    await rejects(mk('act-bad', 'planet:x', 'LIVE'), /23514|check/i);
  });

  it('metrics need a reason when the value is null; gate and experiment states are checked', async () => {
    await sql(`INSERT INTO economy.scenario (id, version, manifest, hash) VALUES ('s', 1, '{}', 'h')`);
    await sql(`INSERT INTO economy.experiment (id, request_id, manifest, manifest_hash) VALUES ('e1', 'rq1', '{}', 'h')`);
    await sql(`INSERT INTO economy.experiment_run (id, experiment_id, candidate_id, scenario_id, scenario_version, seed) VALUES ('r1', 'e1', 'cand@1', 's', 1, 101)`);
    await rejects(sql(`INSERT INTO economy.experiment_run (id, experiment_id, candidate_id, scenario_id, scenario_version, seed) VALUES ('r2', 'e1', 'cand@1', 's', 1, 101)`), /23505|already exists/i);
    await sql(`INSERT INTO economy.metric (run_id, window_start_tick, window_end_tick, scope, metric_key, value, reason, unit) VALUES ('r1', 0, 10, 'planet', 'k', NULL, 'zero_demand', 'days')`);
    await rejects(sql(`INSERT INTO economy.metric (run_id, window_start_tick, window_end_tick, scope, metric_key, value, unit) VALUES ('r1', 0, 10, 'planet', 'k', NULL, 'days')`), /23514|check/i);
    await rejects(sql(`INSERT INTO economy.gate_result (run_id, gate_id, gate_version, outcome, threshold) VALUES ('r1', 'g', 1, 'maybe', '1')`), /23514|check/i);
    await rejects(sql(`UPDATE economy.experiment SET status = 'done' WHERE id = 'e1'`), /23514|check/i);
    await rejects(sql(`UPDATE economy.scenario SET hash = 'x'`), /append-only/);
  });
});
