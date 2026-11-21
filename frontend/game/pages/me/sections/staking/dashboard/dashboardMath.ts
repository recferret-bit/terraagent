// Pure helpers of the Wealth Dashboard (ticker, top-up, early-exit preview, chart path, countdowns). No DOM, no clock:
// callers pass `nowMs`. Balance numbers come from the server payload / data table, never from literals (D-35).
import type { PerformancePoint, StakingPerformanceResponse } from '@terra/contracts';

const BP = 10_000;
const SECONDS_PER_YEAR = 365 * 86_400;
const num = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Native active stake plus the NEAR value of every liquid-staking position. */
export function totalStakedNear(b: StakingPerformanceResponse['balances']): number {
  return num(b.activeStakedNear) + b.lst.reduce((sum, l) => sum + num(l.nearValue), 0);
}

export const lstNearValue = (b: StakingPerformanceResponse['balances']): number => b.lst.reduce((s, l) => s + num(l.nearValue), 0);

/** NEAR accrued per second at the net APY (client-side ticker only; the server number is authoritative on refetch). */
export function yieldPerSecondNear(totalNear: number, netApyBp: number): number {
  if (!(totalNear > 0) || !(netApyBp > 0)) return 0;
  return (totalNear * netApyBp) / BP / SECONDS_PER_YEAR;
}

/** Accrued yield shown by the live counter `elapsedMs` after the snapshot. Never decreases, never NaN. */
export function tickedYieldNear(baseNear: number, perSecond: number, elapsedMs: number): number {
  const base = Number.isFinite(baseNear) ? Math.max(0, baseNear) : 0;
  return base + perSecond * Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000;
}

/** Counter text with 9 decimals so the per-second accrual is visible even for small stakes. */
export const formatMicroNear = (n: number): string => (Number.isFinite(n) ? n : 0).toFixed(9);

/** Amount that lifts the stake to the next tier minimum (rounded up to 4 decimals); `null` at the top tier. */
export function topUpAmountNear(totalNear: number, nextTierMinNear: number | null): number | null {
  if (nextTierMinNear === null) return null;
  const diff = Math.max(0, nextTierMinNear - Math.max(0, totalNear));
  return Math.ceil(diff * 10_000) / 10_000;
}

/** Early-exit fee an unstake of `amountNear` would pay at `feeBp` (0 after the 7-day window). */
export function earlyExitFeeNear(amountNear: number, feeBp: number): number {
  if (!(amountNear > 0) || !(feeBp > 0)) return 0;
  return (amountNear * feeBp) / BP;
}

/** Progress (0..1) toward the next tier minimum; 1 at the top tier. */
export function tierProgress(totalNear: number, nextTierMinNear: number | null): number {
  if (nextTierMinNear === null) return 1;
  if (!(nextTierMinNear > 0)) return 1;
  return Math.min(1, Math.max(0, totalNear / nextTierMinNear));
}

/** `3d 4h`, `4h 12m`, `12m 05s`, `45s`; `Ready` once the timestamp passed. */
export function formatCountdown(targetMs: number | null, nowMs: number): string {
  if (targetMs === null) return '—';
  const left = targetMs - nowMs;
  if (left <= 0) return 'Ready';
  const s = Math.ceil(left / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

export interface ChartGeometry {
  readonly width: number;
  readonly height: number;
  readonly padX: number;
  readonly padY: number;
}

export interface ChartPaths {
  readonly empty: boolean;
  readonly realizedD: string;
  readonly projectedD: string;
  /** Last realized point (the "now" marker), or the single point of a one-point series. */
  readonly nowMarker: { readonly x: number; readonly y: number } | null;
  readonly minValue: number;
  readonly maxValue: number;
  readonly startMs: number;
  readonly endMs: number;
}

const EMPTY_PATHS: ChartPaths = { empty: true, realizedD: '', projectedD: '', nowMarker: null, minValue: 0, maxValue: 0, startMs: 0, endMs: 0 };
const fmt = (n: number): string => n.toFixed(1);

/**
 * SVG path data for the hybrid chart: a solid path through the realized points and a dashed one through the projected
 * points that starts at the last realized point so the two join. Empty input yields `empty: true`; a single point yields
 * only the marker. Points are sorted by time; non-finite values are dropped.
 */
export function buildChartPaths(points: readonly PerformancePoint[], g: ChartGeometry): ChartPaths {
  const pts = points.filter((p) => Number.isFinite(p.tMs) && Number.isFinite(p.valueNear)).slice().sort((a, b) => a.tMs - b.tMs);
  if (pts.length === 0) return EMPTY_PATHS;
  const startMs = pts[0]!.tMs;
  const endMs = pts[pts.length - 1]!.tMs;
  const values = pts.map((p) => p.valueNear);
  let minValue = Math.min(0, ...values);
  let maxValue = Math.max(...values);
  if (maxValue - minValue < 1e-9) maxValue = minValue + 1;
  if (minValue === maxValue) minValue -= 1;
  const spanX = Math.max(1, endMs - startMs);
  const innerW = g.width - g.padX * 2;
  const innerH = g.height - g.padY * 2;
  const x = (t: number): number => (pts.length === 1 ? g.padX + innerW / 2 : g.padX + ((t - startMs) / spanX) * innerW);
  const y = (v: number): number => g.padY + innerH - ((v - minValue) / (maxValue - minValue)) * innerH;
  const toD = (list: readonly PerformancePoint[]): string =>
    list.length < 2 ? '' : list.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(x(p.tMs))} ${fmt(y(p.valueNear))}`).join(' ');
  const realized = pts.filter((p) => p.kind === 'realized');
  const projected = pts.filter((p) => p.kind === 'projected');
  const anchor = realized[realized.length - 1];
  const projectedWithAnchor = anchor ? [anchor, ...projected] : projected;
  const marker = anchor ?? pts[0]!;
  return {
    empty: false,
    realizedD: toD(realized),
    projectedD: toD(projectedWithAnchor),
    nowMarker: { x: x(marker.tMs), y: y(marker.valueNear) },
    minValue,
    maxValue,
    startMs,
    endMs,
  };
}
