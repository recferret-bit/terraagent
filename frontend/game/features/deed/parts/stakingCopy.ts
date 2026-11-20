import {
  earlyExitFeeBp,
  STAKING_RULES,
  STAKING_TIERS,
  type EvaluatedStakerPerksV2,
  type StakerPerksInfo,
  type StakingPositionDto,
} from '@terra/contracts';

/** W20 copy: shown unchanged whenever the `W28` wave flag is off. */
export const REAL_NEAR_COPY =
  'Real NEAR from your wallet — not game currency, no in-game bonus';

/** W28 copy: the real perks, from `STAKING_TIERS` (D-35), and an explicit zero-P2W promise. */
export function realNearCopyW28(): string {
  const paying = STAKING_TIERS.filter((t) => t.id > 0);
  const first = paying[0]!;
  const last = paying[paying.length - 1]!;
  const fees = `${first.takerFeeBp}→${last.takerFeeBp} bp market fees`;
  return `Real NEAR from your wallet — 100 % principal back + APY. From ${first.minStakeNear} NEAR it unlocks lower market fees (${fees}), managed NEAR.AI slots and cosmetic prestige. Never game power.`;
}

export function stakingCopyFor(w28: boolean): string {
  return w28 ? realNearCopyW28() : REAL_NEAR_COPY;
}

const MS_PER_DAY = 86_400_000;

export function isV2Perks(perks: StakerPerksInfo | null | undefined): perks is EvaluatedStakerPerksV2 {
  return Boolean(perks) && (perks as { version?: unknown }).version === 2;
}

/** Early-exit fee an unstake would pay now: perks V2 when present, else derived from the position clock. */
export function pendingEarlyExitBp(
  pos: StakingPositionDto | null,
  perks: StakerPerksInfo | null | undefined,
  nowMs: number,
): number {
  if (!pos || Number(pos.staked || '0') <= 0) return 0;
  if (isV2Perks(perks)) return perks.earlyExitFeeBp;
  return earlyExitFeeBp(pos.lastStakedAtMs ?? null, nowMs);
}

/** `<7d` notice text; empty string when unstaking is free. */
export function formatEarlyExitNotice(feeBp: number, lastStakedAtMs: number | null | undefined, nowMs: number): string {
  if (feeBp <= 0) return '';
  const freeAt = lastStakedAtMs != null ? lastStakedAtMs + STAKING_RULES.earlyExitWindowMs : null;
  const days = freeAt === null ? null : Math.max(1, Math.ceil((freeAt - nowMs) / MS_PER_DAY));
  const when = days === null ? 'within 7 days of your last deposit' : `for ${days} more day${days === 1 ? '' : 's'}`;
  return `Early exit: unstaking ${when} pays a ${feeBp} bp (${(feeBp / 100).toFixed(2)} %) fee to the TerraAgent Protocol. Free after 7 days; compounding never resets the clock.`;
}

/** Effective fee tier line from perks V2 (`''` for W20 perks). */
export function formatTierFeeLine(perks: StakerPerksInfo | null | undefined, nowMs: number): string {
  if (!isV2Perks(perks)) return '';
  const feeTier = STAKING_TIERS[perks.feeTier]!;
  const base = `Tier ${perks.tierName}: ${feeTier.takerFeeBp} bp market fee`;
  if (perks.feeWarmupReadyAtMs === null) return base;
  const hours = Math.max(1, Math.ceil((perks.feeWarmupReadyAtMs - nowMs) / 3_600_000));
  return `${base} now, full ${perks.tierName} fee in ${hours} h`;
}
