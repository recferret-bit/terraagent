import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { FlagsService } from '../../src/flags/flags.service';
import { nearToYocto } from '../../src/near/infrastructure/adapters/mock/staking.adapter';
import {
  STAKING_POSITION_READ_MODEL_ONLY,
  STAKING_SYNC_INTERVAL_MS,
  StakingPositionSyncService,
  yoctoToNear,
} from '../../src/near/staking/staking-position-sync.service';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking';

const makeEnv = (overrides: Partial<Record<string, unknown>> = {}): AppEnv =>
  ({ NODE_ENV: 'test', TA_WAVES: 'all', ...overrides }) as unknown as AppEnv;

describe('W20-20 StakingPositionSyncService — syncAccount & lifecycle', () => {
  it('marks the service as read-model-only with a 5-minute sync interval', () => {
    const staking = new InMemoryStaking();
    const env = makeEnv();
    const service = new StakingPositionSyncService(staking, env, undefined, new FlagsService(env));

    expect(STAKING_POSITION_READ_MODEL_ONLY).toBe(true);
    expect(service.readModelOnly).toBe(true);
    expect(STAKING_SYNC_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(yoctoToNear(nearToYocto(12.5))).toBe('12.5');
    expect(yoctoToNear('0')).toBe('0');
  });

  it('syncs position after stake, unstake, reward accrual, and cleans up after full withdraw', async () => {
    const staking = new InMemoryStaking();
    const env = makeEnv();
    const service = new StakingPositionSyncService(staking, env, undefined, new FlagsService(env));
    const accountId = 'col-0.pilot.terraagent.mock';
    const pool = 'astro-stakers.pool.mock';

    await staking.creditNear(accountId, nearToYocto(20));
    await staking.stake({
      opId: 'sync-unit:stake:1',
      accountId,
      pool,
      amount: nearToYocto(10),
    });

    const afterStake = await service.syncAccount(accountId);
    expect(afterStake).not.toBeNull();
    expect(afterStake).toMatchObject({
      colonyId: 'col-0',
      accountId,
      pool,
      poolName: 'Astro Stakers',
      apyBp: 900,
      staked: '10',
      unbonding: '0',
      unbondingReadyAtMs: null,
      withdrawable: '0',
      rewards: '0',
    });

    staking.advanceGameDays(30);
    await staking.unstake({
      opId: 'sync-unit:unstake:1',
      accountId,
      pool,
      amount: nearToYocto(10),
    });

    const afterUnstake = await service.syncAccount(accountId);
    expect(afterUnstake).not.toBeNull();
    expect(afterUnstake?.staked).toBe('0');
    expect(afterUnstake?.unbonding).toBe('10');
    expect(afterUnstake?.unbondingReadyAtMs).not.toBeNull();
    expect(Number(afterUnstake?.rewards)).toBeCloseTo(0.0592, 3);

    staking.advanceGameDays(2);
    await staking.withdraw({
      opId: 'sync-unit:withdraw:1',
      accountId,
      pool,
    });

    const afterWithdraw = await service.syncAccount(accountId);
    expect(afterWithdraw).toBeNull();
    expect(await service.getReadModelPositions(accountId)).toEqual([]);
  });
});

describe('W20-20 StakingPositionSyncService — syncAll recovery, wave gating & timer', () => {
  it('acceptance: stakes directly via StakingPort, wipes read model, and restores via syncAll()', async () => {
    const staking = new InMemoryStaking();
    const env = makeEnv();
    const service = new StakingPositionSyncService(staking, env, undefined, new FlagsService(env));
    const accountId = 'col-direct.pilot.terraagent.mock';
    const pool = 'chorus-one.pool.mock';

    await staking.creditNear(accountId, nearToYocto(15));
    await staking.stake({
      opId: 'sync-unit:direct:1',
      accountId,
      pool,
      amount: nearToYocto(7.5),
    });

    expect(await service.getReadModelPositions(accountId)).toEqual([]);

    const synced = await service.syncAll();
    expect(synced).toHaveLength(1);
    expect(synced[0]).toMatchObject({
      colonyId: 'col-direct',
      accountId,
      pool,
      staked: '7.5',
    });

    service.clearCache();
    expect(await service.getReadModelPositions(accountId)).toEqual([]);

    const restored = await service.syncAll();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.staked).toBe('7.5');
    expect(await service.getReadModelPositions('col-direct')).toHaveLength(1);
  });

  it('is a no-op when wave flag W20 is disabled and manages periodic timer lifecycle', async () => {
    const staking = new InMemoryStaking();
    const disabledEnv = makeEnv({ TA_WAVES: '..19' });
    const disabledService = new StakingPositionSyncService(
      staking,
      disabledEnv,
      undefined,
      new FlagsService(disabledEnv),
    );
    const accountId = 'col-flag.pilot.terraagent.mock';
    const pool = 'astro-stakers.pool.mock';

    await staking.creditNear(accountId, nearToYocto(5));
    await staking.stake({ opId: 'sync-unit:flag:1', accountId, pool, amount: nearToYocto(5) });

    expect(await disabledService.syncAccount(accountId)).toBeNull();
    expect(await disabledService.syncAll([accountId])).toEqual([]);
    expect(await disabledService.getReadModelPositions(accountId)).toEqual([]);

    vi.useFakeTimers();
    try {
      const devEnv = makeEnv({ NODE_ENV: 'development', TA_WAVES: 'all' });
      const devService = new StakingPositionSyncService(
        staking,
        devEnv,
        undefined,
        new FlagsService(devEnv),
      );
      const spy = vi.spyOn(devService, 'syncAll').mockResolvedValue([]);
      devService.onModuleInit();

      vi.advanceTimersByTime(STAKING_SYNC_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);

      devService.onModuleDestroy();
      vi.advanceTimersByTime(STAKING_SYNC_INTERVAL_MS * 2);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
