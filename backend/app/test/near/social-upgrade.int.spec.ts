import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { AuthResponseSchema, HomeResponseSchema, SocialAuthResponseSchema, type HomeResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { mockOauthSecret, signMockToken } from '../../src/near/identity/mock-token';
import { SocialLink } from '../../src/near/identity/social-link';

let db: TestDatabase;
let app: INestApplication;
let url: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      SNAPSHOTS: 'on',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'social-upgrade-jwt-secret-0123456789',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
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

function refreshCookie(res: Response): string {
  const match = /ta_rt=([^;]*)/.exec(res.headers.get('set-cookie') ?? '');
  if (!match?.[1]) throw new Error('missing ta_rt cookie');
  return match[1];
}

function colonyId(home: HomeResponse): string {
  if (home.state !== 'ACTIVE') throw new Error(`expected ACTIVE, got ${home.state}`);
  return home.colony.id;
}

describe('guest → social upgrade (W06-06)', () => {
  it('keeps the colony, revokes the guest refresh cookie, and returns the Pilot ID on the next guest login', async () => {
    const deviceSecret = 'social-upgrade-device-0001';
    const guestRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret }),
    });
    expect(guestRes.status).toBe(200);
    const guest = AuthResponseSchema.parse(await guestRes.json());
    expect(guest.player.isGuest).toBe(true);
    const oldCookie = refreshCookie(guestRes);

    const homeRes = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${guest.accessToken}` } });
    expect(homeRes.status).toBe(200);
    const seated = colonyId(HomeResponseSchema.parse(await homeRes.json()));

    const token = signMockToken(
      { provider: 'google', subject: 'test-pilot', exp: Math.floor(Date.now() / 1000) + 60 },
      mockOauthSecret(),
    );
    const socialRes = await fetch(`${url}/v1/auth/social`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${guest.accessToken}` },
      body: JSON.stringify({ provider: 'google', token }),
    });
    expect(socialRes.status).toBe(200);
    const social = SocialAuthResponseSchema.parse(await socialRes.json());
    expect(social.player.id).toBe(guest.player.id);
    expect(social.player.isGuest).toBe(false);
    expect(social.accountId).toBe('test-pilot.terraagent.mock');

    const againHome = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${social.accessToken}` } });
    expect(againHome.status).toBe(200);
    expect(colonyId(HomeResponseSchema.parse(await againHome.json()))).toBe(seated);
    expect(await db.prisma.colony.count({ where: { playerId: guest.player.id } })).toBe(1);

    const oldRefresh = await fetch(`${url}/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `ta_rt=${oldCookie}` },
    });
    expect(oldRefresh.status).toBe(401);

    const second = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret }),
    });
    expect(second.status).toBe(200);
    const linkedGuest = AuthResponseSchema.parse(await second.json());
    expect(linkedGuest.player.id).toBe(guest.player.id);
    expect(linkedGuest.player.isGuest).toBe(false);
    expect(linkedGuest.accountId).toBe('test-pilot.terraagent.mock');

    const row = await db.prisma.socialIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: 'test-pilot' } },
    });
    expect(row).toMatchObject({ playerId: guest.player.id, accountId: 'test-pilot.terraagent.mock' });
    expect(app.get(SocialLink).lastAccountCreated()).toMatchObject({
      playerId: guest.player.id,
      accountId: 'test-pilot.terraagent.mock',
      provider: 'google',
      subject: 'test-pilot',
    });
  }, 60_000);
});
