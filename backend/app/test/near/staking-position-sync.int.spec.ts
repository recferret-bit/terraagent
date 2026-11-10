import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { FlagsService } from '../../src/flags/flags.service';
import {
  MockStakingAdapter,
  nearToYocto,
} from '../../src/near/infrastructure/adapters/mock/staking.adapter';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = (failRate = 0) => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate, seed: 29 });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

function makeSyncService(adapter: MockStakingAdapter): StakingPositionSyncService {
  const env = {
    NODE_ENV: 'test',
    DATABASE_URL: db.url,
    TA_WAVES: 'all',
  } as unknown as AppEnv;
  return new StakingPositionSyncService(adapter, env, db.prisma, new FlagsService(env));
}

describe('W20-20 StakingPositionSyncService on Postgres — direct stake & recovery', () => {
  it('acceptance: stakes via StakingPort directly (bypassing API) -> syncAll() populates chain.staking_position, and recovers after deleteMany({})', async () => {
    const nowMs = 1_700_000_000_000;
    const adapter = new MockStakingAdapter(db.prisma, cfg(), { sleep, now: () => nowMs });
    const syncService = makeSyncService(adapter);

    const accountId = 'col-sync-1.pilot.terraagent.mock';
    const pool = 'astro-stakers.pool.mock';
    const stakedYocto = nearToYocto(10);

    await adapter.creditNear(accountId, nearToYocto(20));
    await adapter.stake({
      opId: 'pg-sync:stake:1',
      accountId,
      pool,
      amount: stakedYocto,
    });

    adapter.advanceGameDays(30);

    const synced = await syncService.syncAll();
    const match = synced.find((p) => p.accountId === accountId && p.pool === pool);
    expect(match).toBeDefined();
    expect(match?.staked).toBe('10');
    expect(Number(match?.rewards)).toBeCloseTo(0.074, 3);

    const row = await db.prisma.stakingPosition.findUnique({
      where: { colonyId_poolId: { colonyId: 'col-sync-1', poolId: pool } },
    });
    expect(row).not.toBeNull();
    expect(row?.accountId).toBe(accountId);
    expect(row?.poolId).toBe(pool);
    expect(row?.stakedSnapshot.toFixed(0)).toBe(stakedYocto);
    expect(BigInt(row?.rewardsSnapshot.toFixed(0) ?? '0') > 0n).toBe(true);

    await db.prisma.stakingPosition.deleteMany({});
    expect(await db.prisma.stakingPosition.count()).toBe(0);
    expect(await syncService.getReadModelPositions(accountId)).toEqual([]);

    await syncService.syncAll();

    const restoredRow = await db.prisma.stakingPosition.findUnique({
      where: { colonyId_poolId: { colonyId: 'col-sync-1', poolId: pool } },
    });
    expect(restoredRow).not.toBeNull();
    expect(restoredRow?.stakedSnapshot.toFixed(0)).toBe(stakedYocto);

    const readModelDtos = await syncService.getReadModelPositions(accountId);
    expect(readModelDtos).toHaveLength(1);
    expect(readModelDtos[0]).toMatchObject({
      colonyId: 'col-sync-1',
      accountId,
      pool,
      staked: '10',
    });
  });
});

describe('W20-20 StakingPositionSyncService on Postgres — unbonding & withdrawal cleanup', () => {
  it('lifecycle: tracks unbonding in chain.staking_position and removes row once fully withdrawn', async () => {
    const nowMs = 1_700_100_000_000;
    const adapter = new MockStakingAdapter(db.prisma, cfg(), { sleep, now: () => nowMs });
    const syncService = makeSyncService(adapter);

    const accountId = 'col-sync-2.pilot.terraagent.mock';
    const pool = 'chorus-one.pool.mock';
    const amountYocto = nearToYocto(5);

    await db.prisma.deed.create({
      data: {
        colonyId: 'co_custom_deed_2',
        planetId: 'pl_dune_01',
        playerId: 'p_sync_2',
        accountId,
        tokenId: 'deed:co_custom_deed_2',
        metadata: {
          planet: 'pl_dune_01',
          colony: 'co_custom_deed_2',
          status: 'settled',
          settled: true,
          version: 1,
          imageUrl: '/v1/near/deed/deed:co_custom_deed_2/image.png',
        },
        settled: true,
        status: 'settled',
        chainState: 'FINAL',
      },
    });

    await adapter.creditNear(accountId, amountYocto);
    await adapter.stake({
      opId: 'pg-sync:stake:2',
      accountId,
      pool,
      amount: amountYocto,
    });
    await syncService.syncAccount(accountId);

    await adapter.unstake({
      opId: 'pg-sync:unstake:2',
      accountId,
      pool,
      amount: amountYocto,
    });
    const unbondingDto = await syncService.syncAccount(accountId);
    expect(unbondingDto).not.toBeNull();
    expect(unbondingDto?.colonyId).toBe('co_custom_deed_2');
    expect(unbondingDto?.staked).toBe('0');
    expect(unbondingDto?.unbonding).toBe('5');
    expect(unbondingDto?.unbondingReadyAtMs).not.toBeNull();

    const unbondingRow = await db.prisma.stakingPosition.findUnique({
      where: { colonyId_poolId: { colonyId: 'co_custom_deed_2', poolId: pool } },
    });
    expect(unbondingRow?.stakedSnapshot.toFixed(0)).toBe('0');
    expect(unbondingRow?.unbondingSnapshot.toFixed(0)).toBe(amountYocto);
    expect(unbondingRow?.unbondingReadyAt).not.toBeNull();

    adapter.advanceGameDays(2);
    await adapter.withdraw({
      opId: 'pg-sync:withdraw:2',
      accountId,
      pool,
    });

    const afterWithdraw = await syncService.syncAccount(accountId);
    expect(afterWithdraw).toBeNull();

    const remainingRows = await db.prisma.stakingPosition.findMany({
      where: { accountId },
    });
    expect(remainingRows).toEqual([]);
  });
});
