import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { ReadinessRegistry } from '../../src/core/readiness.registry';
import { JobsService } from '../../src/jobs/jobs.service';
import { ensurePlanetActivityTable } from '../game/fixtures/planet-activity-table';

let db: TestDatabase;
let app: INestApplication | undefined;
beforeAll(async () => {
  db = await createTestDatabase();
  await ensurePlanetActivityTable(db.prisma);
});
afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('a booted app runs its loops as pg-boss jobs (3.8)', () => {
  it('registers every converted loop queue (cluster, sim-host, instance and planet jobs) and reports readiness', async () => {
    const source = {
      NODE_ENV: 'development', LOG_LEVEL: 'silent', DATABASE_URL: db.url, SIM_THREADS: '1', SNAPSHOTS: 'on',
      TA_WORKER_ID: 'boot-spec', TA_SEED_RIVAL_AI: '1', GAME_DEV_PLANETS: '0',
    };
    ({ app } = await createApp({ source }));
    await app.listen(0, '127.0.0.1');
    const jobs = app.get(JobsService);
    await jobs.whenStarted();
    expect(jobs.port.kind).toBe('pgboss');
    await expect.poll(async () => (await jobs.port.stats()).map((s) => s.queue), { timeout: 20_000, interval: 250 }).toEqual(
      expect.arrayContaining([
        'near.bounty-expiry',
        'near.staking-position-sync',
        'near.treasury-finalize',
        'notify.council-away',
        'market.order-expiry',
        'market.progression-replay',
        'market.canonical-bots',
        'market.director/boot-spec',
        'market.guild-visit/boot-spec',
        'market.guild-visit.sweep/boot-spec',
        'planet.lifecycle/boot-spec',
        'planet.lifecycle.sweep/boot-spec',
      ]),
    );
    const ready = await app.get(ReadinessRegistry).run();
    expect(ready.body.jobs).toBe('pgboss');
  }, 90_000);
});
