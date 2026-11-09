import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { type StakingActionResponse, type StakingStatusResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash';
import { StakingService } from '../../src/near/staking/staking.service';

const POOL_ASTRO = 'astro-stakers.pool.mock';

let db: TestDatabase;
const apps: INestApplication[] = [];

async function boot(extra: Record<string, string> = {}) {
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'staking-service-jwt-secret-0123456789abcdef',
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

async function createTestDeed(colonyId: string, accountId: string, settled: boolean) {
  await db.prisma.deed.upsert({
    where: { colonyId },
    create: {
      colonyId,
      planetId: 'pl_dune_01',
      playerId: 'p_stake_int',
      accountId,
      tokenId: `deed:${colonyId}`,
      metadata: {
        planet: 'pl_dune_01',
        colony: colonyId,
        stage: settled ? 4 : 3,
        terraformBp: settled ? 10000 : 6000,
        status: settled ? 'settled' : 'active',
        settled,
        version: 1,
        imageUrl: `/v1/near/deed/deed:${colonyId}/image.png?v=1`,
      },
      settled,
      status: settled ? 'settled' : 'active',
      chainState: 'ACTIVE',
    },
    update: {
      settled,
      status: settled ? 'settled' : 'active',
      metadata: {
        planet: 'pl_dune_01',
        colony: colonyId,
        stage: settled ? 4 : 3,
        terraformBp: settled ? 10000 : 6000,
        status: settled ? 'settled' : 'active',
        settled,
        version: 2,
        imageUrl: `/v1/near/deed/deed:${colonyId}/image.png?v=2`,
      },
      metadataVersion: 2,
    },
  });
}

async function postJson<T>(url: string, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await db?.drop();
});

describe('W20-18 StakingController & StakingService Postgres HTTP lifecycle', () => {
  it('enforces DEED_NOT_SETTLED, ACCOUNT_NOT_CLAIMED with claimUrl, and completes stake -> unstake -> withdraw', async () => {
    const { app, url } = await boot({ TA_WAVES: '..20' });
    const colonyId = 'col_stake_int';
    const accountId = `${colonyId}.pilot.terraagent.mock`;

    await createTestDeed(colonyId, accountId, false);
    const unsettled = await postJson<{
      errorCode: string;
      error: { code: string; details?: { colonyId?: string; settled?: boolean } };
    }>(url, '/v1/near/stake', { colonyId, pool: POOL_ASTRO, amount: '5' });
    expect(unsettled.status).toBe(409);
    expect(unsettled.body.errorCode).toBe('DEED_NOT_SETTLED');
    expect(unsettled.body.error.code).toBe('deed_not_settled');
    expect(unsettled.body.error.details?.settled).toBe(false);

    await createTestDeed(colonyId, accountId, true);
    const unclaimed = await postJson<{
      errorCode: string;
      error: { code: string; details?: { claimUrl?: string } };
    }>(url, '/v1/near/stake', { colonyId, pool: POOL_ASTRO, amount: '5' });
    expect(unclaimed.status).toBe(409);
    expect(unclaimed.body.errorCode).toBe('ACCOUNT_NOT_CLAIMED');
    expect(unclaimed.body.error.code).toBe('account_not_claimed');
    expect(unclaimed.body.error.details?.claimUrl).toBe('/v1/near/claim-account');

    const claim = await postJson(url, '/v1/near/claim-account', {
      colonyId,
      walletAccountId: 'pilot-wallet.terraagent.mock',
      newPublicKey: 'ed25519:int-stake-key',
    });
    expect(claim.status).toBe(200);

    const stakingService = app.get(StakingService, { strict: false });
    await stakingService.fundWalletNear(accountId, '12');

    const staked = await postJson<StakingActionResponse>(url, '/v1/near/stake', {
      colonyId,
      pool: POOL_ASTRO,
      amount: '5',
    });
    expect(staked.status).toBe(200);
    expect(staked.body.txHash).toMatch(MOCK_HASH_RE);
    expect(staked.body.walletBalanceNear).toBe('7');
    expect(staked.body.position).toMatchObject({
      colonyId,
      accountId,
      pool: POOL_ASTRO,
      staked: '5',
      unbonding: '0',
    });

    const statusRes = await fetch(`${url}/v1/near/staking?colonyId=${encodeURIComponent(colonyId)}`);
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as StakingStatusResponse;
    expect(statusBody.deedSettled).toBe(true);
    expect(statusBody.accountClaimed).toBe(true);
    expect(statusBody.walletBalanceNear).toBe('7');
    expect(statusBody.positions).toHaveLength(1);

    stakingService.advanceGameDays(30);
    const unstaked = await postJson<StakingActionResponse>(url, '/v1/near/unstake', {
      colonyId,
      pool: POOL_ASTRO,
      amount: '5',
    });
    expect(unstaked.status).toBe(200);
    expect(unstaked.body.position.staked).toBe('0');
    expect(unstaked.body.position.unbonding).toBe('5');

    stakingService.advanceGameDays(2);
    const withdrawn = await postJson<StakingActionResponse>(url, '/v1/near/withdraw', {
      colonyId,
      pool: POOL_ASTRO,
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.position.staked).toBe('0');
    expect(withdrawn.body.position.unbonding).toBe('0');
    expect(Number(withdrawn.body.walletBalanceNear)).toBeGreaterThan(12);
  });
});

describe('W20-18 StakingController HTTP negative cases & wave gating', () => {
  it('rejects non-whitelisted pool (422), insufficient balance (409), invalid body (400), and returns 404 when W20 is off', async () => {
    const { url } = await boot({ TA_WAVES: '..20' });
    const colonyId = 'col_stake_int';

    const badPool = await postJson<{ errorCode: string }>(url, '/v1/near/stake', {
      colonyId,
      pool: 'not-whitelisted.pool.mock',
      amount: '1',
    });
    expect(badPool.status).toBe(422);
    expect(badPool.body.errorCode).toBe('POOL_NOT_WHITELISTED');

    const insufficient = await postJson<{ errorCode: string }>(url, '/v1/near/stake', {
      colonyId,
      pool: POOL_ASTRO,
      amount: '999999',
    });
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.errorCode).toBe('STAKE_INSUFFICIENT_BALANCE');

    const badSchema = await postJson(url, '/v1/near/stake', {
      colonyId,
      pool: POOL_ASTRO,
      amount: '-10',
    });
    expect(badSchema.status).toBe(400);

    const { url: urlOff } = await boot({ TA_WAVES: '..19' });
    const offGet = await fetch(`${urlOff}/v1/near/staking`);
    expect(offGet.status).toBe(404);
    const offPost = await postJson(urlOff, '/v1/near/stake', {
      colonyId,
      pool: POOL_ASTRO,
      amount: '1',
    });
    expect(offPost.status).toBe(404);
  });
});
