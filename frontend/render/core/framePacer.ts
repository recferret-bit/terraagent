import { getDisplayRefreshMs } from './displayRefresh';
import { getFpsCap, type FpsLimit } from './perfConfig';

export interface FramePacerOptions {
  /** Maximum clamped delta time returned in seconds (default `0.05`). */
  maxDt?: number;
  /** Optional custom FPS cap reader (defaults to `getFpsCap` from `perfConfig`). */
  getCap?: () => FpsLimit;
  /** Optional display refresh-interval reader in ms (defaults to `getDisplayRefreshMs`). */
  getRefreshMs?: () => number | null;
}

export interface FramePacer {
  /**
   * Evaluates a `requestAnimationFrame` timestamp `nowMs`.
   * Returns `null` when this VSync tick should be skipped to hold the configured FPS cap,
   * or the clamped `dt` (in seconds) since the previous rendered frame when the caller should step and render.
   */
  next(nowMs: number): number | null;
  /** Resets timing baselines after a pause, visibility change, or manual seek so no catch-up burst occurs. */
  reset(nowMs?: number): void;
}

function computeVSyncToleranceMs(intervalMs: number, refreshMs: number | null): number {
  if (refreshMs !== null && Number.isFinite(refreshMs) && refreshMs > 1 && refreshMs < intervalMs * 1.15) {
    // Half a VSync interval ensures integer ratios (e.g. 120 Hz -> 60 FPS = 2 VSyncs, 60 Hz -> 60 FPS = 1 VSync)
    // never skip an on-time VSync due to sub-millisecond timer jitter.
    return Math.min(3.5, Math.max(1.0, refreshMs * 0.45));
  }
  return Math.min(2.4, Math.max(1.0, intervalMs * 0.14));
}

/**
 * Drift-free, VSync-phase-locked frame limiter (`UNCAPPED` / `120` / `90` / `60` / `30` FPS).
 * Avoids the classic `now - last < 16.67` 40-FPS judder trap on 60 Hz / 120 Hz ProMotion displays by tracking a
 * phase-locked target timestamp with half-VSync jitter tolerance and clamping long background/hitch gaps.
 */
export function createFramePacer(opts: FramePacerOptions = {}): FramePacer {
  const maxDt = opts.maxDt ?? 0.05;
  const readCap = opts.getCap ?? getFpsCap;
  const readRefresh = opts.getRefreshMs ?? getDisplayRefreshMs;

  let lastRenderedMs = -1;
  let nextTargetMs = -1;
  let lastCap: FpsLimit = 0;

  return {
    next(nowMs: number): number | null {
      const cap = readCap();
      if (cap !== lastCap) {
        lastCap = cap;
        nextTargetMs = -1;
      }

      if (lastRenderedMs < 0) {
        lastRenderedMs = nowMs;
        if (cap > 0) nextTargetMs = nowMs + 1000 / cap;
        return 0;
      }

      if (cap > 0) {
        const intervalMs = 1000 / cap;
        if (nextTargetMs < 0) nextTargetMs = lastRenderedMs + intervalMs;
        const toleranceMs = computeVSyncToleranceMs(intervalMs, readRefresh());
        if (nowMs + toleranceMs < nextTargetMs) {
          return null;
        }
        nextTargetMs += intervalMs;
        // Clamp phase after tab switches, breakpoints, or long frames so we never burst catch-up renders.
        if (nextTargetMs <= nowMs - toleranceMs) {
          nextTargetMs = nowMs + intervalMs;
        }
      }

      const rawDt = Math.max(0, (nowMs - lastRenderedMs) / 1000);
      lastRenderedMs = nowMs;
      return Math.min(rawDt, maxDt);
    },
    reset(nowMs = -1): void {
      lastRenderedMs = nowMs;
      nextTargetMs = nowMs >= 0 && lastCap > 0 ? nowMs + 1000 / lastCap : -1;
    },
  };
}
