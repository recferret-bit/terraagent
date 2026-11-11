import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  colonyAccountId,
  HomeResponseSchema,
  MOCK_CARGO_CONTRACT,
  MOCK_RELAYER_ACCOUNT,
  playerAccountId,
  SocialAuthResponseSchema,
  storageDepositOpId,
  type HomeResponse,
} from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { ChainOutboxRepository } from '../../src/near/application/outbox/chain-outbox.repository';
import { DEFAULT_RELAY_CONFIG, OutboxRelay } from '../../src/near/application/outbox/outbox-relay';
import { MockRelayerAdapter } from '../../src/near/infrastructure/adapters/relayer/mock-relayer.adapter';
import { mockOauthSecret, signMockToken } from '../../src/near/identity/mock-token';

const OWNER = playerAccountId('test-pilot');

interface DepositRow {
  readonly opId: string;
  readonly port: string;
  readonly method: string;
  readonly payload: unknown;
  readonly status: string;
  readonly txHash: string | null;
}

interface StoredReceipt {
  readonly txHash: string;
  readonly payload: unknown;
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
      JWT_ACCESS_SECRET: 'storage-deposit-jwt-secret-0123456789',
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

async function upgradeGuest(): Promise<{ accessToken: string; accountId: string; opId: string }> {
  const guestRes = await fetch(`${url}/v1/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceSecret: 'storage-deposit-device-0001' }),
  });
  expect(guestRes.status).toBe(200);
  const guest = (await guestRes.json()) as { accessToken: string; player: { id: string } };
  const homeRes = await fetch(`${url}/v1/me/home`, { headers: { authorization: `Bearer ${guest.accessToken}` } });
  expect(homeRes.status).toBe(200);
  const colonyId = homeColonyId(HomeResponseSchema.parse(await homeRes.json()));
  const accessToken = await social(guest.accessToken);
  const stored = await db.prisma.nearColonyAccount.findFirst({
    where: { playerId: guest.player.id, slot: colonyId },
    select: { accountId: true },
  });
  const accountId = stored?.accountId;
  expect(accountId).toBe(colonyAccountId(colonyId, 'test-pilot'));
  return { accessToken, accountId: accountId ?? '', opId: storageDepositOpId(accountId ?? '') };
}

async function depositRows(): Promise<DepositRow[]> {
  const rows = await db.prisma.chainOutbox.findMany({ where: { opId: { startsWith: 'storage-deposit:' } } });
  return rows.map((row) => ({
    opId: row.opId,
    port: row.port,
    method: row.method,
    payload: row.payload,
    status: row.status,
    txHash: row.txHash,
  }));
}

async function expectOneDeposit(accountId: string): Promise<void> {
  const rows = await depositRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    opId: storageDepositOpId(accountId),
    port: 'Relayer',
    method: 'submitMetaTx',
    payload: {
      signerId: MOCK_RELAYER_ACCOUNT,
      receiverId: MOCK_CARGO_CONTRACT,
      signedDelegate: JSON.stringify({ action: 'storage_deposit', account_id: accountId }),
    },
  });
  const player = await db.prisma.chainOutbox.findFirst({ where: { opId: storageDepositOpId(OWNER) } });
  expect(player).toBeNull();
}

async function storageReceipts(accountId: string): Promise<StoredReceipt[]> {
  const rows = await db.prisma.mockChainReceipt.findMany({ where: { port: 'Relayer', method: 'submitMetaTx' } });
  return rows.filter((row) => {
    const payload = row.payload as { action?: string; account_id?: string };
    return payload.action === 'storage_deposit' && payload.account_id === accountId;
  }).map((row) => ({ txHash: row.txHash, payload: row.payload }));
}

function relay(): { relay: OutboxRelay; relayer: MockRelayerAdapter } {
  const relayer = new MockRelayerAdapter(
    db.prisma,
    { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 },
    { sleep: async () => undefined },
  );
  const repo = new ChainOutboxRepository(db.prisma);
  return {
    relayer,
    relay: new OutboxRelay(repo, { ...DEFAULT_RELAY_CONFIG, pollMs: 1, leaseMs: 1000 }, { resolve: () => relayer }),
  };
}

async function expectOneReceipt(accountId: string): Promise<void> {
  const rows = await storageReceipts(accountId);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row?.txHash.startsWith('mock:')).toBe(true);
  expect(row?.payload).toMatchObject({
    action: 'storage_deposit',
    account_id: accountId,
    signerId: MOCK_RELAYER_ACCOUNT,
    receiverId: MOCK_CARGO_CONTRACT,
    opId: storageDepositOpId(accountId),
  });
  const res = await fetch(`${url}/v1/dev/chain/tx?hash=${encodeURIComponent(row?.txHash ?? '')}`);
  expect(res.status).toBe(200);
  const detail = (await res.json()) as { signerId: string | null; receiverId: string | null; txHash: string; payload: unknown };
  expect(detail.txHash.startsWith('mock:')).toBe(true);
  expect(detail.signerId).toBe(MOCK_RELAYER_ACCOUNT);
  expect(detail.receiverId).toBe(MOCK_CARGO_CONTRACT);
  expect(detail.payload).toMatchObject({ action: 'storage_deposit', account_id: accountId });
}

describe('storage_deposit per colony account (W06-12)', () => {
  it('enqueues one relayer deposit and a restarted relay does not write a second receipt', async () => {
    const colony = await upgradeGuest();
    await expectOneDeposit(colony.accountId);

    await db.prisma.chainOutbox.deleteMany({ where: { opId: colony.opId } });
    await social(colony.accessToken);
    await expectOneDeposit(colony.accountId);
    await social(colony.accessToken);
    await expectOneDeposit(colony.accountId);

    const first = relay();
    // W22 also queues the planet DAO create/member op on the same outbox, so the relay may drain more than the deposit.
    const drained = await first.relay.pollOnce();
    expect(drained).toBeGreaterThanOrEqual(1);
    await expectOneReceipt(colony.accountId);
    const done = await depositRows();
    expect(done[0]?.status).toBe('DONE');
    expect(done[0]?.txHash?.startsWith('mock:')).toBe(true);

    const restarted = relay();
    expect(await restarted.relay.pollOnce()).toBe(0);
    await restarted.relayer.submitMetaTx({
      opId: colony.opId,
      signerId: MOCK_RELAYER_ACCOUNT,
      receiverId: MOCK_CARGO_CONTRACT,
      signedDelegate: JSON.stringify({ action: 'storage_deposit', account_id: colony.accountId }),
    });
    await restarted.relay.pollOnce();
    await expectOneReceipt(colony.accountId);
  }, 60_000);
});
