import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import seed from '../../../../shared/db/seeds/0002_economy_baseline';
import { createApp } from '../../src/app';
import { DEV_ECONOMY_ACTIVATE_TOKEN, DEV_ECONOMY_EDIT_TOKEN } from '../../src/economy/economy-auth';
import { ExperimentJobService } from '../../src/economy/experiments/experiment-job.service';
import type { ApiContext } from '../../../../scripts/economy/api-client';
import { runCli } from '../../../../scripts/economy/cli-lib';
import type { CliIo } from '../../../../scripts/economy/commands';

/** W13-46: an AI goes from candidate to report with JSON alone, through the CLI functions only. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: TestDatabase;
let app: INestApplication;
let ctx: ApiContext;
let jobs: ExperimentJobService;
const files = new Map<string, string>();
const io: CliIo = { readFile: (p) => { const t = files.get(p); if (t === undefined) throw new Error(`no such file ${p}`); return t; }, writeFile: (p, t) => void files.set(p, t), readStdin: () => '' };
const cli = async (...argv: string[]): Promise<{ code: number; out: Json }> => { const r = await runCli(argv, ctx, io); return { code: r.code, out: r.out as Json }; };

const manifest = (hash: string): Json => ({
  schemaVersion: 1, profile: { id: 'baseline', version: 0, hash }, engineCommit: 'workspace', waves: '..13', scenarios: [{ id: 'baseline-two-colony', version: 1 }],
  seeds: [101], warmupTicks: 50, measureTicks: 400, sampleEveryTicks: 200, ticksPerSecond: 5, budget: { maxRuns: 4, maxWallSeconds: 120, maxWorkers: 1 },
  behaviorProfile: 'specialists-v1', demandModel: { source: 'assumed', perPayingActorMonthlyBudgetUsdcAtomic: '30000000' }, output: { format: 'jsonl', trace: 'failures' },
});

beforeAll(async () => {
  db = await createTestDatabase();
  await seed({ prisma: db.prisma, log: () => undefined });
  ({ app } = await createApp({ source: { NODE_ENV: 'test', SNAPSHOTS: 'off', SIM_THREADS: '1', DATABASE_URL: db.url } }));
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  ctx = { base, editToken: DEV_ECONOMY_EDIT_TOKEN, activateToken: DEV_ECONOMY_EDIT_TOKEN, fetch };
  jobs = app.get(ExperimentJobService);
}, 120_000);
afterAll(async () => { await app?.close(); await db?.drop(); });

describe('candidate to report with JSON alone', () => {
  it('schema -> clone -> patch -> validate -> simulate x2 -> status -> compare -> recommend; activation with the run token is refused', async () => {
    const activations = await db.prisma.economyActivation.count();
    const schema = await cli('schema', '--json');
    expect(schema.code).toBe(0);
    expect(JSON.stringify(schema.out)).toContain('market.policy.platformFeeBp');

    const clone = await cli('profile', 'clone', '--from', 'baseline:1', '--name', 'fee-150', '--json');
    expect(clone.code).toBe(0);
    const v = clone.out.version.version.version as number;
    files.set('patch.json', JSON.stringify({ ops: [{ op: 'set', path: 'market.policy.platformFeeBp', value: 150 }] }));
    const patch = await cli('profile', 'patch', '--id', `baseline:${v}`, '--file', 'patch.json', '--json');
    expect(patch.code).toBe(0);
    expect((await cli('validate', '--profile', `baseline:${v}`, '--json')).out.valid).toBe(true);
    expect((await cli('profile', 'export', '--id', `baseline:${v}`, '--out', 'cand.json')).code).toBe(0);
    const cand = JSON.parse(files.get('cand.json')!) as Json;
    expect(cand.content.parameters['market.policy.platformFeeBp']).toBe(150);
    expect((await cli('profile', 'resolve', '--planet', 'pl_x', '--json')).code).toBe(0);

    const baseRef = (await cli('profile', 'export', '--id', 'baseline:1')).out.ref;
    files.set('base.json', JSON.stringify({ ...manifest(baseRef.hash), profile: { id: 'baseline', version: 1, hash: baseRef.hash } }));
    files.set('cand-m.json', JSON.stringify({ ...manifest(cand.ref.hash), profile: { id: 'baseline', version: v, hash: cand.ref.hash } }));
    const b = await cli('simulate', '--manifest', 'base.json', '--json');
    const c = await cli('simulate', '--manifest', 'cand-m.json', '--json');
    expect([b.code, c.code]).toEqual([0, 0]);
    expect(c.out.status).toBe('queued'); // an id, never a completion
    expect((await cli('simulate', '--manifest', 'cand-m.json')).out.id).toBe(c.out.id); // idempotent resubmission

    jobs.start();
    await jobs.idle();
    const st = await cli('experiment', 'status', '--id', c.out.id);
    expect(st.code).toBe(0);
    expect(st.out.status).toBe('completed');

    const cmp = await cli('compare', '--baseline', b.out.id, '--candidate', c.out.id, '--json');
    expect(cmp.code).toBe(0);
    expect(cmp.out.ok).toBe(true);
    const fee = cmp.out.pairs[0].deltas.find((d: Json) => d.metricKey === 'market.fee.platform');
    expect(fee).toBeDefined();
    expect(cmp.out.pairs[0].gates.map((g: Json) => g.gateId)).toContain('hard.flow_reconciliation');

    const rec = await cli('recommend', '--experiment', c.out.id, '--json');
    expect(rec.code).toBe(0);
    expect(rec.out.decision).toBe('recommend');
    expect(rec.out.patch.ops).toEqual([{ op: 'set', path: 'market.policy.platformFeeBp', value: 150 }]);
    expect(rec.out.evidence.baselineId).toBe(b.out.id);
    expect(rec.out.activation).toMatch(/never performed/);
    expect(await db.prisma.economyActivation.count()).toBe(activations);

    // permissions: the run/edit token cannot activate or roll back (403 -> exit 2); the operator token is accepted
    const denied = await cli('activate', '--version', `baseline:${v}`, '--expected-previous', 'none', '--non-production', '--json');
    expect(denied.code).toBe(2);
    expect(denied.out.error.kind).toBe('forbidden');
    expect((await cli('rollback', '--id', 'act_x')).code).toBe(2);
    ctx = { ...ctx, activateToken: DEV_ECONOMY_ACTIVATE_TOKEN };
    expect((await cli('rollback', '--id', 'act_x')).code).toBe(2); // right token, unknown activation: invalid input, not 403
    expect((await cli('rollback', '--id', 'act_x')).out.error.kind).not.toBe('forbidden');
    ctx = { ...ctx, activateToken: DEV_ECONOMY_EDIT_TOKEN };
    expect(await db.prisma.economyActivation.count()).toBe(activations);
  }, 120_000);

  it('exit codes: bad input 2, unknown experiment 2, unreachable API 4, failing validation 2, cancelled stays 0', async () => {
    expect((await cli('nope')).code).toBe(2);
    expect((await cli('profile', 'clone')).code).toBe(2);
    expect((await cli('experiment', 'status', '--id', 'exp_missing')).code).toBe(2);
    files.set('bad.json', JSON.stringify({ ops: [{ op: 'set', path: 'market.policy.nope', value: 1 }] }));
    const clone = await cli('profile', 'clone', '--from', 'baseline:1');
    const v = clone.out.version.version.version as number;
    expect((await cli('profile', 'patch', '--id', `baseline:${v}`, '--file', 'bad.json')).code).toBe(2);
    const down = await runCli(['schema'], { ...ctx, base: 'http://127.0.0.1:1' }, io);
    expect(down.code).toBe(4);
  });
});
