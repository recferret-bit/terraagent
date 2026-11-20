import type { PerformancePoint, PerformanceWindow } from '@terra/contracts';
import { YEAR_MS } from './income-math.js';

export const WINDOW_MS: Readonly<Record<PerformanceWindow, number>> = Object.freeze({
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
  '1y': YEAR_MS,
});

export const MAX_REALIZED_POINTS = 48;
export const PROJECTED_STEPS = 12;

/** One realized income event (yield compounded, non-self fee saving / royalty, patron payout), valued in NEAR. */
export interface IncomeEvent {
  readonly tMs: number;
  readonly valueNear: number;
}

export interface SeriesInput {
  readonly window: PerformanceWindow;
  readonly nowMs: number;
  readonly events: readonly IncomeEvent[];
  /** Staked value now in NEAR; compounds at `netApyBp` in the projection. */
  readonly stakedNear: number;
  readonly netApyBp: number;
  /** Non-self fee savings + royalties + patron, annualized, NEAR (added linearly to the projection). */
  readonly extraNearPerYear: number;
}

const ok = (n: number): boolean => Number.isFinite(n) && n >= 0;

/**
 * Cumulative value over the trailing window: realized points (downsampled to `MAX_REALIZED_POINTS`) from
 * `now - window` to `now`, then `PROJECTED_STEPS` projected points to `now + window` (continuous compounding of the
 * stake plus linear extras). Always `>= 2 + PROJECTED_STEPS` points with non-decreasing time and value.
 */
export function buildSeries(i: SeriesInput): { window: PerformanceWindow; points: PerformancePoint[] } {
  const windowMs = WINDOW_MS[i.window];
  const startMs = i.nowMs - windowMs;
  const events = i.events
    .filter((e) => ok(e.valueNear) && Number.isFinite(e.tMs) && e.tMs >= startMs && e.tMs <= i.nowMs)
    .sort((a, b) => a.tMs - b.tMs);

  const bucketMs = windowMs / MAX_REALIZED_POINTS;
  const realized: PerformancePoint[] = [{ tMs: Math.floor(startMs), valueNear: 0, kind: 'realized' }];
  let total = 0;
  let lastBucket = -1;
  for (const e of events) {
    total += e.valueNear;
    const bucket = Math.floor((e.tMs - startMs) / bucketMs);
    const point: PerformancePoint = { tMs: Math.floor(e.tMs), valueNear: total, kind: 'realized' };
    if (bucket === lastBucket) realized[realized.length - 1] = point;
    else realized.push(point);
    lastBucket = bucket;
  }
  const nowMs = Math.floor(i.nowMs);
  const last = realized[realized.length - 1]!;
  if (last.tMs === nowMs) realized[realized.length - 1] = { ...last, valueNear: total };
  else realized.push({ tMs: nowMs, valueNear: total, kind: 'realized' });

  const stake = ok(i.stakedNear) ? i.stakedNear : 0;
  const rate = ok(i.netApyBp) ? i.netApyBp / 10_000 : 0;
  const extra = ok(i.extraNearPerYear) ? i.extraNearPerYear : 0;
  const projected: PerformancePoint[] = [];
  for (let s = 1; s <= PROJECTED_STEPS; s++) {
    const dt = (windowMs * s) / PROJECTED_STEPS;
    const years = dt / YEAR_MS;
    const gain = stake * (Math.exp(rate * years) - 1) + extra * years;
    projected.push({ tMs: Math.floor(i.nowMs + dt), valueNear: total + gain, kind: 'projected' });
  }
  return { window: i.window, points: [...realized, ...projected] };
}
