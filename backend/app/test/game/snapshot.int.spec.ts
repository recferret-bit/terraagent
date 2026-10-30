import 'reflect-metadata';
import { gunzipSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { createPlanet, restore, snapshot } from '@terra/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { GamePlanets } from '../../src/game/game-planets.service';
import { devPlanetIds } from '../../src/game/dev-planets';
import { SnapshotStore } from '../../src/game/persistence/snapshot-store';

let db: TestDatabase;
let store: SnapshotStore;
beforeAll(async () => {
  db = await createTestDatabase();
  store = new SnapshotStore(db.prisma);
});
afterAll(async () => { await db.drop(); });

const state = (seed: string) => createPlanet({ type: 'flat', seed, planetId: `pl_${seed}` });

describe('SnapshotStore', () => {
  it('round-trips: restore(gunzip(data)) deep-equals the state', async () => {
    const s = state('rt');
    const raw = snapshot(s);
    const saved = await store.save('pl_rt', 5, 'PERIODIC', raw);
    expect(saved.sizeBytes).toBeLessThan(saved.rawBytes);
    const row = await db.prisma.planetSnapshot.findFirstOrThrow({ where: { planetId: 'pl_rt' } });
    expect(row.codec).toBe('msgpack+gz');
    expect(restore(new Uint8Array(gunzipSync(row.data)))).toEqual(s);
    const latest = await store.latest('pl_rt');
    expect(latest?.tick).toBe(5);
    expect(restore(latest!.raw)).toEqual(s);
    expect(await store.latest('pl_none')).toBeNull();
  });

  it('falls back to the previous snapshot when the crc does not match', async () => {
    const id = 'pl_crc';
    await store.save(id, 1, 'PERIODIC', snapshot(state('crc1')));
    await store.save(id, 2, 'PERIODIC', snapshot(state('crc2')));
    const bad: bigint[] = [];
    await db.prisma.$executeRaw`UPDATE world.planet_snapshot SET crc32 = crc32 + 1 WHERE planet_id = ${id} AND tick = 2`;
    const latest = await store.latest(id, (t) => bad.push(t));
    expect(latest?.tick).toBe(1);
    expect(bad).toEqual([2n]);
  });

  it('livePlanetIds skips planets whose newest snapshot is END', async () => {
    await store.save('pl_live', 1, 'PERIODIC', snapshot(state('l')));
    await store.save('pl_done', 1, 'PERIODIC', snapshot(state('d1')));
    await store.save('pl_done', 2, 'END', snapshot(state('d2')));
    const ids = await store.livePlanetIds();
    expect(ids).toContain('pl_live');
    expect(ids).not.toContain('pl_done');
  });

  it('prune keeps last 10 + first of each hour for 48 h (+ END / last SEAL)', async () => {
    const id = 'pl_prune';
    const now = new Date('2026-03-01T12:30:00Z');
    const raw = new Uint8Array([1, 2, 3]);
    for (let i = 1; i <= 30; i++) await store.save(id, i, 'PERIODIC', raw, new Date(now.getTime() - (30 - i) * 20 * 60_000)); // every 20 min
    await store.save(id, 0, 'END', raw, new Date(now.getTime() - 100 * 3600_000));
    await store.save(id, 100, 'PERIODIC', raw, new Date(now.getTime() - 100 * 3600_000)); // older than 48 h, but in the last 10? tick 100 is the newest
    const deleted = await store.prune(id, now);
    const left = (await db.prisma.planetSnapshot.findMany({ where: { planetId: id }, orderBy: { tick: 'asc' } })).map((r) => Number(r.tick));
    expect(deleted).toBeGreaterThan(0);
    expect(left).toContain(0); // END
    expect(left).toContain(100);
    for (let i = 22; i <= 30; i++) expect(left).toContain(i); // last 10 includes 100 + 22..30
    expect(left.length).toBeLessThan(31);
  });
});

describe('boot restore', () => {
  it('app B resumes the dev planet at the tick app A reached', async () => {
    const source = { NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_URL: db.url, SIM_THREADS: '1', GAME_DEV_PLANETS: '1', SNAPSHOT_EVERY_S: '30' };
    const id = devPlanetIds(1, 1)[0]!;
    const tickOf = async (app: INestApplication) => (await app.get(GamePlanets).pool.stats()).flatMap((s) => s.planets).find((p) => p.planetId === id)?.tick ?? -1;

    const a = await createApp({ source });
    await a.app.listen(0, '127.0.0.1');
    await expect.poll(() => tickOf(a.app), { timeout: 15_000, interval: 200 }).toBeGreaterThan(20);
    const before = await tickOf(a.app);
    await a.app.close(); // SHUTDOWN snapshot
    const row = await db.prisma.planetSnapshot.findFirstOrThrow({ where: { planetId: id }, orderBy: { tick: 'desc' } });
    expect(row.kind).toBe('SHUTDOWN');
    expect(Number(row.tick)).toBeGreaterThanOrEqual(before);

    const b = await createApp({ source });
    await b.app.listen(0, '127.0.0.1');
    try {
      const first = await tickOf(b.app);
      expect(first).toBeGreaterThanOrEqual(Number(row.tick));
      await expect.poll(() => tickOf(b.app), { timeout: 5_000, interval: 200 }).toBeGreaterThan(first);
    } finally {
      await b.app.close();
    }
  }, 60_000);
});
