import { getStageSpec } from '../../data';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import { resolveCompiledStageRow } from './triggers';

/**
 * Canonical minimum dwell durations in seconds for stages S1..S4 (`UO-LC-02`).
 * - S1: 60 s (1 min)
 * - S2: 120 s (2 min)
 * - S3: 180 s (3 min)
 * - S4: 180 s (3 min)
 */
export const STAGE_DWELL_SECONDS: Readonly<Record<number, number>> = Object.freeze({
  1: 60,
  2: 120,
  3: 180,
  4: 180,
});

/**
 * Canonical minimum dwell durations in simulation ticks at standard 5 TPS (`TICKS_PER_SECOND = 5`).
 */
export const STAGE_DWELL_TICKS: Readonly<Record<number, number>> = Object.freeze({
  1: 60 * TICKS_PER_SECOND,
  2: 120 * TICKS_PER_SECOND,
  3: 180 * TICKS_PER_SECOND,
  4: 180 * TICKS_PER_SECOND,
});

/**
 * Converts remaining dwell ticks to remaining whole seconds (ceiled, non-negative).
 */
export function ticksToRemainingSeconds(ticks: number | null | undefined): number | null {
  if (ticks === null || ticks === undefined || !Number.isFinite(ticks)) return null;
  return Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
}

/**
 * Returns canonical dwell duration in ticks for `stage`.
 * Consults compiled data table if provided, then fallback stage specs, then `STAGE_DWELL_SECONDS`.
 */
export function getStageDwellTicks(stage: number, data?: CompiledDataLike): number {
  const row = resolveCompiledStageRow(stage, data);
  if (row && typeof row.dwellS === 'number') {
    return row.dwellS;
  }
  const spec = getStageSpec(stage);
  if (spec && typeof spec.dwellS === 'number') {
    return Math.round(spec.dwellS * TICKS_PER_SECOND);
  }
  const fromMap = STAGE_DWELL_SECONDS[stage];
  if (typeof fromMap === 'number') {
    return Math.round(fromMap * TICKS_PER_SECOND);
  }
  return 0;
}

/**
 * Decrements `dwellRemainingTicks` by `dtTicks`, clamping at 0.
 * Preserves `null` when no dwell timer is active.
 */
export function stepDwellTimer(dwellRemainingTicks: number, dtTicks: number): number;
export function stepDwellTimer(dwellRemainingTicks: number | null, dtTicks: number): number | null;
export function stepDwellTimer(
  dwellRemainingTicks: number | null | undefined,
  dtTicks: number,
): number | null {
  if (dwellRemainingTicks === null || dwellRemainingTicks === undefined) {
    return null;
  }
  return Math.max(0, dwellRemainingTicks - Math.max(0, dtTicks));
}

/**
 * Checks whether an active dwell timer has reached 0 ticks remaining.
 */
export function isDwellComplete(dwellRemainingTicks: number | null | undefined): boolean {
  return dwellRemainingTicks !== null && dwellRemainingTicks !== undefined && dwellRemainingTicks <= 0;
}

/**
 * Formats remaining dwell ticks (or seconds if `isSeconds = true`) into `M:SS` display format (e.g. 80s -> "1:20", 5s -> "0:05").
 */
export function formatDwellSeconds(
  dwellRemainingTicks: number | null | undefined,
  isSeconds = false,
): string {
  if (
    dwellRemainingTicks === null ||
    dwellRemainingTicks === undefined ||
    !Number.isFinite(dwellRemainingTicks) ||
    dwellRemainingTicks <= 0
  ) {
    return '0:00';
  }
  const totalSeconds = isSeconds
    ? Math.max(0, Math.ceil(dwellRemainingTicks))
    : Math.max(0, Math.ceil(dwellRemainingTicks / TICKS_PER_SECOND));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
