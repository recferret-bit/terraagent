import 'reflect-metadata';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/core/tokens';
import { FlagsService } from '../../src/flags/flags.service';
import { MockStakingAdapter, nearToYocto, yoctoToNear } from '../../src/near/infrastructure/adapters/mock/staking.adapter';
import {
  creditLocalMockFaucet,
  ensureLocalDevAliasWallet,
  ensureLocalMockStarterFunds,
} from '../../src/near/infrastructure/dev/local-mock-wallet-seed';
import { WalletControlGuard } from '../../src/near/staking/services/wallet-control.guard';
import { PatronNominateService } from '../../src/near/staking/services/patron-nominate.service';
import { ColonyHistoryStore } from '../../src/profile/colony-history.store';
import { MeAchievementsService } from '../../src/profile/me-achievements.service';
import { MeProfileService } from '../../src/profile/me-profile.service';
import { AchievementUnlockStore } from '../../src/progression/achievement-unlock.store';
import { FactsStore } from '../../src/progression/facts.store';
import { FamilyAvailabilityService } from '../../src/progression/family-availability';
import { XpStore } from '../../src/progression/xp.store';
import { devPlayerId } from '../../src/ws/session-verifier';

let db: TestDatabase;
const sleep = async () => undefined;
const cfg = () => ({ latencyMinMs: 0, latencyMaxMs: 0, failRate: 0, seed: 7 });

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.drop();
});

describe('local staking & /me dev alias — real Postgres persistence (NEAR_MODE=local)', () => {
  it('links dev:<slug> socialIdentity with valid id, authorizes WalletControlGuard, and runs 1-minute staking cycles', async () => {
    const localEnv = { NODE_ENV: 'development', DATABASE_URL: db.url, NEAR_MODE: 'local' } as unknown as AppEnv;
    const envBag = localEnv as unknown as Record<string, string | undefined>;
    const acct = 'localdev.terraagent.mock';
    const pool = 'astro-stakers.pool.mock';

    await ensureLocalDevAliasWallet(db.prisma, 'localdev', acct, envBag);
    const aliasId = devPlayerId('localdev');
    const social = await db.prisma.socialIdentity.findFirst({ where: { playerId: aliasId, accountId: acct } });
    expect(social?.id).toBe('si_dev_localdev');

    const guard = new WalletControlGuard(undefined, localEnv, db.prisma);
    expect(await guard.controls(aliasId, acct)).toBe(true);
    expect(await guard.controls(devPlayerId('stranger'), acct)).toBe(false);

    let nowMs = 1_700_000_000_000;
    const adapter = new MockStakingAdapter(db.prisma, cfg(), { sleep, now: () => nowMs }, localEnv);
    expect(yoctoToNear(await adapter.nearBalanceOf(acct), 6)).toBe('1000');

    await adapter.stake({ opId: 'loc-stk:1', accountId: acct, pool, amount: nearToYocto(50) });

    // Advance 61 seconds: 1-minute reward multiplier (10,080x) accrues ~1 week of net yield, early-exit expires
    nowMs += 61_000;
    const rew = await adapter.rewards({ accountId: acct, pool });
    expect(Number(yoctoToNear(rew.accrued, 6))).toBeGreaterThan(0.06);
    await adapter.compound({ opId: 'loc-cmp:1', accountId: acct, pool });

    await adapter.unstake({ opId: 'loc-uns:1', accountId: acct, pool, amount: nearToYocto(20) });
    const unbondPos = await adapter.position({ accountId: acct, pool });
    expect(yoctoToNear(unbondPos.unbonding, 6)).toBe('20');
    await expect(adapter.withdraw({ opId: 'loc-wd-early', accountId: acct, pool })).rejects.toThrow();

    // Advance 61 seconds: 1-minute unbonding matures into withdrawable
    nowMs += 61_000;
    await adapter.withdraw({ opId: 'loc-wd:1', accountId: acct, pool });
    expect(Number(yoctoToNear(await adapter.nearBalanceOf(acct), 6))).toBeGreaterThan(970);

    // Profit staking & faucet against real Postgres
    await adapter.stakeProfits({
      opId: 'loc-prof:1',
      accountId: acct,
      pool,
      usdcAtomic: '40000000',
      nearYocto: nearToYocto(10),
      asset: 'stNEAR',
    });
    const faucet = await creditLocalMockFaucet(db.prisma, acct, envBag);
    expect(faucet).toMatchObject({ ok: true, addedNear: '500', defaultPlanetId: 'pl_local_prime' });
  });

  it('unlocks MeProfileService stakerAutopilotActive & TEE verify for linked and pr_dev_w12 wallets on Postgres', async () => {
    const localEnv = { NODE_ENV: 'development', DATABASE_URL: db.url, NEAR_MODE: 'local' } as unknown as AppEnv;
    const envBag = localEnv as unknown as Record<string, string | undefined>;
    const w12Acct = 'w12.terraagent.mock';
    await ensureLocalMockStarterFunds(db.prisma, w12Acct, envBag, { id: 'pl_w12_forest', name: 'Sylva Reach' });

    const adapter = new MockStakingAdapter(db.prisma, cfg(), { sleep, now: () => 1_700_000_000_000 }, localEnv);
    await adapter.stake({ opId: 'w12-stk:1', accountId: w12Acct, pool: 'astro-stakers.pool.mock', amount: nearToYocto(25) });

    // Seeded extra planet (`pl_w12_forest`) is open and nominatable on Postgres
    const nominate = new PatronNominateService(() => db.prisma, () => 1_700_000_000_000);
    const nomRes = await nominate.nominate(w12Acct, 'pl_w12_forest');
    expect(nomRes).toMatchObject({ accountId: w12Acct, planetId: 'pl_w12_forest' });

    const facts = new FactsStore(db.prisma);
    const xp = new XpStore(db.prisma);
    const flags = new FlagsService({ TA_WAVES: '..28' } as unknown as AppEnv);
    const ach = new MeAchievementsService(facts, new AchievementUnlockStore(db.prisma), new FamilyAvailabilityService(flags), flags);
    const colonies = new ColonyHistoryStore(db.prisma);
    const mockLlm = {
      complete: async () => ({ text: '{"ok":true}', model: 'z-ai/glm-5.3-flash', usage: { inputTokens: 4, outputTokens: 4 } }),
    };
    const me = new MeProfileService(facts, xp, ach, colonies, flags, undefined, undefined, db.prisma, undefined, mockLlm as never, localEnv);

    const w12Ai = await me.getAiSettings('pr_dev_w12');
    expect(w12Ai.stakerAutopilotActive).toBe(true);
    expect(Number(w12Ai.stakedNear)).toBe(25);

    const probe = await me.verifyAiEnclave('pr_dev_w12');
    expect(probe).toMatchObject({ ok: true, managedStaker: true, usedPlayerKey: false });
  });
});

describe('pilot handle rename — real Postgres persistence & uniqueness', () => {
  it('persists renamed handle on core.player and rejects duplicate handles with 409 handle_taken', async () => {
    const localEnv = { NODE_ENV: 'development', DATABASE_URL: db.url, NEAR_MODE: 'local' } as unknown as AppEnv;
    const facts = new FactsStore(db.prisma);
    const xp = new XpStore(db.prisma);
    const flags = new FlagsService({ TA_WAVES: '..28' } as unknown as AppEnv);
    const ach = new MeAchievementsService(facts, new AchievementUnlockStore(db.prisma), new FamilyAvailabilityService(flags), flags);
    const colonies = new ColonyHistoryStore(db.prisma);
    const me = new MeProfileService(
      facts,
      xp,
      ach,
      colonies,
      flags,
      undefined,
      { enabled: true, catchUp: async () => undefined } as never,
      db.prisma,
      undefined,
      undefined,
      localEnv,
    );

    const renamed = await me.updateHandle(
      { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Old Name', isGuest: false },
      { handle: 'Captain Helios' },
    );
    expect(renamed).toEqual({ handle: 'Captain Helios' });
    const prof = await me.getForPlayer({ id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Old Name', isGuest: false });
    expect(prof.identity.handle).toBe('Captain Helios');

    await expect(
      me.updateHandle({ id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FBW', handle: 'Other', isGuest: false }, { handle: 'Captain Helios' }),
    ).rejects.toMatchObject({ errorCode: 'handle_taken', status: 409 });

    // pr_dev_w12 can rename to a custom handle and back to 'w12' even after ensureLocalDevAliasWallet seeded devPlayerId('w12')
    await ensureLocalDevAliasWallet(db.prisma, 'w12', 'w12.terraagent.mock', localEnv as unknown as Record<string, string | undefined>);
    await expect(
      me.updateHandle({ id: 'pr_dev_w12', handle: 'w12', isGuest: false }, { handle: 'Admiral Vega' }),
    ).resolves.toEqual({ handle: 'Admiral Vega' });
    await expect(
      me.updateHandle({ id: 'pr_dev_w12', handle: 'w12', isGuest: false }, { handle: 'w12' }),
    ).resolves.toEqual({ handle: 'w12' });

    // Fresh MeProfileService without ProgressionEngine reads updated DB handle directly via databaseEnabled(env)
    await db.prisma.player.update({ where: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV' }, data: { handle: 'ReLinked Helios' } });
    const meNoEngine = new MeProfileService(facts, xp, ach, colonies, flags, undefined, undefined, db.prisma, undefined, undefined, localEnv);
    const refreshedProf = await meNoEngine.getForPlayer({ id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Old Name', isGuest: false });
    expect(refreshedProf.identity.handle).toBe('ReLinked Helios');
  });
});
