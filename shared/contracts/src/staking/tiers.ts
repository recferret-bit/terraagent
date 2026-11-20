import { z } from 'zod';

/**
 * W28 4-Tier Orbital Patronage ladder (NEAR_STAKING_SPEC §1, §3). This is the ONE data table every surface reads:
 * the backend perks engine (`staker-perks.ts`), the market fee hook, the `/landing.html#economics` calculator, the
 * `/me.html#staking` matrix and the `/trade.html` fee pill. Balance numbers live here only (D-35).
 *
 * Staking never enters `@terra/sim` (D-31, zero P2W): these perks are fees, AI budget, relayer gas and cosmetics.
 */

export const STAKING_TIER_IDS = [0, 1, 2, 3, 4] as const;
export const StakingTierId = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type StakingTierId = z.infer<typeof StakingTierId>;

export const STAKING_TIER_KEYS = ['cadet', 'scout', 'commander', 'archon', 'patron'] as const;
export const StakingTierKey = z.enum(STAKING_TIER_KEYS);
export type StakingTierKey = z.infer<typeof StakingTierKey>;

/** The only model managed (protocol-paid) tiers run on; heavier models are BYOK-only (`/me.html`). */
export const MANAGED_AI_MODEL = 'z-ai/glm-5.3-flash' as const;
/** The free scripted fallback once trial / budget / slots run out. */
export const SCRIPT_AI_MODEL = 'deterministic-policy' as const;

export const StakingTierRow = z.strictObject({
  id: StakingTierId,
  key: StakingTierKey,
  name: z.string().min(1).max(40),
  /** Minimum ACTIVE stake (unbonding excluded) in whole NEAR. */
  minStakeNear: z.number().nonnegative(),
  /** Market taker fee once the tier is fully active (after warmup when `warmupRequired`). */
  takerFeeBp: z.number().int().nonnegative().max(1_000),
  /** Deeper fee cut needs `FEE_WARMUP_MS` of continuous stake; until then the Tier-1 fee applies. */
  warmupRequired: z.boolean(),
  /** Concurrent managed `NEAR.AI` TEE colony slots, wallet-wide. */
  aiColonySlots: z.number().int().nonnegative(),
  /** Managed AI sweep cadence, seconds. */
  sweepSeconds: z.number().int().positive(),
  /** Wallet-wide `NEP-366` gasless relayer quota multiplier (shared across colonies, never per colony). */
  gasMultiplier: z.number().positive(),
  botKeys: z.number().int().nonnegative(),
  /** Early NPC Guild ship radar lead time, ms (`5 min` from Tier 2). */
  guildRadarLeadMs: z.number().int().nonnegative(),
  /** Planet DAO vote weight, basis points of 1 vote (`15000` = `1.5x` from Tier 3). */
  daoVoteWeightBp: z.number().int().positive(),
  /** Extra Trade Hub stall royalty cap on top of the base cap (`+25 bp` from Tier 3). */
  stallRoyaltyBonusBp: z.number().int().nonnegative(),
  /** May compete for the King-of-the-Hill Lead Planetary Patron seat. */
  patronEligible: z.boolean(),
  /** Rough managed AI calls per day at `$4/NEAR` before the trade bonus (display only; the cap is the USD budget). */
  approxDailyCalls: z.number().int().nonnegative(),
});
export type StakingTierRow = z.infer<typeof StakingTierRow>;

const row = (r: StakingTierRow): StakingTierRow => Object.freeze(r);

export const STAKING_TIERS: readonly StakingTierRow[] = Object.freeze([
  row({ id: 0, key: 'cadet', name: 'Cadet', minStakeNear: 0, takerFeeBp: 100, warmupRequired: false, aiColonySlots: 0, sweepSeconds: 180, gasMultiplier: 1, botKeys: 1, guildRadarLeadMs: 0, daoVoteWeightBp: 10_000, stallRoyaltyBonusBp: 0, patronEligible: false, approxDailyCalls: 0 }),
  row({ id: 1, key: 'scout', name: 'Scout', minStakeNear: 10, takerFeeBp: 65, warmupRequired: false, aiColonySlots: 1, sweepSeconds: 120, gasMultiplier: 2, botKeys: 1, guildRadarLeadMs: 0, daoVoteWeightBp: 10_000, stallRoyaltyBonusBp: 0, patronEligible: false, approxDailyCalls: 18 }),
  row({ id: 2, key: 'commander', name: 'Commander', minStakeNear: 50, takerFeeBp: 50, warmupRequired: true, aiColonySlots: 3, sweepSeconds: 60, gasMultiplier: 4, botKeys: 3, guildRadarLeadMs: 300_000, daoVoteWeightBp: 10_000, stallRoyaltyBonusBp: 0, patronEligible: false, approxDailyCalls: 90 }),
  row({ id: 3, key: 'archon', name: 'Archon', minStakeNear: 200, takerFeeBp: 35, warmupRequired: true, aiColonySlots: 6, sweepSeconds: 30, gasMultiplier: 8, botKeys: 3, guildRadarLeadMs: 300_000, daoVoteWeightBp: 15_000, stallRoyaltyBonusBp: 25, patronEligible: false, approxDailyCalls: 350 }),
  row({ id: 4, key: 'patron', name: 'Planetary Patron', minStakeNear: 500, takerFeeBp: 25, warmupRequired: true, aiColonySlots: 12, sweepSeconds: 30, gasMultiplier: 15, botKeys: 3, guildRadarLeadMs: 300_000, daoVoteWeightBp: 15_000, stallRoyaltyBonusBp: 25, patronEligible: true, approxDailyCalls: 900 }),
]);

/** Anti-snipe and economy constants (NEAR_STAKING_SPEC §1, §5). */
export const STAKING_RULES = Object.freeze({
  /** Continuous stake needed before the Tier 2–4 fee cuts apply. */
  feeWarmupMs: 86_400_000,
  /** Unstaking principal staked less than this long ago pays `earlyExitFeeBp` to `protocol.<root>`. */
  earlyExitWindowMs: 7 * 86_400_000,
  earlyExitFeeBp: 25,
  /** One-time managed TEE trial turns for a verified (`!isGuest`) pilot. */
  freeTrialTurns: 5,
  /** Daily managed AI cap = 35 % of (daily protocol yield USD + daily protocol trade-fee USD) → `≥ 65 %` margin. */
  aiBudgetCostShareBp: 3_500,
  /** Blended USD cost of one batched `glm-5.3-flash` TEE turn (`~18 calls/d` at Tier 1, `$4/NEAR`). */
  aiCostPerCallUsd: 0.0000375,
  /** Lead Patron share of the Protocol's trade-fee cut (`15 %` of `80 %` = `12 %` of gross). */
  patronProtocolFeeShareBp: 1_500,
  /** Simulated validator APY used on mock / testnet (badged `Sim APY`). */
  simGrossApyBp: 900,
  /** Protocol slice of validator yield (`20 %`); the pilot keeps `80 %`. */
  protocolYieldShareBp: 2_000,
  /** Fallback `NEAR/USD` when no live price is cached (badged `Est.`). */
  estNearUsd: 4,
  /** Default preview amount on `/me.html#staking` and the landing calculator. */
  defaultPreviewNear: 50,
  /** Landing calculator slider max (`0–500+`). */
  calculatorMaxNear: 500,
});

export const stakingTierRow = (id: StakingTierId): StakingTierRow => STAKING_TIERS[id]!;

/** Highest tier whose `minStakeNear` the ACTIVE stake (whole NEAR, unbonding excluded) reaches. */
export function stakingTierFor(activeStakedNear: number): StakingTierRow {
  const amount = Number.isFinite(activeStakedNear) ? activeStakedNear : 0;
  let best = STAKING_TIERS[0]!;
  for (const t of STAKING_TIERS) if (amount >= t.minStakeNear) best = t;
  return best;
}

const YOCTO_PER_NEAR = 10n ** 24n;

/** Same as `stakingTierFor`, exact on yocto (no float rounding at the thresholds). */
export function stakingTierForYocto(activeStakedYocto: bigint): StakingTierRow {
  let best = STAKING_TIERS[0]!;
  for (const t of STAKING_TIERS) if (activeStakedYocto >= BigInt(t.minStakeNear) * YOCTO_PER_NEAR) best = t;
  return best;
}

export interface EffectiveFeeInput {
  readonly tier: StakingTierRow;
  /** When the current continuous stake began (ms); `null` = not staked. */
  readonly stakedSinceMs: number | null;
  readonly nowMs: number;
}

export interface EffectiveFee {
  /** Tier whose fee actually applies (Tier 1 while a Tier 2–4 stake is still warming up). */
  readonly feeTier: StakingTierRow;
  readonly takerFeeBp: number;
  /** When the full tier fee unlocks; `null` when no warmup is pending. */
  readonly warmupReadyAtMs: number | null;
}

/** Anti-snipe fee rule: Tier 1's `65 bp` applies at `t=0`; Tier 2–4 cuts need `24h` of continuous stake. */
export function effectiveTakerFee({ tier, stakedSinceMs, nowMs }: EffectiveFeeInput): EffectiveFee {
  if (!tier.warmupRequired) return { feeTier: tier, takerFeeBp: tier.takerFeeBp, warmupReadyAtMs: null };
  const readyAt = (stakedSinceMs ?? nowMs) + STAKING_RULES.feeWarmupMs;
  if (stakedSinceMs !== null && nowMs >= readyAt) return { feeTier: tier, takerFeeBp: tier.takerFeeBp, warmupReadyAtMs: null };
  const t1 = STAKING_TIERS[1]!;
  return { feeTier: t1, takerFeeBp: t1.takerFeeBp, warmupReadyAtMs: readyAt };
}

/** `<7d` early-unstake fee in bp (`25`), `0` once the stake matured or when nothing was staked. */
export function earlyExitFeeBp(lastStakedAtMs: number | null, nowMs: number): number {
  if (lastStakedAtMs === null) return 0;
  return nowMs - lastStakedAtMs < STAKING_RULES.earlyExitWindowMs ? STAKING_RULES.earlyExitFeeBp : 0;
}

export interface AiBudgetInput {
  readonly activeStakedNear: number;
  readonly nearUsd: number;
  readonly grossApyBp: number;
  /** Protocol's trade-fee income from this wallet today, USD (the "trade bonus"). */
  readonly dailyProtocolTradeFeeUsd: number;
}

/**
 * Wallet-wide daily managed AI cap in USD: `0.35 × (daily protocol yield USD + daily protocol trade-fee USD)`.
 * Scales with live `NEAR/USD`, so inference never costs more than 35 % of what the wallet earns the protocol.
 */
export function dailyAiBudgetUsd(input: AiBudgetInput): number {
  const stake = Math.max(0, input.activeStakedNear);
  const price = Math.max(0, input.nearUsd);
  const dailyProtocolYieldUsd = (stake * price * input.grossApyBp * STAKING_RULES.protocolYieldShareBp) / (10_000 * 10_000 * 365);
  const fees = Math.max(0, input.dailyProtocolTradeFeeUsd);
  return ((dailyProtocolYieldUsd + fees) * STAKING_RULES.aiBudgetCostShareBp) / 10_000;
}

/** Whole managed calls a daily USD budget buys (`floor(budget / aiCostPerCallUsd)`). */
export const dailyAiCallLimit = (budgetUsd: number): number =>
  budgetUsd > 0 ? Math.floor(budgetUsd / STAKING_RULES.aiCostPerCallUsd + 1e-9) : 0;

/** The next tier above `tier`, or `null` at Tier 4. */
export const nextStakingTier = (tier: StakingTierRow): StakingTierRow | null => STAKING_TIERS[tier.id + 1] ?? null;
