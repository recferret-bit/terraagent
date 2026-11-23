import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobsService } from '../../src/jobs/jobs.service';
import { PgBossJobQueue } from '../../src/jobs/pgboss/pgboss-job-queue';
import { PlanetGameClock } from '../../src/market/orders/expiry-clock';
import { OrderExpirySweep } from '../../src/market/orders/expiry-sweep';
import { jobQueueContract } from './job-queue.contract';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

const pgboss = () => new PgBossJobQueue({ connectionString: db.url, schema: 'pgboss', poolMax: 3 });

// Same suite as the memory adapter, against real Postgres (pg-boss installs its own `pgboss` schema on start).
jobQueueContract('pg-boss', async () => ({ port: pgboss(), close: async () => undefined }), { pollMs: 500, exactStats: false });

describe('pg-boss: a converted loop runs once per interval across two app instances', () => {
  it('two replicas each start the order-expiry sweep job; each 2 s slot runs one sweep in total', async () => {
    const env = { NODE_ENV: 'test', DATABASE_URL: db.url } as never;
    const replica = async (instanceKey: string) => {
      const jobs = new JobsService(pgboss(), { instanceKey, simRole: 'all' });
      const sweep = new OrderExpirySweep({} as never, new PlanetGameClock(), db.prisma, env, { onWarp: () => () => undefined } as never, jobs);
      const calls: number[] = [];
      vi.spyOn(sweep, 'sweep').mockImplementation(async () => { calls.push(Date.now()); return []; });
      sweep.start(2_000);
      jobs.onApplicationBootstrap();
      await jobs.whenStarted();
      return { jobs, sweep, calls };
    };
    const a = await replica('replica-a');
    const b = await replica('replica-b');
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 7_500));
    const elapsedSlots = Math.floor((Date.now() - t0) / 2_000);
    await a.sweep.stop();
    await b.sweep.stop();
    await a.jobs.onModuleDestroy();
    await b.jobs.onModuleDestroy();

    const all = [...a.calls, ...b.calls].sort((x, y) => x - y);
    const slots = all.map((t) => Math.floor((t - 1_000) / 2_000)); // fired mid-slot, run shortly after
    expect(all.length).toBeGreaterThanOrEqual(elapsedSlots - 1);
    expect(all.length).toBeLessThanOrEqual(elapsedSlots + 1);
    expect(new Set(slots).size).toBe(slots.length); // never two sweeps in one slot, although both replicas fired
  }, 30_000);
});

describe('pg-boss: a queue that already exists takes its new definition', () => {
  it('re-defining a loop queue turns its retries off and clears a dead-letter queue it no longer names', async () => {
    const settings = async (name: string) =>
      (await db.prisma.$queryRawUnsafe<{ retry_limit: number; dead_letter: string | null }[]>(`SELECT retry_limit, dead_letter FROM pgboss.queue WHERE name = '${name}'`))[0];
    const first = pgboss(); // the build that created the queue: two retries, then `<name>.dead`
    await first.start();
    await first.createQueue({ name: 'test.redefine', policy: 'exclusive', retryLimit: 2, deadLetter: 'test.redefine.dead', deleteAfterSeconds: 3600 });
    expect(await settings('test.redefine')).toEqual({ retry_limit: 2, dead_letter: 'test.redefine.dead' });
    await first.stop();
    const next = pgboss(); // the next deploy defines the same queue without retries or a dead-letter queue
    await next.start();
    await next.createQueue({ name: 'test.redefine', policy: 'exclusive', retryLimit: 0, deleteAfterSeconds: 3600 });
    expect(await settings('test.redefine')).toEqual({ retry_limit: 0, dead_letter: null });
    await next.stop();
  }, 30_000);
});
