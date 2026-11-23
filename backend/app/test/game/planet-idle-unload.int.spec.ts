import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { DEV_PLANET_CAPACITY, DEV_PLANET_RADIUS, DEV_PLANET_SEED, DEV_PLANET_TYPE } from '@terra/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { GamePlanets } from '../../src/game/game-planets.service';
import { PlanetLifecycleService } from '../../src/game/lifecycle/planet-lifecycle.service';
import { SnapshotService } from '../../src/game/persistence/snapshot.service';
import { ensurePlanetActivityTable } from './fixtures/planet-activity-table';

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
  await ensurePlanetActivityTable(db.prisma);
});
afterAll(async () => { await db?.drop(); });

const PLANET = 'pl_dev';
const params = { type: DEV_PLANET_TYPE, seed: DEV_PLANET_SEED, radius: DEV_PLANET_RADIUS, capacity: DEV_PLANET_CAPACITY };
/** Idle after ~3.6 s without a human, checked every second; no catch-up on restore, so the restored tick is the saved one. */
const source = () => ({
  NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: db.url, SIM_THREADS: '1', SNAPSHOTS: 'on', SNAPSHOT_EVERY_S: '600',
  TA_PLANET_IDLE_UNLOAD_H: '0.001', TA_PLANET_IDLE_CHECK_S: '1', RESTART_FASTRUN_MAX_S: '0',
});

const dormantSince = async () =>
  (await db.prisma.$queryRaw<{ d: Date | null }[]>`SELECT dormant_since AS d FROM world.planet_activity WHERE planet_id = ${PLANET}`)[0]?.d ?? null;

async function boot(): Promise<INestApplication> {
  const { app } = await createApp({ source: source() });
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('idle unload (3.5): idle → snapshotted and unloaded → restored at the same tick', () => {
  it('unloads an idle planet, keeps it dormant across a restart, and restores it on the next join', async () => {
    const a = await boot();
    let sealTick: number;
    try {
      const planets = a.get(GamePlanets);
      await a.get(SnapshotService).loadNew(PLANET, { params });
      expect(planets.isLoaded(PLANET)).toBe(true);
      await expect.poll(() => planets.isLoaded(PLANET), { timeout: 20_000, interval: 200 }).toBe(false);
      const seal = await db.prisma.planetSnapshot.findFirstOrThrow({ where: { planetId: PLANET }, orderBy: { tick: 'desc' } });
      expect(seal.kind).toBe('SEAL');
      sealTick = Number(seal.tick);
      expect(sealTick).toBeGreaterThan(0);
      expect(await dormantSince()).toBeInstanceOf(Date);
      const lease = await db.prisma.simWorkerLease.findUnique({ where: { planetId: PLANET } });
      expect(lease === null || (lease.alivePlayers === 0 && lease.aliveBots === 0)).toBe(true);
      expect(await a.get(PlanetLifecycleService).keepDormant(PLANET)).toBe(true); // a reclaim would not restore it
    } finally {
      await a.close();
    }

    const b = await boot(); // restart: the dormant planet is not restored at boot
    try {
      const planets = b.get(GamePlanets);
      expect(planets.isLoaded(PLANET)).toBe(false);
      const loadedAt = new Promise<number>((resolve) => planets.onPlanetLoaded((id, tick) => { if (id === PLANET) resolve(tick); }));
      expect(await b.get(SnapshotService).restoreIfPersisted(PLANET)).toBe('restored'); // the join / landing path
      expect(await loadedAt).toBe(sealTick);
      const full = await planets.fullState(PLANET);
      expect(full.tick).toBeGreaterThanOrEqual(sealTick);
      await expect.poll(dormantSince, { timeout: 5_000, interval: 100 }).toBeNull();
    } finally {
      await b.close();
    }
  }, 90_000);
});
