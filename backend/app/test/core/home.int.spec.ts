import 'reflect-metadata';
import { AuthResponseSchema, HomeResponseSchema } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

let db: TestDatabase;
beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await db?.drop(); });

async function boot() {
  const { app } = await createApp({
    source: { NODE_ENV: 'test', LOG_LEVEL: 'silent', SIM_THREADS: '1', SNAPSHOTS: 'on', DATABASE_URL: db.url, JWT_ACCESS_SECRET: 'home-int-jwt-secret-0123456789' },
  });
  await app.listen(0, '127.0.0.1');
  return { app, url: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

describe('seating on Postgres (PrismaHomeStore, BE-03/BE-14/LED-14)', () => {
  it('writes the colony and seat count rows, and after a restart answers the same colony on its restored planet', async () => {
    const first = await boot();
    const login = AuthResponseSchema.parse(await (await fetch(`${first.url}/v1/auth/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceSecret: 'home-int-device-secret-0001' }),
    })).json());
    const home = async (url: string) => {
      const res = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${login.accessToken}` } });
      expect(res.status).toBe(200);
      return HomeResponseSchema.parse(await res.json());
    };
    const seated = await home(first.url);
    if (seated.state !== 'ACTIVE') throw new Error('expected ACTIVE');
    const row = await db.prisma.colony.findUnique({ where: { id: seated.colony.id } });
    expect(row).toMatchObject({ playerId: login.player.id, planetId: 'pl_dev', colonyIndex: 0, spawnQ: seated.colony.spawnQ, spawnR: seated.colony.spawnR });
    expect((await db.prisma.planet.findUnique({ where: { id: 'pl_dev' } }))?.seatsTaken).toBe(1);
    await first.app.close(); // shutdown snapshot of pl_dev

    const second = await boot();
    try {
      const again = await home(second.url);
      expect(again).toMatchObject({ state: 'ACTIVE', colony: { id: seated.colony.id }, planet: { id: 'pl_dev' } });
      expect(await db.prisma.colony.count()).toBe(1);
    } finally {
      await second.app.close();
    }
  }, 60_000);
});
