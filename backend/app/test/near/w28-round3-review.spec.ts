import { generateKeyPairSync } from 'node:crypto';
import { CANONICAL_PLANETS } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FlagsService } from '../../src/flags/flags.service.js';
import type { StakingPort } from '../../src/near/application/ports/staking.port.js';
import { NearException } from '../../src/near/domain/errors.js';
import { TestnetStakingAdapter } from '../../src/near/infrastructure/adapters/real/testnet-staking.adapter.js';
import type { StakingRpc } from '../../src/near/infrastructure/adapters/real/testnet-staking-reads.js';
import { seedToNearSecretKey } from '../../src/near/infrastructure/rpc/near-rpc.client.js';
import { ActionEffects } from '../../src/near/staking/services/action-effects.js';
import { ActionFinisher, OpNonce } from '../../src/near/staking/services/action-finisher.js';
import { PerksView } from '../../src/near/staking/services/perks-view.js';
import { WalletStakeFlow } from '../../src/near/staking/services/wallet-stake.flow.js';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service.js';

function makeNearSecretKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  return seedToNearSecretKey(Buffer.from(privDer.subarray(privDer.length - 32)));
}

const ONE = 10n ** 24n;

describe('W28 Round 3: TestnetStakingAdapter LST pool support & withdraw_lst rollback detection', () => {
  it('accepts whitelisted LST pools across position/unstake/compound/withdraw, infers asset on V1 MethodNotFound, and catches false rollback on withdraw_lst', async () => {
    const minterKey = makeNearSecretKey();
    const rpcCalls: Array<{ methodName: string; args: Record<string, unknown> }> = [];
    let nextSuccessJson: unknown = true;

    const fakeRpc: StakingRpc = {
      network: 'testnet',
      config: {
        contracts: { staking: 'staking.terraagent.testnet' },
        accounts: { minter: 'minter.terraagent.testnet' },
        secrets: { minterSecretKey: minterKey },
      },
      view: async (_contract, method, args) => {
        if (method === 'get_account_positions') {
          throw new Error('MethodResolveError(MethodNotFound)');
        }
        return {
          account_id: String(args?.account_id ?? 'alice.testnet'),
          pool_id: String(args?.pool_id ?? 'meta-v2.pool.testnet'),
          staked: (25n * ONE).toString(),
          unbonding: '0',
          unbonding_ready_at_ms: null,
          withdrawable: (10n * ONE).toString(),
          rewards: '0',
        } as never;
      },
      call: async (params) => {
        rpcCalls.push({ methodName: params.methodName, args: params.args });
        const b64 = Buffer.from(JSON.stringify(nextSuccessJson)).toString('base64');
        return {
          receipt: { txHash: `tx_${rpcCalls.length}`, blockHeight: 1, status: 'success', network: 'testnet', at: 1_000 },
          outcome: { status: { SuccessValue: b64 } },
        };
      },
      accountBalanceYocto: async () => (5n * ONE).toString(),
    };

    const adapter = new TestnetStakingAdapter(
      { NEAR_MODE: 'testnet', NEAR_NETWORK: 'testnet', TA_WAVES: 'all' } as never,
      fakeRpc,
      { samples: async () => ({ now: { totalSupplyYocto: 100n * ONE, blockTimeMs: 86_400_000 }, then: { totalSupplyYocto: 99n * ONE, blockTimeMs: 0 }, totalStakeYocto: 50n * ONE }) },
    );

    // 1. V1 MethodNotFound on get_account_positions still resolves LST position and infers asset = 'stNEAR'!
    const pos = await adapter.position({ accountId: 'alice.testnet', pool: 'meta-v2.pool.testnet' });
    expect(pos).toMatchObject({ pool: 'meta-v2.pool.testnet', asset: 'stNEAR', staked: (25n * ONE).toString() });

    // 2. Unstake and compound on LST pool succeed without POOL_NOT_WHITELISTED, while evil pool still rejects!
    await adapter.unstake({ opId: 'op_u_lst', accountId: 'alice.testnet', pool: 'meta-v2.pool.testnet', amount: ONE.toString() });
    await adapter.compound({ opId: 'op_c_lst', accountId: 'alice.testnet', pool: 'meta-v2.pool.testnet' });
    await expect(adapter.position({ accountId: 'alice.testnet', pool: 'evil.pool.testnet' })).rejects.toMatchObject({
      errorCode: 'POOL_NOT_WHITELISTED',
    });

    // 3. withdraw on meta-v2.pool.testnet dispatches withdraw_lst even without explicit asset, and detects boolean `false` rollback!
    nextSuccessJson = false;
    await expect(
      adapter.withdraw({ opId: 'op_w_rollback', accountId: 'alice.testnet', pool: 'meta-v2.pool.testnet' }),
    ).rejects.toBeInstanceOf(NearException);

    nextSuccessJson = true;
    const okReceipt = await adapter.withdraw({ opId: 'op_w_ok', accountId: 'alice.testnet', pool: 'meta-v2.pool.testnet' });
    expect(okReceipt.txHash).toBeTruthy();
    expect(rpcCalls.at(-1)).toMatchObject({
      methodName: 'withdraw_lst',
      args: expect.objectContaining({ pool_id: 'meta-v2.pool.testnet', lst_contract: 'meta-v2.pool.testnet' }),
    });
  });
});

describe('W28 Round 3: StakingPositionSyncService V1 fallback, RPC-outage safety & Patron refresh', () => {
  it('probes LST pools on V1 MethodNotFound, refuses to wipe LST positions on transient RPC timeouts, and refreshes nominated Patron seats', async () => {
    const upserts: string[] = [];
    const deletes: unknown[] = [];
    const refreshedSeats: string[] = [];
    let accountPositionsMode: 'v1' | 'timeout' = 'v1';

    const stakingPort: Partial<StakingPort> = {
      listPools: async () => [{ poolId: 'astro-stakers.pool.testnet', name: 'Astro', apyBp: 900 }],
      accountPositions: async () => {
        if (accountPositionsMode === 'v1') throw new Error('MethodNotFound: get_account_positions');
        throw new Error('rpc_timeout: timed out');
      },
      position: async ({ pool }) => {
        if (pool === 'astro-stakers.pool.testnet') {
          return { accountId: 'whale.testnet', pool, staked: (50n * ONE).toString(), unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null };
        }
        if (pool === 'meta-v2.pool.testnet') {
          return { accountId: 'whale.testnet', pool, asset: 'stNEAR', staked: (500n * ONE).toString(), unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null };
        }
        return { accountId: 'whale.testnet', pool, staked: '0', unbonding: '0', withdrawable: '0', rewards: '0', unbondingReadyAtMs: null };
      },
      rewards: async () => ({ accrued: '0' }),
    };

    const prisma = {
      stakingPosition: {
        findMany: async () => [
          { accountId: 'whale.testnet', poolId: 'meta-v2.pool.testnet', stakedSnapshot: { toFixed: () => (500n * ONE).toString() }, stakedSinceAt: new Date(0), lastStakedAt: new Date(0) },
        ],
        findFirst: async () => null,
        upsert: async (args: { where: { colonyId_poolId: { poolId: string } } }) => {
          upserts.push(args.where.colonyId_poolId.poolId);
        },
        deleteMany: async (args: unknown) => {
          deletes.push(args);
          return { count: 0 };
        },
      },
      nearColonyAccount: { findMany: async () => [], findUnique: async () => null },
      socialIdentity: { findMany: async () => [], findFirst: async () => null },
      deed: { findFirst: async () => null },
      colony: { findMany: async () => [], findUnique: async () => null },
      stakingPatronNomination: {
        findMany: async () => [{ accountId: 'whale.testnet', planetId: CANONICAL_PLANETS.desert.id }],
      },
      stakingPatronSeat: {
        findMany: async () => [],
        findUnique: async () => null,
        upsert: async (args: { where: { planetId: string } }) => {
          refreshedSeats.push(args.where.planetId);
        },
        deleteMany: async () => ({ count: 0 }),
      },
    };

    const env = { NEAR_MODE: 'testnet', NEAR_NETWORK: 'testnet', DATABASE_URL: 'postgres://mock', TA_WAVES: 'all' };
    const flags = { has: () => true } as unknown as FlagsService;
    const sync = new StakingPositionSyncService(stakingPort as StakingPort, env as never, prisma as never, flags);

    // 1. V1 MethodNotFound probes meta-v2.pool.testnet via get_position and refreshes whale's nominated Lead Patron seat!
    const v1Active = await sync.syncAccountPositions('whale.testnet', undefined, true);
    expect(v1Active.map((p) => p.pool)).toEqual(['astro-stakers.pool.testnet', 'meta-v2.pool.testnet']);
    expect(upserts).toContain('meta-v2.pool.testnet');
    expect(refreshedSeats).toContain(CANONICAL_PLANETS.desert.id);

    // 2. Transient RPC timeout on accountPositions MUST NOT run global deleteMany to wipe meta-v2.pool.testnet!
    deletes.length = 0;
    accountPositionsMode = 'timeout';
    await sync.syncAccountPositions('whale.testnet', undefined, true);
    const globalPrunes = deletes.filter((d) => JSON.stringify(d).includes('notIn'));
    expect(globalPrunes).toHaveLength(0);
  });
});

describe('W28 Round 3: WalletStakeFlow.withdraw forwards asset to StakingPort & ActionEffects', () => {
  it('passes asset=stNEAR to StakingPort.withdraw and records stNEAR in StakingTx history', async () => {
    const withdrawSpy = vi.fn().mockResolvedValue({ txHash: 'tx_w_lst', blockHeight: 1, status: 'FINAL', explorerUrl: 'https://x' });
    const recorded: Array<{ kind: string; asset: string }> = [];
    const pos = { accountId: 'alice.near', pool: 'meta-pool.near', staked: '0', unbonding: '0', withdrawable: (5n * ONE).toString(), rewards: '0', unbondingReadyAtMs: null };
    const stakingPort = {
      position: async () => pos,
      rewards: async () => ({ accrued: '0' }),
      withdraw: withdrawSpy,
      listPools: async () => [{ poolId: 'meta-pool.near', name: 'Meta Pool', apyBp: 900 }],
    } as unknown as StakingPort;
    const sync = new StakingPositionSyncService(stakingPort, { NODE_ENV: 'test' } as never);
    const flow = new WalletStakeFlow({
      staking: stakingPort,
      balances: { readNear: async () => '10' } as never,
      finisher: new ActionFinisher(stakingPort, sync),
      nonce: new OpNonce(),
      perks: new PerksView(stakingPort, () => ({ TA_WAVES: 'all' }), () => null),
      effects: new ActionEffects(stakingPort, { record: async (e: { kind: string; asset: string }) => { recorded.push({ kind: e.kind, asset: e.asset }); } } as never),
      env: () => ({ NEAR_MODE: 'mock' }),
      db: () => null,
    });

    await flow.withdraw({ accountId: 'alice.near', pool: 'meta-pool.near', asset: 'stNEAR' });
    expect(withdrawSpy).toHaveBeenCalledWith(expect.objectContaining({ pool: 'meta-pool.near', asset: 'stNEAR' }));
    expect(recorded).toContainEqual({ kind: 'withdraw', asset: 'stNEAR' });
  });
});
