import type { INestApplication } from '@nestjs/common';
import {
  ClaimAccountResponseSchema,
  StakingActionResponse,
  StakingStatusResponse,
} from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

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
      NEAR_MODE: 'mock',
      TA_WAVES: 'W00,W02,W05,W06,W08,W12,W20',
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

async function postDevCmd(name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/v1/dev/commands/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('W20-21 StakingPanel end-to-end client <-> server HTTP integration', () => {
  it('completes settle -> claim account -> stake 10 NEAR -> warp 1 day (rewards) -> unstake -> warp 4 epochs -> withdraw', async () => {
    await postDevCmd('deed.show', {});
    await postDevCmd('stake.fund', { near: 100 });
    await postDevCmd('deed.settle', {});

    const status0Res = await fetch(`${url}/v1/near/staking?colonyId=col_0`);
    expect(status0Res.status).toBe(200);
    const status0 = StakingStatusResponse.parse(await status0Res.json());
    expect(status0.accountClaimed).toBe(false);
    const pool = status0.pools[0]?.poolId ?? 'astro-stakers.pool.mock';

    const claimRes = await fetch(`${url}/v1/near/claim-account`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: 'col_0',
        walletAccountId: 'pilot.mock',
        walletSignature: {
          accountId: 'pilot.mock',
          publicKey: 'ed25519:mockkey',
          signature: 'mocksig',
          message: 'claim:col_0:pilot.mock',
          nonce: 'n-w20-21-claim',
          recipient: 'terraagent.mock',
        },
      }),
    });
    expect(claimRes.status).toBe(200);
    const claimed = ClaimAccountResponseSchema.parse(await claimRes.json());
    expect(claimed.claimedByAccountId).toBe('pilot.mock');

    const stakeRes = await fetch(`${url}/v1/near/stake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: 'col_0',
        pool,
        amount: '10',
        walletSignature: {
          accountId: 'pilot.mock',
          publicKey: 'ed25519:mockkey',
          signature: 'mocksig',
          message: `stake:col_0:${pool}:10`,
          nonce: 'n-w20-21-stake',
          recipient: pool,
        },
      }),
    });
    expect(stakeRes.status).toBe(200);
    const staked = StakingActionResponse.parse(await stakeRes.json());
    expect(staked.position.staked).toBe('10');

    // Warp 1 day (86400s) -> net user rewards ~ 0.00197 NEAR (7.2% net APY; 20% of 9% goes to TerraAgent Protocol)
    await postDevCmd('time.warp', { seconds: 86_400 });
    const status1Res = await fetch(`${url}/v1/near/staking?colonyId=col_0`);
    const status1 = StakingStatusResponse.parse(await status1Res.json());
    expect(status1.positions[0]?.rewards).toContain('0.00197');

    // Unstake -> Unbonding (4 epochs)
    const unstakeRes = await fetch(`${url}/v1/near/unstake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: 'col_0',
        pool,
        amount: '10',
      }),
    });
    expect(unstakeRes.status).toBe(200);
    const unstaked = StakingActionResponse.parse(await unstakeRes.json());
    expect(unstaked.position.unbonding).toBe('10');

    // Warp 4 epochs (172800s) -> Withdrawable 10 NEAR
    await postDevCmd('time.warp', { seconds: 172_800 });
    const status2Res = await fetch(`${url}/v1/near/staking?colonyId=col_0`);
    const status2 = StakingStatusResponse.parse(await status2Res.json());
    expect(status2.positions[0]?.withdrawable).toBe('10');

    // Withdraw -> balance returns to wallet
    const withdrawRes = await fetch(`${url}/v1/near/withdraw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        colonyId: 'col_0',
        pool,
      }),
    });
    expect(withdrawRes.status).toBe(200);
    const withdrawn = StakingActionResponse.parse(await withdrawRes.json());
    expect(withdrawn.walletBalanceNear).toContain('100.00197');
  });
});
