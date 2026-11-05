import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import seed from '../../../../shared/db/seeds/0002_economy_baseline';
import { createApp } from '../../src/app';
import { DEV_ECONOMY_ACTIVATE_TOKEN, DEV_ECONOMY_EDIT_TOKEN, DEV_ECONOMY_READ_TOKEN } from '../../src/economy/economy-auth';
import { ExperimentJobService } from '../../src/economy/experiments/experiment-job.service';
import { EconomyProfileService } from '../../src/economy/profile/profile.service';

/** W13-45: persistent bounded experiment jobs. Real Postgres, real worker threads, short runs. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: TestDatabase;
let app: INestApplication;
let url: string;
let jobs: ExperimentJobService;
let hash: string;
const dir = mkdtempSync(join(tmpdir(), 'exp-art-'));

const manifest = (over: Json = {}): Json => ({
  schemaVersion: 1, profile: { id: 'baseline', version: 1, hash }, engineCommit: 'workspace', waves: '..13', scenarios: [{ id: 'baseline-two-colony', version: 1 }],
  seeds: [101], warmupTicks: 50, measureTicks: 400, sampleEveryTicks: 200, ticksPerSecond: 5, budget: { maxRuns: 8, maxWallSeconds: 120, maxWorkers: 1 },
  behaviorProfile: 'specialists-v1', demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' }, ...over,
});
const call = async (method: string, path: string, body?: unknown, token: string | null = DEV_ECONOMY_EDIT_TOKEN) => {
  const res = await fetch(`${url}/v1/economy${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, text, json: (text.startsWith('{') ? JSON.parse(text) : {}) as Json };
};
const submit = (requestId: string, m: Json = manifest()) => call('POST', '/experiments', { requestId, manifest: m });
const OWN = ['experiment', 'experiment_run', 'metric', 'gate_result', 'scenario'];

/** Row counts of every table except the experiment ones: what "production state untouched" compares. */
async function fingerprint(): Promise<Record<string, number>> {
  const tables = await db.prisma.$queryRawUnsafe<{ table_schema: string; table_name: string }[]>(
    `SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2`);
  const out: Record<string, number> = {};
  for (const t of tables) {
    if (t.table_schema === 'economy' && OWN.includes(t.table_name)) continue;
    if (t.table_name === '_prisma_migrations') continue;
    const [r] = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t.table_schema}"."${t.table_name}"`);
    out[`${t.table_schema}.${t.table_name}`] = Number(r!.n);
  }
  return out;
}

beforeAll(async () => {
  db = await createTestDatabase();
  await seed({ prisma: db.prisma, log: () => undefined });
  ({ app } = await createApp({ source: { NODE_ENV: 'test', SNAPSHOTS: 'off', SIM_THREADS: '1', DATABASE_URL: db.url, TA_ECONOMY_ARTIFACT_DIR: dir, TA_ECONOMY_EXPERIMENT_LEASE_MS: '1000' } }));
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  jobs = app.get(ExperimentJobService);
  hash = (await app.get(EconomyProfileService).export('baseline', 1)).ref.hash;
}, 120_000);
afterAll(async () => { await app?.close(); await db?.drop(); rmSync(dir, { recursive: true, force: true }); });

describe('submit', () => {
  it('is idempotent per requestId, answers 202 with an id (never a result), and refuses a different manifest', async () => {
    const a = await submit('req-1');
    expect(a.status).toBe(202);
    expect(a.json.status).toBe('queued');
    const b = await submit('req-1');
    expect(b.json.id).toBe(a.json.id);
    expect(b.json.replayed).toBe(true);
    expect(await db.prisma.economyExperiment.count({ where: { requestId: 'req-1' } })).toBe(1);
    expect(await db.prisma.economyExperimentRun.count({ where: { experimentId: a.json.id } })).toBe(1);
    expect((await submit('req-1', manifest({ seeds: [999] }))).status).toBe(409);
    expect((await submit('req-bad', manifest({ profile: { id: 'baseline', version: 1, hash: 'sha256:00' } }))).status).toBe(409);
    expect((await submit('req-bad2', manifest({ scenarios: [{ id: 'nope', version: 1 }] }))).status).toBe(422);
  });

  it('needs the edit token: read and activate tokens get 403', async () => {
    expect((await call('POST', '/experiments', { requestId: 'r-x', manifest: manifest() }, DEV_ECONOMY_READ_TOKEN)).status).toBe(403);
    expect((await call('POST', '/experiments', { requestId: 'r-x', manifest: manifest() }, DEV_ECONOMY_ACTIVATE_TOKEN)).status).toBe(403);
    expect((await call('GET', '/experiments', undefined, DEV_ECONOMY_READ_TOKEN)).status).toBe(200);
  });
});

describe('jobs', () => {
  it('runs to completion, stores sampled metrics, gates and checksummed artifacts, and touches no production table', async () => {
    const before = await fingerprint();
    const sub = await submit('req-run', manifest({ seeds: [101, 202] }));
    jobs.start();
    await jobs.idle();
    const st = (await call('GET', `/experiments/${sub.json.id}`, undefined, DEV_ECONOMY_READ_TOKEN)).json;
    expect(st.status).toBe('completed');
    expect(st.counts).toEqual({ completed: 2 });
    expect(st.progress.outcome).toBe('pass');
    expect(st.runs[0].gates.map((g: Json) => g.gateId)).toContain('hard.flow_reconciliation');
    expect(await db.prisma.economyMetric.count({ where: { runId: st.runs[0].id } })).toBeGreaterThan(10);
    const csv = await call('GET', `/experiments/${sub.json.id}/artifacts/run-0000-metrics.csv`, undefined, DEV_ECONOMY_READ_TOKEN);
    expect(csv.status).toBe(200);
    expect(csv.text.split('\n')[0]).toContain('metricKey');
    expect((await call('GET', `/experiments/${sub.json.id}/artifacts/summary.json`)).json.outcome).toBe('pass');
    expect((await call('GET', `/experiments/${sub.json.id}/artifacts/nope.json`)).status).toBe(404);
    expect(st.runs[0].artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint()).toEqual(before);
    // the same job + a fresh queue pass never re-runs a completed run
    await jobs.pump();
    expect(await db.prisma.economyExperimentRun.count({ where: { experimentId: sub.json.id } })).toBe(2);
  }, 120_000);

  it('a restart mid-run (expired lease) resumes the run without a duplicate row', async () => {
    const sub = await submit('req-crash', manifest({ seeds: [7, 8] }));
    const id = `${sub.json.id}_r0000`;
    await jobs.stop();
    await db.prisma.economyExperimentRun.update({ where: { id }, data: { status: 'running', hashes: { lease: { owner: 'dead-process', expiresAt: new Date(Date.now() - 5000).toISOString() } } } });
    await db.prisma.economyExperiment.update({ where: { id: sub.json.id }, data: { status: 'running' } });
    jobs.start(); // "restart"
    await jobs.idle();
    const st = (await call('GET', `/experiments/${sub.json.id}`)).json;
    expect(st.status).toBe('completed');
    expect(st.runs).toHaveLength(2);
    expect(st.runs.map((r: Json) => r.status)).toEqual(['completed', 'completed']);
    expect(await db.prisma.economyExperimentRun.count({ where: { experimentId: sub.json.id } })).toBe(2);
    expect(await db.prisma.economyMetric.count({ where: { runId: id } })).toBeGreaterThan(10);
  }, 120_000);

  it('a live (unexpired) lease of another worker is not reclaimed', async () => {
    const sub = await submit('req-live', manifest({ seeds: [9] }));
    const id = `${sub.json.id}_r0000`;
    await db.prisma.economyExperimentRun.update({ where: { id }, data: { status: 'running', hashes: { lease: { owner: 'other', expiresAt: new Date(Date.now() + 600_000).toISOString() } } } });
    await db.prisma.economyExperiment.update({ where: { id: sub.json.id }, data: { status: 'running' } });
    await jobs.pump();
    expect((await db.prisma.economyExperimentRun.findUniqueOrThrow({ where: { id } })).status).toBe('running');
    await call('POST', `/experiments/${sub.json.id}/cancel`);
  });

  it('a wall-time timeout yields incomplete, never a pass', async () => {
    const sub = await submit('req-timeout', manifest({ seeds: [1, 2], measureTicks: 60_000, sampleEveryTicks: 20_000, budget: { maxRuns: 8, maxWallSeconds: 1, maxWorkers: 1 } }));
    await jobs.idle(60_000);
    const st = (await call('GET', `/experiments/${sub.json.id}`)).json;
    expect(st.status).toBe('incomplete');
    expect(st.progress.outcome).toBe('incomplete');
    expect(st.runs.every((r: Json) => r.status === 'incomplete')).toBe(true);
  }, 90_000);

  it('maxRuns below the plan leaves the rest incomplete; cancel then resume finishes the queued runs', async () => {
    const capped = await submit('req-cap', manifest({ seeds: [1, 2], budget: { maxRuns: 1, maxWallSeconds: 120, maxWorkers: 1 } }));
    await jobs.idle();
    const st = (await call('GET', `/experiments/${capped.json.id}`)).json;
    expect(st.status).toBe('incomplete');
    expect(st.counts).toEqual({ completed: 1, incomplete: 1 });
    const c = await submit('req-cancel', manifest({ seeds: [3] }));
    await jobs.stop();
    const cancelled = await call('POST', `/experiments/${c.json.id}/cancel`);
    expect(cancelled.json.status).toBe('cancelled');
    expect(cancelled.json.runs[0].status).toBe('cancelled');
    const resumed = await call('POST', `/experiments/${c.json.id}/resume`);
    expect(resumed.status).toBe(202);
    expect(resumed.json.status).toBe('queued');
    jobs.start();
    await jobs.idle();
    expect((await call('GET', `/experiments/${c.json.id}`)).json.status).toBe('completed');
    expect((await call('POST', `/experiments/${c.json.id}/resume`)).status).toBe(409);
  }, 120_000);
});
