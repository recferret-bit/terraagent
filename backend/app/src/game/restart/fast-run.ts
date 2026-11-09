import { COARSE_DT } from '@terra/sim';
import { RESTART_FASTRUN_MAX_TICKS } from './missed-ticks';

/** Yield the worker this often so other planets and messages still run (CT-51). */
export const FAST_RUN_YIELD_EVERY = 200;

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
 * Yields a macrotask every {@link FAST_RUN_YIELD_EVERY} steps. Never runs more than 24 h of ticks.
 */
export async function runCoarseCatchUp(opts: {
  readonly ticks: number;
  readonly step: (dt: number) => boolean;
  readonly dt?: number;
  readonly yieldEvery?: number;
}): Promise<CoarseCatchUp> {
  const dt = opts.dt ?? COARSE_DT;
  const yieldEvery = opts.yieldEvery ?? FAST_RUN_YIELD_EVERY;
  const budget = Math.min(Math.max(0, Math.floor(opts.ticks)), RESTART_FASTRUN_MAX_TICKS);
  const steps = Math.floor(budget / dt);
  let done = 0;
  for (let i = 0; i < steps; i++) {
    if (!opts.step(dt)) return { steps: done, advanced: done * dt, completed: false };
    done++;
    if (done % yieldEvery === 0) await macrotask();
  }
  return { steps: done, advanced: done * dt, completed: true };
}
