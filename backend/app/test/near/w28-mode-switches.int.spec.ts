import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { EnvError } from '@terra/config';
import { StakingOverviewResponse, StakingPerformanceResponse } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MockLlmAdapter } from '../../src/ai/adapters/mock-llm.adapter.js';
import { NearAiLlmAdapter } from '../../src/ai/adapters/nearai-llm.adapter.js';
import { GuardedLlmProvider } from '../../src/ai/provider/guarded-llm.js';
import { MockStakingAdapter } from '../../src/near/infrastructure/adapters/mock/staking.adapter.js';
import { TestnetStakingAdapter } from '../../src/near/infrastructure/adapters/real/testnet-staking.adapter.js';
import { StakingPort } from '../../src/near/application/ports/staking.port.js';
import { LlmProviderPort } from '../../src/ports/llm-provider.port.js';
import { devPlayerId } from '../../src/ws/session-verifier.js';
import { UNIT_APP_ENV } from '../unit-app-env.js';

let db: TestDatabase;
const apps: INestApplication[] = [];

async function boot(overrides: Record<string, string>) {
  const created = await createApp({
    source: {
      ...UNIT_APP_ENV,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: db.url,
      JWT_ACCESS_SECRET: 'w28-3mode-jwt-secret-0123456789abcdef',
      MOCK_LATENCY_MIN_MS: '0',
      MOCK_LATENCY_MAX_MS: '0',
      TA_WAVES: 'all',
      ...overrides,
    },
  });
  await created.app.listen(0, '127.0.0.1');
  apps.push(created.app);
  const url = (await created.app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app: created.app, url };
}

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await db?.drop();
});

async function verifyLocalMockIntegration(): Promise<void> {
  const { app, url } = await boot({ NEAR_MODE: 'local', AI_PROVIDER: 'local' });
  expect(app.get(StakingPort)).toBeInstanceOf(MockStakingAdapter);
  expect(app.get(LlmProviderPort)).toBeInstanceOf(GuardedLlmProvider);
  expect((app.get(LlmProviderPort) as GuardedLlmProvider).inner).toBeInstanceOf(MockLlmAdapter);

  const status = (await (await fetch(`${url}/v1/near/status`)).json()) as {
    nearMode: string;
    ports: Array<{ port: string; mode: string }>;
    ai: { provider: string; mode: string };
  };
  expect(status.nearMode).toBe('local');
  expect(status.ports).toHaveLength(11);
  expect(status.ports.every((p) => p.mode === 'mock')).toBe(true);
  expect(status.ai).toMatchObject({ provider: 'local', mode: 'mock' });

  const overviewRes = await fetch(`${url}/v1/near/staking/overview?amount=100`);
  const overviewRaw = await overviewRes.json();
  expect(overviewRes.status, JSON.stringify(overviewRaw)).toBe(200);
  const overview = StakingOverviewResponse.parse(overviewRaw);
  expect(overview.network).toBe('mock');
  expect(overview.apy.source).toBe('sim');

  const txRes = await fetch(`${url}/v1/near/staking/wallet-tx?action=stake_payable&amountNear=10`);
  expect(txRes.status).toBe(200);
  expect(await txRes.json()).toMatchObject({
    contractId: 'protocol.terraagent.mock',
    methodName: 'stake_payable',
    args: { pool_id: 'astro-stakers.pool.mock' },
  });

  const perf = StakingPerformanceResponse.parse(
    await (await fetch(`${url}/v1/near/staking/performance?accountId=alice.mock&window=30d`)).json(),
  );
  expect(perf.apy.source).toBe('sim');
  expect(perf.price.source).toBe('est');

  const unauthMockProfits = await fetch(`${url}/v1/near/stake/profits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev:stranger' },
    body: JSON.stringify({ accountId: 'alice.mock', amountUsdc: '10' }),
  });
  expect(unauthMockProfits.status).toBe(403);
}

async function verifyTestnetIntegration(): Promise<void> {
  const { app, url } = await boot({ NEAR_MODE: 'testnet', AI_PROVIDER: 'testnet', AI_LIVE: '1' });
  expect(app.get(StakingPort)).toBeInstanceOf(TestnetStakingAdapter);
  expect(app.get(LlmProviderPort)).toBeInstanceOf(GuardedLlmProvider);
  expect((app.get(LlmProviderPort) as GuardedLlmProvider).inner).toBeInstanceOf(NearAiLlmAdapter);

  const status = (await (await fetch(`${url}/v1/near/status`)).json()) as {
    nearMode: string;
    network: string;
    contracts: { staking: string; dao: string; pilots: string };
    ports: Array<{ port: string; mode: string }>;
    ai: { provider: string; mode: string };
  };
  expect(status.nearMode).toBe('testnet');
  expect(status.network).toBe('testnet');
  expect(status.contracts).toMatchObject({
    staking: 'staking.terraagent.testnet',
    dao: 'dao.terraagent.testnet',
    pilots: 'pilots.terraagent.testnet',
  });
  expect(status.ports.every((p) => p.mode === 'testnet')).toBe(true);
  expect(status.ai).toMatchObject({ provider: 'testnet', mode: 'testnet' });

  const txRes = await fetch(`${url}/v1/near/staking/wallet-tx?action=stake_lst&amountNear=10`);
  expect(txRes.status).toBe(200);
  expect(await txRes.json()).toMatchObject({
    contractId: 'meta-v2.pool.testnet',
    methodName: 'ft_transfer_call',
  });

  await db.prisma.socialIdentity.create({
    data: { id: 'si_w28_tn', playerId: devPlayerId('tn'), provider: 'near', subject: 'tn.testnet', accountId: 'tn.testnet' },
  });
  const profits = await fetch(`${url}/v1/near/stake/profits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev:tn' },
    body: JSON.stringify({ accountId: 'tn.testnet', amountUsdc: '10', dry: false }),
  });
  const profitsRaw = await profits.json();
  expect(profits.status, JSON.stringify(profitsRaw)).toBe(200);
  expect(profitsRaw).toMatchObject({
    txHash: null,
    position: null,
    quote: { dry: true, amountInAtomic: '10000000' },
  });

  const strangerNominate = await fetch(`${url}/v1/near/staking/patron/nominate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev:stranger' },
    body: JSON.stringify({ accountId: 'tn.testnet', planetId: 'planet-1' }),
  });
  expect(strangerNominate.status).toBe(403);

  const unsignedStake = await fetch(`${url}/v1/near/stake`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer dev:tn' },
    body: JSON.stringify({ accountId: 'tn.testnet', pool: 'astro-stakers.poolv1.testnet', amount: '10' }),
  });
  expect(unsignedStake.status).toBe(401);

  const aiProfits = await fetch(`${url}/v1/near/stake/profits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor': 'ai' },
    body: JSON.stringify({ accountId: 'tn.testnet', amountUsdc: '10' }),
  });
  expect(aiProfits.status).toBe(403);
}

async function verifyMainnetIntegration(): Promise<void> {
  const { app, url } = await boot({
    NEAR_MODE: 'mainnet',
    NEAR_ALLOW_MAINNET: '1',
    AI_PROVIDER: 'mainnet',
    AI_LIVE: '1',
  });
  expect(app.get(StakingPort)).toBeInstanceOf(TestnetStakingAdapter);
  expect((app.get(StakingPort) as unknown as { rpc: { network: string } }).rpc.network).toBe('mainnet');
  expect(app.get(LlmProviderPort)).toBeInstanceOf(GuardedLlmProvider);
  expect((app.get(LlmProviderPort) as GuardedLlmProvider).inner).toBeInstanceOf(NearAiLlmAdapter);

  const status = (await (await fetch(`${url}/v1/near/status`)).json()) as {
    nearMode: string;
    network: string;
    contracts: { staking: string; dao: string; pilots: string };
    ports: Array<{ port: string; mode: string }>;
    ai: { provider: string; mode: string };
  };
  expect(status.nearMode).toBe('mainnet');
  expect(status.network).toBe('mainnet');
  expect(status.contracts).toMatchObject({
    staking: 'staking.terraagent.near',
    dao: 'dao.terraagent.near',
    pilots: 'pilots.terraagent.near',
  });
  expect(status.ports.every((p) => p.mode === 'mainnet')).toBe(true);
  expect(status.ai).toMatchObject({ provider: 'mainnet', mode: 'mainnet' });

  const txRes = await fetch(`${url}/v1/near/staking/wallet-tx?action=deposit_and_stake_lst&amountNear=25`);
  expect(txRes.status).toBe(200);
  expect(await txRes.json()).toMatchObject({
    contractId: 'staking.terraagent.near',
    methodName: 'deposit_and_stake_lst',
    args: {
      pool_id: 'meta-pool.near',
      lst_contract: 'meta-pool.near',
      referral_id: 'protocol.terraagent.near',
    },
  });
}

async function verifyModeNegativeIntegration(): Promise<void> {
  await expect(
    boot({ NODE_ENV: 'production', NEAR_MODE: 'local', AI_PROVIDER: 'local' }),
  ).rejects.toBeInstanceOf(EnvError);

  await expect(
    boot({ NEAR_MODE: 'mainnet', AI_PROVIDER: 'mainnet', AI_LIVE: '1' }),
  ).rejects.toThrow(/NEAR_ALLOW_MAINNET/);

  const { url } = await boot({ NEAR_MODE: 'testnet', AI_PROVIDER: 'testnet', AI_LIVE: '1' });
  const badTx = await fetch(`${url}/v1/near/staking/wallet-tx?action=unknown_action`);
  expect(badTx.status).toBe(400);
  const badPerf = await fetch(`${url}/v1/near/staking/performance?accountId=a&window=7d`);
  expect(badPerf.status).toBe(400);
}

describe('W28 3-mode Web3 & AI integration (local/mock, testnet, mainnet)', () => {
  it('boots Mode 1 (local/mock) and serves mock status, overview, performance, wallet-tx, and mock AI', verifyLocalMockIntegration);

  it('boots Mode 2 (testnet) and routes all 11 NEAR ports + NEAR.AI to Testnet while enforcing dry:true on profit stakes', verifyTestnetIntegration);

  it('boots Mode 3 (mainnet with NEAR_ALLOW_MAINNET=1) and serves Mainnet wallet-tx descriptors, contracts, and AI mode', verifyMainnetIntegration);

  it('negative & corner: production refuses mock/local without allow flags, mainnet fails without NEAR_ALLOW_MAINNET, and invalid wallet-tx returns 400', verifyModeNegativeIntegration);
});
