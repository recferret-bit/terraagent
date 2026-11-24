import { describe, expect, it } from 'vitest';
import {
  CompoundYieldRequest,
  EvaluatedStakerPerksV2,
  IntentsQuoteRequest,
  PatronContenderRow,
  PatronHistoryRow,
  PlanetPatronCompetitionView,
  PlanetaryPatronageView,
  REST_ERROR_CODES,
  STAKING_RULES,
  STAKING_TIERS,
  StakeProfitsRequest,
  StakeRequestSchema,
  StakerPerksAny,
  StakingActionResponse,
  StakingPerformanceResponse,
  StakingPositionDto,
  StakingPrestigeResponse,
  StakingStatusResponse,
  StakingTierId,
  dailyAiBudgetUsd,
  dailyAiCallLimit,
  earlyExitFeeBp,
  effectiveTakerFee,
  nextStakingTier,
  parseDecimalToAtomic,
  parseDisplayAmount,
  parseWaves,
  stakingTierFor,
  stakingTierForYocto,
  type EvaluatedStakerPerksV2 as PerksV2,
} from '../src';

const H = 3_600_000;
const D = 24 * H;
const YOCTO = 10n ** 24n;

const samplePerksV2 = (over: Partial<PerksV2> = {}): PerksV2 => ({
  active: true,
  minStakeNear: '10',
  totalStakedNear: '50',
  grossApyBp: 900,
  netApyBp: 720,
  protocolYieldShareBp: 2000,
  platformFeeBp: 65,
  standardPlatformFeeBp: 100,
  managedAutopilotUnlocked: true,
  protocolAccountId: 'protocol.terraagent.testnet',
  version: 2,
  tier: 2,
  tierKey: 'commander',
  tierName: 'Commander',
  feeTier: 1,
  activeStakedNear: '50',
  unbondingNear: '0',
  aiModel: 'z-ai/glm-5.3-flash',
  aiMode: 'tee',
  maxAiColonySlots: 3,
  activeAiColonySlots: 0,
  dailyAiCallLimit: 92,
  dailyAiCallsUsed: 0,
  dailyAiBudgetUsd: 0.00345,
  freeTrialTurnsRemaining: 0,
  feeWarmupReadyAtMs: D,
  earlyExitFeeBp: 25,
  earlyExitFreeAtMs: 7 * D,
  stakedSinceMs: 0,
  gasMultiplier: 4,
  sweepSeconds: 60,
  botKeys: 3,
  guildRadarLeadMs: 300_000,
  daoVoteWeightBp: 10_000,
  stallRoyaltyBonusBp: 0,
  leadPatronPlanetIds: [],
  nextTierMinNear: 200,
  ...over,
});

describe('W28-01 tier ladder data (NEAR_STAKING_SPEC §3)', () => {
  it('has exactly Tiers 0..4 with the 100→65→50→35→25 bp fee ladder and 0/1/3/6/12 slots', () => {
    expect(STAKING_TIERS.map((t) => t.id)).toEqual([0, 1, 2, 3, 4]);
    expect(STAKING_TIERS.map((t) => t.minStakeNear)).toEqual([0, 10, 50, 200, 500]);
    expect(STAKING_TIERS.map((t) => t.takerFeeBp)).toEqual([100, 65, 50, 35, 25]);
    expect(STAKING_TIERS.map((t) => t.aiColonySlots)).toEqual([0, 1, 3, 6, 12]);
    expect(STAKING_TIERS.map((t) => t.warmupRequired)).toEqual([false, false, true, true, true]);
    expect(STAKING_TIERS.map((t) => t.gasMultiplier)).toEqual([1, 2, 4, 8, 15]);
    expect(STAKING_TIERS.filter((t) => t.patronEligible).map((t) => t.id)).toEqual([4]);
    expect(STAKING_TIERS[3]!.daoVoteWeightBp).toBe(15_000);
    expect(STAKING_TIERS[2]!.guildRadarLeadMs).toBe(300_000);
  });

  it('is frozen (data rows cannot be mutated at runtime)', () => {
    expect(Object.isFrozen(STAKING_TIERS)).toBe(true);
    expect(Object.isFrozen(STAKING_TIERS[1])).toBe(true);
    expect(Object.isFrozen(STAKING_RULES)).toBe(true);
  });

  it('resolves tiers at the exact thresholds (boundary: 9.999 → T0, 10 → T1, 500 → T4, 10^6 → T4)', () => {
    expect(stakingTierFor(0).id).toBe(0);
    expect(stakingTierFor(9.999).id).toBe(0);
    expect(stakingTierFor(10).id).toBe(1);
    expect(stakingTierFor(49.99).id).toBe(1);
    expect(stakingTierFor(50).id).toBe(2);
    expect(stakingTierFor(200).id).toBe(3);
    expect(stakingTierFor(499.999999).id).toBe(3);
    expect(stakingTierFor(500).id).toBe(4);
    expect(stakingTierFor(1_000_000).id).toBe(4);
    expect(stakingTierFor(Number.NaN).id).toBe(0);
    expect(stakingTierFor(-5).id).toBe(0);
  });

  it('resolves yocto exactly at thresholds (1 yocto below 10 NEAR stays Tier 0)', () => {
    expect(stakingTierForYocto(10n * YOCTO - 1n).id).toBe(0);
    expect(stakingTierForYocto(10n * YOCTO).id).toBe(1);
    expect(stakingTierForYocto(500n * YOCTO).id).toBe(4);
    expect(stakingTierForYocto(0n).id).toBe(0);
  });

  it('nextStakingTier walks the ladder and stops at Tier 4', () => {
    expect(nextStakingTier(STAKING_TIERS[0]!)?.id).toBe(1);
    expect(nextStakingTier(STAKING_TIERS[4]!)).toBeNull();
  });
});

describe('W28-01 anti-snipe fee rules', () => {
  it('Tier 1 fee (65 bp) is instant at t=0', () => {
    const f = effectiveTakerFee({ tier: STAKING_TIERS[1]!, stakedSinceMs: 0, nowMs: 0 });
    expect(f.takerFeeBp).toBe(65);
    expect(f.warmupReadyAtMs).toBeNull();
  });

  it('Tier 2–4 cuts wait 24h (10s flash-stake keeps 65 bp; at exactly 24h the cut applies)', () => {
    for (const id of [2, 3, 4] as const) {
      const tier = STAKING_TIERS[id]!;
      const flash = effectiveTakerFee({ tier, stakedSinceMs: 1_000, nowMs: 11_000 });
      expect(flash.takerFeeBp).toBe(65);
      expect(flash.feeTier.id).toBe(1);
      expect(flash.warmupReadyAtMs).toBe(1_000 + D);
      const almost = effectiveTakerFee({ tier, stakedSinceMs: 0, nowMs: D - 1 });
      expect(almost.takerFeeBp).toBe(65);
      const ready = effectiveTakerFee({ tier, stakedSinceMs: 0, nowMs: D });
      expect(ready.takerFeeBp).toBe(tier.takerFeeBp);
      expect(ready.warmupReadyAtMs).toBeNull();
    }
  });

  it('Tier 0 is always 100 bp; a missing stake start never unlocks a warmup tier', () => {
    expect(effectiveTakerFee({ tier: STAKING_TIERS[0]!, stakedSinceMs: null, nowMs: 5 }).takerFeeBp).toBe(100);
    expect(effectiveTakerFee({ tier: STAKING_TIERS[4]!, stakedSinceMs: null, nowMs: 10 * D }).takerFeeBp).toBe(65);
  });

  it('early-exit fee is 25 bp under 7 days, 0 at ≥ 7 days and 0 with no stake', () => {
    expect(earlyExitFeeBp(0, 7 * D - 1)).toBe(25);
    expect(earlyExitFeeBp(0, 7 * D)).toBe(0);
    expect(earlyExitFeeBp(null, 0)).toBe(0);
  });
});

describe('W28-01 dynamic USD AI budget (Cost ≤ 35 %)', () => {
  const base = { grossApyBp: 900, dailyProtocolTradeFeeUsd: 0 };

  it('Tier 1 at $4/NEAR buys ~18 calls; Tier 2 ~90; Tier 3 ~350; Tier 4 ~900', () => {
    const calls = (near: number) => dailyAiCallLimit(dailyAiBudgetUsd({ ...base, activeStakedNear: near, nearUsd: 4 }));
    expect(calls(10)).toBe(18);
    expect(calls(50)).toBeGreaterThanOrEqual(90);
    expect(calls(200)).toBeGreaterThanOrEqual(350);
    expect(calls(500)).toBeGreaterThanOrEqual(900);
  });

  it('budget never exceeds 35 % of protocol daily income, at any price (incl. $0.50 crash)', () => {
    for (const nearUsd of [0.5, 1, 4, 12]) {
      for (const near of [0, 10, 50, 200, 500, 1_000_000]) {
        const fees = 0.42;
        const budget = dailyAiBudgetUsd({ grossApyBp: 900, activeStakedNear: near, nearUsd, dailyProtocolTradeFeeUsd: fees });
        const income = (near * nearUsd * 0.09 * 0.2) / 365 + fees;
        expect(budget).toBeLessThanOrEqual(income * 0.35 + 1e-12);
      }
    }
  });

  it('scales down linearly when NEAR/USD drops (a 87.5 % crash cuts the budget 87.5 %)', () => {
    const at4 = dailyAiBudgetUsd({ ...base, activeStakedNear: 50, nearUsd: 4 });
    const at05 = dailyAiBudgetUsd({ ...base, activeStakedNear: 50, nearUsd: 0.5 });
    expect(at05 / at4).toBeCloseTo(0.125, 9);
  });

  it('negative / zero inputs give a zero budget and zero calls', () => {
    expect(dailyAiBudgetUsd({ ...base, activeStakedNear: -1, nearUsd: -3, dailyProtocolTradeFeeUsd: -2 })).toBe(0);
    expect(dailyAiCallLimit(0)).toBe(0);
    expect(dailyAiCallLimit(-1)).toBe(0);
  });
});

describe('W28-01 schemas', () => {
  it('StakingTierId accepts 0..4 only', () => {
    for (const ok of [0, 1, 2, 3, 4]) expect(StakingTierId.safeParse(ok).success).toBe(true);
    for (const bad of [-1, 5, 1.5, '1']) expect(StakingTierId.safeParse(bad).success).toBe(false);
  });

  it('EvaluatedStakerPerksV2 parses a full V2 row and rejects unknown keys / bad tiers', () => {
    expect(EvaluatedStakerPerksV2.parse(samplePerksV2()).tier).toBe(2);
    expect(EvaluatedStakerPerksV2.safeParse({ ...samplePerksV2(), extra: 1 }).success).toBe(false);
    expect(EvaluatedStakerPerksV2.safeParse({ ...samplePerksV2(), tier: 7 }).success).toBe(false);
    expect(EvaluatedStakerPerksV2.safeParse({ ...samplePerksV2(), aiMode: 'gpt' }).success).toBe(false);
  });

  it('StakerPerksAny accepts both V2 and the W20 shape (wave-flag fencing)', () => {
    const v1 = { active: false, minStakeNear: '10', totalStakedNear: '0', grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, platformFeeBp: 100, standardPlatformFeeBp: 100, managedAutopilotUnlocked: false, protocolAccountId: 'protocol.terraagent.mock' };
    expect(StakerPerksAny.safeParse(v1).success).toBe(true);
    expect(StakerPerksAny.safeParse(samplePerksV2()).success).toBe(true);
  });

  it('wallet-first: positions, status and stake requests no longer need a colonyId', () => {
    const pos = StakingPositionDto.parse({ accountId: 'alice.testnet', pool: 'meta-pool.testnet', staked: '50', unbonding: '0', unbondingReadyAtMs: null, withdrawable: '0', rewards: '0', asset: 'stNEAR', stakedSinceMs: 0, lastStakedAtMs: 0 });
    expect(pos.colonyId).toBeUndefined();
    expect(StakeRequestSchema.parse({ accountId: 'alice.testnet', pool: 'meta-pool.testnet', amount: '50', asset: 'near' }).colonyId).toBeUndefined();
    expect(StakeRequestSchema.safeParse({ pool: 'p.pool', amount: '1', asset: 'DOGE' }).success).toBe(false);
    const status = StakingStatusResponse.parse({ accountId: 'alice.testnet', walletAccountId: 'alice.testnet', walletBalanceNear: '1', deedSettled: false, accountClaimed: false, claimedByAccountId: null, pools: [], positions: [pos], perks: samplePerksV2() });
    expect(status.colonyId).toBeUndefined();
  });

  it('StakingActionResponse carries early-exit and compound fields', () => {
    const pos = { accountId: 'a.testnet', pool: 'p.pool', staked: '5', unbonding: '45', unbondingReadyAtMs: 1, withdrawable: '0', rewards: '0' };
    expect(StakingActionResponse.parse({ txHash: 'mock:1', position: pos, walletBalanceNear: '0', earlyExitFeeBp: 25, earlyExitFeeNear: '0.1125' }).earlyExitFeeBp).toBe(25);
    expect(StakingActionResponse.safeParse({ txHash: 'mock:1', position: pos, walletBalanceNear: '0', earlyExitFeeNear: '-1' }).success).toBe(false);
  });

  it('CompoundYieldRequest / StakeProfitsRequest validate (USDC ≤ 6 decimals, stNEAR default)', () => {
    expect(CompoundYieldRequest.parse({ pool: 'p.pool' }).pool).toBe('p.pool');
    expect(CompoundYieldRequest.safeParse({}).success).toBe(false);
    expect(StakeProfitsRequest.parse({ amountUsdc: '10.00' }).asset).toBe('stNEAR');
    expect(StakeProfitsRequest.safeParse({ amountUsdc: '10.0000001' }).success).toBe(false);
    expect(StakeProfitsRequest.safeParse({ amountUsdc: '-1' }).success).toBe(false);
    expect(StakeProfitsRequest.safeParse({ amountUsdc: '1e3' }).success).toBe(false);
  });

  it('StakingPerformanceResponse round-trips a minimal valid payload', () => {
    const zero = { amountNear: 0, dailyNear: 0, monthlyNear: 0, yearlyNear: 0, dailyUsd: 0, monthlyUsd: 0, yearlyUsd: 0 };
    const aiBudget = { model: 'z-ai/glm-5.3-flash', mode: 'trial', dailyBudgetUsd: 0, dailyBudgetUsedUsd: 0, dailyCallLimit: 0, dailyCallsUsed: 0, tradeBonusCalls: 0, freeTrialTurnsRemaining: 5, freeTrialTurnsTotal: 5, trialEligible: true, colonySlotsUsed: 0, colonySlotsMax: 0 };
    const res = StakingPerformanceResponse.parse({
      accountId: 'alice.testnet', asOfMs: 1,
      price: { nearUsd: 4, source: 'est', asOfMs: 1 },
      apy: { grossApyBp: 900, netApyBp: 720, protocolYieldShareBp: 2000, source: 'sim' },
      balances: { walletNear: '0', activeStakedNear: '0', unbondingNear: '0', withdrawableNear: '0', accruedYieldNear: '0', lst: [], totalStakedUsd: 0 },
      timers: { stakedSinceMs: null, feeWarmupReadyAtMs: null, earlyExitFreeAtMs: null, earlyExitFeeBp: 0, unbondingReadyAtMs: null },
      income: { stakingYieldNear: 0, stakingYieldUsd: 0, marketFeeSavingsUsd: 0, stallRoyaltiesUsd: 0, patronRevenueUsd: 0, selfFillsExcluded: 3 },
      projection: zero, effectiveApyBp: 720, perks: samplePerksV2({ tier: 0, tierKey: 'cadet' }), aiBudget,
      ecosystem: { totalNear: '0', entries: [] },
      series: { window: '90d', points: [{ tMs: 0, valueNear: 0, kind: 'realized' }] },
      txs: [],
    });
    expect(res.income.selfFillsExcluded).toBe(3);
  });

  it('StakingPrestigeResponse holds a nullable Lead Patron and per-colony tiers 0..4', () => {
    expect(StakingPrestigeResponse.parse({ planetId: 'pl_dune', leadPatron: null, colonies: [{ colonyId: 'c1', tier: 4 }] }).colonies[0]!.tier).toBe(4);
    expect(StakingPrestigeResponse.safeParse({ planetId: 'pl_dune', leadPatron: null, colonies: [{ colonyId: 'c1', tier: 5 }] }).success).toBe(false);
  });

  it('IntentsQuoteRequest needs atomic integer amounts (no "10.00" on the wire)', () => {
    expect(IntentsQuoteRequest.safeParse({ originAsset: 'a', destinationAsset: 'b', amount: '10000000', dry: true }).success).toBe(true);
    expect(IntentsQuoteRequest.safeParse({ originAsset: 'a', destinationAsset: 'b', amount: '10.00' }).success).toBe(false);
  });

  it('registers the W28 REST error codes', () => {
    for (const c of ['NOTHING_TO_COMPOUND', 'NOTHING_TO_WITHDRAW', 'INSUFFICIENT_USDC', 'AI_SLOT_LIMIT', 'WALLET_REQUIRED']) {
      expect(REST_ERROR_CODES as readonly string[]).toContain(c);
    }
  });

  it('W28 is a real wave flag (..27 excludes it, ..28 and all include it)', () => {
    expect(parseWaves('..27').has('W28')).toBe(false);
    expect(parseWaves('..28').has('W28')).toBe(true);
    expect(parseWaves('all').has('W28')).toBe(true);
  });
});

describe('W28-01 decimal scaling (W28-13 RampView)', () => {
  it('scales by token decimals: 10.00 USDC (6) → 10000000; 1 NEAR (24) → 10^24', () => {
    expect(parseDecimalToAtomic('10.00', 6)).toBe(10_000_000n);
    expect(parseDecimalToAtomic('1', 24)).toBe(YOCTO);
    expect(parseDecimalToAtomic('0.000001', 6)).toBe(1n);
    expect(parseDecimalToAtomic('10.000000', 6)).toBe(10_000_000n);
  });

  it('rejects over-precision, signs, exponents and junk (no $1 quintillion overflow)', () => {
    for (const bad of ['10.0000001', '-1', '1e18', '', 'abc', '01']) expect(() => parseDecimalToAtomic(bad, 6), bad).toThrow(RangeError);
    expect(() => parseDecimalToAtomic('1', -1)).toThrow(RangeError);
  });

  it('parseDisplayAmount still delegates with the market token precision', () => {
    expect(parseDisplayAmount('USDC', '10.5')).toBe(10_500_000n);
  });
});

describe('Planetary Patronage competition & history schemas', () => {
  it('validates contender, history, planet competition, and 3-planet patronage payloads (pos/neg/boundary)', () => {
    const contender = PatronContenderRow.parse({
      rank: 1,
      accountId: 'alice.near',
      carrierName: 'ISS alice.near',
      activeStakedNear: '620',
      tier: 4,
      status: 'lead',
      gapToLeadNear: '0',
      stakedSinceMs: 0,
      nominatedAtMs: 1000,
      isSelf: true,
    });
    const history = PatronHistoryRow.parse({
      id: 'ph_1',
      planetId: 'pl_01JKHAR0NDVNEST00000000000',
      accountId: 'alice.near',
      carrierName: 'ISS alice.near',
      kind: 'seat_overtaken',
      activeStakedNear: '620',
      previousAccountId: 'bob.near',
      previousStakedNear: '510',
      payoutUsd: null,
      atMs: 1000,
    });
    const planet = PlanetPatronCompetitionView.parse({
      planetId: 'pl_01JKHAR0NDVNEST00000000000',
      leadPatron: {
        planetId: 'pl_01JKHAR0NDVNEST00000000000',
        accountId: 'alice.near',
        carrierName: 'ISS alice.near',
        activeStakedNear: '620',
        sinceMs: 1000,
        protocolFeeShareBp: 1500,
      },
      stakeToLeadNear: '620',
      totalContenders: 1,
      contenders: [contender],
      history: [history],
    });
    const patronage = PlanetaryPatronageView.parse({
      nominatedPlanetId: 'pl_01JKHAR0NDVNEST00000000000',
      planets: [planet],
    });
    expect(patronage.planets[0]!.contenders[0]!.status).toBe('lead');

    // Negative / boundary checks: rank 0, negative gap, tier 5, unknown kind, extra field
    expect(PatronContenderRow.safeParse({ ...contender, rank: 0 }).success).toBe(false);
    expect(PatronContenderRow.safeParse({ ...contender, tier: 5 }).success).toBe(false);
    expect(PatronContenderRow.safeParse({ ...contender, gapToLeadNear: '-1' }).success).toBe(false);
    expect(PatronHistoryRow.safeParse({ ...history, kind: 'rigged' }).success).toBe(false);
    expect(PlanetaryPatronageView.safeParse({ ...patronage, extra: true }).success).toBe(false);
  });
});
