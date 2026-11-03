/**
 * Dynamic resolution (F8 → PERF → RENDER SCALE = AUTO): a pure state machine fed one frame interval at a time. It
 * keeps the highest pixel ratio while frames are fast and steps down one level (2 → 1.75 → 1.5 → 1.25 → 1) when the
 * smoothed frame time stays slow; it steps back up when frames stay fast for longer. It never touches the renderer:
 * `sample()` returns true when `dpr` changed and the viewport then resizes once (`createColonyViewport.ts`).
 *
 * Anti-oscillation:
 * - time hysteresis: slow for `downHoldMs` (1 s) to step down, fast for `upHoldMs` (3 s) to step up;
 * - after every step the smoothing restarts and `settleMs` of frames are ignored (the resize itself hitches);
 * - a step up that has to be undone within `probeWindowMs` doubles the next up-hold (3 → 6 → 12 … ≤ `maxUpHoldMs`),
 *   so a level the GPU cannot hold is retried ever more rarely instead of flip-flopping.
 * - both thresholds follow the display's refresh interval (`refreshMs`, else the shortest interval seen, clamped to
 *   [`minFrameMs` = 120 FPS, 17 ms]): slow = smoothed frame > refresh × `downRatio` (some frames miss a refresh),
 *   fast = < refresh × `upRatio` (on a vsync-locked screen a frame is never under one refresh, so "at the refresh
 *   rate" counts as fast). A 120 Hz screen is held at 8.3 ms, a 60 Hz one at 16.7 ms; the back-off above keeps the
 *   probing rare when the next level really is too slow.
 */
export const AUTO_SCALE_LEVELS: readonly number[] = [2, 1.75, 1.5, 1.25, 1];

const SPIKE_CLAMP_MS = 100;
/** A refresh interval is only believed up to ~59 Hz: uniformly slow frames (GPU-bound) must still count as slow. */
const MAX_REFRESH_MS = 17;

export interface AdaptiveScaleOptions {
  /** Steps down while the smoothed frame time is above refresh × this. */
  downRatio: number;
  /** Steps up while the smoothed frame time is below refresh × this. */
  upRatio: number;
  /** Shortest refresh interval chased (ms): 1000 / 120, so a faster screen is held at 120 FPS, not beyond. */
  minFrameMs: number;
  /** Display refresh interval (ms) when known (`displayRefresh.ts`); null → the shortest interval sampled here. */
  refreshMs: (() => number | null) | null;
  downHoldMs: number;
  upHoldMs: number;
  maxUpHoldMs: number;
  settleMs: number;
  probeWindowMs: number;
  /** EMA weight of a new sample. */
  alpha: number;
  /** Intervals longer than this (tab hidden, shader compile) are ignored and reset the hold timers. */
  maxGapMs: number;
}

export const DEFAULT_ADAPTIVE_SCALE: Readonly<AdaptiveScaleOptions> = {
  downRatio: 1.12,
  upRatio: 1.04,
  minFrameMs: 1000 / 120,
  refreshMs: null,
  downHoldMs: 1000,
  upHoldMs: 3000,
  maxUpHoldMs: 60000,
  settleMs: 600,
  probeWindowMs: 6000,
  alpha: 0.1,
  maxGapMs: 250,
};

/** The levels at or below `ceiling` (the display's pixel ratio, ≤ 2), highest first; `ceiling` itself always first. */
export function autoScaleLevels(ceiling: number): number[] {
  const c = Math.max(0.5, ceiling);
  const below = AUTO_SCALE_LEVELS.filter((l) => l < c - 1e-3);
  return [c, ...below];
}

export class AdaptiveScale {
  private levels: number[];
  private level = 0;
  private ema: number | null = null;
  private floor = Infinity;
  private slowSince: number | null = null;
  private fastSince: number | null = null;
  private settleUntil = -Infinity;
  private upHold: number;
  private lastUpAt: number | null = null;
  private readonly o: Readonly<AdaptiveScaleOptions>;

  constructor(ceiling: number, opts: Partial<AdaptiveScaleOptions> = {}) {
    this.o = { ...DEFAULT_ADAPTIVE_SCALE, ...opts };
    this.levels = autoScaleLevels(ceiling);
    this.upHold = this.o.upHoldMs;
  }

  /** Current pixel ratio. */
  get dpr(): number { return this.levels[this.level]!; }
  /** Smoothed frame time (ms), or null before the first sample after a (re)start. */
  get smoothedMs(): number | null { return this.ema; }
  /** Current hold before a step up (ms); grows after failed up-probes. */
  get upHoldMs(): number { return this.upHold; }

  /** New ceiling (display pixel ratio / quality cap changed): restart at the top. Returns true if `dpr` changed. */
  setCeiling(ceiling: number): boolean {
    const before = this.dpr;
    this.levels = autoScaleLevels(ceiling);
    this.level = 0;
    this.restart(-Infinity);
    return this.dpr !== before;
  }

  /** Feeds one frame interval `frameMs` ending at `nowMs`. Returns true when `dpr` changed. */
  sample(frameMs: number, nowMs: number): boolean {
    const o = this.o;
    if (!(frameMs > 0) || frameMs > o.maxGapMs) {
      this.slowSince = this.fastSince = null;
      return false;
    }
    // Refresh-interval estimate: snaps down to the shortest interval seen, creeps up very slowly otherwise.
    this.floor = frameMs < this.floor ? frameMs : this.floor + (frameMs - this.floor) * 0.001;
    const ms = Math.min(frameMs, SPIKE_CLAMP_MS); // one hitch must not dominate the average
    this.ema = this.ema === null ? ms : this.ema + o.alpha * (ms - this.ema);
    if (nowMs < this.settleUntil) return false;
    if (this.lastUpAt !== null && nowMs - this.lastUpAt > o.probeWindowMs) {
      this.lastUpAt = null; // the last step up held: relax the back-off
      this.upHold = Math.max(o.upHoldMs, this.upHold / 2);
    }
    const refresh = this.refreshMs();
    const downTh = refresh * o.downRatio;
    const upTh = refresh * o.upRatio;
    if (this.ema > downTh) {
      this.fastSince = null;
      this.slowSince ??= nowMs;
      if (nowMs - this.slowSince >= o.downHoldMs && this.level < this.levels.length - 1) {
        if (this.lastUpAt !== null && nowMs - this.lastUpAt <= o.probeWindowMs) {
          this.upHold = Math.min(o.maxUpHoldMs, this.upHold * 2); // failed probe
        }
        this.lastUpAt = null;
        this.level++;
        this.restart(nowMs);
        return true;
      }
    } else if (this.ema < upTh) {
      this.slowSince = null;
      this.fastSince ??= nowMs;
      if (nowMs - this.fastSince >= this.upHold && this.level > 0) {
        this.level--;
        this.lastUpAt = nowMs;
        this.restart(nowMs);
        return true;
      }
    } else {
      this.slowSince = this.fastSince = null;
    }
    return false;
  }

  /** Refresh interval the thresholds follow (ms), clamped to [`minFrameMs`, `MAX_REFRESH_MS`]. */
  refreshMs(): number {
    const r = this.o.refreshMs?.() ?? this.floor;
    return Math.min(MAX_REFRESH_MS, Math.max(this.o.minFrameMs, Number.isFinite(r) ? r : MAX_REFRESH_MS));
  }

  private restart(nowMs: number): void {
    this.ema = null;
    this.slowSince = this.fastSince = null;
    this.settleUntil = nowMs + this.o.settleMs;
  }
}
