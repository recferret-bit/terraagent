import { z } from 'zod';
import { StakerPerksInfo } from './core';
import { StakingTierId, StakingTierKey } from './tiers';

/** How a colony's Director runs right now (W28 §1 5-turn trial → Script AI, or managed TEE, or BYOK). */
export const AI_ACCESS_MODES = ['trial', 'tee', 'script', 'byok'] as const;
export const AiAccessMode = z.enum(AI_ACCESS_MODES);
export type AiAccessMode = z.infer<typeof AiAccessMode>;

/**
 * Why a colony's Director runs on the rule-based policy (`deterministic-policy`) right now. `provider_*`: the NEAR AI
 * provider refused the key (`unfunded` = no balance, `unauthorized` = key rejected) or is down / rate-limited
 * (`unavailable`); with mode `byok` they describe the player's own key. `planet_idle`: no human on the planet for 24 h.
 */
export const AI_DOWNSHIFT_REASONS = [
  'guest',
  'no_stake',
  'budget_exhausted',
  'slot_cap',
  'trial_exhausted',
  'no_database',
  'provider_unfunded',
  'provider_unauthorized',
  'provider_unavailable',
  'planet_idle',
] as const;
export const AiDownshiftReason = z.enum(AI_DOWNSHIFT_REASONS);
export type AiDownshiftReason = z.infer<typeof AiDownshiftReason>;

/** Wallet-wide managed AI allowance (shared across every colony of the wallet; never multiplied per colony). */
export const AiBudgetView = z.strictObject({
  model: z.string().min(1).max(80),
  mode: AiAccessMode,
  /** Set when the Director runs on rules (or a BYOK key is refused); absent while AI decisions run normally. */
  downshiftReason: AiDownshiftReason.optional(),
  dailyBudgetUsd: z.number().nonnegative(),
  dailyBudgetUsedUsd: z.number().nonnegative(),
  dailyCallLimit: z.number().int().nonnegative(),
  dailyCallsUsed: z.number().int().nonnegative(),
  /** Extra calls unlocked today by the wallet's protocol trade fees. */
  tradeBonusCalls: z.number().int().nonnegative(),
  freeTrialTurnsRemaining: z.number().int().nonnegative(),
  freeTrialTurnsTotal: z.number().int().nonnegative(),
  /** `false` for anonymous guests (no trial, anti bot farming). */
  trialEligible: z.boolean(),
  colonySlotsUsed: z.number().int().nonnegative(),
  colonySlotsMax: z.number().int().nonnegative(),
});
export type AiBudgetView = z.infer<typeof AiBudgetView>;

/**
 * W28 perks (extends the W20 `StakerPerksInfo`, so every V1 field keeps its meaning; `platformFeeBp` is now the
 * effective taker fee after the `24h` warmup rule).
 */
export const EvaluatedStakerPerksV2 = StakerPerksInfo.extend({
  version: z.literal(2),
  tier: StakingTierId,
  tierKey: StakingTierKey,
  tierName: z.string().min(1).max(40),
  /** Tier whose fee applies now (Tier 1 while a Tier 2–4 stake is in warmup). */
  feeTier: StakingTierId,
  activeStakedNear: z.string(),
  unbondingNear: z.string(),
  aiModel: z.string().min(1).max(80),
  aiMode: AiAccessMode,
  maxAiColonySlots: z.number().int().nonnegative(),
  activeAiColonySlots: z.number().int().nonnegative(),
  dailyAiCallLimit: z.number().int().nonnegative(),
  dailyAiCallsUsed: z.number().int().nonnegative(),
  dailyAiBudgetUsd: z.number().nonnegative(),
  freeTrialTurnsRemaining: z.number().int().nonnegative(),
  /** When the Tier 2–4 fee unlocks; `null` = no warmup pending. */
  feeWarmupReadyAtMs: z.number().int().nonnegative().nullable(),
  /** Fee an unstake would pay right now (`25` within 7 days of the last deposit, else `0`). */
  earlyExitFeeBp: z.number().int().nonnegative(),
  /** When unstaking becomes free; `null` = already free / nothing staked. */
  earlyExitFreeAtMs: z.number().int().nonnegative().nullable(),
  stakedSinceMs: z.number().int().nonnegative().nullable(),
  gasMultiplier: z.number().positive(),
  sweepSeconds: z.number().int().positive(),
  botKeys: z.number().int().nonnegative(),
  guildRadarLeadMs: z.number().int().nonnegative(),
  daoVoteWeightBp: z.number().int().positive(),
  stallRoyaltyBonusBp: z.number().int().nonnegative(),
  /** Planets on which this wallet is the King-of-the-Hill Lead Patron. */
  leadPatronPlanetIds: z.array(z.string().min(1).max(80)),
  /** Stake needed for the next tier, whole NEAR; `null` at Tier 4. */
  nextTierMinNear: z.number().nonnegative().nullable(),
});
export type EvaluatedStakerPerksV2 = z.infer<typeof EvaluatedStakerPerksV2>;

/** `GET /v1/near/staking/perks?accountId=…|colonyId=…` (HUD pills, `DirectorPanel`, `/trade.html` fee pill). */
export const StakerPerksResponse = z.strictObject({
  accountId: z.string().min(2).max(64).nullable(),
  perks: EvaluatedStakerPerksV2,
  aiBudget: AiBudgetView,
});
export type StakerPerksResponse = z.infer<typeof StakerPerksResponse>;
