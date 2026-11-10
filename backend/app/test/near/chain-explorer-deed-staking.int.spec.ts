import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { OutboxRelayService } from '../../src/near/application/outbox/outbox.module.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { MockDeedNftAdapter } from '../../src/near/infrastructure/adapters/mock/deed.adapter.js';
import type {
  ExplorerDeedRow,
  ExplorerStakingRow,
} from '../../src/near/infrastructure/dev/chain-explorer.controller.js';
import { MOCK_HASH_RE } from '../../src/near/infrastructure/mock/tx-hash.js';
import { StakingService } from '../../src/near/staking/staking.service.js';

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
      JWT_ACCESS_SECRET: 'explorer-deed-staking-jwt-secret-0123456789',
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

async function seedDeedAndStake(app: INestApplication, url: string, colonyId: string): Promise<string> {
  const minter = app.get(DeedMintOutboxService, { strict: false });
  const projector = app.get(DeedProjectorService, { strict: false });
  const debounce = app.get(DeedDebounceService, { strict: false });
  const settledService = app.get(DeedSettledService, { strict: false });
  const relay = app.get(OutboxRelayService, { strict: false });
  const stakingService = app.get(StakingService, { strict: false });

  const minted = await minter.mintForColony({
    colonyId, planetId: 'pl_dune_01', playerId: 'p_explorer_1',
    colonyName: 'Aegis Spire', planetType: 'dune', stage: 3, terraformBp: 4000,
  });
  const accountId = minted!.record.accountId;
  await relay.pollOnce();

  await projector.projectMilestone({
    colonyId, planetId: 'pl_dune_01', stage: 4, terraformBp: 8000, change: 'Terraform reached 80%',
  });
  await debounce.flushColony(colonyId, { forceImmediate: true });
  await relay.pollOnce();

  await settledService.settleColonyDeed({
    colonyId, planetId: 'pl_dune_01', reason: 'Colony settled at Stage 4',
  });
  await relay.pollOnce();

  const rawAdapter = new MockDeedNftAdapter(db.prisma, { latencyMinMs: 0, latencyMaxMs: 0, failRate: 0 });
  await rawAdapter.mint({
    opId: 'raw-deed-mint:col_raw', collection: 'deed', tokenId: 'deed-col_raw',
    ownerAccountId: 'col_raw.pilot.terraagent.mock',
    metadata: {
      planet: 'pl_forest_02', colony: 'col_raw', stage: 1, status: 'active',
      settled: false, version: 1, imageUrl: '/v1/near/deed/deed:col_raw/image.png?v=1',
    },
  });

  const claimRes = await fetch(`${url}/v1/near/claim-account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ colonyId, walletAccountId: 'pilot-wallet.terraagent.mock', newPublicKey: 'ed25519:explorer-stake-key' }),
  });
  expect(claimRes.status).toBe(200);

  await stakingService.fundWalletNear(accountId, '10');
  const stakeRes = await fetch(`${url}/v1/near/stake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ colonyId, pool: POOL_ASTRO, amount: '5' }),
  });
  expect(stakeRes.status).toBe(200);
  return accountId;
}

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await db?.drop();
});

describe('W20-24 ChainExplorerController Postgres HTTP integration — deeds & staking', () => {
  it('mints, updates, settles a deed and stakes NEAR, then serves /v1/dev/chain/deeds?tokenId=deed-col_0 and /v1/dev/chain/staking', async () => {
    const { app, url } = await boot({ TA_WAVES: '..20' });
    const accountId = await seedDeedAndStake(app, url, 'col_0');

    const deedRes = await fetch(`${url}/v1/dev/chain/deeds?tokenId=deed-col_0`);
    expect(deedRes.status).toBe(200);
    const deedRows = (await deedRes.json()) as ExplorerDeedRow[];
    expect(deedRows).toHaveLength(1);
    const deed = deedRows[0]!;
    expect(deed.colonyId).toBe('col_0');
    expect(deed.accountId).toBe(accountId);
    expect(deed.settled).toBe(true);
    expect(deed.status).toBe('settled');
    expect(deed.version).toBeGreaterThanOrEqual(3);
    expect(deed.lastUpdateTx).toMatch(MOCK_HASH_RE);
    expect(deed.history.map((h) => h.version)).toEqual([1, 2, 3]);
    expect(deed.history[0]?.txHash).toMatch(MOCK_HASH_RE);
    expect(deed.history[2]?.txHash).toMatch(MOCK_HASH_RE);

    const allDeeds = (await (await fetch(`${url}/v1/dev/chain/deeds`)).json()) as ExplorerDeedRow[];
    expect(allDeeds.map((d) => d.colonyId)).toEqual(expect.arrayContaining(['col_0', 'col_raw']));

    const stakingRes = await fetch(`${url}/v1/dev/chain/staking`);
    expect(stakingRes.status).toBe(200);
    const stakingRows = (await stakingRes.json()) as ExplorerStakingRow[];
    const posRow = stakingRows.find((r) => r.kind === 'position' && r.colonyId === 'col_0');
    expect(posRow).toMatchObject({
      kind: 'position', pool: POOL_ASTRO, accountId, colonyId: 'col_0',
      staked: '5', unbonding: '0', apyBp: 900,
    });
    const astroPool = stakingRows.find((r) => r.kind === 'pool' && r.pool === POOL_ASTRO);
    expect(astroPool).toMatchObject({
      kind: 'pool', pool: POOL_ASTRO, accountId: '-', colonyId: '-',
      staked: '5', rewards: '-', apyBp: 900,
    });
  });

  it('validates query params (400) and returns 404 when W20 is off', async () => {
    const { url } = await boot({ TA_WAVES: '..20' });
    for (const q of ['deeds?limit=0', 'deeds?limit=201', 'deeds?tokenId=', 'staking?limit=0', 'staking?account=']) {
      const res = await fetch(`${url}/v1/dev/chain/${q}`);
      expect(res.status, q).toBe(400);
    }

    const { url: urlOff } = await boot({ TA_WAVES: '..19' });
    expect((await fetch(`${urlOff}/v1/dev/chain/deeds`)).status).toBe(404);
    expect((await fetch(`${urlOff}/v1/dev/chain/staking`)).status).toBe(404);
    expect((await fetch(`${urlOff}/v1/dev/chain/deeds?limit=0`)).status).toBe(404);
  });
});
