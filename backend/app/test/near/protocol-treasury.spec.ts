import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { MARKET_TOKEN_KEYS, RESOURCE_KEYS } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MarketSnapshotService, myOrderView } from '../../src/market/api/market-snapshot.service.js';
import type { MarketOrderRecord } from '../../src/market/book/market-order.record.js';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import { TradeReadService } from '../../src/market/trade/trade-read.service.js';
import { TestnetIntentsAdapter } from '../../src/near/infrastructure/adapters/real/testnet-intents.adapter.js';
import { NearStatusController } from '../../src/near/infrastructure/dev/near-status.controller.js';
import { buildProtocolTreasuryView } from '../../src/near/infrastructure/dev/protocol-treasury.view.js';
import { nearAdapters, nearEnvFor } from '../../src/near/infrastructure/near-infrastructure.module.js';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config.js';
import { resolveProtocolFeeSchedule } from '../../src/near/infrastructure/network/protocol-fee.config.js';
import { seedToNearSecretKey } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import {
  buildStakerPerksFromYocto,
  resolveDbStakerPerks,
  resolvePlanetStakedColonies,
} from '../../src/near/staking/staker-perks.js';
import { GAME_DAY_MS, nearToYocto } from '../../src/near/staking/yocto.js';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking.js';

function makeNearKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = Buffer.from(privDer.subarray(privDer.length - 32));
  const nearPublicKey = `ed25519:${encodeBase58(pubDer.subarray(pubDer.length - 32))}`;
  return { nearPublicKey, nearSecretKey: seedToNearSecretKey(seed) };
}

describe('TerraAgent Protocol treasury view, fee env overrides & staker perks', () => {
  it('exposes protocolAccount on GET /v1/near/status and full fee schedule + streams on GET /v1/near/protocol', async () => {
    const ctl = new NearStatusController(undefined, {
      NEAR_MODE: 'mock',
      NEAR_NETWORK: 'testnet',
    } as never);

    const status = await ctl.status();
    expect(status.protocolAccount).toBe('protocol.terraagent.mock');
    expect(status.accounts.protocol).toBe('protocol.terraagent.testnet');

    const protocol = await ctl.protocol();
    expect(protocol.entityName).toBe('TerraAgent Protocol');
    expect(protocol.protocolAccountId).toBe('protocol.terraagent.mock');
    expect(protocol.feeSchedule).toMatchObject({
      standardPlatformFeeBp: 100,
      stakerPlatformFeeBp: 50,
      daoCarveOutShareBp: 2000,
      protocolNetStandardBp: 80,
      protocolNetStakerBp: 40,
      validatorGrossApyBp: 900,
      stakerNetApyBp: 720,
      protocolStakingYieldBp: 180,
      protocolStakingYieldShareBp: 2000,
      minStakeForPerksNear: '10',
      escrowSlashVictimShareBp: 9000,
      escrowSlashProtocolShareBp: 1000,
    });
    expect(protocol.inflows.map((s) => s.id)).toEqual([
      'market_fee',
      'staking_yield',
      'escrow_slash',
    ]);
    expect(protocol.outflows.map((s) => s.id)).toEqual(['relayer_gas', 'managed_near_ai']);
  });
});

describe('TerraAgent Protocol custom fee/yield env overrides & bounds', () => {
  it('propagates custom fee/treasury env overrides and safely clamps/rejects malformed values', async () => {
    const customEnv = {
      NEAR_MODE: 'testnet',
      NEAR_PROTOCOL_ACCOUNT: 'revenue.terraagent.testnet',
      NEAR_PLATFORM_FEE_BP: '120',
      NEAR_STAKER_PLATFORM_FEE_BP: '40',
      NEAR_DAO_FEE_SHARE_BP: '2500',
      NEAR_STAKER_MIN_NEAR: '25',
      NEAR_PROTOCOL_STAKING_YIELD_BP: '1500',
      NEAR_ESCROW_SLASH_PROTOCOL_BP: '1500',
    };
    const parsed = nearEnvFor(nearAdapters).schema.parse(customEnv);
    expect(parsed).toBeTruthy();

    const ctl = new NearStatusController(undefined, customEnv as never);
    const view = await ctl.protocol();
    expect(view.protocolAccountId).toBe('revenue.terraagent.testnet');
    expect(view.inflows[1]?.rateSummary).toContain('15% of validator yield');
    expect(view.outflows[1]?.description).toContain('>= 25 NEAR');

    const mockCustomCtl = new NearStatusController(undefined, {
      NEAR_MODE: 'mock',
      NEAR_PROTOCOL_ACCOUNT: 'custom.protocol.mock',
    } as never);
    expect((await mockCustomCtl.status()).protocolAccount).toBe('custom.protocol.mock');
    expect(view.feeSchedule).toMatchObject({
      standardPlatformFeeBp: 120,
      stakerPlatformFeeBp: 40,
      daoCarveOutShareBp: 2500,
      protocolNetStandardBp: 90,
      protocolNetStakerBp: 30,
      stakerNetApyBp: 765,
      protocolStakingYieldBp: 135,
      protocolStakingYieldShareBp: 1500,
      minStakeForPerksNear: '25',
      escrowSlashVictimShareBp: 8500,
      escrowSlashProtocolShareBp: 1500,
    });

    const policyProvider = new MarketPolicyProvider(undefined, customEnv as never);
    expect(policyProvider.current().platformFeeBp).toBe(120);
    expect(policyProvider.current().treasuryShareBp).toBe(2500);

    // Out-of-bounds / malformed env strings fall back cleanly to D-44 defaults
    const fallback = resolveProtocolFeeSchedule({
      NEAR_PLATFORM_FEE_BP: '99999',
      NEAR_STAKER_PLATFORM_FEE_BP: '-5',
      NEAR_DAO_FEE_SHARE_BP: 'abc',
      NEAR_STAKER_MIN_NEAR: 'not-a-number',
      NEAR_PROTOCOL_STAKING_YIELD_BP: '10001',
      NEAR_ESCROW_SLASH_PROTOCOL_BP: '20000',
    });
    expect(fallback.standardPlatformFeeBp).toBe(100);
    expect(fallback.stakerPlatformFeeBp).toBe(50);
    expect(fallback.daoCarveOutShareBp).toBe(2000);
    expect(fallback.minStakeForPerksNear).toBe('10');
    expect(fallback.protocolStakingYieldShareBp).toBe(2000);
    expect(fallback.escrowSlashProtocolShareBp).toBe(1000);

    // Boundary 0 bp & 10000 bp staking yield shares
    expect(resolveProtocolFeeSchedule({ NEAR_PROTOCOL_STAKING_YIELD_BP: '0' })).toMatchObject({
      protocolStakingYieldShareBp: 0,
      protocolStakingYieldBp: 0,
      stakerNetApyBp: 900,
    });
    expect(resolveProtocolFeeSchedule({ NEAR_PROTOCOL_STAKING_YIELD_BP: '10000' })).toMatchObject({
      protocolStakingYieldShareBp: 10000,
      protocolStakingYieldBp: 900,
      stakerNetApyBp: 0,
    });
  });
});

describe('Staker perks threshold & Managed NEAR.AI wallet fallback', () => {
  it('activates staker perks strictly at >= minStakeNear and surfaces effectivePlatformFeeBp on myOrderView', () => {
    const below = buildStakerPerksFromYocto(BigInt(nearToYocto(9.9)));
    expect(below.active).toBe(false);
    expect(below.managedAutopilotUnlocked).toBe(false);
    expect(below.platformFeeBp).toBe(100);

    const exact = buildStakerPerksFromYocto(BigInt(nearToYocto(10)));
    expect(exact.active).toBe(true);
    expect(exact.managedAutopilotUnlocked).toBe(true);
    expect(exact.platformFeeBp).toBe(50);

    const dummyOrder = {
      orderId: 'ord_1',
      seq: 1n,
      ref: 'ref_1',
      planetId: 'pl_1',
      pair: 'metals.t1/USDC',
      base: 'metals.t1',
      quote: 'USDC',
      side: 'buy',
      colonyId: 'col_0',
      colonyIndex: 0,
      playerId: 'p1',
      accountId: 'p1.testnet',
      stallColonyId: 'col_0',
      stallAccountId: 'p1.testnet',
      stallHubEntityId: 1,
      platformAccountId: 'protocol.terraagent.testnet',
      amount: 10n,
      filled: 0n,
      priceAmount: 1_000_000n,
      fillPolicy: 'partial',
      policyVersion: 'v1',
      policyHash: 'h1',
      platformFeeBp: 100,
      effectivePlatformFeeBp: 50,
      stallFeeBp: 25,
      maxStallFeeBp: 50,
      reservedPrincipal: 1_000_000n,
      reservedFees: 7_500n,
      cumNotional: 0n,
      feeBuckets: {},
      actorKind: 'player',
      state: 'OPEN',
      ttlS: 3600,
      expiresAt: new Date(1_700_003_600_000),
      createdAt: new Date(1_700_000_000_000),
    } satisfies MarketOrderRecord;
    expect(myOrderView(dummyOrder).platformFeeBp).toBe(50);
  });

  it('resolves Managed NEAR.AI staker colonies via owner wallet account fallback and credits custom protocol account in InMemoryStaking', async () => {
    const fakePrisma = {
      nearColonyAccount: {
        findMany: vi.fn(async () => [
          { colonyId: 'col_0', accountId: 'p0.pilots.terraagent.testnet', ownerAccountId: 'alice.testnet' },
          { colonyId: 'col_1', accountId: 'p1.pilots.terraagent.testnet', ownerAccountId: null },
        ]),
      },
      stakingPosition: {
        findMany: vi.fn(async () => [
          { colonyId: 'external', accountId: 'alice.testnet', stakedSnapshot: { toFixed: () => nearToYocto(12) } },
        ]),
      },
      mockChainStaking: {
        findMany: vi.fn(async () => []),
      },
    };
    const map = await resolvePlanetStakedColonies(
      fakePrisma as never,
      { DATABASE_URL: 'postgresql://terra:terra@127.0.0.1:5432/terra' } as never,
      [
        { index: 0, id: 'col_0' },
        { index: 1, id: 'col_1' },
      ],
    );
    expect(map).toEqual({ 0: true });

    const mem = new InMemoryStaking(undefined, undefined, 'treasury-v2.terraagent.mock');
    await mem.creditNear('alice.mock', nearToYocto(10));
    await mem.stake({ opId: 'op-1', accountId: 'alice.mock', pool: 'astro-stakers.pool.mock', amount: nearToYocto(10) });
    mem.advanceClockMs(365 * GAME_DAY_MS);
    await mem.unstake({ opId: 'op-2', accountId: 'alice.mock', pool: 'astro-stakers.pool.mock', amount: nearToYocto(10) });
    expect(await mem.nearBalanceOf('treasury-v2.terraagent.mock')).toBe(nearToYocto('0.18'));
  });
});

describe('Claimed wallet trade fee discounts & multi-pool mockChainStaking', () => {
  it('resolves claimed wallet trade fee discounts via resolveDbStakerPerks and sums multi-pool mockChainStaking', async () => {
    const claimedDb = {
      nearColonyAccount: {
        findMany: vi.fn(async () => [
          {
            colonyId: 'col_0',
            accountId: 'col-0.alex.pilots.terraagent.testnet',
            ownerAccountId: 'alex.pilots.terraagent.testnet',
            claimedByAccountId: 'alex-wallet.testnet',
          },
        ]),
      },
      stakingPosition: {
        findMany: vi.fn(async () => [
          { stakedSnapshot: { toFixed: () => nearToYocto(10) } },
        ]),
      },
      mockChainStaking: { findMany: vi.fn(async () => []) },
    };
    const perks = await resolveDbStakerPerks(claimedDb as never, {
      colonyId: 'col_0',
      accountId: 'col-0.alex.pilots.terraagent.testnet',
      standardPlatformFeeBp: 80,
    });
    expect(perks.active).toBe(true);
    expect(perks.platformFeeBp).toBe(40);

    const multiPoolPrisma = {
      nearColonyAccount: {
        findMany: vi.fn(async () => [
          { colonyId: 'col_0', accountId: 'p0.mock', ownerAccountId: 'p0.mock', claimedByAccountId: null },
        ]),
      },
      stakingPosition: { findMany: vi.fn(async () => []) },
      mockChainStaking: {
        findMany: vi.fn(async () => [
          { accountId: 'p0.mock', staked: { toFixed: () => nearToYocto(5) } },
          { accountId: 'p0.mock', staked: { toFixed: () => nearToYocto(5) } },
        ]),
      },
    };
    const multiMap = await resolvePlanetStakedColonies(
      multiPoolPrisma as never,
      { DATABASE_URL: 'postgresql://terra:terra@127.0.0.1:5432/terra' } as never,
      [{ index: 0, id: 'col_0' }],
    );
    expect(multiMap).toEqual({ 0: true });
  });
});

describe('Mainnet fee-receiving token_diff signing for protocol & dao accounts', () => {
  it('signs production Mainnet fee-receiving token_diff legs for protocol.<root> and dao.<root> via NEAR_PROTOCOL_SECRET_KEY / NEAR_DAO_SECRET_KEY', async () => {
    const protoKey = makeNearKeyPair();
    const daoKey = makeNearKeyPair();
    const emptyPrisma = {
      nearColonyAccount: { findUnique: vi.fn(async () => null) },
    };
    const adapter = new TestnetIntentsAdapter(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://terra:terra@127.0.0.1:5432/terra',
        NEAR_MODE: 'mainnet',
        NEAR_ALLOW_MAINNET: '1',
        NEAR_ROOT_ACCOUNT: 'terraagent.near',
        NEAR_PROTOCOL_SECRET_KEY: protoKey.nearSecretKey,
        NEAR_DAO_SECRET_KEY: daoKey.nearSecretKey,
        NEAR_KEK: randomBytes(32).toString('base64'),
      } as never,
      emptyPrisma as never,
    );
    const rpc = (adapter as unknown as { rpc: { view: (cid: string, m: string) => Promise<string> } }).rpc;
    vi.spyOn(rpc, 'view').mockResolvedValue('cafebabe');

    const protoSigned = await adapter.signTokenDiff({
      accountId: 'protocol.terraagent.near',
      deltas: { USDC: '8000' },
      deadlineMs: Date.now() + 60_000,
    });
    expect(protoSigned.publicKey).toBe(protoKey.nearPublicKey);
    expect(protoSigned.diff.accountId).toBe('protocol.terraagent.near');

    const daoSigned = await adapter.signTokenDiff({
      accountId: 'dao.terraagent.near',
      deltas: { USDC: '2000' },
      deadlineMs: Date.now() + 60_000,
    });
    expect(daoSigned.publicKey).toBe(daoKey.nearPublicKey);
    expect(daoSigned.diff.accountId).toBe('dao.terraagent.near');

    const subDaoSigned = await adapter.signTokenDiff({
      accountId: 'kepler.dao.terraagent.near',
      deltas: { USDC: '2000' },
      deadlineMs: Date.now() + 60_000,
    });
    expect(subDaoSigned.publicKey).toBe(daoKey.nearPublicKey);
    expect(subDaoSigned.diff.accountId).toBe('kepler.dao.terraagent.near');

    // Unknown unprovisioned account on production Mainnet still fails closed
    await expect(
      adapter.signTokenDiff({
        accountId: 'unknown.near',
        deltas: { USDC: '-10000' },
        deadlineMs: Date.now() + 60_000,
      }),
    ).rejects.toMatchObject({ errorCode: 'NEAR_ACCOUNT_NOT_FOUND' });
  });
});

describe('Live RPC protocol balance hydration & /v1/trade/policy staker discounts', () => {
  it('hydrates native NEAR, staking vault yield, NEP-245 cargo & Mainnet verifier balances with graceful RPC error tolerance', async () => {
    const mainnetEnv = { NEAR_MODE: 'mainnet', NEAR_ROOT_ACCOUNT: 'terraagent.near' };
    const cfg = resolveNearNetworkConfig(mainnetEnv, 'mainnet');
    const cargoBatch = RESOURCE_KEYS.map((k) => (k === 'metals.t1' ? '42000000000000000000' : '0'));
    const verifierBatch = MARKET_TOKEN_KEYS.map((k) => (k === 'USDC' ? '12500000' : '0'));

    const mockRpc = {
      config: cfg,
      network: 'mainnet' as const,
      withFailover: vi.fn(async (op: (p: { viewAccount: () => Promise<{ amount: string }> }) => Promise<unknown>) =>
        op({ viewAccount: async () => ({ amount: nearToYocto(15) }) }),
      ),
      view: vi.fn(async (contractId: string, methodName: string) => {
        if (contractId === cfg.contracts.staking && methodName === 'get_protocol_yield_balance') {
          return nearToYocto('1.8');
        }
        if (contractId === cfg.contracts.res && methodName === 'mt_batch_balance_of') {
          return cargoBatch;
        }
        if (contractId === cfg.contracts.intents && methodName === 'mt_batch_balance_of') {
          return verifierBatch;
        }
        throw new Error('unexpected rpc view');
      }),
    };

    const view = await buildProtocolTreasuryView(mainnetEnv, undefined, mockRpc as never);
    expect(view.balances).toEqual({
      NEAR: nearToYocto(15),
      STAKING_YIELD_NEAR: nearToYocto('1.8'),
      'metals.t1': '42000000000000000000',
      USDC: '12500000',
    });

    // Partial RPC failure never rejects /v1/near/protocol
    const degradedRpc = {
      ...mockRpc,
      withFailover: vi.fn(async () => {
        throw new Error('rpc_down');
      }),
    };
    const degraded = await buildProtocolTreasuryView(mainnetEnv, undefined, degradedRpc as never);
    expect(degraded.balances.STAKING_YIELD_NEAR).toBe(nearToYocto('1.8'));
    expect(degraded.balances.NEAR).toBeUndefined();
  });
});

describe('Custom staking yield split & /v1/trade/policy staker discounts', () => {
  it('credits custom NEAR_PROTOCOL_STAKING_YIELD_BP in InMemoryStaking and resolves /v1/trade/policy staker fee discounts', async () => {
    const mem15 = new InMemoryStaking(undefined, undefined, 'proto.mock', 1500);
    await mem15.creditNear('bob.mock', nearToYocto(10));
    await mem15.stake({ opId: 's1', accountId: 'bob.mock', pool: 'astro-stakers.pool.mock', amount: nearToYocto(10) });
    mem15.advanceClockMs(365 * GAME_DAY_MS);
    await mem15.unstake({ opId: 'u1', accountId: 'bob.mock', pool: 'astro-stakers.pool.mock', amount: nearToYocto(10) });
    expect(await mem15.nearBalanceOf('proto.mock')).toBe(nearToYocto('0.135'));

    const customTradeEnv = {
      NEAR_PLATFORM_FEE_BP: '120',
      NEAR_STAKER_PLATFORM_FEE_BP: '45',
      NEAR_DAO_FEE_SHARE_BP: '2500',
      NEAR_STAKER_MIN_NEAR: '10',
    };
    const policyProvider = new MarketPolicyProvider(undefined, customTradeEnv as never);
    const snapshotSvc = new MarketSnapshotService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      policyProvider,
      {} as never,
      {} as never,
      customTradeEnv as never,
    );
    const fakePrisma = {
      colony: { findFirst: vi.fn(async () => ({ id: 'col_staker' })) },
      nearColonyAccount: {
        findMany: vi.fn(async () => [{ colonyId: 'col_staker', accountId: 'staker.testnet', ownerAccountId: null, claimedByAccountId: null }]),
      },
      stakingPosition: {
        findMany: vi.fn(async () => [{ stakedSnapshot: { toFixed: () => nearToYocto(12) } }]),
      },
      mockChainStaking: { findMany: vi.fn(async () => []) },
    };
    const readSvc = new TradeReadService(
      fakePrisma as never,
      { gate: () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      snapshotSvc,
      policyProvider,
      customTradeEnv as never,
    );

    const anonPolicy = await readSvc.policyView(null);
    expect(anonPolicy.policy).toMatchObject({
      platformFeeBp: 120,
      standardPlatformFeeBp: 120,
      stakerPlatformFeeBp: 45,
      minStakeNear: '10',
      daoFeeShareBp: 2500,
    });
    expect(anonPolicy.policy.stakerDiscountActive).toBeUndefined();

    const stakerPolicy = await readSvc.policyView({
      actorKind: 'player',
      ownerId: 'player_1',
      ownerRef: 'player:player_1',
      key: null,
      scopes: ['read', 'trade', 'manage'],
      colonyFor: async () => ({ colonyId: 'col_staker', colonyIndex: 0, accountId: 'staker.testnet' }),
    }, 'planet-alpha');
    expect(stakerPolicy.policy).toMatchObject({
      platformFeeBp: 45,
      standardPlatformFeeBp: 120,
      daoFeeShareBp: 2500,
      stakerDiscountActive: true,
    });
  });
});
