/**
 * Display refresh-interval estimate for AUTO render scale (`adaptiveScale.ts`), so dynamic resolution aims at the
 * screen's real rate (8.3 ms on a 120 Hz screen) instead of a fixed 60 FPS budget.
 *
 * A one-callback rAF probe runs for the whole page lifetime (menus and loading screens included, where frames are
 * cheap) on the vsync-aligned rAF timestamps, whose intervals are whole multiples of the refresh interval. Every
 * block of `REFRESH_BLOCK` intervals contributes its 2nd-shortest one (one stray short interval cannot fake a faster
 * screen; two refresh-length frames out of eight are enough to reveal it even while GPU-bound). The estimate snaps
 * down to the shortest block value and creeps back up very slowly (a window moved to a slower screen), so a long
 * GPU-bound stretch does not talk it into a slower display.
 */
export const REFRESH_BLOCK = 8;
/** Share of the gap to a slower block value the estimate moves per block (~230 blocks, ~30 s at 60 FPS, to halve). */
const CREEP = 0.003;
const MAX_GAP_MS = 250;

export interface RefreshEstimator {
  /** Feeds one frame interval (ms). */
  feed(dt: number): void;
  /** Current estimate (ms), null before the first full block. */
  get(): number | null;
}

export function createRefreshEstimator(): RefreshEstimator {
  let estimate: number | null = null;
  const block: number[] = [];
  return {
    feed(dt) {
      if (!(dt > 0) || dt > MAX_GAP_MS) return;
      block.push(dt);
      if (block.length < REFRESH_BLOCK) return;
      block.sort((a, b) => a - b);
      const v = block[1]!;
      block.length = 0;
      estimate = estimate === null || v < estimate ? v : estimate + (v - estimate) * CREEP;
    },
    get: () => estimate,
  };
}

let shared: RefreshEstimator | null = null;

/** Page-wide estimate (ms), null until known or without `requestAnimationFrame` (tests, workers). Starts the probe. */
export function getDisplayRefreshMs(): number | null {
  if (!shared) {
    shared = createRefreshEstimator();
    if (typeof requestAnimationFrame !== 'function') return null;
    const est = shared;
    let last = -1;
    const tick = (t: number) => {
      if (last >= 0) est.feed(t - last);
      last = t;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick); // gone after a test env teardown
    };
    requestAnimationFrame(tick);
  }
  return shared.get();
}
