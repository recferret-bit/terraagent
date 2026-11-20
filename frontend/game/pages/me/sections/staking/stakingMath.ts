// Pure staking-preview math and the local fallback overview. Every balance number comes from the W28 data table
// (`STAKING_TIERS` / `STAKING_RULES`); nothing here hardcodes a fee, threshold or APY (D-35).
import type { StakingOverviewResponse } from '@terra/contracts';
import { STAKING_RULES, STAKING_TIERS } from '@terra/contracts/staking/tiers';

const BP = 10_000;
const DAYS_PER_YEAR = 365;
const MONTHS_PER_YEAR = 12;

export type IncomeProjectionView = StakingOverviewResponse['projection'];

/** Net APY in bp after the Protocol's yield slice. */
export const netApyBp = (grossBp: number, protocolShareBp: number): number =>
  Math.round((grossBp * (BP - protocolShareBp)) / BP);

/** Simple (non-compounding) income: yearly = amount x net APY; daily = /365; monthly = /12. Bad input yields zeros. */
export function projectIncome(amountNear: number, netBp: number, nearUsd: number): IncomeProjectionView {
  const amount = Number.isFinite(amountNear) ? Math.max(0, amountNear) : 0;
  const bp = Number.isFinite(netBp) ? Math.max(0, netBp) : 0;
  const usd = Number.isFinite(nearUsd) ? Math.max(0, nearUsd) : 0;
  const yearlyNear = (amount * bp) / BP;
  const dailyNear = yearlyNear / DAYS_PER_YEAR;
  const monthlyNear = yearlyNear / MONTHS_PER_YEAR;
  return {
    amountNear: amount,
    dailyNear,
    monthlyNear,
    yearlyNear,
    dailyUsd: dailyNear * usd,
    monthlyUsd: monthlyNear * usd,
    yearlyUsd: yearlyNear * usd,
  };
}

/** Locally computed overview (`Est.` price, `Sim APY`, empty ecosystem) used when the endpoint is missing or fails. */
export function fallbackOverview(amountNear: number, nowMs: number = Date.now()): StakingOverviewResponse {
  const grossApyBp = STAKING_RULES.simGrossApyBp;
  const protocolYieldShareBp = STAKING_RULES.protocolYieldShareBp;
  const net = netApyBp(grossApyBp, protocolYieldShareBp);
  return {
    asOfMs: nowMs,
    network: 'mock',
    price: { nearUsd: STAKING_RULES.estNearUsd, source: 'est', asOfMs: nowMs },
    apy: { grossApyBp, netApyBp: net, protocolYieldShareBp, source: 'sim' },
    tiers: [...STAKING_TIERS],
    rules: {
      feeWarmupMs: STAKING_RULES.feeWarmupMs,
      earlyExitWindowMs: STAKING_RULES.earlyExitWindowMs,
      earlyExitFeeBp: STAKING_RULES.earlyExitFeeBp,
      freeTrialTurns: STAKING_RULES.freeTrialTurns,
      standardTakerFeeBp: STAKING_TIERS[0]!.takerFeeBp,
    },
    projection: projectIncome(amountNear, net, STAKING_RULES.estNearUsd),
    ecosystem: { totalNear: '0', entries: [] },
  };
}

/** Projection for `amount`: the server's own when it was computed for the same amount, else recomputed locally. */
export function projectionFor(ov: StakingOverviewResponse, amount: number): IncomeProjectionView {
  return ov.projection.amountNear === amount ? ov.projection : projectIncome(amount, ov.apy.netApyBp, ov.price.nearUsd);
}

export const formatPct = (bp: number): string => `${(bp / 100).toFixed(2)}%`;

export function formatNear(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const digits = n >= 100 ? 2 : n >= 1 ? 3 : 4;
  return `${n.toFixed(digits)} NEAR`;
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole-NEAR TVL (`12,345,678`); non-numeric input shows the dash. */
export function formatTvl(near: string): string {
  const n = Number(near);
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}
