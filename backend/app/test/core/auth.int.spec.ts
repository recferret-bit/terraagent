import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { AuthResponseSchema } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

let db: TestDatabase;
let app: INestApplication;
let url: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'int-test-jwt-secret-key-0123456789',
    },
  });
  app = created.app;
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('Guest auth Postgres persistence (W01-02)', () => {
  it('persists core.player and core.auth_session rows across guest, refresh, and logout', async () => {
    const res = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'postgres-device-secret-0001' }),
    });
    expect(res.status).toBe(200);
    const body = AuthResponseSchema.parse(await res.json());
    const setCookie = res.headers.get('set-cookie')!;
    const rt = /^ta_rt=([^;]*)/.exec(setCookie)![1]!;

    const dbPlayer = await db.prisma.player.findUnique({ where: { id: body.player.id } });
    expect(dbPlayer).toBeTruthy();
    expect(dbPlayer?.handle).toBe(body.player.handle);
    expect(dbPlayer?.deviceSecretHash).toMatch(/^[0-9a-f]{64}$/);

    const sessionsAfterLogin = await db.prisma.authSession.findMany({ where: { playerId: body.player.id } });
    expect(sessionsAfterLogin).toHaveLength(1);
    expect(sessionsAfterLogin[0]?.revokedAt).toBeNull();

    // Refresh rotates the DB session
    const refRes = await fetch(`${url}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${rt}` },
    });
    expect(refRes.status).toBe(200);
    const rt2 = /^ta_rt=([^;]*)/.exec(refRes.headers.get('set-cookie')!)![1]!;
    expect(rt2).not.toBe(rt);

    const sessionsAfterRefresh = await db.prisma.authSession.findMany({
      where: { playerId: body.player.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(sessionsAfterRefresh).toHaveLength(2);
    expect(sessionsAfterRefresh[0]?.revokedAt).not.toBeNull();
    expect(sessionsAfterRefresh[1]?.revokedAt).toBeNull();

    // Logout revokes the active DB session
    const logoutRes = await fetch(`${url}/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${rt2}` },
    });
    expect(logoutRes.status).toBe(200);

    const activeSessions = await db.prisma.authSession.findMany({
      where: { playerId: body.player.id, revokedAt: null },
    });
    expect(activeSessions).toHaveLength(0);
  });
});
