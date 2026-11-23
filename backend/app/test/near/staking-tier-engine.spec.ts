import {
  dailyAiCallLimit,
  MANAGED_AI_MODEL,
  SCRIPT_AI_MODEL,
  STAKING_RULES,
  STAKING_TIERS,
} from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { splitPlatformFee } from '../../src/near/infrastructure/network/protocol-fee.config';
import { EMPTY_AI_USAGE } from '../../src/near/staking/perks/ai-usage.reader';
import { isW28Enabled, resolvePerkLadder } from '../../src/near/staking/perks/legacy-ladder';
import { buildAiBudgetView, evaluatePerks, type PerksEvalInput } from '../../src/near/staking/perks/tier-engine';
import { buildStakerPerksFromYocto } from '../../src/near/staking/staker-perks';
import { nearToYocto } from '../../src/near/staking/yocto';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const near = (n: number | string): bigint => BigInt(nearToYocto(n));

function input(over: Partial<PerksEvalInput> & { stakeNear?: number | string } = {}): PerksEvalInput {
  const { stakeNear, ...rest } = over;
  return {
    ladder: resolvePerkLadder({ w28: true, env: {} }),
    activeStakedYocto: near(stakeNear ?? 0),
    unbondingYocto: 0n,
    stakedSinceMs: null,
    lastStakedAtMs: null,
    nowMs: NOW,
    protocolAccountId: 'protocol.terraagent.mock',
    nearUsd: 4,
    dailyProtocolTradeFeeUsd: 0,
    usage: EMPTY_AI_USAGE,
    leadPatronPlanetIds: [],
    ...rest,
  };
}

describe('W28-03 tier engine: ladder and thresholds', () => {
  it.each([
    [0, 0, 100],
    ['9.999999', 0, 100],
    [10, 1, 65],
    [49, 1, 65],
    [500, 4, 65], // warming up: Tier 1 rate until 24h
  ])('stake %s NEAR (just staked) -> tier %i pays %i bp', (stake, tier, fee) => {
    const p = evaluatePerks(input({ stakeNear: stake, stakedSinceMs: NOW }));
    expect(p.tier).toBe(tier);
    expect(p.platformFeeBp).toBe(fee);
    expect(p.version).toBe(2);
  });

  it('wallet quotas come from the tier row and are never multiplied by colonies', () => {
    for (const row of STAKING_TIERS) {
      const p = evaluatePerks(input({ stakeNear: row.minStakeNear, stakedSinceMs: NOW - 2 * 24 * HOUR }));
      expect(p.maxAiColonySlots).toBe(row.aiColonySlots);
      expect(p.sweepSeconds).toBe(row.sweepSeconds);
      expect(p.gasMultiplier).toBe(row.gasMultiplier);
      expect(p.botKeys).toBe(row.botKeys);
      expect(p.guildRadarLeadMs).toBe(row.guildRadarLeadMs);
      expect(p.daoVoteWeightBp).toBe(row.daoVoteWeightBp);
      expect(p.stallRoyaltyBonusBp).toBe(row.stallRoyaltyBonusBp);
    }
    expect(STAKING_TIERS.map((t) => t.aiColonySlots)).toEqual([0, 1, 3, 6, 12]);
  });

  it('reports the next tier threshold and null at Tier 4', () => {
    expect(evaluatePerks(input({ stakeNear: 60 })).nextTierMinNear).toBe(200);
    expect(evaluatePerks(input({ stakeNear: 900 })).nextTierMinNear).toBeNull();
  });
});

describe('W28-03 anti-snipe: 24h fee warmup', () => {
  it('a 10 s flash-stake of 10000 NEAR keeps the 65 bp Scout fee', () => {
    const p = evaluatePerks(input({ stakeNear: 10_000, stakedSinceMs: NOW - 10_000 }));
    expect(p.tier).toBe(4);
    expect(p.feeTier).toBe(1);
    expect(p.platformFeeBp).toBe(65);
    expect(p.feeWarmupReadyAtMs).toBe(NOW - 10_000 + STAKING_RULES.feeWarmupMs);
  });

  it('flips exactly at the 24h boundary (23h59m59.999s = 65 bp, 24h = tier fee)', () => {
    const since = NOW - STAKING_RULES.feeWarmupMs;
    expect(evaluatePerks(input({ stakeNear: 50, stakedSinceMs: since + 1 })).platformFeeBp).toBe(65);
    const at = evaluatePerks(input({ stakeNear: 50, stakedSinceMs: since }));
    expect(at.platformFeeBp).toBe(50);
    expect(at.feeWarmupReadyAtMs).toBeNull();
    expect(evaluatePerks(input({ stakeNear: 200, stakedSinceMs: since })).platformFeeBp).toBe(35);
    expect(evaluatePerks(input({ stakeNear: 500, stakedSinceMs: since })).platformFeeBp).toBe(25);
  });

  it('unknown stake start (no clock) never grants the deep cuts', () => {
    expect(evaluatePerks(input({ stakeNear: 200, stakedSinceMs: null })).platformFeeBp).toBe(65);
  });

  it('never exceeds a lower configured standard fee', () => {
    const ladder = resolvePerkLadder({ w28: true, env: {}, standardPlatformFeeBp: 40 });
    expect(evaluatePerks(input({ ladder, stakeNear: 10, stakedSinceMs: NOW })).platformFeeBp).toBe(40);
    expect(evaluatePerks(input({ ladder, stakeNear: 0 })).platformFeeBp).toBe(40);
  });

  it('early-exit fee: 25 bp within 7 days of the last deposit, free afterwards, none when unstaked', () => {
    const since = NOW - 3 * 24 * HOUR;
    const young = evaluatePerks(input({ stakeNear: 50, stakedSinceMs: since, lastStakedAtMs: since }));
    expect(young.earlyExitFeeBp).toBe(25);
    expect(young.earlyExitFreeAtMs).toBe(since + STAKING_RULES.earlyExitWindowMs);
    const boundary = NOW - STAKING_RULES.earlyExitWindowMs;
    expect(evaluatePerks(input({ stakeNear: 50, stakedSinceMs: boundary, lastStakedAtMs: boundary })).earlyExitFeeBp).toBe(0);
    const none = evaluatePerks(input({ stakeNear: 0, lastStakedAtMs: since }));
    expect(none.earlyExitFeeBp).toBe(0);
    expect(none.earlyExitFreeAtMs).toBeNull();
  });
});

describe('W28-03 unbonding exclusion: instant downgrade', () => {
  it('500 staked, unstake 491 -> only 9 active -> Tier 0 immediately, unbonding is reported separately', () => {
    const before = evaluatePerks(input({ stakeNear: 500, stakedSinceMs: NOW - 2 * 24 * HOUR }));
    expect(before.tier).toBe(4);
    const after = evaluatePerks(
      input({ stakeNear: 9, unbondingYocto: near(491), stakedSinceMs: NOW - 2 * 24 * HOUR }),
    );
    expect(after.tier).toBe(0);
    expect(after.active).toBe(false);
    expect(after.managedAutopilotUnlocked).toBe(false);
    expect(after.maxAiColonySlots).toBe(0);
    expect(after.platformFeeBp).toBe(100);
    expect(after.unbondingNear).toBe('491');
    expect(after.activeStakedNear).toBe('9');
  });
});

describe('W28-03 dynamic USD AI cap and margin', () => {
  const stake = 200;
  const revenueUsd = (nearUsd: number, tradeFeeUsd = 0): number =>
    (stake * nearUsd * 900 * STAKING_RULES.protocolYieldShareBp) / (10_000 * 10_000 * 365) + tradeFeeUsd;
  const slotted = (nearUsd: number, tradeFee = 0) =>
    evaluatePerks(input({ stakeNear: stake, stakedSinceMs: NOW, nearUsd, dailyProtocolTradeFeeUsd: tradeFee }));

  it('at $4/NEAR a Scout gets about 18 calls a day', () => {
    expect(evaluatePerks(input({ stakeNear: 10, nearUsd: 4 })).dailyAiCallLimit).toBeGreaterThanOrEqual(18);
  });

  it('a $0.50 NEAR crash scales the budget down 8x and AI cost stays at or under 35 % of protocol revenue (margin >= 65 %)', () => {
    const at4 = slotted(4);
    const crash = slotted(0.5);
    expect(crash.dailyAiBudgetUsd).toBeCloseTo(at4.dailyAiBudgetUsd / 8, 10);
    expect(crash.dailyAiCallLimit).toBeLessThan(at4.dailyAiCallLimit / 7);
    for (const p of [at4, crash]) {
      const cost = p.dailyAiCallLimit * STAKING_RULES.aiCostPerCallUsd;
      const rev = revenueUsd(p === at4 ? 4 : 0.5);
      expect(cost / rev).toBeLessThanOrEqual(0.35 + 1e-9);
      expect(1 - cost / rev).toBeGreaterThanOrEqual(0.65);
    }
  });

  it('the trade-fee bonus adds budget on top, and a wallet without a slot gets no managed budget', () => {
    const base = slotted(4);
    const bonus = slotted(4, 2);
    expect(bonus.dailyAiBudgetUsd).toBeCloseTo(base.dailyAiBudgetUsd + 0.7, 10);
    expect(bonus.dailyAiCallLimit).toBe(dailyAiCallLimit(bonus.dailyAiBudgetUsd));
    const cadet = evaluatePerks(input({ stakeNear: 5, dailyProtocolTradeFeeUsd: 50 }));
    expect(cadet.dailyAiBudgetUsd).toBe(0);
    expect(cadet.dailyAiCallLimit).toBe(0);
  });

  it('a zero or negative price never produces a budget', () => {
    expect(slotted(0).dailyAiCallLimit).toBe(0);
    expect(slotted(-3).dailyAiBudgetUsd).toBe(0);
  });

  it('aiModel/aiMode: managed with a slot or trial turns, script otherwise; budget view reports the trade bonus', () => {
    const cadet = evaluatePerks(input({ stakeNear: 0 }));
    expect([cadet.aiModel, cadet.aiMode]).toEqual([SCRIPT_AI_MODEL, 'script']);
    const usage = { ...EMPTY_AI_USAGE, freeTrialTurnsRemaining: 3, trialEligible: true };
    const trial = evaluatePerks(input({ stakeNear: 0, usage }));
    expect([trial.aiModel, trial.aiMode, trial.freeTrialTurnsRemaining]).toEqual([MANAGED_AI_MODEL, 'trial', 3]);
    const tee = evaluatePerks(input({ stakeNear: 50, usage: { ...usage, dailyCallsUsed: 7, activeAiColonySlots: 2 } }));
    expect([tee.aiModel, tee.aiMode, tee.dailyAiCallsUsed, tee.activeAiColonySlots]).toEqual([MANAGED_AI_MODEL, 'tee', 7, 2]);
    const view = buildAiBudgetView(
      evaluatePerks(input({ stakeNear: 50, dailyProtocolTradeFeeUsd: 1 })),
      { ...usage, dailyUsdUsed: 0.01 },
      4,
    );
    expect(view.tradeBonusCalls).toBeGreaterThan(0);
    expect(view.freeTrialTurnsTotal).toBe(STAKING_RULES.freeTrialTurns);
    expect(view.colonySlotsMax).toBe(3);
    expect(view.dailyBudgetUsedUsd).toBe(0.01);
  });
});

describe('W28-03 wave fencing: W28 off is the W20 ladder', () => {
  const legacy = (stake: number | string, env: Record<string, string> = {}, standard?: number) =>
    buildStakerPerksFromYocto(near(stake), { env, w28: false, standardPlatformFeeBp: standard, stakedSinceMs: NOW, nowMs: NOW });

  it('50 bp at >= 10 NEAR, 100 bp below, no deep tiers and no slots beyond Tier 1', () => {
    expect(legacy(9.9).platformFeeBp).toBe(100);
    expect(legacy(10).platformFeeBp).toBe(50);
    const whale = legacy(5000);
    expect(whale.platformFeeBp).toBe(50);
    expect(whale.tier).toBe(1);
    expect(whale.maxAiColonySlots).toBe(1);
    expect(whale.feeWarmupReadyAtMs).toBeNull();
  });

  it('keeps the env-driven ladder: NEAR_STAKER_PLATFORM_FEE_BP, NEAR_STAKER_MIN_NEAR, half-of-standard default', () => {
    expect(legacy(20, { NEAR_STAKER_MIN_NEAR: '20', NEAR_STAKER_PLATFORM_FEE_BP: '33' }).platformFeeBp).toBe(33);
    expect(legacy(19.99, { NEAR_STAKER_MIN_NEAR: '20' }).active).toBe(false);
    expect(legacy(10, {}, 80).platformFeeBp).toBe(40);
  });

  it('isW28Enabled reads TA_WAVES: ..27 off, all and ..28 on, explicit flag wins', () => {
    expect(isW28Enabled({ TA_WAVES: '..27' })).toBe(false);
    expect(isW28Enabled({ TA_WAVES: 'all' })).toBe(true);
    expect(isW28Enabled({ TA_WAVES: '..28' })).toBe(true);
    expect(isW28Enabled({ TA_WAVES: '..27' }, true)).toBe(true);
    expect(buildStakerPerksFromYocto(near(10), { env: { TA_WAVES: '..27' } }).platformFeeBp).toBe(50);
    expect(buildStakerPerksFromYocto(near(10), { env: { TA_WAVES: 'all' } }).platformFeeBp).toBe(65);
  });
});

describe('W28-03 splitPlatformFee', () => {
  it('without a patron: 80 % Protocol / 20 % DAO', () => {
    expect(splitPlatformFee(10_000n, { daoShareBp: 2_000, patronActive: false })).toEqual({ protocol: 8_000n, dao: 2_000n, patron: 0n });
  });

  it('with a patron: 12 % of gross to the patron, 68 % Protocol, 20 % DAO', () => {
    expect(splitPlatformFee(10_000n, { daoShareBp: 2_000, patronActive: true })).toEqual({ protocol: 6_800n, dao: 2_000n, patron: 1_200n });
  });

  it('never loses an atomic unit to rounding, for any gross and share', () => {
    for (const gross of [0n, 1n, 2n, 7n, 99n, 101n, 12_345_679n, 10n ** 30n + 7n]) {
      for (const daoShareBp of [0, 1, 2_000, 2_500, 9_999, 10_000]) {
        for (const patronActive of [false, true]) {
          const s = splitPlatformFee(gross, { daoShareBp, patronActive });
          expect(s.protocol + s.dao + s.patron).toBe(gross);
          expect(s.protocol >= 0n && s.dao >= 0n && s.patron >= 0n).toBe(true);
        }
      }
    }
  });

  it('clamps nonsense: negative gross is zero, out-of-range shares are clamped', () => {
    expect(splitPlatformFee(-5n, { daoShareBp: 2_000, patronActive: true })).toEqual({ protocol: 0n, dao: 0n, patron: 0n });
    const s = splitPlatformFee(100n, { daoShareBp: 99_999, patronActive: true });
    expect(s).toEqual({ protocol: 0n, dao: 100n, patron: 0n });
  });
});
