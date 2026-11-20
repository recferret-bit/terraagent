import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { FlagsService } from '../../src/flags/flags.service';
import { StakingPositionSyncService } from '../../src/near/staking/staking-position-sync.service';
import { nearToYocto } from '../../src/near/staking/yocto';
import { InMemoryStaking } from '../../src/near/testing/in-memory-staking';

const POOL = 'astro-stakers.pool.mock';
const env = { NODE_ENV: 'test', TA_WAVES: 'all', DATABASE_URL: 'postgres://fake' } as unknown as AppEnv;

/** A recording `chain.staking_position` double. */
function fakePrisma() {
  const upserts: Array<{ where: { colonyId_poolId: { colonyId: string; poolId: string } }; create: Record<string, unknown> }> = [];
  const prisma = {
    stakingPosition: {
      upsert: async (a: never) => void upserts.push(a),
      deleteMany: async () => ({ count: 0 }),
      findFirst: async () => null,
    },
    deed: { findFirst: async () => null },
    nearColonyAccount: { findUnique: async () => null },
  };
  return { prisma, upserts };
}

async function setup() {
  const staking = new InMemoryStaking();
  const { prisma, upserts } = fakePrisma();
  const sync = new StakingPositionSyncService(staking, env, prisma as never, new FlagsService(env));
  const stake = async (accountId: string, near: number) => {
    await staking.creditNear(accountId, nearToYocto(near));
    await staking.stake({ opId: `s:${accountId}`, accountId, pool: POOL, amount: nearToYocto(near) });
  };
  return { staking, sync, upserts, stake };
}

describe('W28-04 read model for wallets with no colony', () => {
  it('keys a wallet row by its full account id, omits colonyId and mirrors the stake clocks', async () => {
    const { sync, upserts, stake } = await setup();
    await stake('alice.near', 10);
    const dto = await sync.syncAccount('alice.near', { pool: POOL, wallet: true });
    expect(dto?.colonyId).toBeUndefined();
    expect(dto).toMatchObject({ accountId: 'alice.near', staked: '10', stakedSinceMs: expect.any(Number), lastStakedAtMs: expect.any(Number) });
    expect(upserts[0]!.where.colonyId_poolId.colonyId).toBe('alice.near');
    expect(upserts[0]!.create.stakedSinceAt).toBeInstanceOf(Date);
    expect(upserts[0]!.create.lastStakedAt).toBeInstanceOf(Date);
  });

  it('two wallets sharing a first label do not collide (the W20 derived id would map both to "alice")', async () => {
    const { sync, upserts, stake } = await setup();
    await stake('alice.near', 10);
    await stake('alice.other', 20);
    await sync.syncAccount('alice.near', { pool: POOL, wallet: true });
    await sync.syncAccount('alice.other', { pool: POOL, wallet: true });
    expect(upserts.map((u) => u.where.colonyId_poolId.colonyId)).toEqual(['alice.near', 'alice.other']);
  });

  it('a later non-wallet sync of the same account keeps the wallet key (no duplicate row, no double counting)', async () => {
    const { sync, upserts, stake } = await setup();
    await stake('bob.near', 10);
    await sync.syncAccount('bob.near', { pool: POOL, wallet: true });
    await sync.syncAccountPositions('bob.near');
    expect(new Set(upserts.map((u) => u.where.colonyId_poolId.colonyId))).toEqual(new Set(['bob.near']));
  });

  it('without the wallet option the W20 derived colony id still applies (unchanged for colony accounts)', async () => {
    const { sync, stake } = await setup();
    await stake('col-9.pilot.terraagent.mock', 10);
    const dto = await sync.syncAccount('col-9.pilot.terraagent.mock', { pool: POOL });
    expect(dto?.colonyId).toBe('col-9');
  });

  it('an emptied position clears its clocks in the read model (null, not stale)', async () => {
    const { staking, sync, stake } = await setup();
    await stake('cat.near', 10);
    await staking.unstake({ opId: 'u', accountId: 'cat.near', pool: POOL, amount: nearToYocto(10) });
    const dto = await sync.syncAccount('cat.near', { pool: POOL, wallet: true });
    expect(dto?.staked).toBe('0');
    expect(dto?.stakedSinceMs ?? null).toBeNull();
    expect(dto?.lastStakedAtMs ?? null).toBeNull();
  });
});
