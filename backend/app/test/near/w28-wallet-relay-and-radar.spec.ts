import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service';
import { GuildRadarController } from '../../src/market/guild/visit/guild-radar.controller';
import {
  enforceWalletRelayQuota,
  resetWalletRelayQuotasForTests,
} from '../../src/near/identity/wallet-relay-quota';

describe('W28 wallet-shared NEP-366 gasless relayer quota (unit)', () => {
  beforeEach(() => resetWalletRelayQuotasForTests());

  const makeMockDb = (stakedNear: number, walletKey = 'whale.near') => {
    const stakedYocto = (BigInt(stakedNear) * 10n ** 24n).toString();
    return {
      nearColonyAccount: {
        findMany: vi.fn(async () => [
          { colonyId: 'col_0', accountId: 'c0.pilots.mock', ownerAccountId: walletKey, claimedByAccountId: null, playerId: 'p_1' },
          { colonyId: 'col_1', accountId: 'c1.pilots.mock', ownerAccountId: walletKey, claimedByAccountId: null, playerId: 'p_1' },
        ]),
      },
      stakingPosition: {
        findMany: vi.fn(async () =>
          stakedNear > 0
            ? [{ accountId: walletKey, stakedSnapshot: { toFixed: () => stakedYocto }, unbondingSnapshot: null, stakedSinceAt: new Date(1_000), lastStakedAt: new Date(1_000), updatedAt: new Date(1_000) }]
            : [],
        ),
      },
      mockChainStaking: { findMany: vi.fn(async () => []) },
      socialIdentity: { findFirst: vi.fn(async () => ({ accountId: walletKey, playerId: 'p_1' })), findMany: vi.fn(async () => [{ accountId: walletKey }]) },
      colony: { findMany: vi.fn(async () => [{ id: 'col_0' }, { id: 'col_1' }]), findFirst: vi.fn(async () => ({ playerId: 'p_1' })) },
    } as never;
  };

  it('scales daily wallet relay cap 1x -> 2x -> 4x -> 8x -> 15x across Tiers 0..4 (positive)', async () => {
    const env = { NEAR_RELAYER_WALLET_DAILY_TX_BASE: '2', TA_WAVES: 'all' };
    const tiers: Array<[number, number, number]> = [
      [0, 1, 2],
      [10, 2, 4],
      [50, 4, 8],
      [200, 8, 16],
      [500, 15, 30],
    ];
    for (const [near, mult, expectedCap] of tiers) {
      resetWalletRelayQuotasForTests();
      const out = await enforceWalletRelayQuota({
        prisma: makeMockDb(near, `w${near}.near`),
        env,
        w28: true,
        playerId: `p_${near}`,
        signerId: `w${near}.near`,
      });
      expect([out.gasMultiplier, out.cap, out.used]).toEqual([mult, expectedCap, 1]);
    }
  });

  it('shares one daily quota across multiple colonies of the same wallet and rejects (cap + 1) with 429 (negative / Sybil)', async () => {
    const prisma = makeMockDb(10, 'sybil.near'); // Tier 1 = 2x * base 2 = 4 relays/day total across all colonies
    const env = { NEAR_RELAYER_WALLET_DAILY_TX_BASE: '2', TA_WAVES: 'all' };
    const day = new Date('2026-11-21T10:00:00Z');
    for (const signerId of ['c0.pilots.mock', 'c1.pilots.mock', 'c0.pilots.mock', 'c1.pilots.mock']) {
      const ok = await enforceWalletRelayQuota({ prisma, env, w28: true, playerId: 'p_1', signerId, now: day });
      expect(ok.walletKey).toBe('sybil.near');
    }
    await expect(
      enforceWalletRelayQuota({ prisma, env, w28: true, playerId: 'p_1', signerId: 'c1.pilots.mock', now: day }),
    ).rejects.toMatchObject({ status: 429, errorCode: 'RATE_LIMITED' });
  });

  it('resets at UTC midnight rollover and bypasses quota when W28 is off (corner)', async () => {
    const prisma = makeMockDb(0, 'cadet.near');
    const env = { NEAR_RELAYER_WALLET_DAILY_TX_BASE: '1', TA_WAVES: 'all' };
    await enforceWalletRelayQuota({ prisma, env, w28: true, playerId: 'p_1', signerId: 'cadet.near', now: new Date('2026-11-21T23:59:59Z') });
    await expect(
      enforceWalletRelayQuota({ prisma, env, w28: true, playerId: 'p_1', signerId: 'cadet.near', now: new Date('2026-11-21T23:59:59Z') }),
    ).rejects.toMatchObject({ status: 429 });
    const nextDay = await enforceWalletRelayQuota({ prisma, env, w28: true, playerId: 'p_1', signerId: 'cadet.near', now: new Date('2026-11-22T00:00:00Z') });
    expect(nextDay.used).toBe(1);

    const w28Off = await enforceWalletRelayQuota({ prisma, env, w28: false, playerId: 'p_1', signerId: 'cadet.near', now: new Date('2026-11-21T23:59:59Z') });
    expect(w28Off.used).toBe(0);
  });
});

describe('GuildRadarController scenario slot & accountId resolution (unit)', () => {
  it('resolves scenario (planetId, colonyIndex) to core.colony.id so Tier 2+ stakers get 5m early radar', async () => {
    const now = 1_700_000_000_000;
    const visits = {
      upcoming: vi.fn(() => ({
        nowMs: now,
        windows: [{ npcId: 'kestrel', name: 'GHS Kestrel', arriveAt: now + 120_000, departAt: now + 600_000 }],
      })),
    };
    const staked50 = (50n * 10n ** 24n).toString();
    const prisma = {
      colony: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'co_real' ? { id: 'co_real', playerId: 'p_1' } : null)),
        findFirst: vi.fn(async () => ({ id: 'co_real', playerId: 'p_1' })),
        findMany: vi.fn(async () => [{ id: 'co_real' }]),
      },
      nearColonyAccount: { findMany: vi.fn(async () => []) },
      socialIdentity: {
        findFirst: vi.fn(async () => ({ accountId: 'cmdr.near', playerId: 'p_1' })),
        findMany: vi.fn(async () => [{ accountId: 'cmdr.near' }]),
      },
      stakingPosition: {
        findMany: vi.fn(async () => [
          { accountId: 'cmdr.near', stakedSnapshot: { toFixed: () => staked50 }, unbondingSnapshot: null, stakedSinceAt: new Date(now - 90_000_000), lastStakedAt: new Date(now - 90_000_000), updatedAt: new Date(now) },
        ]),
      },
      mockChainStaking: { findMany: vi.fn(async () => []) },
    };
    const ctrl = new GuildRadarController(visits as never, new FlagsService({ TA_WAVES: 'all' } as never), prisma as never, { TA_WAVES: 'all' } as never);
    const out = await ctrl.radar('pl_1', 'col_0', '0');
    expect(out.leadMs).toBe(300_000);
    expect(out.visits[0]).toMatchObject({ name: 'GHS Kestrel', visibleNow: true, early: true });

    await expect(ctrl.radar('  ', 'col_0')).rejects.toMatchObject({ status: 400 });
  });
});
