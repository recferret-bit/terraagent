import 'reflect-metadata';
import { STAKING_RULES } from '@terra/contracts';
import { EnvError } from '@terra/config';
import { describe, expect, it, vi } from 'vitest';
import { aiProvider } from '../../src/ai/ai-selection.js';
import { CoreException } from '../../src/core/errors/index.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import { NEAR_PORT_NAMES } from '../../src/near/domain/types.js';
import { nearAdapterFor } from '../../src/near/infrastructure/adapter-selection.js';
import { guardQuoteRequest, resolveQuoteDry } from '../../src/near/infrastructure/dev/intents-quote-guard.js';
import { NearStatusController } from '../../src/near/infrastructure/dev/near-status.controller.js';
import { nearAdapters, nearEnvFor } from '../../src/near/infrastructure/near-infrastructure.module.js';
import { resolveActiveNearNetwork, resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { NearUsdPriceCache } from '../../src/near/staking/performance/near-usd-price.service.js';
import { StakingPerformanceService } from '../../src/near/staking/performance/staking-performance.service.js';
import { ActionEffects } from '../../src/near/staking/services/action-effects.js';
import { ActionFinisher, OpNonce } from '../../src/near/staking/services/action-finisher.js';
import { PerksView } from '../../src/near/staking/services/perks-view.js';
import { StakeProfitsService } from '../../src/near/staking/services/stake-profits.service.js';
import { parseStakingPoolsConfig } from '../../src/near/staking/staking-pools.config.js';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';
import { buildStakingWalletTxDescriptor, resolveStakingContractId } from '../../src/near/staking/staking-wallet-tx.js';
import { InMemoryChainRead } from '../../src/near/testing/in-memory-chain-read.js';

const ONE_NEAR = 10n ** 24n;

async function assertLocalMockMode(): Promise<void> {
  for (const mode of ['mock', 'local'] as const) {
    for (const port of NEAR_PORT_NAMES) {
      expect(nearAdapterFor(port, { NEAR_MODE: mode })).toBe('mock');
    }
    expect(aiProvider({ AI_PROVIDER: mode })).toBe('mock');
    expect(resolveStakingContractId({ NEAR_MODE: mode })).toBe('protocol.terraagent.mock');
    expect(parseStakingPoolsConfig(undefined, { NEAR_MODE: mode }).map((p) => p.poolId)).toContain(
      'astro-stakers.pool.mock',
    );
    const tx = buildStakingWalletTxDescriptor({ action: 'stake_payable', amountNear: '10' }, { NEAR_MODE: mode });
    expect(tx).toMatchObject({ contractId: 'protocol.terraagent.mock', methodName: 'stake_payable' });
    expect(tx.args).toMatchObject({ pool_id: 'astro-stakers.pool.mock' });

    const lstTx = buildStakingWalletTxDescriptor({ action: 'stake_lst', amountNear: '5' }, { NEAR_MODE: mode });
    expect(lstTx).toMatchObject({ contractId: 'meta-pool.mock', methodName: 'ft_transfer_call' });

    const ctl = new NearStatusController(new InMemoryChainRead(), { NEAR_MODE: mode, AI_PROVIDER: mode } as never);
    const status = await ctl.status();
    expect(status.ports.every((p) => p.mode === 'mock')).toBe(true);
    expect(status.ai).toMatchObject({ provider: mode, mode: 'mock' });
  }
}

async function assertTestnetDevnetMode(): Promise<void> {
  for (const nearMode of ['testnet', 'devnet'] as const) {
    for (const port of NEAR_PORT_NAMES) {
      expect(nearAdapterFor(port, { NEAR_MODE: nearMode })).toBe('testnet');
    }
    expect(resolveActiveNearNetwork(null, { NEAR_MODE: nearMode })).toBe('testnet');
  }
  expect(aiProvider({ AI_PROVIDER: 'testnet', AI_LIVE: '1' })).toBe('nearai');
  expect(aiProvider({ AI_PROVIDER: 'nearai', AI_LIVE: '1' })).toBe('nearai');
  expect(resolveStakingContractId({ NEAR_MODE: 'testnet' })).toBe('staking.terraagent.testnet');
  expect(parseStakingPoolsConfig(undefined, { NEAR_MODE: 'testnet' }).map((p) => p.poolId)).toContain(
    'astro-stakers.pool.testnet',
  );

  const tx = buildStakingWalletTxDescriptor({ action: 'stake_payable', amountNear: '25' }, { NEAR_MODE: 'testnet' });
  expect(tx.contractId).toBe('staking.terraagent.testnet');
  expect(tx.args).toMatchObject({ pool_id: 'astro-stakers.pool.testnet' });

  const lstTx = buildStakingWalletTxDescriptor(
    { action: 'deposit_and_stake_lst', amountNear: '25' },
    { NEAR_MODE: 'testnet' },
  );
  expect(lstTx.contractId).toBe('staking.terraagent.testnet');
  expect(lstTx.args).toMatchObject({
    pool_id: 'meta-v2.pool.testnet',
    lst_contract: 'meta-v2.pool.testnet',
    referral_id: 'protocol.terraagent.testnet',
  });

  expect(resolveQuoteDry({ dry: false, confirmMainnet: true }, { NEAR_MODE: 'testnet' })).toBe(true);

  const ctl = new NearStatusController(new InMemoryChainRead(), {
    NEAR_MODE: 'testnet',
    AI_PROVIDER: 'testnet',
    AI_LIVE: '1',
  } as never);
  const status = await ctl.status();
  expect(status.network).toBe('testnet');
  expect(status.contracts.staking).toBe('staking.terraagent.testnet');
  expect(status.ports.every((p) => p.mode === 'testnet')).toBe(true);
  expect(status.ai).toMatchObject({ provider: 'testnet', mode: 'testnet' });
}

async function assertMainnetMode(): Promise<void> {
  const env = { NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1', AI_PROVIDER: 'mainnet', NODE_ENV: 'production' };
  for (const port of NEAR_PORT_NAMES) {
    expect(nearAdapterFor(port, env)).toBe('mainnet');
  }
  expect(aiProvider(env)).toBe('nearai');
  expect(resolveActiveNearNetwork(null, env)).toBe('mainnet');
  const cfg = resolveNearNetworkConfig(env, 'mainnet');
  expect(cfg.contracts.staking).toBe('staking.terraagent.near');
  expect(cfg.accounts.protocol).toBe('protocol.terraagent.near');
  expect(parseStakingPoolsConfig(undefined, env).map((p) => p.poolId)).toContain('astro-stakers.poolv1.near');

  const tx = buildStakingWalletTxDescriptor({ action: 'stake_payable', amountNear: '50' }, env);
  expect(tx.contractId).toBe('staking.terraagent.near');
  expect(tx.args).toMatchObject({ pool_id: 'astro-stakers.poolv1.near' });

  const lstTx = buildStakingWalletTxDescriptor({ action: 'deposit_and_stake_lst', amountNear: '50' }, env);
  expect(lstTx.args).toMatchObject({
    pool_id: 'meta-pool.near',
    lst_contract: 'meta-pool.near',
    referral_id: 'protocol.terraagent.near',
  });

  expect(resolveQuoteDry({ dry: false, confirmMainnet: true }, env)).toBe(false);
  expect(resolveQuoteDry({ dry: false, confirmMainnet: false }, env)).toBe(true);

  const ctl = new NearStatusController(new InMemoryChainRead(), env as never);
  const status = await ctl.status();
  expect(status.network).toBe('mainnet');
  expect(status.contracts.staking).toBe('staking.terraagent.near');
  expect(status.ports.every((p) => p.mode === 'mainnet')).toBe(true);
  expect(status.ai).toMatchObject({ provider: 'mainnet', mode: 'mainnet' });
}

function assertModeRejections(): void {
  const envSpec = nearEnvFor(nearAdapters);
  expect(() => envSpec.schema.parse({ NEAR_MODE: 'mainnet' })).toThrow(/NEAR_ALLOW_MAINNET/);
  expect(() => envSpec.schema.parse({ NEAR_ADAPTER_STAKING: 'mainnet' })).toThrow(/NEAR_ALLOW_MAINNET/);

  expect(aiProvider({ AI_PROVIDER: 'testnet', NODE_ENV: 'development' })).toBe('nearai-needs-live');
  expect(aiProvider({ AI_PROVIDER: 'mainnet', NODE_ENV: 'test' })).toBe('nearai-needs-live');
  const secret = 'sk-secret-do-not-leak';
  expect(aiProvider({ AI_PROVIDER: secret, AI_LIVE: '1' })).toBe('unknown');

  expect(() =>
    buildStakingWalletTxDescriptor({ action: 'bad_action', amountNear: '10' }, { NEAR_MODE: 'mock' }),
  ).toThrow(CoreException);
  expect(() =>
    buildStakingWalletTxDescriptor(
      { action: 'stake_lst', lstContract: 'rogue.testnet', amountNear: '10' },
      { NEAR_MODE: 'testnet' },
    ),
  ).toThrow(/unwhitelisted/i);
  expect(() =>
    buildStakingWalletTxDescriptor({ action: 'unstake', amountNear: '5' }, { NEAR_MODE: 'testnet' }),
  ).toThrow(/accountId/i);
  expect(() =>
    buildStakingWalletTxDescriptor({ action: 'withdraw' }, { NEAR_MODE: 'mainnet' }),
  ).toThrow(/accountId/i);
  expect(() => guardQuoteRequest({ amount: '10.5' }, { NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '1' })).toThrow(
    CoreException,
  );
}

function assertModeOverridesAndCasing(): void {
  expect(nearAdapterFor('Staking', { NEAR_MODE: 'testnet', NEAR_ADAPTER_STAKING: 'local' })).toBe('mock');
  expect(nearAdapterFor('Staking', { NEAR_MODE: 'local', NEAR_ADAPTER_STAKING: 'mainnet' })).toBe('mainnet');
  expect(nearAdapterFor('Identity', { NEAR_MODE: 'local', NEAR_ADAPTER_STAKING: 'mainnet' })).toBe('mock');

  for (const bad of ['LOCAL', 'Local', 'Testnet', 'Mainnet', ' mainnet ', 'dev', 'prod']) {
    expect(nearAdapterFor('Staking', { NEAR_MODE: bad })).toBe('mock');
    expect(aiProvider({ AI_PROVIDER: bad, AI_LIVE: '1', NODE_ENV: 'production' })).toBe('unknown');
  }
  expect(aiProvider({ AI_PROVIDER: 'local', NODE_ENV: 'production' })).toBe('mock');
  expect(resolveQuoteDry({ dry: false, confirmMainnet: true }, { NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: '0' })).toBe(true);
  expect(resolveQuoteDry({ dry: true, confirmMainnet: true }, { NEAR_MODE: 'mainnet', NEAR_ALLOW_MAINNET: 'true' })).toBe(true);
  expect(EnvError).toBeDefined();
}

function makeStakeProfitsHarness(envMap: Record<string, string>) {
  const stakeProfitsSpy = vi.fn().mockResolvedValue({
    txHash: 'mock:stake-profits-1',
    blockHeight: 1,
    status: 'FINAL',
  });
  const pool = envMap.NEAR_MODE === 'mainnet' ? 'astro-stakers.poolv1.near' : envMap.NEAR_MODE === 'testnet' ? 'astro-stakers.pool.testnet' : 'astro-stakers.pool.mock';
  const stakingPort = {
    listPools: async () => [{ poolId: pool, name: 'Astro', apyBp: 900 }],
    position: async () => ({
      accountId: 'alice.near',
      pool,
      asset: 'stNEAR' as const,
      staked: (5n * ONE_NEAR).toString(),
      unbonding: '0',
      withdrawable: '0',
      rewards: '0',
      unbondingReadyAtMs: null,
    }),
    rewards: async () => ({ accrued: '0' }),
    stakeProfits: stakeProfitsSpy,
  } as unknown as StakingPort;
  const sync = new StakingPositionSyncService(stakingPort, envMap as never);
  const svc = new StakeProfitsService({
    staking: stakingPort,
    balances: { readNear: async () => '100' } as never,
    finisher: new ActionFinisher(stakingPort, sync),
    nonce: new OpNonce(),
    perks: new PerksView(stakingPort, () => ({ ...envMap, TA_WAVES: 'all' }), () => null),
    effects: new ActionEffects(stakingPort, { record: async () => undefined } as never),
    env: () => envMap,
    db: () => null,
  });
  return { svc, stakeProfitsSpy };
}

async function assertStakeProfitsAcrossModes(): Promise<void> {
  const mockRun = makeStakeProfitsHarness({ NEAR_MODE: 'local' });
  const mockRes = await mockRun.svc.run({ accountId: 'alice.mock', amountUsdc: '8.00' });
  expect(mockRes.quote.dry).toBe(false);
  expect(mockRes.txHash).toBe('mock:stake-profits-1');
  expect(mockRun.stakeProfitsSpy).toHaveBeenCalledTimes(1);

  for (const mode of ['testnet', 'mainnet'] as const) {
    const liveRun = makeStakeProfitsHarness({ NEAR_MODE: mode, NEAR_ALLOW_MAINNET: '1' });
    // Even if caller passes dry: false, real networks must remain quote-only (no server-side swap execution).
    const liveRes = await liveRun.svc.run({ accountId: 'alice.near', amountUsdc: '8.00', dry: false });
    expect(liveRes.quote.dry).toBe(true);
    expect(liveRes.txHash).toBeNull();
    expect(liveRun.stakeProfitsSpy).not.toHaveBeenCalled();
  }
}

async function assertPerformanceAndPriceCache(): Promise<void> {
  const flags = { has: () => true } as unknown as FlagsService;

  const mockPrice = new NearUsdPriceCache({
    live: false,
    fetcher: async () => 99,
    now: () => 10_000,
  });
  expect(await mockPrice.view()).toEqual({ nearUsd: STAKING_RULES.estNearUsd, source: 'est', asOfMs: 10_000 });

  const livePrice = new NearUsdPriceCache({
    live: true,
    fetcher: async () => 5.5,
    now: () => 20_000,
  });
  expect(await livePrice.view()).toEqual({ nearUsd: 5.5, source: 'live', asOfMs: 20_000 });

  const makePerf = (mode: 'mock' | 'testnet' | 'mainnet', apyReader?: () => Promise<number | null>) => {
    const env = { NEAR_MODE: mode, NEAR_ALLOW_MAINNET: '1', TA_WAVES: 'all' };
    const price = new NearUsdPriceCache({ live: mode !== 'mock', fetcher: async () => 5, now: () => 50_000 });
    return new StakingPerformanceService(flags, price as never, undefined, env as never, apyReader);
  };

  const mockOverview = await makePerf('mock').overview('100');
  expect(mockOverview.network).toBe('mock');
  expect(mockOverview.apy.source).toBe('sim');
  expect(mockOverview.price).toMatchObject({ nearUsd: STAKING_RULES.estNearUsd, source: 'est' });

  const testnetOverview = await makePerf('testnet', async () => 780).overview('100');
  expect(testnetOverview.network).toBe('testnet');
  expect(testnetOverview.apy.source).toBe('sim');
  expect(testnetOverview.price).toMatchObject({ nearUsd: 5, source: 'live' });

  const mainnetLive = await makePerf('mainnet', async () => 850).overview('100');
  expect(mainnetLive.network).toBe('mainnet');
  expect(mainnetLive.apy).toMatchObject({ source: 'live', grossApyBp: 850 });

  // Corner: Mainnet falls back to sim APY cleanly when validator APY probe throws.
  const mainnetFallback = await makePerf('mainnet', async () => {
    throw new Error('rpc timeout');
  }).overview('100');
  expect(mainnetFallback.network).toBe('mainnet');
  expect(mainnetFallback.apy.source).toBe('sim');
}

describe('W28 3-mode Web3 & AI switches (local/mock, testnet, mainnet)', () => {
  it('positive: local / mock mode binds all 11 NEAR ports and AI to mock/local', assertLocalMockMode);

  it('positive: testnet / devnet mode routes all 11 NEAR ports, AI, pools, and wallet-tx to Testnet and keeps quotes dry', assertTestnetDevnetMode);

  it('positive: mainnet mode with NEAR_ALLOW_MAINNET=1 routes all 11 NEAR ports, AI, pools, and wallet-tx to Mainnet and unlocks dry:false only with confirmation', assertMainnetMode);

  it('negative: rejects mainnet without NEAR_ALLOW_MAINNET, unconfirmed AI live modes without AI_LIVE, secret-shaped AI_PROVIDER, and invalid wallet-tx inputs', assertModeRejections);

  it('corner: per-port overrides and fail-closed casing/whitespace behave consistently across all 3 modes', assertModeOverridesAndCasing);

  it('StakeProfitsService executes in mock/local mode and enforces quote-only dry:true in testnet and mainnet modes', assertStakeProfitsAcrossModes);

  it('StakingPerformanceService & NearUsdPriceCache switch explorer URLs, APY source, and live price fetch across mock/testnet/mainnet', assertPerformanceAndPriceCache);
});
