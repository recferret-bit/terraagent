import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { AccountClaimService } from '../../src/near/staking/account-claim.service.js';
import { StakingService } from '../../src/near/staking/staking.service.js';

let db: TestDatabase;
let app: INestApplication;
let url: string;

const ANON_ID = '3f0c6f0e-6a53-4d34-9a3e-2f1b6a1a9c20';

async function setupSettledAndClaimedDeed(appInstance: INestApplication) {
  const mintService = appInstance.get(DeedMintOutboxService);
  const settledService = appInstance.get(DeedSettledService);
  const claimService = appInstance.get(AccountClaimService);
  const stakingService = appInstance.get(StakingService);
  const relay = appInstance.get(OutboxRelayService);

  await mintService.mintForColony({
    colonyId: 'col_0',
    planetId: 'planet_a',
    colonyName: 'Aegis Spire',
    planetType: 'temperate',
    stage: 4,
    terraformBp: 4000,
  });
  await relay.pollOnce();

  await settledService.settleColonyDeed({
    colonyId: 'col_0',
    planetId: 'planet_a',
    reason: 'Stage 4 + 100 % Living Planet',
  });
  await relay.pollOnce();

  const claimed = await claimService.claimColonyAccount({
    colonyId: 'col_0',
    walletAccountId: 'pilot.mock',
    signature: {
      accountId: 'pilot.mock',
      publicKey: 'ed25519:mockkey',
      signature: 'mocksig',
      message: 'claim:col_0',
      nonce: 'n-w20-26-claim',
      recipient: 'terraagent.mock',
    },
  });
  await stakingService.fundWalletNear(claimed.accountId, '50');
  const status = await stakingService.getStatus({ colonyId: 'col_0' });
  return { stakingService, poolId: status.pools[0]!.poolId };
}

beforeAll(async () => {
  db = await createTestDatabase();
  const created = await createApp({
    source: {
      NODE_ENV: 'test',
      SIM_THREADS: '1',
      DATABASE_URL: db.url,
      NEAR_MODE: 'mock',
      TA_WAVES: 'W00,W02,W05,W08,W12,W20',
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

describe('Deed & Staking telemetry & analytics integration (W20-26)', () => {
  it('stores deed_viewed, deed_shared, stake_started, stake_completed in analytics_event with colonyId and planetId and updates Prometheus metrics', async () => {
    const { stakingService, poolId } = await setupSettledAndClaimedDeed(app);

    const queuedEvents: Array<{ name: string; ts: number; props: Record<string, unknown> }> = [
      {
        name: 'deed_viewed',
        ts: Date.now(),
        props: { colonyId: 'col_0', planetId: 'planet_a', tokenId: 'deed-col_0', settled: true },
      },
      {
        name: 'deed_shared',
        ts: Date.now(),
        props: { colonyId: 'col_0', planetId: 'planet_a', tokenId: 'deed-col_0', channel: 'x' },
      },
      {
        name: 'stake_started',
        ts: Date.now(),
        props: { colonyId: 'col_0', planetId: 'planet_a', pool: poolId, amount: '10' },
      },
    ];

    const stakeRes = await stakingService.stake({
      colonyId: 'col_0',
      pool: poolId,
      amount: '10',
      walletSignature: {
        accountId: 'pilot.mock',
        publicKey: 'ed25519:mockkey',
        signature: 'mocksig',
        message: 'stake:col_0:10',
        nonce: 'n-w20-26-stake',
        recipient: poolId,
      },
    });
    queuedEvents.push({
      name: 'stake_completed',
      ts: Date.now(),
      props: {
        colonyId: 'col_0',
        planetId: 'planet_a',
        pool: poolId,
        amount: '10',
        txHash: stakeRes.txHash,
      },
    });

    const ingestRes = await fetch(`${url}/v1/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anonId: ANON_ID, sessionId: 'sess-w20-26', events: queuedEvents }),
    });
    expect(ingestRes.status).toBe(204);

    const rows = await db.prisma.analyticsEvent.findMany({
      where: { sessionId: 'sess-w20-26' },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((r) => r.name)).toEqual([
      'deed_viewed',
      'deed_shared',
      'stake_started',
      'stake_completed',
    ]);
    for (const row of rows) {
      expect(row.props).toMatchObject({ colonyId: 'col_0', planetId: 'planet_a' });
    }

    const metricsRes = await fetch(`${url}/v1/metrics`);
    expect(metricsRes.status).toBe(200);
    const metricsText = await metricsRes.text();
    expect(metricsText).toMatch(/near_tx_total\{kind="deed_mint"\} 1/);
    expect(metricsText).toMatch(/near_tx_total\{kind="deed_update"\} 1/);
    expect(metricsText).toMatch(/near_tx_total\{kind="stake"\} 1/);
    expect(metricsText).toMatch(/staking_positions 1/);
  });
});
