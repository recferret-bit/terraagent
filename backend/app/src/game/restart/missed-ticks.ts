import { RESTART_FASTRUN_MAX_H } from '@terra/contracts';
import { COARSE_DT, TICK_MS, TICKS_PER_SECOND } from '@terra/sim';

/** Active-mode ticks in {@link RESTART_FASTRUN_MAX_H} wall hours (5 per second). */
export const RESTART_FASTRUN_MAX_TICKS = RESTART_FASTRUN_MAX_H * 3600 * TICKS_PER_SECOND;

export interface MissedRestartTicks {
  /** Whole coarse steps only. Never above {@link RESTART_FASTRUN_MAX_TICKS}. */
  readonly ticks: number;
  /** Wall gap was longer than 24 h; the extra time is not simulated (CT-51). */
  readonly capped: boolean;
}

/**
 * Wall gap `nowMs − savedAtMs` as missed active ticks (one tick per {@link TICK_MS}, 5 per wall second).
 * A non-positive gap is 0. Past 24 h is capped. The count is a multiple of coarse `dt` (5), so the
 * fast-run stays within one coarse step of the raw gap.
 */
export function missedRestartTicks(nowMs: number, savedAtMs: number): MissedRestartTicks {
  if (!Number.isFinite(nowMs) || !Number.isFinite(savedAtMs)) return { ticks: 0, capped: false };
  const gapMs = nowMs - savedAtMs;
  if (gapMs <= 0) return { ticks: 0, capped: false };
  const raw = Math.floor(gapMs / TICK_MS);
  const capped = raw > RESTART_FASTRUN_MAX_TICKS;
  const limited = capped ? RESTART_FASTRUN_MAX_TICKS : raw;
  return { ticks: limited - (limited % COARSE_DT), capped };
}
