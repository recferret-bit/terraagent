// Pure math for the #economics staking calculator and the nav pill. Every balance number comes from the W28 data table
// (`STAKING_TIERS` / `STAKING_RULES`); nothing here hardcodes a fee, threshold or APY.
import { STAKING_RULES, STAKING_TIERS, stakingTierFor, type StakingTierRow } from '@terra/contracts/staking/tiers';

const BP = 10_000;
const HOUR_MS = 3_600_000;

/** Whole NEAR in `0..calculatorMaxNear`; NaN / negative / non-finite collapse to 0, larger values clamp to the max. */
export function clampStake(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? STAKING_RULES.calculatorMaxNear : 0;
  return Math.min(STAKING_RULES.calculatorMaxNear, Math.max(0, Math.floor(value)));
}

/** Net APY in bp after the Protocol's yield slice: `gross × (1 − protocolYieldShareBp)`. */
export const netApyBpFrom = (grossBp: number, protocolShareBp: number): number =>
  Math.round((grossBp * (BP - protocolShareBp)) / BP);

export interface PillApy { readonly netApyBp: number; readonly source: 'live' | 'sim' }
export interface OverviewApyDetails extends PillApy { readonly grossApyBp: number }

/** The simulated APY shown when the overview endpoint is missing or unreachable. */
export const fallbackApy = (): PillApy => ({
  netApyBp: netApyBpFrom(STAKING_RULES.simGrossApyBp, STAKING_RULES.protocolYieldShareBp),
  source: 'sim',
});

export const fallbackApyDetails = (): OverviewApyDetails => ({
  ...fallbackApy(),
  grossApyBp: STAKING_RULES.simGrossApyBp,
});

/** Reads `apy` from a `StakingOverviewResponse`-shaped payload; anything malformed yields the sim fallback. */
export function parseOverviewApy(payload: unknown): PillApy {
  const apy = (payload as { apy?: { netApyBp?: unknown; source?: unknown } } | null)?.apy;
  const net = apy?.netApyBp;
  if (typeof net !== 'number' || !Number.isFinite(net) || net < 0) return fallbackApy();
  return { netApyBp: net, source: apy?.source === 'live' ? 'live' : 'sim' };
}

/** Reads `netApyBp`, `grossApyBp`, and `source` for the calculator, deriving gross APY cleanly when omitted. */
export function parseOverviewApyDetails(payload: unknown): OverviewApyDetails {
  const pill = parseOverviewApy(payload);
  const apy = (payload as { apy?: { grossApyBp?: unknown; protocolYieldShareBp?: unknown } } | null)?.apy;
  const rawGross = apy?.grossApyBp;
  if (typeof rawGross === 'number' && Number.isFinite(rawGross) && rawGross >= pill.netApyBp) {
    return { ...pill, grossApyBp: rawGross };
  }
  const shareRaw = apy?.protocolYieldShareBp;
  const shareBp = typeof shareRaw === 'number' && Number.isFinite(shareRaw) && shareRaw >= 0 && shareRaw < BP ? shareRaw : STAKING_RULES.protocolYieldShareBp;
  const derivedGross = Math.round((pill.netApyBp * BP) / Math.max(1, BP - shareBp));
  return { ...pill, grossApyBp: pill.source === 'sim' && typeof rawGross !== 'number' ? Math.max(pill.netApyBp, derivedGross) : derivedGross };
}

export const formatApy = (bp: number): string => `${(bp / 100).toFixed(2)}%`;

/** Pill badge text: `7.20% SIM APY` for simulated yield, `7.20% APY` for live validator yield. */
export const pillBadge = (apy: PillApy): string => `${formatApy(apy.netApyBp)} ${apy.source === 'sim' ? 'SIM APY' : 'APY'}`;

export interface StakeQuote {
  readonly stake: number;
  readonly tier: StakingTierRow;
  readonly nextTier: StakingTierRow | null;
  readonly standardFeeBp: number;
  /** Fee once the (24h for Tier 2–4) warmup is done. */
  readonly feeBp: number;
  readonly warmupHours: number | null;
  readonly feeSavedUsdc: number;
  readonly netYieldNear: number;
  readonly protocolYieldNear: number;
}

export function quoteStake(rawStake: number, monthlyVolumeUsdc: number, netBp: number, grossBp: number): StakeQuote {
  const stake = clampStake(rawStake);
  const tier = stakingTierFor(stake);
  const base = STAKING_TIERS[0]!;
  const volume = Number.isFinite(monthlyVolumeUsdc) ? Math.max(0, monthlyVolumeUsdc) : 0;
  return {
    stake,
    tier,
    nextTier: STAKING_TIERS[tier.id + 1] ?? null,
    standardFeeBp: base.takerFeeBp,
    feeBp: tier.takerFeeBp,
    warmupHours: tier.warmupRequired ? STAKING_RULES.feeWarmupMs / HOUR_MS : null,
    feeSavedUsdc: (volume * (base.takerFeeBp - tier.takerFeeBp)) / BP,
    netYieldNear: (stake * netBp) / BP,
    protocolYieldNear: (stake * (grossBp - netBp)) / BP,
  };
}

export interface StakeCta { readonly amount: number; readonly tierId: number; readonly label: string; readonly href: string }

/**
 * Primary CTA. The amount is the slider value; below the first threshold (incl. 0) it offers the smallest stake that
 * unlocks Tier 1 (`STAKING_TIERS[1].minStakeNear`), so the button never promises a tier the amount does not buy.
 */
export function stakeCta(rawStake: number): StakeCta {
  const stake = clampStake(rawStake);
  const entry = STAKING_TIERS[1]!;
  const amount = Math.max(stake, entry.minStakeNear);
  const tierId = stakingTierFor(amount).id;
  return { amount, tierId, label: `STAKE ${amount} NEAR · UNLOCK TIER ${tierId} →`, href: `/me.html#staking?amount=${amount}` };
}

/** Tier markers (`id >= 1`) as slider positions in percent. */
export const tierMarkers = (): { id: number; name: string; minNear: number; leftPct: number }[] =>
  STAKING_TIERS.filter((t) => t.id >= 1).map((t) => ({
    id: t.id, name: t.name, minNear: t.minStakeNear, leftPct: (t.minStakeNear / STAKING_RULES.calculatorMaxNear) * 100,
  }));
