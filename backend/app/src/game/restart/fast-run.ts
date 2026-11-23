import { COARSE_DT } from '@terra/sim';
import { RESTART_FASTRUN_MAX_TICKS } from './missed-ticks';

/** Yield the worker after this much wall time so other planets and messages still run (CT-51, 0.7). */
export const FAST_RUN_YIELD_MS = 50;
/** Hard wall-clock ceiling per planet catch-up in live sim threads so boot never stalls for minutes. */
export const FAST_RUN_MAX_WALL_MS = 10_000;

export interface CoarseCatchUp {
  readonly steps: number;
  readonly advanced: number;
  /** False when a step dropped the planet. */
  readonly completed: boolean;
}

const macrotask = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

/**
 * Coarse fast-run: `step(dt)` with `dt` 5, `ticks / dt` times, not on the scheduler's wall timer.
 * Yields a macrotask once {@link FAST_RUN_YIELD_MS} of wall time went by since the last yield (a step count would hold
 * the thread for minutes when steps are slow), or after `yieldEvery` steps when given (whichever comes first). Never
 * runs more than 24 h of ticks or longer than `maxWallMs` when provided.
 */
export async function runCoarseCatchUp(opts: {
  readonly ticks: number;
  readonly step: (dt: number) => boolean;
  readonly dt?: number;
  readonly yieldEveryMs?: number;
  readonly yieldEvery?: number;
  readonly maxWallMs?: number;
  readonly now?: () => number;
}): Promise<CoarseCatchUp> {
  const dt = opts.dt ?? COARSE_DT;
  const yieldMs = opts.yieldEveryMs ?? FAST_RUN_YIELD_MS;
  const yieldEvery = opts.yieldEvery ?? Infinity;
  const budget = Math.min(Math.max(0, Math.floor(opts.ticks)), RESTART_FASTRUN_MAX_TICKS);
  const steps = Math.floor(budget / dt);
  const now = opts.now ?? (() => performance.now());
  const startMs = now();
  let sliceStart = startMs;
  let sliceSteps = 0;
  let done = 0;
  for (let i = 0; i < steps; i++) {
    if (!opts.step(dt)) return { steps: done, advanced: done * dt, completed: false };
    done++;
    sliceSteps++;
    const t = now();
    if (t - sliceStart < yieldMs && sliceSteps < yieldEvery) continue;
    if (opts.maxWallMs !== undefined && t - startMs >= opts.maxWallMs) break;
    await macrotask();
    sliceStart = now();
    sliceSteps = 0;
  }
  return { steps: done, advanced: done * dt, completed: true };
}
