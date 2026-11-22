import {
  dailyAiBudgetUsd,
  dailyAiCallLimit,
  earlyExitFeeBp,
  effectiveTakerFee,
  MANAGED_AI_MODEL,
  nextStakingTier,
  SCRIPT_AI_MODEL,
  STAKING_RULES,
  type AiAccessMode,
  type AiBudgetView,
  type EvaluatedStakerPerksV2,
} from '@terra/contracts';
import { yoctoToNear } from '../yocto.js';
import type { AiUsageSnapshot } from './ai-usage.reader.js';
import { tierForLadder, type PerkLadder } from './legacy-ladder.js';

export interface PerksEvalInput {
  readonly ladder: PerkLadder;
  readonly activeStakedYocto: bigint;
  readonly unbondingYocto: bigint;
  readonly stakedSinceMs: number | null;
  readonly lastStakedAtMs: number | null;
  readonly nowMs: number;
  readonly protocolAccountId: string;
  readonly nearUsd: number;
  /** Protocol trade-fee income from the wallet today, USD (the "trade bonus" on the AI cap). */
  readonly dailyProtocolTradeFeeUsd: number;
  readonly usage: AiUsageSnapshot;
  readonly leadPatronPlanetIds: readonly string[];
}

/** `EvaluatedStakerPerksV2` plus the exact stake the market and profile code compare against. */
export type EvaluatedPerks = EvaluatedStakerPerksV2 & {
  readonly totalStakedYocto: bigint;
  readonly stakedYocto: bigint;
};

const nearOf = (yocto: bigint): number => Number(yocto / 10n ** 18n) / 1_000_000;

/** Wallet-wide USD budget and call cap; `0` without a TEE slot (no managed AI to pay for). */
function aiAllowance(input: PerksEvalInput, slots: number): { budgetUsd: number; callLimit: number } {
  if (slots <= 0) return { budgetUsd: 0, callLimit: 0 };
  const budgetUsd = dailyAiBudgetUsd({
    activeStakedNear: nearOf(input.activeStakedYocto),
    nearUsd: input.nearUsd,
    grossApyBp: input.ladder.grossApyBp,
    dailyProtocolTradeFeeUsd: input.dailyProtocolTradeFeeUsd,
  });
  return { budgetUsd, callLimit: dailyAiCallLimit(budgetUsd) };
}

function aiAccess(slots: number, trialTurns: number): { aiModel: string; aiMode: AiAccessMode } {
  if (slots > 0) return { aiModel: MANAGED_AI_MODEL, aiMode: 'tee' };
  if (trialTurns > 0) return { aiModel: MANAGED_AI_MODEL, aiMode: 'trial' };
  return { aiModel: SCRIPT_AI_MODEL, aiMode: 'script' };
}

/**
 * The perks engine (pure): ACTIVE stake -> tier -> effective fee, wallet-shared quotas, AI allowance, stake clocks.
 * Quotas come straight from the tier row and are never multiplied per colony; the fee follows `effectiveTakerFee`
 * (Tier 1 `65 bp` instant, Tier 2-4 only after `24h` of continuous stake) and never exceeds the standard fee.
 */
export function evaluatePerks(input: PerksEvalInput): EvaluatedPerks {
  const { ladder, nowMs, usage } = input;
  const tier = tierForLadder(ladder, input.activeStakedYocto);
  const staked = input.activeStakedYocto > 0n;
  const warmupMs = ladder.feeWarmupMs ?? STAKING_RULES.feeWarmupMs;
  const exitWindowMs = ladder.earlyExitWindowMs ?? STAKING_RULES.earlyExitWindowMs;
  const fee = effectiveTakerFee({ tier, stakedSinceMs: staked ? input.stakedSinceMs : null, nowMs, feeWarmupMs: warmupMs });
  const platformFeeBp = tier.id === 0 ? ladder.standardPlatformFeeBp : Math.min(fee.takerFeeBp, ladder.standardPlatformFeeBp);
  const slots = tier.aiColonySlots;
  const { budgetUsd, callLimit } = aiAllowance(input, slots);
  const exitFee = staked ? earlyExitFeeBp(input.lastStakedAtMs, nowMs, exitWindowMs) : 0;
  const next = nextStakingTier(tier);
  const active = tier.id >= 1;
  return {
    version: 2,
    active,
    minStakeNear: ladder.minStakeNear,
    totalStakedNear: yoctoToNear(input.activeStakedYocto, 6),
    totalStakedYocto: input.activeStakedYocto,
    stakedYocto: input.activeStakedYocto,
    grossApyBp: ladder.grossApyBp,
    netApyBp: ladder.netApyBp,
    protocolYieldShareBp: ladder.protocolYieldShareBp,
    platformFeeBp,
    stakerPlatformFeeBp: ladder.w28 ? tier.takerFeeBp : (ladder.rows[1]?.takerFeeBp ?? tier.takerFeeBp),
    standardPlatformFeeBp: ladder.standardPlatformFeeBp,
    managedAutopilotUnlocked: active,
    protocolAccountId: input.protocolAccountId,
    tier: tier.id,
    tierKey: tier.key,
    tierName: tier.name,
    feeTier: fee.feeTier.id,
    activeStakedNear: yoctoToNear(input.activeStakedYocto, 6),
    unbondingNear: yoctoToNear(input.unbondingYocto, 6),
    ...aiAccess(slots, usage.freeTrialTurnsRemaining),
    maxAiColonySlots: slots,
    activeAiColonySlots: usage.activeAiColonySlots,
    dailyAiCallLimit: callLimit,
    dailyAiCallsUsed: usage.dailyCallsUsed,
    dailyAiBudgetUsd: budgetUsd,
    freeTrialTurnsRemaining: usage.freeTrialTurnsRemaining,
    feeWarmupReadyAtMs: staked ? fee.warmupReadyAtMs : null,
    earlyExitFeeBp: exitFee,
    earlyExitFreeAtMs: exitFee > 0 && input.lastStakedAtMs !== null ? input.lastStakedAtMs + exitWindowMs : null,
    stakedSinceMs: staked ? input.stakedSinceMs : null,
    gasMultiplier: tier.gasMultiplier,
    sweepSeconds: tier.sweepSeconds,
    botKeys: tier.botKeys,
    guildRadarLeadMs: tier.guildRadarLeadMs,
    daoVoteWeightBp: tier.daoVoteWeightBp,
    stallRoyaltyBonusBp: tier.stallRoyaltyBonusBp,
    leadPatronPlanetIds: [...input.leadPatronPlanetIds],
    nextTierMinNear: next ? next.minStakeNear : null,
  };
}

/** The wallet-wide AI allowance card (`GET /v1/near/staking/perks`). */
export function buildAiBudgetView(perks: EvaluatedStakerPerksV2, usage: AiUsageSnapshot, nearUsd: number): AiBudgetView {
  const baseBudget = dailyAiBudgetUsd({
    activeStakedNear: Number(perks.activeStakedNear),
    nearUsd,
    grossApyBp: perks.grossApyBp,
    dailyProtocolTradeFeeUsd: 0,
  });
  const baseCalls = perks.maxAiColonySlots > 0 ? dailyAiCallLimit(baseBudget) : 0;
  return {
    model: perks.aiModel,
    mode: perks.aiMode,
    dailyBudgetUsd: perks.dailyAiBudgetUsd,
    dailyBudgetUsedUsd: usage.dailyUsdUsed,
    dailyCallLimit: perks.dailyAiCallLimit,
    dailyCallsUsed: perks.dailyAiCallsUsed,
    tradeBonusCalls: Math.max(0, perks.dailyAiCallLimit - baseCalls),
    freeTrialTurnsRemaining: perks.freeTrialTurnsRemaining,
    freeTrialTurnsTotal: STAKING_RULES.freeTrialTurns,
    trialEligible: usage.trialEligible,
    colonySlotsUsed: perks.activeAiColonySlots,
    colonySlotsMax: perks.maxAiColonySlots,
  };
}
