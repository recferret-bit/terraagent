import 'reflect-metadata';
import { CANONICAL_PLANETS } from '@terra/contracts';
import { createTestDatabase, type TestDatabase } from '@terra/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveWalletPerks } from '../../src/near/staking/perks/perks.resolver';
import { PatronSeatService } from '../../src/near/staking/perks/patron-seat.service';
import { readPlanetaryPatronage } from '../../src/near/staking/perks/patron-competition.reader';
import { resolveWallet } from '../../src/near/staking/perks/stake-clock.reader';
import { resolveDbStakerPerks, resolvePlanetStakedColonies } from '../../src/near/staking/staker-perks';
import { nearToYocto } from '../../src/near/staking/yocto';
import type { AppEnv } from '../../src/core/tokens';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const POOL = 'astro-stakers.pool.mock';
let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db?.drop();
});
beforeEach(async () => {
  const p = db.prisma;
  await p.stakingPatronHistory.deleteMany({});
  await p.stakingPatronPayout.deleteMany({});
  await p.stakingPatronSeat.deleteMany({});
  await p.stakingPatronNomination.deleteMany({});
  await p.stakingPosition.deleteMany({});
  await p.mockChainStaking.deleteMany({});
  await p.nearColonyAccount.deleteMany({});
  await p.aiWalletUsage.deleteMany({});
  await p.aiFreeTrial.deleteMany({});
});

async function link(colonyId: string, accountId: string, owner: string, claimedBy: string | null, playerId = 'player-1') {
  await db.prisma.nearColonyAccount.create({
    data: {
      accountId,
      playerId,
      slot: `slot-${colonyId}`,
      colonyId,
      ownerAccountId: owner,
      publicKey: 'ed25519:test',
      encryptedSecret: 'x',
      kekVersion: 1,
      claimedByAccountId: claimedBy,
      claimedAt: claimedBy ? new Date(NOW) : null,
    },
  });
}

async function position(colonyId: string, accountId: string, near: number, sinceMs: number | null, extra: { unbonding?: number; lastMs?: number } = {}) {
  await db.prisma.stakingPosition.create({
    data: {
      colonyId,
      poolId: POOL,
      accountId,
      stakedSnapshot: nearToYocto(near),
      unbondingSnapshot: nearToYocto(extra.unbonding ?? 0),
      stakedSinceAt: sinceMs === null ? null : new Date(sinceMs),
      lastStakedAt: new Date(extra.lastMs ?? sinceMs ?? NOW),
    },
  });
}

describe('W28-03 DB-backed perks resolver', () => {
  it('all colonies of one wallet share one perks object (never per-colony quotas)', async () => {
    const owner = 'alex.pilots.terraagent.mock';
    await link('col_a', 'col-a.alex.pilots.terraagent.mock', owner, 'alex.near');
    await link('col_b', 'col-b.alex.pilots.terraagent.mock', owner, 'alex.near');
    await link('col_c', 'col-c.alex.pilots.terraagent.mock', owner, 'alex.near');
    await position('col_a', 'col-a.alex.pilots.terraagent.mock', 60, NOW - 3 * DAY);
    await position('col_b', 'col-b.alex.pilots.terraagent.mock', 150, NOW - 2 * DAY);

    const opts = { w28: true, nowMs: NOW, full: true } as const;
    const [a, b, c, w] = await Promise.all([
      resolveDbStakerPerks(db.prisma, { colonyId: 'col_a', ...opts }),
      resolveDbStakerPerks(db.prisma, { colonyId: 'col_b', ...opts }),
      resolveDbStakerPerks(db.prisma, { colonyId: 'col_c', ...opts }),
      resolveDbStakerPerks(db.prisma, { accountId: 'alex.near', ...opts }),
    ]);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(w).toEqual(a);
    expect(a.activeStakedNear).toBe('210');
    expect(a.tier).toBe(3);
    expect(a.maxAiColonySlots).toBe(6);
    expect(a.platformFeeBp).toBe(35);
    expect(a.stakedSinceMs).toBe(NOW - 3 * DAY); // earliest continuous stake of the wallet
    expect(a.gasMultiplier).toBe(8);
  });

  it('a fresh deposit does not reset the warmup of an older position (earliest stakedSince wins), a brand-new stake pays 65 bp', async () => {
    await link('col_a', 'a.mock', 'a.mock', null);
    await position('col_a', 'a.mock', 60, NOW - 2 * DAY);
    await db.prisma.stakingPosition.create({
      data: { colonyId: 'col_a2', poolId: 'kiln.pool.mock', accountId: 'a.mock', stakedSnapshot: nearToYocto(1), stakedSinceAt: new Date(NOW - 10_000), lastStakedAt: new Date(NOW - 10_000) },
    });
    const old = await resolveDbStakerPerks(db.prisma, { accountId: 'a.mock', w28: true, nowMs: NOW });
    expect(old.tier).toBe(2);
    expect(old.platformFeeBp).toBe(50);
    expect(old.earlyExitFeeBp).toBe(25); // last deposit 10 s ago

    await link('col_s', 's.mock', 's.mock', null);
    await position('col_s', 's.mock', 600, NOW - 10_000);
    const snipe = await resolveDbStakerPerks(db.prisma, { accountId: 's.mock', w28: true, nowMs: NOW });
    expect(snipe.tier).toBe(4);
    expect(snipe.platformFeeBp).toBe(65);
    expect(snipe.feeTier).toBe(1);
  });

  it('unbonding principal never counts: 500 staked then 491 moved to unbonding is Tier 0 on the next read', async () => {
    await link('col_a', 'a.mock', 'a.mock', null);
    await position('col_a', 'a.mock', 500, NOW - 3 * DAY);
    expect((await resolveDbStakerPerks(db.prisma, { accountId: 'a.mock', w28: true, nowMs: NOW })).tier).toBe(4);
    await db.prisma.stakingPosition.update({
      where: { colonyId_poolId: { colonyId: 'col_a', poolId: POOL } },
      data: { stakedSnapshot: nearToYocto(9), unbondingSnapshot: nearToYocto(491) },
    });
    const after = await resolveDbStakerPerks(db.prisma, { accountId: 'a.mock', w28: true, nowMs: NOW });
    expect(after.tier).toBe(0);
    expect(after.unbondingNear).toBe('491');
    expect(after.platformFeeBp).toBe(100);
    expect(after.managedAutopilotUnlocked).toBe(false);
  });

});

describe('W28-03 DB-backed perks resolver: fallbacks, wave fence and usage', () => {
  it('falls back to chain.mock_chain_staking per account when no read-model row exists', async () => {
    await link('col_m', 'm.mock', 'm.mock', null);
    await db.prisma.mockChainStaking.create({
      data: { accountId: 'm.mock', poolId: POOL, staked: nearToYocto(12), stakedSinceAt: new Date(NOW - DAY), lastStakedAt: new Date(NOW - DAY) },
    });
    const p = await resolveDbStakerPerks(db.prisma, { colonyId: 'col_m', w28: true, nowMs: NOW });
    expect(p.tier).toBe(1);
    expect(p.stakedSinceMs).toBe(NOW - DAY);
    expect(p.platformFeeBp).toBe(65);
  });

  it('unknown colony / account resolves to Tier 0 with the standard fee; no query resolves to zero stake', async () => {
    const none = await resolveDbStakerPerks(db.prisma, { colonyId: 'nope', w28: true, nowMs: NOW, standardPlatformFeeBp: 100 });
    expect([none.tier, none.platformFeeBp, none.active]).toEqual([0, 100, false]);
    expect((await resolveDbStakerPerks(db.prisma, { w28: true, nowMs: NOW })).tier).toBe(0);
    expect((await resolveDbStakerPerks(null, { colonyId: 'x', w28: true })).tier).toBe(0);
  });

  it('W28 off (TA_WAVES=..27) returns exactly the W20 numbers on the same rows', async () => {
    await link('col_a', 'a.mock', 'a.mock', null);
    await position('col_a', 'a.mock', 600, NOW - 5 * DAY);
    const off = await resolveDbStakerPerks(db.prisma, { accountId: 'a.mock', env: { TA_WAVES: '..27' }, nowMs: NOW, full: true });
    expect(off.platformFeeBp).toBe(50);
    expect(off.tier).toBe(1);
    expect(off.leadPatronPlanetIds).toEqual([]);
    const tuned = await resolveDbStakerPerks(db.prisma, {
      accountId: 'a.mock',
      env: { TA_WAVES: '..27', NEAR_STAKER_PLATFORM_FEE_BP: '40', NEAR_STAKER_MIN_NEAR: '700' },
      nowMs: NOW,
    });
    expect([tuned.active, tuned.platformFeeBp]).toEqual([false, 100]);
    const on = await resolveDbStakerPerks(db.prisma, { accountId: 'a.mock', env: { TA_WAVES: 'all' }, nowMs: NOW });
    expect([on.tier, on.platformFeeBp]).toEqual([4, 25]);
  });

  it('full mode reads trial and daily usage tables; default mode skips them', async () => {
    await link('col_a', 'a.mock', 'a.mock', null, 'player-9');
    await position('col_a', 'a.mock', 10, NOW - DAY);
    await db.prisma.socialIdentity.deleteMany({});
    await db.prisma.socialIdentity.create({ data: { id: 'si-1', playerId: 'player-9', provider: 'google', subject: 'sub-9', accountId: 'a.mock' } });
    await db.prisma.aiFreeTrial.create({ data: { playerId: 'player-9', turnsUsed: 2 } });
    await db.prisma.aiWalletUsage.create({ data: { walletKey: 'a.mock', day: '2026-11-20', callsUsed: 4, usdMicros: 150_000n } });
    const full = await resolveWalletPerks(db.prisma, { accountId: 'a.mock', w28: true, nowMs: NOW, full: true });
    expect(full.perks.dailyAiCallsUsed).toBe(4);
    expect(full.usage).toMatchObject({ trialEligible: true, freeTrialTurnsRemaining: 3 });
    await db.prisma.socialIdentity.delete({ where: { id: 'si-1' } }); // a guest has no trial
    const guest = await resolveWalletPerks(db.prisma, { accountId: 'a.mock', w28: true, nowMs: NOW, full: true });
    expect(guest.usage).toMatchObject({ trialEligible: false, freeTrialTurnsRemaining: 0 });
    await db.prisma.socialIdentity.create({ data: { id: 'si-2', playerId: 'player-9', provider: 'google', subject: 'sub-9', accountId: 'a.mock' } });
    expect(full.usage.dailyUsdUsed).toBeCloseTo(0.15);
    const light = await resolveWalletPerks(db.prisma, { accountId: 'a.mock', w28: true, nowMs: NOW });
    expect(light.perks.dailyAiCallsUsed).toBe(0);
    expect(light.perks.dailyAiBudgetUsd).toBe(0);
    const swapped = await resolveWalletPerks(db.prisma, {
      accountId: 'a.mock', w28: true, nowMs: NOW, full: true,
      deps: { priceProvider: { nearUsd: () => 0.5 }, tradeFeeProvider: { dailyProtocolTradeFeeUsd: () => 0 } },
    });
    expect(swapped.perks.dailyAiBudgetUsd).toBeCloseTo(full.perks.dailyAiBudgetUsd / 8, 10);
  });

  it('resolvePlanetStakedColonies flags colonies of a staking wallet (W28 threshold 10 NEAR, W28 off honours env)', async () => {
    await link('col_a', 'a.mock', 'a.mock', null);
    await link('col_b', 'b.mock', 'b.mock', null);
    await position('col_a', 'a.mock', 10, NOW - DAY);
    await position('col_b', 'b.mock', 9, NOW - DAY);
    const env = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'test', DATABASE_URL: db.url, ...extra }) as unknown as AppEnv;
    const cols = [{ index: 0, id: 'col_a' }, { index: 1, id: 'col_b' }];
    expect(await resolvePlanetStakedColonies(db.prisma, env(), cols)).toEqual({ 0: true });
    expect(await resolvePlanetStakedColonies(db.prisma, env({ TA_WAVES: '..27', NEAR_STAKER_MIN_NEAR: '9' }), cols)).toEqual({ 0: true, 1: true });
  });
});

describe('W28-03 PatronSeatService (King-of-the-Hill on Postgres)', () => {
  const seats = () => new PatronSeatService(db.prisma);
  const planetX = CANONICAL_PLANETS.desert.id;
  const planetY = CANONICAL_PLANETS.ocean.id;

  async function whale(name: string, near: number, sinceMs: number, planetId: string | null = planetX) {
    await link(`col_${name}`, `${name}.near`, `${name}.near`, null, `player-${name}`);
    await position(`col_${name}`, `${name}.near`, near, sinceMs);
    if (planetId) await seats().nominate(`${name}.near`, planetId);
  }

  it('upserts the seat for the highest >= 500 staker; below 500 nobody holds it', async () => {
    await whale('low', 499, NOW - 5 * DAY);
    expect(await seats().refreshPlanet(planetX, NOW)).toBeNull();
    expect(await db.prisma.stakingPatronSeat.count()).toBe(0);
    await whale('a', 500, NOW - 4 * DAY);
    const seat = await seats().refreshPlanet(planetX, NOW);
    expect(seat?.accountId).toBe('a.near');
    const row = await db.prisma.stakingPatronSeat.findUnique({ where: { planetId: planetX } });
    expect(row?.accountId).toBe('a.near');
    expect(row?.activeStaked.toFixed(0)).toBe(nearToYocto(500));
  });

  it('550 overtakes 500; a tie later keeps the incumbent; sinceAt only moves on a transfer', async () => {
    await whale('a', 500, NOW - 4 * DAY);
    await seats().refreshPlanet(planetX, NOW - 2 * DAY);
    await whale('b', 550, NOW - DAY);
    const moved = await seats().refreshPlanet(planetX, NOW - DAY);
    expect(moved?.accountId).toBe('b.near');
    expect(moved?.sinceMs).toBe(NOW - DAY);
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'col_a', poolId: POOL } }, data: { stakedSnapshot: nearToYocto(550) } });
    const tie = await seats().refreshPlanet(planetX, NOW);
    expect(tie?.accountId).toBe('b.near');
    expect(tie?.sinceMs).toBe(NOW - DAY);
    expect(await db.prisma.stakingPatronSeat.count()).toBe(1);
  });

  it('the patron unstaking to 499 or below the runner-up transfers the seat immediately via the perks read', async () => {
    await whale('a', 600, NOW - 4 * DAY);
    await whale('b', 520, NOW - 4 * DAY);
    const first = await resolveDbStakerPerks(db.prisma, { accountId: 'a.near', w28: true, nowMs: NOW, full: true });
    expect(first.leadPatronPlanetIds).toEqual([planetX]);
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'col_a', poolId: POOL } }, data: { stakedSnapshot: nearToYocto(510), unbondingSnapshot: nearToYocto(90) } });
    const lost = await resolveDbStakerPerks(db.prisma, { accountId: 'a.near', w28: true, nowMs: NOW, full: true });
    expect(lost.leadPatronPlanetIds).toEqual([]);
    expect(lost.tier).toBe(4);
    const heir = await resolveDbStakerPerks(db.prisma, { accountId: 'b.near', w28: true, nowMs: NOW, full: true });
    expect(heir.leadPatronPlanetIds).toEqual([planetX]);
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'col_b', poolId: POOL } }, data: { stakedSnapshot: nearToYocto(499) } });
    expect(await seats().refreshPlanet(planetX, NOW)?.then((s) => s?.accountId)).toBe('a.near');
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'col_a', poolId: POOL } }, data: { stakedSnapshot: nearToYocto(499) } });
    expect(await seats().refreshPlanet(planetX, NOW)).toBeNull();
    expect(await db.prisma.stakingPatronSeat.count()).toBe(0);
  });

  it('one wallet with several nominated accounts is a single candidate; seats on different planets are independent; W28 off exposes none', async () => {
    await whale('a', 700, NOW - 4 * DAY, planetX);
    await link('col_a2', 'a2.near', 'a.near', null, 'player-a');
    await seats().nominate('a2.near', planetX);
    await whale('c', 800, NOW - 3 * DAY, planetY);
    expect((await seats().refreshPlanet(planetX, NOW))?.accountId).toBe('a.near');
    expect((await seats().refreshPlanet(planetY, NOW))?.accountId).toBe('c.near');
    const off = await resolveDbStakerPerks(db.prisma, { accountId: 'a.near', env: { TA_WAVES: '..27' }, nowMs: NOW, full: true });
    expect(off.leadPatronPlanetIds).toEqual([]);
  });
});

describe('W28 Patron competition & history reader', () => {
  const seats = () => new PatronSeatService(db.prisma);
  const planetX = CANONICAL_PLANETS.desert.id;

  it('records nominated, seat_claimed, seat_overtaken, seat_vacated, and ranks contenders with gapToLeadNear', async () => {
    await link('col_a', 'a.near', 'a.near', null, 'player-a');
    await position('col_a', 'a.near', 520, NOW - 4 * DAY);
    await seats().nominate('a.near', planetX, NOW - 3 * DAY);
    await seats().refreshPlanet(planetX, NOW - 3 * DAY);

    await link('col_b', 'b.near', 'b.near', null, 'player-b');
    await position('col_b', 'b.near', 640, NOW - 2 * DAY);
    await seats().nominate('b.near', planetX, NOW - 2 * DAY);
    await seats().refreshPlanet(planetX, NOW - 2 * DAY);

    await link('col_c', 'c.near', 'c.near', null, 'player-c');
    await position('col_c', 'c.near', 300, NOW - DAY);
    await seats().nominate('c.near', planetX, NOW - DAY);

    await db.prisma.stakingPatronPayout.create({
      data: { id: 'pp-koth-1', planetId: planetX, accountId: 'b.near', amountUsdcAtomic: '4250000', createdAt: new Date(NOW - DAY) },
    });

    const viewerWallet = await resolveWallet(db.prisma, { accountId: 'a.near' });
    const view = await readPlanetaryPatronage(db.prisma, viewerWallet);
    expect(view.nominatedPlanetId).toBe(planetX);
    const desert = view.planets.find((p) => p.planetId === planetX)!;
    expect(desert.leadPatron?.accountId).toBe('b.near');
    expect(desert.stakeToLeadNear).toBe('640');
    expect(desert.contenders.map((c) => [c.rank, c.accountId, c.status, c.gapToLeadNear, c.isSelf])).toEqual([
      [1, 'b.near', 'lead', '0', false],
      [2, 'a.near', 'contender', '120', true],
      [3, 'c.near', 'below_threshold', '340', false],
    ]);
    expect(desert.history.map((h) => h.kind)).toContain('seat_claimed');
    expect(desert.history.map((h) => h.kind)).toContain('seat_overtaken');
    expect(desert.history.map((h) => h.kind)).toContain('nominated');
    const payout = desert.history.find((h) => h.kind === 'fee_payout');
    expect(payout?.payoutUsd).toBeCloseTo(4.25, 6);

    // Lowering b below 500 and a below 500 vacates the seat and records seat_vacated
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'col_a', poolId: POOL } }, data: { stakedSnapshot: nearToYocto(400) } });
    await db.prisma.stakingPosition.update({ where: { colonyId_poolId: { colonyId: 'col_b', poolId: POOL } }, data: { stakedSnapshot: nearToYocto(450) } });
    expect(await seats().refreshPlanet(planetX, NOW)).toBeNull();
    const afterVacate = (await readPlanetaryPatronage(db.prisma, viewerWallet)).planets.find((p) => p.planetId === planetX)!;
    expect(afterVacate.leadPatron).toBeNull();
    expect(afterVacate.stakeToLeadNear).toBe('500');
    expect(afterVacate.contenders[0]!.gapToLeadNear).toBe('50');
    expect(afterVacate.history[0]!.kind).toBe('seat_vacated');
  });
});

describe('Multi-colony staking_position deduplication on PostgreSQL', () => {
  it('counts the same (accountId, poolId) stake once even when synced under multiple colonyIds', async () => {
    await link('col_m1', 'col-m1.pilots.terraagent.mock', 'vega.near', 'vega.near', 'pr_vega_pg');
    await link('col_m2', 'col-m2.pilots.terraagent.mock', 'vega.near', 'vega.near', 'pr_vega_pg');
    await position('vega.near', 'vega.near', 50, NOW - 2 * DAY);
    await position('col_m1', 'vega.near', 50, NOW - 2 * DAY);
    await position('col_m2', 'vega.near', 50, NOW - 2 * DAY);

    const perks = await resolveDbStakerPerks(db.prisma, { playerId: 'pr_vega_pg', w28: true, nowMs: NOW });
    expect(perks.activeStakedNear).toBe('50');
    expect(perks.tier).toBe(2);
    expect(perks.maxAiColonySlots).toBe(3);
  });
});

describe('Quick-Win Hardening: Dust Pre-Stake Warmup & DB tradeFeeProvider', () => {
  it('cross-pool dust pre-stake (1 NEAR at NOW-10d + 500 NEAR at NOW-10s) does not unlock Tier 4 25 bp fee early', async () => {
    await link('col_sniper1', 'sniper.near', 'sniper.near', null, 'p_sniper');
    await position('col_sniper1', 'sniper.near', 1, NOW - 10 * DAY);
    await db.prisma.stakingPosition.create({
      data: { colonyId: 'col_sniper2', poolId: 'kiln.pool.mock', accountId: 'sniper.near', stakedSnapshot: nearToYocto(500), stakedSinceAt: new Date(NOW - 10_000), lastStakedAt: new Date(NOW - 10_000) },
    });
    const res = await resolveDbStakerPerks(db.prisma, { accountId: 'sniper.near', w28: true, nowMs: NOW });
    expect(res.tier).toBe(4);
    expect(res.stakedSinceMs).toBe(NOW - 10_000);
    expect(res.feeTier).toBe(1);
    expect(res.platformFeeBp).toBe(65);
  });

  it('resolveWalletPerks feeds genuine daily buyer trade fees minus DAO + Patron cuts into AI trade bonus and excludes self-fills', async () => {
    await link('col_tb', 'tb-buyer.near', 'tb-buyer.near', null, 'p_tb');
    await link('col_tb2', 'tb-alt.near', 'tb-buyer.near', null, 'p_tb');
    await position('col_tb', 'tb-buyer.near', 10, NOW - 2 * DAY);
    const basePerks = await resolveWalletPerks(db.prisma, { accountId: 'tb-buyer.near', w28: true, nowMs: NOW, full: true });
    await db.prisma.intentTrade.createMany({
      data: [
        {
          tradeId: 'tr_tb_real', planetId: CANONICAL_PLANETS.desert.id, pair: 'metals.t1/USDC', base: 'metals.t1', quote: 'USDC',
          makerOrderId: 'm1', takerOrderId: 'k1', makerSide: 'sell', buyerColonyId: 'col_tb', sellerColonyId: 'col_str', stallColonyId: 'col_st',
          buyerAccountId: 'tb-buyer.near', sellerAccountId: 'stranger.near', stallAccountId: 'stall.near', platformAccountId: 'protocol.mock',
          amount: '10', notional: '1000000000', platformFee: '1000000', stallFee: '0', treasuryAllocation: '200000',
          platformFeeBp: 65, stallFeeBp: 100, policyVersion: 'v1', policyHash: 'h', legs: [], batchHash: 'b', state: 'FINAL',
          createdAt: new Date(NOW - 1_000), settledAt: new Date(NOW - 1_000),
        },
        {
          tradeId: 'tr_tb_wash', planetId: CANONICAL_PLANETS.desert.id, pair: 'metals.t1/USDC', base: 'metals.t1', quote: 'USDC',
          makerOrderId: 'm2', takerOrderId: 'k2', makerSide: 'sell', buyerColonyId: 'col_tb', sellerColonyId: 'col_tb2', stallColonyId: 'col_st',
          buyerAccountId: 'tb-buyer.near', sellerAccountId: 'tb-alt.near', stallAccountId: 'stall.near', platformAccountId: 'protocol.mock',
          amount: '10', notional: '9000000000', platformFee: '9000000', stallFee: '0', treasuryAllocation: '0',
          platformFeeBp: 65, stallFeeBp: 100, policyVersion: 'v1', policyHash: 'h', legs: [], batchHash: 'b', state: 'FINAL',
          createdAt: new Date(NOW - 500), settledAt: new Date(NOW - 500),
        },
      ],
    });
    await db.prisma.stakingPatronPayout.create({
      data: { id: 'pp_tb_1', planetId: CANONICAL_PLANETS.desert.id, accountId: 'patron.near', sourceTradeId: 'tr_tb_real', amountUsdcAtomic: '120000', createdAt: new Date(NOW - 1_000) },
    });
    try {
      const withBonus = await resolveWalletPerks(db.prisma, { accountId: 'tb-buyer.near', w28: true, nowMs: NOW, full: true });
      expect(withBonus.perks.dailyAiBudgetUsd).toBeCloseTo(basePerks.perks.dailyAiBudgetUsd + 0.68 * 0.35, 6);
      expect(withBonus.perks.dailyAiCallLimit).toBeGreaterThan(basePerks.perks.dailyAiCallLimit);
    } finally {
      await db.prisma.stakingPatronPayout.deleteMany({ where: { id: 'pp_tb_1' } });
      await db.prisma.intentTrade.deleteMany({ where: { tradeId: { in: ['tr_tb_real', 'tr_tb_wash'] } } });
    }
  });
});
