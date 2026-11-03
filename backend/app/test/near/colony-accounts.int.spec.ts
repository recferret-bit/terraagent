import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { colonyAccountId, HomeResponseSchema, newId, playerAccountId, SocialAuthResponseSchema, type HomeResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { EventBus } from '../../src/bus/event-bus';
import { mockOauthSecret, signMockToken } from '../../src/near/identity/mock-token';

const OWNER = playerAccountId('test-pilot');

interface ExplorerAccount {
  readonly accountId: string;
  readonly kind: string;
  readonly publicKey: string | null;
  readonly ownerAccountId: string | null;
}

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
      JWT_ACCESS_SECRET: 'colony-accounts-jwt-secret-0123456789',
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

function homeColonyId(home: HomeResponse): string {
  if (home.state !== 'ACTIVE') throw new Error(`expected ACTIVE, got ${home.state}`);
  return home.colony.id;
}

async function chainAccounts(): Promise<ExplorerAccount[]> {
  const res = await fetch(`${url}/v1/dev/chain/accounts?limit=200`);
  expect(res.status).toBe(200);
  return (await res.json()) as ExplorerAccount[];
}

function colonyRows(rows: readonly ExplorerAccount[]): ExplorerAccount[] {
  return rows.filter((row) => row.kind === 'colony').sort((a, b) => (a.accountId < b.accountId ? -1 : 1));
}

async function social(bearer: string): Promise<string> {
  const token = signMockToken(
    { provider: 'google', subject: 'test-pilot', exp: Math.floor(Date.now() / 1000) + 60 },
    mockOauthSecret(),
  );
  const res = await fetch(`${url}/v1/auth/social`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ provider: 'google', token }),
  });
  expect(res.status).toBe(200);
  const body = SocialAuthResponseSchema.parse(await res.json());
  expect(body.accountId).toBe(OWNER);
  return body.accessToken;
}

function emitFounded(playerId: string, colonyId: string, planetId: string): void {
  app.get(EventBus).emit('planet.event', {
    planetId,
    tick: 1,
    kind: 'colonyFounded',
    severity: 'info',
    colonyIds: [colonyId],
    data: { colonyId, playerId },
  });
}

async function waitForAccount(accountId: string): Promise<ExplorerAccount> {
  for (let i = 0; i < 50; i += 1) {
    const found = (await chainAccounts()).find((row) => row.accountId === accountId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`colony account ${accountId} did not appear`);
}

describe('colony sub-accounts (W06-08)', () => {
  it('creates one sub-account per colony on social upgrade and does not rotate the key', async () => {
    const guestRes = await fetch(`${url}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceSecret: 'colony-accounts-device-0001' }),
    });
    expect(guestRes.status).toBe(200);
    const guest = (await guestRes.json()) as { accessToken: string; player: { id: string } };
    const homeRes = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${guest.accessToken}` } });
    expect(homeRes.status).toBe(200);
    const homeColony = homeColonyId(HomeResponseSchema.parse(await homeRes.json()));
    const seated = await db.prisma.colony.findUnique({ where: { id: homeColony } });
    expect(seated?.playerId).toBe(guest.player.id);
    const extraId = newId('co');
    await db.prisma.colony.create({
      data: {
        id: extraId, playerId: guest.player.id, planetId: `${seated?.planetId ?? 'pl'}-extra`, colonyIndex: 0,
        name: 'Second colony', color: 1, status: 'ACTIVE', spawnQ: 1, spawnR: 1,
      },
    });

    const upgraded = await social(guest.accessToken);
    const expected = [homeColony, extraId].map((id) => colonyAccountId(id, 'test-pilot')).sort();
    const first = colonyRows(await chainAccounts());
    expect(first.map((row) => row.accountId)).toEqual(expected);
    for (const row of first) {
      expect(row.kind).toBe('colony');
      expect(row.ownerAccountId).toBe(OWNER);
      expect(row.publicKey?.startsWith('ed25519:')).toBe(true);
    }
    const named = (await chainAccounts()).find((row) => row.accountId === OWNER);
    expect(named).toMatchObject({ kind: 'named', ownerAccountId: OWNER });
    const stored = await db.prisma.nearColonyAccount.findUnique({ where: { accountId: expected[0] } });
    expect(stored?.slot).toBe(expected[0] === colonyAccountId(homeColony, 'test-pilot') ? homeColony : extraId);
    expect(stored?.encryptedSecret.length).toBeGreaterThan(20);

    await social(upgraded);
    const second = colonyRows(await chainAccounts());
    expect(second.map((row) => row.accountId)).toEqual(first.map((row) => row.accountId));
    expect(second.map((row) => row.publicKey)).toEqual(first.map((row) => row.publicKey));
    const storedAgain = await db.prisma.nearColonyAccount.findUnique({ where: { accountId: expected[0] } });
    expect(storedAgain?.publicKey).toBe(stored?.publicKey);
    expect(storedAgain?.encryptedSecret).toBe(stored?.encryptedSecret);

    const third = newId('co');
    await db.prisma.colony.create({
      data: {
        id: third, playerId: guest.player.id, planetId: `${seated?.planetId ?? 'pl'}-extra`, colonyIndex: 1,
        name: 'Third colony', color: 2, status: 'ACTIVE', spawnQ: 2, spawnR: 2,
      },
    });
    const thirdAccount = colonyAccountId(third, 'test-pilot');
    emitFounded(guest.player.id, third, seated?.planetId ?? 'pl');
    const created = await waitForAccount(thirdAccount);
    expect(created).toMatchObject({ kind: 'colony', ownerAccountId: OWNER });
    emitFounded(guest.player.id, third, seated?.planetId ?? 'pl');
    const repeated = await waitForAccount(thirdAccount);
    expect(repeated.publicKey).toBe(created.publicKey);
    expect(colonyRows(await chainAccounts()).find((row) => row.accountId === expected[0])?.publicKey).toBe(first[0]?.publicKey);
  }, 60_000);
});
