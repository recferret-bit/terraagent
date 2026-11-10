import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';
import { AccountClaimService, type ClaimAccountResponse } from '../../src/near/staking/account-claim.service';

let db: TestDatabase;
const apps: INestApplication[] = [];

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'account-claim-jwt-secret-0123456789abcdef',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
      ...extra,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await db?.drop();
});

describe('W20-19 AccountClaimController & AccountClaimService Postgres integration', () => {
  it('POST /v1/near/claim-account persists claimed_at and claimed_by_account_id in chain.near_colony_account', async () => {
    const { app, url } = await boot({ TA_WAVES: '..20' });
    const res = await fetch(`${url}/v1/near/claim-account`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: 'col_0',
        walletAccountId: 'pilot-wallet.terraagent.mock',
        newPublicKey: 'ed25519:claim-pub-key',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClaimAccountResponse;
    expect(body.colonyId).toBe('col_0');
    expect(body.accountId).toBe('col_0.pilot.terraagent.mock');
    expect(body.claimedByAccountId).toBe('pilot-wallet.terraagent.mock');
    expect(body.txHash).toMatch(MOCK_HASH_RE);

    const row = await db.prisma.nearColonyAccount.findUnique({
      where: { accountId: body.accountId },
    });
    expect(row).not.toBeNull();
    expect(row?.claimedAt).toBeInstanceOf(Date);
    expect(row?.claimedByAccountId).toBe('pilot-wallet.terraagent.mock');

    const replayRes = await fetch(`${url}/v1/near/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: 'col_0',
        walletAccountId: 'pilot-wallet.terraagent.mock',
        newPublicKey: 'ed25519:claim-pub-key',
      }),
    });
    expect(replayRes.status).toBe(200);
    const replay = (await replayRes.json()) as ClaimAccountResponse;
    expect(replay.txHash).toBe(body.txHash);

    const service = app.get(AccountClaimService, { strict: false });
    const status = await service.isAccountClaimed('col_0');
    expect(status.claimed).toBe(true);
    expect(status.claimedByAccountId).toBe('pilot-wallet.terraagent.mock');
  });

  it('rejects empty colonyId with 400 validation error and returns 404 when TA_WAVES=..19', async () => {
    const { url } = await boot({ TA_WAVES: '..20' });
    const badEmpty = await fetch(`${url}/v1/near/claim-account`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colonyId: '' }),
    });
    expect(badEmpty.status).toBe(400);

    const badBlank = await fetch(`${url}/v1/near/claim-account`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colonyId: '   ' }),
    });
    expect(badBlank.status).toBe(400);

    const { url: urlOff } = await boot({ TA_WAVES: '..19' });
    const offRes = await fetch(`${urlOff}/v1/near/claim-account`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colonyId: 'col_0' }),
    });
    expect(offRes.status).toBe(404);
  });
});
