import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StakingPort } from '../../src/near/application/ports/staking.port';
import {
  MockStakingAdapter,
  nearToYocto,
  yoctoToNear,
} from '../../src/near/infrastructure/adapters/mock/staking.adapter';
import { nearAdapters } from '../../src/near/infrastructure/near-infrastructure.module';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = (failRate = 0) => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate, seed: 11 });

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});

describe('W20-16 MockStakingAdapter on Postgres', () => {
  it('registers MockStakingAdapter in nearAdapters and accrues ~0.074 NEAR after 30 game-days on 10 NEAR staked', async () => {
    expect(
      nearAdapters.some((a) => a.port === StakingPort && a.kind === 'mock' && a.useClass === MockStakingAdapter),
    ).toBe(true);

    let nowMs = 1_700_000_000_000;
    const adapter = new MockStakingAdapter(db.prisma, cfg(), { sleep, now: () => nowMs });
    const accountId = 'col-pg.pilot.terraagent.mock';
    const pool = 'astro-stakers.pool.mock';

    await adapter.creditNear(accountId, nearToYocto(15));
    await adapter.stake({
      opId: 'pg-stake:1',
      accountId,
      pool,
      amount: nearToYocto(10),
    });

    adapter.advanceGameDays(30);
    const rew = await adapter.rewards({ accountId, pool });
    const nearRewards = Number(yoctoToNear(rew.accrued, 6));
    expect(nearRewards).toBeCloseTo(0.074, 3);

    await adapter.unstake({
      opId: 'pg-unstake:1',
      accountId,
      pool,
      amount: nearToYocto(5),
    });
    adapter.advanceGameDays(2);

    const posReady = await adapter.position({ accountId, pool });
    expect(posReady.withdrawable).toBe(nearToYocto(5));

    await adapter.withdraw({
      opId: 'pg-withdraw:1',
      accountId,
      pool,
    });
    const finalBal = BigInt(await adapter.nearBalanceOf(accountId));
    expect(finalBal > BigInt(nearToYocto(10))).toBe(true);
  });
});
