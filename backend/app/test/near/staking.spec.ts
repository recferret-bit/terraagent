import { describe, expect, it } from 'vitest';
import {
  nearToYocto,
  yoctoToNear,
} from '../../src/near/infrastructure/adapters/mock/staking.adapter';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking';

describe('W20-16 InMemoryStaking & reward accrual math', () => {
  it('acceptance: Stake 10 NEAR -> after 30 game-days, rewards ~= 0.074 NEAR (10 * 0.09 * 30 / 365)', async () => {
    const staking = new InMemoryStaking();
    const accountId = 'col-0.pilot.terraagent.mock';
    const pool = 'astro-stakers.pool.mock';
    await staking.creditNear(accountId, nearToYocto(20));

    await staking.stake({
      opId: 'stake:1',
      accountId,
      pool,
      amount: nearToYocto(10),
    });

    staking.advanceGameDays(30);
    const rew = await staking.rewards({ accountId, pool });
    const nearRewards = Number(yoctoToNear(rew.accrued, 6));
    expect(nearRewards).toBeCloseTo((10 * 0.09 * 30) / 365, 3);
    expect(nearRewards).toBeCloseTo(0.074, 3);
  });

  it('enforces 2-game-day unbonding before withdraw and is idempotent by opId', async () => {
    const staking = new InMemoryStaking();
    const accountId = 'col-1.pilot.terraagent.mock';
    const pool = 'astro-stakers.pool.mock';
    await staking.creditNear(accountId, nearToYocto(10));

    const r1 = await staking.stake({ opId: 'stake:idem', accountId, pool, amount: nearToYocto(10) });
    const r2 = await staking.stake({ opId: 'stake:idem', accountId, pool, amount: nearToYocto(10) });
    expect(r2.txHash).toBe(r1.txHash);
    expect(await staking.nearBalanceOf(accountId)).toBe('0');

    await staking.unstake({ opId: 'unstake:1', accountId, pool, amount: nearToYocto(5) });
    const posUnbonding = await staking.position({ accountId, pool });
    expect(posUnbonding.staked).toBe(nearToYocto(5));
    expect(posUnbonding.unbonding).toBe(nearToYocto(5));
    expect(posUnbonding.withdrawable).toBe('0');

    // Before 2 game-days, withdraw fails
    staking.advanceGameDays(1);
    await expect(
      staking.withdraw({ opId: 'withdraw:early', accountId, pool }),
    ).rejects.toMatchObject({ errorCode: 'STAKE_INSUFFICIENT_BALANCE' });

    // After 2 game-days total, unbonding matures into withdrawable
    staking.advanceGameDays(1);
    const posReady = await staking.position({ accountId, pool });
    expect(posReady.unbonding).toBe('0');
    expect(posReady.withdrawable).toBe(nearToYocto(5));

    await staking.withdraw({ opId: 'withdraw:ok', accountId, pool });
    const balAfter = BigInt(await staking.nearBalanceOf(accountId));
    expect(balAfter >= BigInt(nearToYocto(5))).toBe(true);
  });

  it('rejects non-whitelisted pools and insufficient balance', async () => {
    const staking = new InMemoryStaking();
    const accountId = 'col-2.pilot.terraagent.mock';
    await expect(
      staking.stake({
        opId: 'stake:bad-pool',
        accountId,
        pool: 'rogue.pool.mock',
        amount: nearToYocto(1),
      }),
    ).rejects.toMatchObject({ errorCode: 'POOL_NOT_WHITELISTED' });

    await expect(
      staking.stake({
        opId: 'stake:no-funds',
        accountId,
        pool: 'astro-stakers.pool.mock',
        amount: nearToYocto(5),
      }),
    ).rejects.toMatchObject({ errorCode: 'STAKE_INSUFFICIENT_BALANCE' });
  });
});
