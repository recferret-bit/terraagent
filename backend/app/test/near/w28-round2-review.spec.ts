import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CoreException } from '../../src/core/errors/index.js';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { MarketPolicyProvider } from '../../src/market/orders/market-policy.provider.js';
import type { TradePrincipal } from '../../src/market/trade/trade-auth.js';
import { TradeError } from '../../src/market/trade/trade-error.js';
import { MAX_ACTIVE_KEYS_PER_OWNER, TradeKeysService } from '../../src/market/trade/trade-keys.service.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import { TestnetTreasuryDaoAdapter } from '../../src/near/infrastructure/adapters/real/testnet-treasury-dao.adapter.js';
import { seedToNearSecretKey } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { encodeBase58 } from '../../src/near/keystore/base58.js';
import { readPoolTxAssetNets, splitStakedByAsset } from '../../src/near/staking/performance/asset-split.js';
import type { NearUsdPriceService } from '../../src/near/staking/performance/near-usd-price.service.js';
import { StakingPerformanceService } from '../../src/near/staking/performance/staking-performance.service.js';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';
import { buildStakingWalletTxDescriptor } from '../../src/near/staking/staking-wallet-tx.js';

function makeNearSecretKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const seed = Buffer.from(privDer.subarray(privDer.length - 32));
  encodeBase58(seed);
  return seedToNearSecretKey(seed);
}

const ONE = 10n ** 24n;

describe('W28 Round 2: buildStakingWalletTxDescriptor actions & LST pool isolation', () => {
  const env = { NEAR_MODE: 'testnet', NEAR_NETWORK: 'testnet', NEAR_ROOT_ACCOUNT: 'terraagent.testnet' };

  it('builds self-custody unstake and withdraw descriptors for native NEAR and isolates LST pools from validator pools', () => {
    const nativeUnstake = buildStakingWalletTxDescriptor(
      { action: 'unstake', accountId: 'alice.testnet', poolId: 'astro-stakers.pool.testnet', amountNear: '25' },
      env,
    );
    expect(nativeUnstake).toMatchObject({
      contractId: 'staking.terraagent.testnet',
      methodName: 'unstake',
      attachedDepositYocto: '0',
      args: { account_id: 'alice.testnet', pool_id: 'astro-stakers.pool.testnet', amount: (25n * ONE).toString() },
    });

    const nativeWithdraw = buildStakingWalletTxDescriptor(
      { action: 'withdraw', accountId: 'alice.testnet', poolId: 'astro-stakers.pool.testnet' },
      env,
    );
    expect(nativeWithdraw).toMatchObject({
      contractId: 'staking.terraagent.testnet',
      methodName: 'withdraw',
      attachedDepositYocto: '0',
      args: { account_id: 'alice.testnet', pool_id: 'astro-stakers.pool.testnet', recipient_id: 'alice.testnet' },
    });

    // Even if a caller passes the native validator poolId alongside lstContract, LST actions MUST route to lstContract!
    const lstStake = buildStakingWalletTxDescriptor(
      {
        action: 'stake_lst',
        accountId: 'alice.testnet',
        poolId: 'astro-stakers.pool.testnet',
        lstContract: 'meta-v2.pool.testnet',
        amountNear: '10',
      },
      env,
    );
    expect(lstStake.contractId).toBe('meta-v2.pool.testnet');
    expect(lstStake.methodName).toBe('ft_transfer_call');
    expect(lstStake.args).toMatchObject({
      receiver_id: 'staking.terraagent.testnet',
      msg: JSON.stringify({ pool_id: 'meta-v2.pool.testnet', account_id: 'alice.testnet' }),
    });

    const lstUnstake = buildStakingWalletTxDescriptor(
      {
        action: 'unstake',
        accountId: 'alice.testnet',
        poolId: 'astro-stakers.pool.testnet',
        lstContract: 'meta-v2.pool.testnet',
        amountNear: '10',
      },
      env,
    );
    expect(lstUnstake.args).toMatchObject({ pool_id: 'meta-v2.pool.testnet' });

    const lstWithdraw = buildStakingWalletTxDescriptor(
      {
        action: 'withdraw_lst',
        accountId: 'alice.testnet',
        poolId: 'astro-stakers.pool.testnet',
        lstContract: 'meta-v2.pool.testnet',
        amountNear: '10',
      },
      env,
    );
    expect(lstWithdraw.args).toMatchObject({
      pool_id: 'meta-v2.pool.testnet',
      lst_contract: 'meta-v2.pool.testnet',
      account_id: 'alice.testnet',
    });
  });

  it('rejects unwhitelisted lstContract or unsupported actions with typed CoreException', () => {
    expect(() =>
      buildStakingWalletTxDescriptor(
        { action: 'stake_lst', accountId: 'alice.testnet', lstContract: 'evil-lst.testnet', amountNear: '5' },
        env,
      ),
    ).toThrow(CoreException);
    expect(() =>
      buildStakingWalletTxDescriptor({ action: 'unknown_action', accountId: 'alice.testnet' }, env),
    ).toThrow(CoreException);
  });
});

describe('W28 Round 2: splitStakedByAsset & readPoolTxAssetNets multi-asset native + LST accounting', () => {
  it('preserves exact native NEAR vs stNEAR/LiNEAR balances when Stake Trade Profits shares a mock pool row', () => {
    const total = 67_500_000_000_000_000_000_000_000n; // 50 NEAR + 12.5 stNEAR + 5 LiNEAR
    const mixed = splitStakedByAsset(total, 'stNEAR', {
      near: 50n * ONE,
      stNEAR: 12_500_000_000_000_000_000_000_000n,
      LiNEAR: 5n * ONE,
    });
    expect(mixed.near).toBe(50n * ONE);
    expect(mixed.stNEAR).toBe(12_500_000_000_000_000_000_000_000n);
    expect(mixed.LiNEAR).toBe(5n * ONE);
  });

  it('handles partial unstake spillover across assets via readPoolTxAssetNets and falls back cleanly when tx history is absent', async () => {
    const db = {
      stakingTx: {
        findMany: async () => [
          { accountId: 'a.near', poolId: 'astro.mock', kind: 'stake', asset: 'near', amountYocto: { toFixed: () => (50n * ONE).toString() } },
          { accountId: 'a.near', poolId: 'astro.mock', kind: 'stake_profits', asset: 'stNEAR', amountYocto: { toFixed: () => (10n * ONE).toString() } },
          { accountId: 'a.near', poolId: 'astro.mock', kind: 'unstake', asset: 'near', amountYocto: { toFixed: () => (55n * ONE).toString() } },
        ],
      },
    };
    const nets = await readPoolTxAssetNets(db as never, ['a.near']);
    const spill = splitStakedByAsset(5n * ONE, 'stNEAR', nets.get('a.near::astro.mock'));
    expect(spill).toEqual({ near: 0n, stNEAR: 5n * ONE, LiNEAR: 0n });

    const noHistory = splitStakedByAsset(20n * ONE, 'near', undefined);
    expect(noHistory).toEqual({ near: 20n * ONE, stNEAR: 0n, LiNEAR: 0n });
  });
});

describe('W28 Round 2: TradeKeysService tier-scaled botKeys enforcement', () => {
  function makeTradeKeys(opts: { w28: boolean; activeCount: number; stakedYocto: bigint }) {
    let createdCount = 0;
    const keysRepo = {
      countActive: async () => opts.activeCount + createdCount,
      create: async (rec: { key: { id: string }; ownerId: string; planetId: string; colonyId: string; accountId: string; scopes: string[]; allowance: unknown }) => {
        createdCount += 1;
        return {
          keyId: rec.key.id,
          prefix: 'ta_bot_test',
          label: 'bot',
          ownerId: rec.ownerId,
          planetId: rec.planetId,
          colonyId: rec.colonyId,
          colonyIndex: 0,
          accountId: rec.accountId,
          scopes: rec.scopes,
          ratePerSecond: 2,
          rateBurst: 5,
          allowance: rec.allowance,
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
        };
      },
    };
    const reqRepo = { usage: async () => ({ committedToday: 0n, outstandingOrders: 0 }) };
    const policy = { current: () => ({ pairs: [{ pair: 'metals.t1/USDC', quote: 'USDC' }] }) } as unknown as MarketPolicyProvider;
    const orders = {
      gate: () => undefined,
      colonyOrThrow: async () => ({ colonyId: 'col_1', colonyIndex: 0, accountId: 'alice.near' }),
    };
    const prisma = {
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(prisma),
      stakingPosition: {
        findMany: async () =>
          opts.stakedYocto > 0n
            ? [{ accountId: 'alice.near', colonyId: 'alice.near', poolId: 'astro.mock', stakedSnapshot: { toFixed: () => opts.stakedYocto.toString() }, stakedSinceAt: new Date(0), lastStakedAt: new Date(0) }]
            : [],
      },
      nearColonyAccount: { findMany: async () => [], findUnique: async () => null },
      socialIdentity: { findMany: async () => [{ accountId: 'alice.near', provider: 'near' }] },
      colony: { findMany: async () => [], findUnique: async () => null },
    };
    const flags = { has: (f: string) => opts.w28 && f === 'W28' } as unknown as FlagsService;
    return new TradeKeysService(
      keysRepo as never,
      reqRepo as never,
      policy,
      orders as never,
      {} as never,
      {} as never,
      prisma as never,
      { NODE_ENV: 'test', DATABASE_URL: 'postgres://mock' } as never,
      flags,
    );
  }

  const principal: TradePrincipal = {
    kind: 'session',
    ownerId: 'p_alice',
    scopes: new Set(['read', 'trade', 'manage']),
    key: null,
  } as unknown as TradePrincipal;

  it('caps active bot keys to 1 at Tier 0/1 and 3 at Tier 2+ under W28, while keeping 20 when W28 is off', async () => {
    const t1 = makeTradeKeys({ w28: true, activeCount: 0, stakedYocto: 10n * ONE });
    await expect(t1.create(principal, { planetId: 'pl_1', label: 'k1', scopes: ['read', 'trade'] })).resolves.toMatchObject({ secret: expect.any(String) });
    await expect(t1.create(principal, { planetId: 'pl_1', label: 'k2', scopes: ['read', 'trade'] })).rejects.toMatchObject({
      code: 'key_limit',
      details: { max: 1, tier: 1 },
    } satisfies Partial<TradeError>);

    const t2 = makeTradeKeys({ w28: true, activeCount: 2, stakedYocto: 50n * ONE });
    await expect(t2.create(principal, { planetId: 'pl_1', label: 'k3', scopes: ['read', 'trade'] })).resolves.toMatchObject({ secret: expect.any(String) });
    await expect(t2.create(principal, { planetId: 'pl_1', label: 'k4', scopes: ['read', 'trade'] })).rejects.toMatchObject({
      code: 'key_limit',
      details: { max: 3, tier: 2 },
    });

    const w27 = makeTradeKeys({ w28: false, activeCount: 5, stakedYocto: 0n });
    expect(MAX_ACTIVE_KEYS_PER_OWNER).toBe(20);
    await expect(w27.create(principal, { planetId: 'pl_1', label: 'k6', scopes: ['read', 'trade'] })).resolves.toMatchObject({ secret: expect.any(String) });
  });
});

describe('W28 Round 2: TestnetTreasuryDaoAdapter weighted voting & read-model sync', () => {
  it('dispatches vote_weighted when weightBp != 10_000 and vote when unweighted, and merges get_dao_weights', async () => {
    const adapter = new TestnetTreasuryDaoAdapter({
      NEAR_MODE: 'testnet',
      NEAR_ROOT_ACCOUNT: 'terraagent.testnet',
      NEAR_MINTER_SECRET_KEY: makeNearSecretKey(),
    } as never);
    const rpcCall = vi.fn().mockResolvedValue({
      receipt: { txHash: 'tx_vote', blockHeight: 1, status: 'FINAL', explorerUrl: 'https://x' },
      outcome: {},
    });
    const rpcView = vi.fn().mockImplementation(async (_contract: string, method: string) => {
      if (method === 'get_dao') {
        return {
          dao_account_id: 'dune.dao.terraagent.testnet',
          name: 'dune',
          members: ['a.near', 'b.near', 'c.near', 'd.near'].map((account_id) => ({ account_id, can_propose: true })),
          balances: { USDC: '50000' },
          proposals: [
            {
              id: 0,
              proposer: 'a.near',
              status: 'Approved',
              votes: [
                { voter: 'a.near', vote: 'approve' },
                { voter: 'b.near', vote: 'approve' },
                { voter: 'c.near', vote: 'reject' },
              ],
              kind: 'meteor_shield',
              description: 'shield',
            },
          ],
        };
      }
      return { '0|a.near': 15_000 };
    });
    (adapter as unknown as { rpc: { call: typeof rpcCall; view: typeof rpcView } }).rpc.call = rpcCall;
    (adapter as unknown as { rpc: { view: typeof rpcView } }).rpc.view = rpcView;

    await adapter.vote({
      opId: 'op_unweighted',
      daoAccountId: 'dune.dao.terraagent.testnet',
      proposalId: 0,
      voter: 'b.near',
      vote: 'approve',
    });
    expect(rpcCall).toHaveBeenLastCalledWith(expect.objectContaining({ methodName: 'vote' }));

    await adapter.vote({
      opId: 'op_weighted',
      daoAccountId: 'dune.dao.terraagent.testnet',
      proposalId: 0,
      voter: 'a.near',
      vote: 'approve',
      weightBp: 15_000,
    });
    expect(rpcCall).toHaveBeenLastCalledWith(
      expect.objectContaining({
        methodName: 'vote_weighted',
        args: expect.objectContaining({ weight_bp: 15_000 }),
      }),
    );

    const view = await adapter.get({ daoAccountId: 'dune.dao.terraagent.testnet' });
    expect(view.proposals[0]).toMatchObject({ proposalId: 0, state: 'Approved', yes: 2, no: 1 });
  });
});

describe('W28 Round 2: StakingPerformanceService real-network accountPositions sync', () => {
  it('syncs extra LST pools from accountPositions on real-network StakingPerformanceService reads', async () => {
    const upserts: Array<{ poolId: string; staked: string }> = [];
    const stakingPort: Partial<StakingPort> & { nearBalanceOf?(accountId: string): Promise<string> } = {
      listPools: async () => [{ poolId: 'astro-stakers.pool.testnet', name: 'Astro', apyBp: 900 }],
      accountPositions: async () => [
        { accountId: 'alice.testnet', pool: 'meta-v2.pool.testnet', staked: (35n * ONE).toString(), unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null },
      ],
      position: async ({ pool }) =>
        pool === 'meta-v2.pool.testnet'
          ? { accountId: 'alice.testnet', pool, staked: (35n * ONE).toString(), unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null }
          : { accountId: 'alice.testnet', pool, staked: '0', unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null },
      rewards: async () => ({ accrued: '0' }),
      validatorApy: async () => ({ apyBp: 900, source: 'sim', sampledAtMs: 1_000 }),
      nearBalanceOf: async () => (12n * ONE).toString(),
    };
    const prisma = {
      stakingPosition: {
        findMany: async () => [],
        findUnique: async () => null,
        upsert: async (args: { where: { colonyId_poolId: { poolId: string } }; create: { stakedSnapshot: string } }) => {
          upserts.push({ poolId: args.where.colonyId_poolId.poolId, staked: args.create.stakedSnapshot });
        },
        deleteMany: async () => ({ count: 0 }),
      },
      nearColonyAccount: { findMany: async () => [], findUnique: async () => null },
      socialIdentity: { findMany: async () => [] },
      stakingTx: { findMany: async () => [] },
      stakingPatronPayout: { findMany: async () => [] },
      stakingPatronSeat: { findFirst: async () => null },
      intentTrade: { findMany: async () => [] },
      aiWalletUsage: { findUnique: async () => null },
      player: { findUnique: async () => null },
      colony: { findMany: async () => [], findUnique: async () => null },
    };
    const env = { NEAR_MODE: 'testnet', NEAR_NETWORK: 'testnet', DATABASE_URL: 'postgres://mock', TA_WAVES: 'all' };
    const flags = { has: () => true } as unknown as FlagsService;
    const price = { nearUsd: () => 4, view: async () => ({ nearUsd: 4, source: 'est' as const, asOfMs: 1_000 }) } as unknown as NearUsdPriceService;
    const sync = new StakingPositionSyncService(stakingPort as StakingPort, env as never, prisma as never, flags);
    const perfSvc = new StakingPerformanceService(flags, price, prisma as never, env as never, undefined, stakingPort as StakingPort, sync);

    await perfSvc.performance('alice.testnet', '30d', 1_700_000_000_000);
    expect(upserts).toContainEqual({ poolId: 'meta-v2.pool.testnet', staked: (35n * ONE).toString() });
  });
});
