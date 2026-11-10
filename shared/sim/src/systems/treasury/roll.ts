import { nextU32, seedStream } from '../../kernel/rng';

/** Basis-point scale of `magnitudeBp` and strike chances (contract max). Not a balance row. */
const BASIS_POINTS = 10_000;

/**
 * One xoshiro draw in `[0, 10_000)` from the planet seed and the attempt tick.
 * A fresh `hazard` stream per tick, so the planet's saved streams are not advanced.
 */
export function strikeRollBp(seed: string, tick: number): number {
  return nextU32(seedStream(`${seed}:${tick}`, 'hazard')) % BASIS_POINTS;
}

/** Unshielded chance is `baseStrikeBp`. A shield keeps `(10_000 - magnitudeBp) / 10_000` of it. */
export function strikeChanceBp(baseStrikeBp: number, magnitudeBp: number, active: boolean): number {
  if (!active) return baseStrikeBp;
  const kept = BASIS_POINTS - magnitudeBp;
  if (kept <= 0) return 0;
  return Math.floor((baseStrikeBp * kept) / BASIS_POINTS);
}

/** Interval boundary ticks in `(prevTick, tick]`. Tick 0 is not an attempt. */
export function attemptTicks(prevTick: number, tick: number, interval: number): number[] {
  if (interval <= 0 || tick <= prevTick) return [];
  const first = Math.floor(prevTick / interval) + 1;
  const last = Math.floor(tick / interval);
  const out: number[] = [];
  for (let n = Math.max(first, 1); n <= last; n++) out.push(n * interval);
  return out;
}
