import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { myOrderView } from '../../src/market/api/market-snapshot.service.js';
import type { MarketOrderRecord } from '../../src/market/book/market-order.record.js';
import { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import { TestnetIntentsAdapter } from '../../src/near/infrastructure/adapters/real/testnet-intents.adapter.js';
import { NearStatusController } from '../../src/near/infrastructure/dev/near-status.controller.js';
import { nearAdapters, nearEnvFor } from '../../src/near/infrastructure/near-infrastructure.module.js';
import { resolveProtocolFeeSchedule } from '../../src/near/infrastructure/network/protocol-fee.config.js';
import { seedToNearSecretKey } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import {
  buildStakerPerksFromYocto,
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

  it('propagates custom fee/treasury env overrides and safely clamps/rejects malformed values', async () => {
    const customEnv = {
      NEAR_MODE: 'testnet',
      NEAR_PROTOCOL_ACCOUNT: 'revenue.terraagent.testnet',
      NEAR_PLATFORM_FEE_BP: '120',
      NEAR_STAKER_PLATFORM_FEE_BP: '40',
      NEAR_DAO_FEE_SHARE_BP: '2500',
      NEAR_STAKER_MIN_NEAR: '25',
      NEAR_ESCROW_SLASH_PROTOCOL_BP: '1500',
    };
    const parsed = nearEnvFor(nearAdapters).schema.parse(customEnv);
    expect(parsed).toBeTruthy();

    const ctl = new NearStatusController(undefined, customEnv as never);
    const view = await ctl.protocol();
    expect(view.protocolAccountId).toBe('revenue.terraagent.testnet');
    expect(view.feeSchedule).toMatchObject({
      standardPlatformFeeBp: 120,
      stakerPlatformFeeBp: 40,
      daoCarveOutShareBp: 2500,
      protocolNetStandardBp: 90,
      protocolNetStakerBp: 30,
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
      NEAR_ESCROW_SLASH_PROTOCOL_BP: '20000',
    });
    expect(fallback.standardPlatformFeeBp).toBe(100);
    expect(fallback.stakerPlatformFeeBp).toBe(50);
    expect(fallback.daoCarveOutShareBp).toBe(2000);
    expect(fallback.minStakeForPerksNear).toBe('10');
    expect(fallback.escrowSlashProtocolShareBp).toBe(1000);
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
