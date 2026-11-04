import type { INestApplication } from '@nestjs/common';
import { newId, parseWaves } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { compileProfile } from '@terra/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import seed from '../../../../shared/db/seeds/0002_economy_baseline';
import { createApp } from '../../src/app';
import { CommandPrechecks } from '../../src/core/command-prechecks';
import { DEV_ECONOMY_ACTIVATE_TOKEN, DEV_ECONOMY_EDIT_TOKEN, DEV_ECONOMY_READ_TOKEN } from '../../src/economy/economy-auth';
import { EconomyProfileService } from '../../src/economy/profile/profile.service';
import { GamePlanets } from '../../src/game/game-planets.service';
import { MarketOrderRepository } from '../../src/market/book/market-order.repository';

/** Loosely typed JSON body (the assertions below check the shape). */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: TestDatabase;
let app: INestApplication;
let url: string;
const flags = parseWaves('all').list;
const source = (over: Record<string, string> = {}) => ({ NODE_ENV: 'test', SNAPSHOTS: 'on', SIM_THREADS: '1', DATABASE_URL: db.url, ...over });

async function boot(): Promise<void> {
  ({ app } = await createApp({ source: source() }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}
const call = async (method: string, path: string, body?: unknown, token: string | null = DEV_ECONOMY_ACTIVATE_TOKEN) => {
  const res = await fetch(`${url}/v1/economy${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: (await res.json()) as Json };
};
async function waitFor<T>(fn: () => Promise<T | false | undefined>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}
let n = 0;
/** clone baseline@1 → patch the platform fee → validate → approve; returns the version id. */
async function approvedVersion(fee: number): Promise<string> {
  const c = await call('POST', '/profiles/baseline/versions/1/clone', { requestId: `mk-clone-${++n}` }, DEV_ECONOMY_EDIT_TOKEN);
  const v = c.json.version.version.version as number;
  const p = await call('PATCH', `/profiles/baseline/versions/${v}`, { schemaVersion: 1, requestId: `mk-patch-${n}`, expectedVersion: 1, ops: [{ op: 'set', path: 'market.policy.platformFeeBp', value: fee }] }, DEV_ECONOMY_EDIT_TOKEN);
  expect(p.status).toBe(200);
  expect((await call('POST', `/profiles/baseline/versions/${v}/validate`, { requestId: `mk-val-${n}` }, DEV_ECONOMY_EDIT_TOKEN)).json.valid).toBe(true);
  expect((await call('POST', `/profiles/baseline/versions/${v}/approve`, { requestId: `mk-appr-${n}` })).status).toBe(200);
  return `baseline@${v}`;
}
const activeVersion = async () => (await call('GET', '/activations?scope=global')).json.activations.find((a: Json) => a.state === 'ACTIVE')?.versionId as string | undefined;
const dataHashOf = async (id: string) => (await app.get(GamePlanets).fullState(id)).dataHash;
const expectedHash = async (versionId: string) => compileProfile((await app.get(EconomyProfileService).get('baseline', Number(versionId.split('@')[1]))).content, flags).dataHash;
const act = (versionId: string, expectedPrev: string | null, extra: Json = {}) =>
  call('POST', '/activations', { requestId: `act-${++n}`, versionId, expectedPreviousVersionId: expectedPrev, nonProduction: true, ...extra });

beforeAll(async () => {
  db = await createTestDatabase();
  await seed({ prisma: db.prisma, log: () => undefined });
  await boot();
}, 120_000);
afterAll(async () => { await app?.close(); await db?.drop(); });

describe('activation roles', () => {
  it('only the activate token activates; read and edit (AI) tokens get 403, activate cannot edit', async () => {
    const body = { requestId: 'r-role', versionId: 'baseline@1', expectedPreviousVersionId: 'baseline@1', nonProduction: true };
    expect((await call('POST', '/activations', body, DEV_ECONOMY_EDIT_TOKEN)).status).toBe(403);
    expect((await call('POST', '/activations', body, DEV_ECONOMY_READ_TOKEN)).status).toBe(403);
    expect((await call('POST', '/activations', body, null)).status).toBe(401);
    expect((await call('POST', '/activations/x/rollback', { requestId: 'r-role2' }, DEV_ECONOMY_EDIT_TOKEN)).status).toBe(403);
    expect((await call('POST', '/profiles/baseline/versions/1/approve', { requestId: 'r-role3' }, DEV_ECONOMY_EDIT_TOKEN)).status).toBe(403);
    expect((await call('POST', '/profiles/baseline/versions/1/clone', { requestId: 'r-role4' }, DEV_ECONOMY_ACTIVATE_TOKEN)).status).toBe(403);
    expect((await call('GET', '/activations', undefined, DEV_ECONOMY_READ_TOKEN)).status).toBe(200);
  });
});

describe('activation: evidence gate, effective tick, live swap', () => {
  it('needs evidence unless a non-production sandbox, and the evidence must be a passing run of that candidate', async () => {
    const v2 = await approvedVersion(80);
    const noEvidence = await call('POST', '/activations', { requestId: 'ev-0', versionId: v2, expectedPreviousVersionId: 'baseline@1' });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.json.error.details.errors[0]).toMatchObject({ code: 'invalid_manifest', path: 'evidenceRunId' });
    await db.prisma.economyScenario.create({ data: { id: 's1', version: 1, manifest: {}, hash: 'h' } });
    await db.prisma.economyExperiment.create({ data: { id: 'e1', requestId: 'rq-e1', manifest: {}, manifestHash: 'h', status: 'completed' } });
    const run = (id: string, candidateId: string, status: string, seedN: number) =>
      db.prisma.economyExperimentRun.create({ data: { id, experimentId: 'e1', candidateId, scenarioId: 's1', scenarioVersion: 1, seed: seedN, status } });
    await run('run-bad', v2, 'completed', 1);
    await db.prisma.economyGateResult.create({ data: { runId: 'run-bad', gateId: 'fill', gateVersion: 1, outcome: 'fail', observed: 1, threshold: '2' } });
    await run('run-other', 'baseline@1', 'completed', 2);
    await db.prisma.economyGateResult.create({ data: { runId: 'run-other', gateId: 'fill', gateVersion: 1, outcome: 'pass', observed: 3, threshold: '2' } });
    await run('run-ok', v2, 'completed', 3);
    await db.prisma.economyGateResult.create({ data: { runId: 'run-ok', gateId: 'fill', gateVersion: 1, outcome: 'pass', observed: 3, threshold: '2' } });
    for (const id of ['run-bad', 'run-other', 'nope']) {
      const r = await call('POST', '/activations', { requestId: `ev-${id}`, versionId: v2, expectedPreviousVersionId: 'baseline@1', evidenceRunId: id });
      expect(r.status, id).toBe(422);
    }

    // A planet loaded before the activation swaps live at its effective tick.
    const planetId = newId('pl');
    await app.get(GamePlanets).load(planetId);
    const before = await dataHashOf(planetId);
    const ok = await call('POST', '/activations', { requestId: 'ev-ok', versionId: v2, expectedPreviousVersionId: 'baseline@1', evidenceRunId: 'run-ok', effectiveTick: 0 });
    expect(ok.status).toBe(202);
    expect(ok.json.activation).toMatchObject({ state: 'PENDING', versionId: v2, previousId: 'act_baseline_1', evidenceRunId: 'run-ok' });
    await waitFor(async () => (await activeVersion()) === v2);
    const applied = (await call('GET', '/activations?scope=global')).json.activations;
    expect(applied.find((a: Json) => a.versionId === 'baseline@1').state).toBe('SUPERSEDED');
    expect(applied.find((a: Json) => a.versionId === v2)).toMatchObject({ state: 'ACTIVE', appliedTick: 0 });
    const want = await expectedHash(v2);
    expect(want).not.toBe(before);
    await waitFor(async () => (await dataHashOf(planetId)) === want);
    const replay = await call('POST', '/activations', { requestId: 'ev-ok', versionId: v2, expectedPreviousVersionId: 'baseline@1', evidenceRunId: 'run-ok' });
    expect(replay.json).toMatchObject({ replayed: true, activation: { id: ok.json.activation.id } });
  }, 120_000);

  it('a future effective tick keeps the planet on the old data until it gets there', async () => {
    const current = (await activeVersion()) as string;
    const v = await approvedVersion(70);
    const planetId = newId('pl');
    await app.get(GamePlanets).load(planetId);
    const before = await dataHashOf(planetId);
    const r = await act(v, current, { effectiveTick: 1_000_000_000 });
    expect(r.status).toBe(202);
    await waitFor(async () => (await activeVersion()) === v); // the host acknowledged: threads hold it
    await new Promise((res) => setTimeout(res, 600));
    expect(await dataHashOf(planetId)).toBe(before);
    await act(current, v); // restore the previous version for the next test (effective now)
    await waitFor(async () => (await activeVersion()) === current);
  }, 120_000);
});

describe('activation: compare-and-swap, rollback, crash, pinned orders, fail closed', () => {
  it('concurrent activations with the same expected previous: one wins, the other gets version_conflict', async () => {
    const current = (await activeVersion()) as string;
    const [a, b] = [await approvedVersion(60), await approvedVersion(65)];
    const results = await Promise.all([act(a, current), act(b, current)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
    const winner = results.find((r) => r.status === 202) as { json: Json };
    await waitFor(async () => (await activeVersion()) === winner.json.activation.versionId);
    expect((await act(a, 'baseline@1')).status).toBe(409); // wrong expected previous
    const rows = await db.prisma.economyActivation.findMany({ where: { scope: 'global', state: 'ACTIVE' } });
    expect(rows).toHaveLength(1);
  }, 120_000);

  it('rollback schedules the previous immutable version and never touches orders', async () => {
    const orders = new MarketOrderRepository(db.prisma);
    const hashOf = async () => (await call('GET', '/resolve', undefined, DEV_ECONOMY_READ_TOKEN)).json.marketPolicyHash as string;
    const order = (i: number, policyHash: string) => ({
      orderId: `ord-${i}`, ref: `market-order:c${i}:${i}`, planetId: 'p1', pair: 'bio.water/USDC', base: 'bio.water', quote: 'USDC', side: 'sell' as const, colonyId: `c${i}`, accountId: `a${i}`,
      stallColonyId: `c${i}`, stallAccountId: `a${i}`, platformAccountId: 'platform', amount: 10n, priceAmount: 1000n, fillPolicy: 'partial', policyVersion: 'bootstrap-1', policyHash,
      platformFeeBp: 100, stallFeeBp: 100, maxStallFeeBp: null, ttlS: 3600, expiresAt: new Date('2031-01-01T00:00:00Z'),
    });
    const active = (await db.prisma.economyActivation.findFirst({ where: { scope: 'global', state: 'ACTIVE' } }))!;
    const h1 = await hashOf();
    await orders.createFromRequest(order(1, h1));
    const rb = await call('POST', `/activations/${active.id}/rollback`, { requestId: 'rb-1', effectiveTick: 0 });
    expect(rb.status).toBe(202);
    const prevVersion = (await db.prisma.economyActivation.findUnique({ where: { id: active.previousId! } }))!.versionId;
    expect(rb.json.activation).toMatchObject({ versionId: prevVersion, state: 'PENDING' });
    await waitFor(async () => (await activeVersion()) === prevVersion);
    const h2 = await hashOf();
    expect(h2).not.toBe(h1);
    await orders.createFromRequest(order(2, h2));
    const rows = await db.prisma.marketOrder.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.policyHash)).toEqual([h1, h2]); // the old order kept its pinned policy
    expect((await call('POST', `/activations/${active.id}/rollback`, { requestId: 'rb-2' })).status).toBe(409); // no longer ACTIVE
  }, 120_000);

  it('crash between write and apply: the PENDING row is applied on the next boot, the chosen version survives reload', async () => {
    const current = (await activeVersion()) as string;
    const v = await approvedVersion(55);
    await app.close(); // simulated crash: the activation row is written, the host never applied it
    const prev = (await db.prisma.economyActivation.findFirst({ where: { scope: 'global', state: 'ACTIVE' } }))!;
    await db.prisma.economyActivation.create({ data: { id: 'act_crash', scope: 'global', versionId: v, previousId: prev.id, requestedTick: 0n, state: 'PENDING', operator: 'activate' } });
    await boot();
    await waitFor(async () => (await activeVersion()) === v);
    expect(current).not.toBe(v);
    const planetId = newId('pl');
    await app.get(GamePlanets).load(planetId);
    expect(await dataHashOf(planetId)).toBe(await expectedHash(v));
    await app.close(); // reload again: still the chosen version (booted straight from the ACTIVE row)
    await boot();
    const p2 = newId('pl');
    await app.get(GamePlanets).load(p2);
    expect(await dataHashOf(p2)).toBe(await expectedHash(v));
    expect(await db.prisma.economyActivation.count({ where: { scope: 'global', state: 'ACTIVE' } })).toBe(1);
  }, 180_000);

  it('market commands fail closed when no version can be loaded, and pass when one is', async () => {
    const input = { kind: 'market.placeOrder', args: {}, playerId: 'p', planetId: 'pl', colony: null, dev: false };
    expect(await app.get(CommandPrechecks).run(input)).toBeNull();
    const dead = await createApp({ source: source({ DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/none' }) });
    try {
      await dead.app.init();
      expect(dead.app.get(EconomyProfileService).loadState).toBe('unavailable');
      expect(await dead.app.get(CommandPrechecks).run(input)).toMatchObject({ code: 'market_unavailable' });
      expect(await dead.app.get(CommandPrechecks).run({ ...input, kind: 'market.cancelOrder' })).toBeNull();
    } finally {
      await dead.app.close();
    }
  }, 120_000);
});
