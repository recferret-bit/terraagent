import { STAKING_RULES } from '@terra/contracts';
import { expect } from 'vitest';
import type { StakingPort } from '../application/ports/staking.port';
import { isW28Enabled } from '../staking/perks/legacy-ladder';
import { nearToYocto, PROTOCOL_STAKING_ACCOUNT_ID } from '../staking/yocto';
import {
  defineNearContract,
  describeNearPortContract,
  type MakeAdapter,
  type NearContractApi,
  type NearContractSuite,
} from './harness';

/** The `< 7 day` early-exit fee of the W28 ladder on `amount` (0 with the wave off). */
const w28Fee = (amount: bigint): bigint =>
  isW28Enabled(process.env) ? (amount * BigInt(STAKING_RULES.earlyExitFeeBp)) / 10_000n : 0n;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export interface StakingContractHelpers {
  fund(accountId: string, yoctoAmount: string): Promise<void>;
  advanceDays(days: number): void;
  /** Plain NEAR balance of an account (the protocol account receives the early-exit fee). */
  balanceOf(accountId: string): Promise<bigint>;
}

interface TestableStakingAdapter {
  creditNear?(accountId: string, yoctoAmount: string): Promise<void>;
  advanceGameDays?(days: number): void;
  nearBalanceOf?(accountId: string): Promise<string>;
}

function addWhitelistAndIdempotencyTests(
  api: NearContractApi<StakingPort, StakingContractHelpers>,
): void {
  const { test, expectReceipt } = api;

  test('listPools returns whitelisted pools and rejects non-whitelisted pool with POOL_NOT_WHITELISTED', async ({ port, fund }) => {
    const pools = await port.listPools();
    expect(pools.length).toBeGreaterThanOrEqual(1);
    expect(pools[0]!.apyBp).toBeGreaterThan(0);

    const accountId = `col-${uid()}.pilot.terraagent.mock`;
    await fund(accountId, nearToYocto(20));

    await expect(
      port.stake({
        opId: `stake-bad-pool:${uid()}`,
        accountId,
        pool: 'unapproved-validator.pool.mock',
        amount: nearToYocto(5),
      }),
    ).rejects.toMatchObject({ errorCode: 'POOL_NOT_WHITELISTED' });
  });

  test('stake is idempotent by opId and fails with STAKE_INSUFFICIENT_BALANCE when unfunded', async (a) => {
    const { port, fund } = a;
    const pools = await port.listPools();
    const pool = pools[0]!.poolId;
    const accountId = `col-${uid()}.pilot.terraagent.mock`;

    await expect(
      port.stake({
        opId: `stake-unfunded:${uid()}`,
        accountId,
        pool,
        amount: nearToYocto(10),
      }),
    ).rejects.toMatchObject({ errorCode: 'STAKE_INSUFFICIENT_BALANCE' });

    await fund(accountId, nearToYocto(10));
    const opId = `stake-idem:${uid()}`;
    const r1 = await port.stake({ opId, accountId, pool, amount: nearToYocto(10) });
    const r2 = await port.stake({ opId, accountId, pool, amount: nearToYocto(10) });
    expect(r2.txHash).toBe(r1.txHash);
    expectReceipt(r1, a);

    const pos = await port.position({ accountId, pool });
    expect(pos.staked).toBe(nearToYocto(10));
  });
}

function addUnbondingAndRewardsTests(
  api: NearContractApi<StakingPort, StakingContractHelpers>,
): void {
  const { test, expectReceipt } = api;

  test('stake -> unstake -> unbonding -> withdraw transitions states and is idempotent by opId', async (a) => {
    const { port, fund, advanceDays } = a;
    const pools = await port.listPools();
    const pool = pools[0]!.poolId;
    const accountId = `col-${uid()}.pilot.terraagent.mock`;
    await fund(accountId, nearToYocto(10));

    await port.stake({
      opId: `stake:${uid()}`,
      accountId,
      pool,
      amount: nearToYocto(10),
    });

    const unstakeOp = `unstake:${uid()}`;
    const u1 = await port.unstake({ opId: unstakeOp, accountId, pool, amount: nearToYocto(4) });
    const u2 = await port.unstake({ opId: unstakeOp, accountId, pool, amount: nearToYocto(4) });
    expect(u2.txHash).toBe(u1.txHash);
    expectReceipt(u1, a);

    const mid = await port.position({ accountId, pool });
    // W28: this unstake is `< 7 days` after the deposit, so 25 bp of it stays with the protocol.
    const fee = w28Fee(BigInt(nearToYocto(4)));
    expect(mid.staked).toBe(nearToYocto(6));
    expect(mid.unbonding).toBe((BigInt(nearToYocto(4)) - fee).toString());
    expect(mid.unbondingReadyAtMs).not.toBeNull();
    expect(mid.withdrawable).toBe('0');

    await expect(
      port.withdraw({ opId: `withdraw-early:${uid()}`, accountId, pool }),
    ).rejects.toMatchObject({ errorCode: 'STAKE_INSUFFICIENT_BALANCE' });

    advanceDays(2);
    const ready = await port.position({ accountId, pool });
    expect(ready.unbonding).toBe('0');
    expect(ready.withdrawable).toBe((BigInt(nearToYocto(4)) - fee).toString());

    const withdrawOp = `withdraw:${uid()}`;
    const w1 = await port.withdraw({ opId: withdrawOp, accountId, pool });
    const w2 = await port.withdraw({ opId: withdrawOp, accountId, pool });
    expect(w2.txHash).toBe(w1.txHash);
    expectReceipt(w1, a);

    const after = await port.position({ accountId, pool });
    expect(after.withdrawable).toBe('0');
  });

  test('rewards are non-negative and monotonic over time', async ({ port, fund, advanceDays }) => {
    const pools = await port.listPools();
    const pool = pools[0]!.poolId;
    const accountId = `col-${uid()}.pilot.terraagent.mock`;
    await fund(accountId, nearToYocto(10));

    const r0 = await port.rewards({ accountId, pool });
    expect(BigInt(r0.accrued)).toBe(0n);

    await port.stake({
      opId: `stake-rew:${uid()}`,
      accountId,
      pool,
      amount: nearToYocto(10),
    });

    advanceDays(10);
    const r10 = BigInt((await port.rewards({ accountId, pool })).accrued);
    expect(r10 > 0n).toBe(true);

    advanceDays(20);
    const r30 = BigInt((await port.rewards({ accountId, pool })).accrued);
    expect(r30 > r10).toBe(true);
  });
}

function addW28ClockAndCompoundTests(api: NearContractApi<StakingPort, StakingContractHelpers>): void {
  const { test } = api;
  const newWallet = () => `wal-${uid()}.near`;

  test('deposit clocks: since starts the stake, last follows every deposit, emptying resets both', async ({ port, fund, advanceDays }) => {
    const pool = (await port.listPools())[0]!.poolId;
    const accountId = newWallet();
    await fund(accountId, nearToYocto(30));
    const empty = await port.position({ accountId, pool });
    expect(empty.stakedSinceMs ?? null).toBeNull();
    expect(empty.lastStakedAtMs ?? null).toBeNull();

    await port.stake({ opId: `stake-a:${uid()}`, accountId, pool, amount: nearToYocto(10) });
    const first = await port.position({ accountId, pool });
    expect(first.stakedSinceMs).toEqual(expect.any(Number));
    expect(first.lastStakedAtMs).toBe(first.stakedSinceMs);

    advanceDays(1);
    await port.stake({ opId: `stake-b:${uid()}`, accountId, pool, amount: nearToYocto(5) });
    const second = await port.position({ accountId, pool });
    expect(second.stakedSinceMs).toBe(first.stakedSinceMs);
    expect(second.lastStakedAtMs!).toBeGreaterThan(first.lastStakedAtMs!);

    await port.unstake({ opId: `unstake-all:${uid()}`, accountId, pool, amount: nearToYocto(15) });
    const emptied = await port.position({ accountId, pool });
    expect(emptied.staked).toBe('0');
    expect(emptied.stakedSinceMs ?? null).toBeNull();
    expect(emptied.lastStakedAtMs ?? null).toBeNull();
  });

  test('early exit: < 7 days pays 25 bp to the protocol, >= 7 days pays nothing (W28 only)', async ({ port, fund, advanceDays, balanceOf }) => {
    const pool = (await port.listPools())[0]!.poolId;
    const accountId = newWallet();
    await fund(accountId, nearToYocto(20));
    await port.stake({ opId: `stake:${uid()}`, accountId, pool, amount: nearToYocto(20) });

    const protocolBefore = await balanceOf(PROTOCOL_STAKING_ACCOUNT_ID);
    const amount = BigInt(nearToYocto(4));
    await port.unstake({ opId: `early:${uid()}`, accountId, pool, amount: nearToYocto(4) });
    const fee = w28Fee(amount);
    const early = await port.position({ accountId, pool });
    expect(BigInt(early.unbonding)).toBe(amount - fee);
    expect((await balanceOf(PROTOCOL_STAKING_ACCOUNT_ID)) - protocolBefore >= fee).toBe(true);

    advanceDays(8);
    const before = BigInt((await port.position({ accountId, pool })).unbonding) + BigInt((await port.position({ accountId, pool })).withdrawable);
    await port.unstake({ opId: `matured:${uid()}`, accountId, pool, amount: nearToYocto(4) });
    const after = await port.position({ accountId, pool });
    expect(BigInt(after.unbonding) + BigInt(after.withdrawable) - before).toBe(amount);
  });

  test('compound rolls the accrued yield into principal, keeps the clocks and rejects an empty position', async ({ port, fund, advanceDays }) => {
    if (!port.compound) return;
    const pool = (await port.listPools())[0]!.poolId;
    const accountId = newWallet();
    await expect(port.compound({ opId: `compound-none:${uid()}`, accountId, pool })).rejects.toMatchObject({ errorCode: 'NOTHING_TO_COMPOUND' });

    await fund(accountId, nearToYocto(10));
    await port.stake({ opId: `stake:${uid()}`, accountId, pool, amount: nearToYocto(10) });
    advanceDays(30);
    const before = await port.position({ accountId, pool });
    expect(BigInt(before.rewards) > 0n).toBe(true);

    const opId = `compound:${uid()}`;
    const r1 = await port.compound({ opId, accountId, pool });
    const r2 = await port.compound({ opId, accountId, pool });
    expect(r2.txHash).toBe(r1.txHash);

    const after = await port.position({ accountId, pool });
    expect(BigInt(after.staked)).toBeGreaterThanOrEqual(BigInt(before.staked) + BigInt(before.rewards));
    expect(after.stakedSinceMs).toBe(before.stakedSinceMs);
    expect(after.lastStakedAtMs).toBe(before.lastStakedAtMs);
    expect((await port.accountPositions?.(accountId))?.map((p) => p.pool)).toEqual([pool]);
  });
}

export const stakingSuite: NearContractSuite<StakingPort, StakingContractHelpers> = (api) => {
  addWhitelistAndIdempotencyTests(api);
  addUnbondingAndRewardsTests(api);
  addW28ClockAndCompoundTests(api);
};

export const contract = defineNearContract<StakingPort, StakingContractHelpers>({
  port: 'Staking',
  helpers: (port) => {
    const testable = port as unknown as TestableStakingAdapter;
    return {
      fund: async (accountId: string, yoctoAmount: string) => {
        await testable.creditNear?.(accountId, yoctoAmount);
      },
      advanceDays: (days: number) => {
        testable.advanceGameDays?.(days);
      },
      balanceOf: async (accountId: string) => BigInt((await testable.nearBalanceOf?.(accountId)) ?? '0'),
    };
  },
  suite: stakingSuite,
});

export const describeStakingPortContract = (
  label: string,
  make: MakeAdapter<StakingPort, StakingContractHelpers>,
): void => describeNearPortContract('Staking', label, make, stakingSuite);
