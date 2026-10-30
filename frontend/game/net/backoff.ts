/** Reconnect backoff (PROTOCOL §4.6, CLIENT §6.2): 0.5 s, 1, 2, 4, 8, then 10 s cap, ±20 % jitter. */
export const BACKOFF_STEPS_MS = [500, 1000, 2000, 4000, 8000] as const;
export const BACKOFF_CAP_MS = 10_000;
export const BACKOFF_JITTER = 0.2;
/** A stream that stayed up this long resets the attempt counter. */
export const STABLE_AFTER_MS = 30_000;
/** After this long without a connection the banner says "still trying". */
export const STILL_TRYING_AFTER_MS = 60_000;

/** Delay before attempt `n` (1-based); `rand` in [0, 1) supplies the jitter. */
export function backoffDelay(attempt: number, rand: () => number): number {
  const base = attempt <= BACKOFF_STEPS_MS.length ? BACKOFF_STEPS_MS[Math.max(0, attempt - 1)] : BACKOFF_CAP_MS;
  return Math.round(base * (1 + BACKOFF_JITTER * (rand() * 2 - 1)));
}
