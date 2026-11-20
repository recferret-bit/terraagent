import { dailyAiBudgetUsd, dailyAiCallLimit, earlyExitFeeBp, effectiveTakerFee, STAKING_RULES, STAKING_TIERS, stakingTierFor } from '@terra/contracts';
import type { DbClient } from '@terra/db';
import { describe, expect, it } from 'vitest';
import { splitPlatformFee } from '../../src/near/infrastructure/network/protocol-fee.config';
import { readFillIncome } from '../../src/near/staking/performance/fill-income.reader';
import { effectiveApyBp } from '../../src/near/staking/performance/income-math';
import { EMPTY_AI_USAGE } from '../../src/near/staking/perks/ai-usage.reader';
import { resolvePerkLadder } from '../../src/near/staking/perks/legacy-ladder';
import { evaluatePerks, type PerksEvalInput } from '../../src/near/staking/perks/tier-engine';
import { nearToYocto } from '../../src/near/staking/yocto';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

/** Seeded generator (mulberry32): properties replay exactly, no extra dependency. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function perks(stakeNear: number | string, over: Partial<PerksEvalInput> = {}) {
  return evaluatePerks({
    ladder: resolvePerkLadder({ w28: true, env: {} }),
    activeStakedYocto: BigInt(nearToYocto(stakeNear)),
    unbondingYocto: 0n,
    stakedSinceMs: NOW,
    lastStakedAtMs: NOW,
    nowMs: NOW,
    protocolAccountId: 'protocol.terraagent.mock',
    nearUsd: 4,
    dailyProtocolTradeFeeUsd: 0,
    usage: EMPTY_AI_USAGE,
    leadPatronPlanetIds: [],
    ...over,
  });
}

describe('W28-15 flash-stake snipe (NEAR_STAKING_SPEC section 5.3)', () => {
  const NEAR_USD = 4;
  const SNIPER_USD = 50_000;
  const stakeNear = SNIPER_USD / NEAR_USD; // 12,500 NEAR: far past Tier 4
  const feeUsd = (volumeUsd: number, bp: number): number => (volumeUsd * bp) / 10_000;

  it('a sniper who stakes and trades inside 24h pays the 65 bp Scout fee, never the Tier 4 25 bp', () => {
    for (const ageMs of [0, 1, HOUR, 12 * HOUR, DAY - 1]) {
      const p = perks(stakeNear, { stakedSinceMs: NOW - ageMs, lastStakedAtMs: NOW - ageMs });
      expect(p.tier).toBe(4);
      expect(p.platformFeeBp).toBe(STAKING_TIERS[1]!.takerFeeBp);
      expect(p.feeTier).toBe(1);
    }
  });

  it('the 24h boundary is exact: 24h - 1 ms is 65 bp, 24h is the full 25 bp, and an unknown clock never unlocks it', () => {
    const at = (ageMs: number) => perks(stakeNear, { stakedSinceMs: NOW - ageMs, lastStakedAtMs: NOW - ageMs }).platformFeeBp;
    expect(at(DAY - 1)).toBe(65);
    expect(at(DAY)).toBe(25);
    expect(at(DAY + 1)).toBe(25);
    expect(perks(stakeNear, { stakedSinceMs: null }).platformFeeBp).toBe(65);
    const tier4 = STAKING_TIERS[4]!;
    expect(effectiveTakerFee({ tier: tier4, stakedSinceMs: NOW - DAY, nowMs: NOW }).warmupReadyAtMs).toBeNull();
    expect(effectiveTakerFee({ tier: tier4, stakedSinceMs: NOW - DAY + 1, nowMs: NOW }).warmupReadyAtMs).toBe(NOW + 1);
  });

  it('unstaking before 7 days costs 25 bp of the principal; the exit fee window is exact', () => {
    const lastStakedAt = NOW - 6 * DAY;
    expect(earlyExitFeeBp(lastStakedAt, NOW)).toBe(25);
    expect(earlyExitFeeBp(NOW - STAKING_RULES.earlyExitWindowMs + 1, NOW)).toBe(25);
    expect(earlyExitFeeBp(NOW - STAKING_RULES.earlyExitWindowMs, NOW)).toBe(0);
    expect(feeUsd(SNIPER_USD, earlyExitFeeBp(lastStakedAt, NOW))).toBeCloseTo(125, 9);
  });

  it('the sniper pays 0.65 % + 0.25 % and is strictly worse than the patient staker for every volume', () => {
    const snipeTradeBp = perks(stakeNear, { stakedSinceMs: NOW - HOUR }).platformFeeBp; // trade inside 24h
    const patientTradeBp = perks(stakeNear, { stakedSinceMs: NOW - 8 * DAY }).platformFeeBp; // waited, stays > 7d
    const exitBp = earlyExitFeeBp(NOW - HOUR, NOW);
    expect([snipeTradeBp, exitBp]).toEqual([65, 25]);
    expect(earlyExitFeeBp(NOW - 8 * DAY, NOW)).toBe(0);
    for (const volumeUsd of [0, 1_000, 50_000, 1_000_000]) {
      const sniper = feeUsd(volumeUsd, snipeTradeBp) + feeUsd(SNIPER_USD, exitBp);
      const patient = feeUsd(volumeUsd, patientTradeBp);
      expect(sniper).toBeGreaterThanOrEqual(patient);
    }
  });

  it('versus not staking (100 bp) the sniper saves 35 bp of volume minus the 25 bp exit fee: nothing below 25/35 (71 %) of the stake traded', () => {
    const unstakedBp = STAKING_TIERS[0]!.takerFeeBp;
    const saving = (volumeUsd: number): number => feeUsd(volumeUsd, unstakedBp) - (feeUsd(volumeUsd, 65) + feeUsd(SNIPER_USD, 25));
    expect(saving(0)).toBeLessThan(0);
    expect(saving(0.7 * SNIPER_USD)).toBeLessThan(0);
    expect(saving(SNIPER_USD)).toBeCloseTo(50, 9); // trading the whole stake once: 35 bp saved ($175) - $125 exit fee = +$50
    // break-even volume is exactly 25/35 of the stake; beyond it the sniper only earns the plain Scout saving (35 bp)
    expect(saving((25 / 35) * SNIPER_USD)).toBeCloseTo(0, 6);
    expect(saving(1_000_000)).toBeCloseTo(feeUsd(1_000_000, 35) - 125, 6);
  });
});

describe('W28-15 NEAR/USD crash: AI gross margin stays >= 65 % (property over price, stake, tier and trade bonus)', () => {
  const COST = STAKING_RULES.aiCostPerCallUsd;
  const EPS = 1e-9;

  it('1500 random (stake, price $0.50..$20, trade fees) draws never spend more than 35 % of protocol income', () => {
    const r = rng(2815);
    for (let i = 0; i < 1_500; i++) {
      const stake = Math.floor(r() ** 3 * 1_000_000);
      const price = 0.5 * 40 ** r(); // log-uniform 0.5..20
      const tradeFees = r() < 0.5 ? 0 : r() ** 2 * 5_000;
      const p = perks(stake, { nearUsd: price, dailyProtocolTradeFeeUsd: tradeFees, stakedSinceMs: NOW - 9 * DAY });
      const income = (stake * price * p.grossApyBp * STAKING_RULES.protocolYieldShareBp) / (10_000 * 10_000 * 365) + tradeFees;
      const spend = p.dailyAiCallLimit * COST;
      expect(spend, `stake ${stake} price ${price} fees ${tradeFees}`).toBeLessThanOrEqual(0.35 * income + EPS);
      if (income > 0) expect(1 - spend / income).toBeGreaterThanOrEqual(0.65 - EPS);
      if (p.maxAiColonySlots === 0) expect(p.dailyAiCallLimit).toBe(0);
    }
  });

  it('every tier at both ends of the price range, with and without a trade bonus, holds the margin', () => {
    for (const row of STAKING_TIERS.filter((t) => t.id > 0)) {
      for (const price of [0.5, 1, 4, 20]) {
        for (const tradeFees of [0, 0.01, 250]) {
          const p = perks(row.minStakeNear, { nearUsd: price, dailyProtocolTradeFeeUsd: tradeFees, stakedSinceMs: NOW - 9 * DAY });
          const budget = dailyAiBudgetUsd({ activeStakedNear: row.minStakeNear, nearUsd: price, grossApyBp: p.grossApyBp, dailyProtocolTradeFeeUsd: tradeFees });
          expect(p.dailyAiBudgetUsd).toBeCloseTo(budget, 12);
          expect(p.dailyAiCallLimit).toBe(dailyAiCallLimit(budget));
          expect(p.dailyAiCallLimit * COST).toBeLessThanOrEqual(budget + EPS);
        }
      }
    }
  });

  it('a lower price never buys more calls (monotone), and a 8x crash cuts the stake-only budget 8x', () => {
    const calls = (price: number) => perks(500, { nearUsd: price, stakedSinceMs: NOW - 9 * DAY }).dailyAiCallLimit;
    let prev = -1;
    for (const price of [0.5, 1, 2, 4, 8, 20]) {
      const c = calls(price);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(perks(500, { nearUsd: 0.5 }).dailyAiBudgetUsd * 8).toBeCloseTo(perks(500, { nearUsd: 4 }).dailyAiBudgetUsd, 12);
  });

  it('negative: zero price, negative stake and negative fees never produce a positive budget or negative calls', () => {
    expect(dailyAiBudgetUsd({ activeStakedNear: 500, nearUsd: 0, grossApyBp: 900, dailyProtocolTradeFeeUsd: 0 })).toBe(0);
    expect(dailyAiBudgetUsd({ activeStakedNear: -5, nearUsd: 4, grossApyBp: 900, dailyProtocolTradeFeeUsd: -10 })).toBe(0);
    expect(dailyAiCallLimit(0)).toBe(0);
    expect(dailyAiCallLimit(Number.NaN)).toBe(0);
  });
});

describe('W28-15 multi-colony Sybil (pure part): quotas are wallet rows, never multiplied by colonies', () => {
  it('perks evaluated for 1..12 colonies of one wallet are identical, and each tier equals its table row', () => {
    for (const row of STAKING_TIERS) {
      const base = perks(row.minStakeNear, { stakedSinceMs: NOW - 2 * DAY });
      for (const colonies of [1, 2, 10, 12]) {
        const perColony = Array.from({ length: colonies }, () => perks(row.minStakeNear, { stakedSinceMs: NOW - 2 * DAY }));
        const slots = perColony.reduce((s, p) => Math.max(s, p.maxAiColonySlots), 0);
        expect(perColony.every((p) => JSON.stringify(p, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) === JSON.stringify(base, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))).toBe(true);
        expect(slots).toBe(row.aiColonySlots);
        expect(base.gasMultiplier).toBe(row.gasMultiplier);
        expect(base.dailyAiCallLimit * STAKING_RULES.aiCostPerCallUsd).toBeLessThanOrEqual(base.dailyAiBudgetUsd + 1e-9);
      }
    }
  });

  it('perks are priced per wallet by its own ACTIVE stake: 100 NEAR in one wallet is Tier 2, ten dust wallets under 10 NEAR get nothing', () => {
    expect(stakingTierFor(100).id).toBe(2);
    expect(perks(100).maxAiColonySlots).toBe(3);
    for (const dust of ['0.000001', '5', '9.999999']) {
      const p = perks(dust);
      expect([p.tier, p.maxAiColonySlots, p.dailyAiCallLimit, p.gasMultiplier]).toEqual([0, 0, 0, 1]);
    }
  });
});

describe('W28-15 fee split conservation (property)', () => {
  it('protocol + dao + patron equals gross exactly for 3000 random gross x dao share x patron cases', () => {
    const r = rng(15);
    for (let i = 0; i < 3_000; i++) {
      const gross = BigInt(Math.floor(r() * 2 ** 40)) * BigInt(Math.floor(r() * 2 ** 20) + 1);
      const daoShareBp = Math.floor(r() * 10_001);
      const patronActive = r() < 0.5;
      const s = splitPlatformFee(gross, { daoShareBp, patronActive });
      expect(s.protocol + s.dao + s.patron).toBe(gross);
      expect(s.protocol >= 0n && s.dao >= 0n && s.patron >= 0n).toBe(true);
      if (!patronActive) expect(s.patron).toBe(0n);
      expect(s.dao).toBe((gross * BigInt(daoShareBp)) / 10_000n);
    }
  });

  it('the default W28 schedule is 20 % DAO / 12 % Patron / 68 % Protocol of gross and the patron never exceeds 15 % of the protocol cut', () => {
    const gross = 10n ** 9n;
    expect(splitPlatformFee(gross, { daoShareBp: 2_000, patronActive: true })).toEqual({ protocol: 680_000_000n, dao: 200_000_000n, patron: 120_000_000n });
    const r = rng(16);
    for (let i = 0; i < 500; i++) {
      const g = BigInt(Math.floor(r() * 1e12));
      const s = splitPlatformFee(g, { daoShareBp: Math.floor(r() * 10_001), patronActive: true });
      expect(s.patron * 10_000n).toBeLessThanOrEqual((s.protocol + s.patron) * BigInt(STAKING_RULES.patronProtocolFeeShareBp));
    }
  });

  it('corner cases: zero and negative gross, 0 / 100 % dao share, and a clamped nonsense share', () => {
    expect(splitPlatformFee(0n, { daoShareBp: 2_000, patronActive: true })).toEqual({ protocol: 0n, dao: 0n, patron: 0n });
    expect(splitPlatformFee(-5n, { daoShareBp: 2_000, patronActive: true })).toEqual({ protocol: 0n, dao: 0n, patron: 0n });
    expect(splitPlatformFee(1_000n, { daoShareBp: 10_000, patronActive: true })).toEqual({ protocol: 0n, dao: 1_000n, patron: 0n });
    expect(splitPlatformFee(1_000n, { daoShareBp: 0, patronActive: false })).toEqual({ protocol: 1_000n, dao: 0n, patron: 0n });
    expect(splitPlatformFee(1_000n, { daoShareBp: 99_999, patronActive: true }).dao).toBe(1_000n);
  });
});

interface Fill {
  id: string;
  quote: string;
  notional: bigint;
  stallFee: bigint;
  platformFeeBp: number;
  buyerAccountId: string;
  sellerAccountId: string;
  stallAccountId: string;
  buyerColonyId: string;
  sellerColonyId: string;
  stallColonyId: string;
  at: number;
}

const dec = (n: bigint) => ({ toFixed: () => n.toString() });
const row = (f: Fill) => ({ ...f, notional: dec(f.notional), stallFee: dec(f.stallFee), createdAt: new Date(f.at), settledAt: new Date(f.at) });

/** A fake db: the wallet `me` owns accounts me.a / me.b (colonies cme1 / cme2); `rival.*` / `other.*` belong to other owners. */
function fakeDb(fills: Fill[]): DbClient {
  const owners = [
    { accountId: 'me.a', playerId: 'pme', ownerAccountId: 'me.near', claimedByAccountId: null },
    { accountId: 'me.b', playerId: 'pme', ownerAccountId: 'me.near', claimedByAccountId: null },
    { accountId: 'rival.a', playerId: 'prival', ownerAccountId: 'rival.near', claimedByAccountId: null },
    { accountId: 'other.a', playerId: 'pother', ownerAccountId: 'other.near', claimedByAccountId: null },
  ];
  return {
    intentTrade: { findMany: async () => fills.map(row) },
    nearColonyAccount: { findMany: async () => owners },
  } as unknown as DbClient;
}

const WALLET = { walletKey: 'me.near', accountIds: ['me.a', 'me.b'], colonyIds: ['cme1', 'cme2'], playerId: 'pme' };

describe('W28-15 self-fill ROI exclusion (property over random fill mixes)', () => {
  const base = (id: number, over: Partial<Fill>): Fill => ({
    id: `t${id}`, quote: 'USDC', notional: 1_000_000_000n, stallFee: 5_000_000n, platformFeeBp: 65,
    buyerAccountId: 'me.a', sellerAccountId: 'rival.a', stallAccountId: 'other.a',
    buyerColonyId: 'cme1', sellerColonyId: 'crival', stallColonyId: 'cother', at: NOW - id * HOUR, ...over,
  });

  /** The ways to wash-trade: same colony both sides, own account on both sides, own account as stall, claim-wallet twin. */
  const WASH: Array<(id: number, r: () => number) => Fill> = [
    (id, r) => base(id, { sellerColonyId: 'cme1', notional: BigInt(Math.floor(r() * 1e11)) }),
    (id, r) => base(id, { sellerAccountId: 'me.b', sellerColonyId: 'cme2', notional: BigInt(Math.floor(r() * 1e11)) }),
    (id, r) => base(id, { stallAccountId: 'me.b', stallColonyId: 'cme2', stallFee: BigInt(Math.floor(r() * 1e10)), platformFeeBp: 25 }),
    (id, r) => base(id, { buyerAccountId: 'me.b', buyerColonyId: 'cme2', stallAccountId: 'me.a', stallColonyId: 'cme1', stallFee: BigInt(Math.floor(r() * 1e10)) }),
  ];

  it('adding any number of wash fills changes neither savings, royalties, events nor effective APY', async () => {
    const r = rng(2816);
    for (let round = 0; round < 40; round++) {
      const real: Fill[] = Array.from({ length: Math.floor(r() * 5) }, (_v, i) => base(100 + i, { platformFeeBp: [100, 65, 50, 25][Math.floor(r() * 4)]!, notional: BigInt(Math.floor(r() * 5e9) + 1) }));
      const wash: Fill[] = Array.from({ length: Math.floor(r() * 12) + 1 }, (_v, i) => WASH[Math.floor(r() * WASH.length)]!(i, r));
      const q = { sinceMs: NOW - 30 * DAY, nearUsd: 4 };
      const clean = await readFillIncome(fakeDb(real), WALLET, q);
      const dirty = await readFillIncome(fakeDb([...real, ...wash]), WALLET, q);
      expect(dirty.selfFillsExcluded).toBe(wash.length);
      expect(dirty.marketFeeSavingsUsd).toBe(clean.marketFeeSavingsUsd);
      expect(dirty.stallRoyaltiesUsd).toBe(clean.stallRoyaltiesUsd);
      expect(dirty.events).toEqual(clean.events);
      const apy = (i: typeof clean) => effectiveApyBp({ netApyBp: 720, stakedUsd: 1_000, windowMs: 30 * DAY, extrasUsd: i.marketFeeSavingsUsd + i.stallRoyaltiesUsd });
      expect(apy(dirty)).toBe(apy(clean));
    }
  });

  it('a fill with a real counterparty does count (negative control), and wash volume alone is worth zero', async () => {
    const q = { sinceMs: NOW - DAY, nearUsd: 4 };
    const real = await readFillIncome(fakeDb([base(1, {})]), WALLET, q);
    expect(real.marketFeeSavingsUsd).toBeCloseTo(1_000 * 0.0035, 9);
    expect(real.selfFillsExcluded).toBe(0);
    const washOnly = await readFillIncome(fakeDb(Array.from({ length: 50 }, (_v, i) => WASH[i % WASH.length]!(i, () => 0.9))), WALLET, q);
    expect(washOnly.marketFeeSavingsUsd + washOnly.stallRoyaltiesUsd).toBe(0);
    expect(washOnly.events).toEqual([]);
    expect(effectiveApyBp({ netApyBp: 720, stakedUsd: 1_000, windowMs: 30 * DAY, extrasUsd: 0 })).toBe(720);
  });

  it('more real volume never lowers the APY, and effective APY never goes below the base net APY while staked', () => {
    const r = rng(17);
    let prev = 0;
    for (let extras = 0; extras < 200; extras += 1 + Math.floor(r() * 7)) {
      const a = effectiveApyBp({ netApyBp: 720, stakedUsd: 5_000, windowMs: 30 * DAY, extrasUsd: extras });
      expect(a).toBeGreaterThanOrEqual(Math.max(prev, 720));
      prev = a;
    }
  });
});
