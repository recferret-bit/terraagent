import { expect } from 'vitest';
import type { StakingPort } from '../application/ports/staking.port';
import { nearToYocto } from '../staking/yocto';
import {
  defineNearContract,
  describeNearPortContract,
  type MakeAdapter,
  type NearContractApi,
  type NearContractSuite,
} from './harness';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export interface StakingContractHelpers {
  fund(accountId: string, yoctoAmount: string): Promise<void>;
  advanceDays(days: number): void;
}

interface TestableStakingAdapter {
  creditNear?(accountId: string, yoctoAmount: string): Promise<void>;
  advanceGameDays?(days: number): void;
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
    expect(mid.staked).toBe(nearToYocto(6));
    expect(mid.unbonding).toBe(nearToYocto(4));
    expect(mid.unbondingReadyAtMs).not.toBeNull();
    expect(mid.withdrawable).toBe('0');

    await expect(
      port.withdraw({ opId: `withdraw-early:${uid()}`, accountId, pool }),
    ).rejects.toMatchObject({ errorCode: 'STAKE_INSUFFICIENT_BALANCE' });

    advanceDays(2);
    const ready = await port.position({ accountId, pool });
    expect(ready.unbonding).toBe('0');
    expect(ready.withdrawable).toBe(nearToYocto(4));

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

export const stakingSuite: NearContractSuite<StakingPort, StakingContractHelpers> = (api) => {
  addWhitelistAndIdempotencyTests(api);
  addUnbondingAndRewardsTests(api);
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
    };
  },
  suite: stakingSuite,
});

export const describeStakingPortContract = (
  label: string,
  make: MakeAdapter<StakingPort, StakingContractHelpers>,
): void => describeNearPortContract('Staking', label, make, stakingSuite);
