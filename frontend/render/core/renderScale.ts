import { AdaptiveScale } from './adaptiveScale';
import { getDisplayRefreshMs } from './displayRefresh';
import { getFpsCap, getRenderScaleMode, getTargetFps, onFpsCapChange, onPerfChange, perfTelemetry } from './perfConfig';

/**
 * Per-viewport render-scale resolver (F8 → PERF → RENDER SCALE). The viewport's `resize()` asks `resolve(ceiling)`
 * for the pixel ratio (ceiling = display DPR ≤ 2, or the menu's LOW quality cap); `frame()` runs once per rendered
 * frame, feeds AUTO's state machine and returns true only when the viewport must resize (a step, never per frame).
 */
export interface RenderScaleController {
  resolve(ceiling: number): number;
  frame(nowMs: number): boolean;
  dispose(): void;
}

const READOUT_ALPHA = 0.1;
const MAX_GAP_MS = 250;
const MAX_DISPLAY_REFRESH_MS = 17;
const ASSUMED_60HZ_MS = 1000 / 60;

/** Refresh interval AUTO holds (ms): F8 → PERF → TARGET FPS / FPS cap, else the display's measured one (null = unknown yet). */
export function targetRefreshMs(): number | null {
  const fps = getTargetFps();
  const rawDisplay = fps === 'display' ? getDisplayRefreshMs() : null;
  const base = fps === 'display'
    ? (rawDisplay === null ? null : Math.min(MAX_DISPLAY_REFRESH_MS, rawDisplay))
    : 1000 / fps;
  const cap = getFpsCap();
  if (cap > 0) {
    const capMs = 1000 / cap;
    if (base !== null) return Math.max(base, capMs);
    return capMs >= ASSUMED_60HZ_MS - 1e-4 ? capMs : null;
  }
  return base;
}
getDisplayRefreshMs(); // start the refresh probe at load, so menus and loading screens already measure the display

export function createRenderScaleController(onModeChange: () => void): RenderScaleController {
  let auto: AdaptiveScale | null = null;
  let autoCeiling = 0;
  let autoMinFrameMs = 0;
  let last = -1;
  let ema = 0;
  let mode = getRenderScaleMode();
  let targetFps = getTargetFps();
  const resolveMinFrameMs = (): number => {
    const cap = getFpsCap();
    return cap > 0 ? Math.max(1000 / 120, 1000 / cap) : 1000 / 120;
  };
  const ensureAuto = (ceiling: number): AdaptiveScale => {
    const minFrameMs = resolveMinFrameMs();
    if (!auto || autoCeiling !== ceiling || Math.abs(autoMinFrameMs - minFrameMs) > 1e-4) {
      auto = new AdaptiveScale(ceiling, { refreshMs: targetRefreshMs, minFrameMs, maxGapMs: Math.max(MAX_GAP_MS, minFrameMs * 4) });
      autoCeiling = ceiling;
      autoMinFrameMs = minFrameMs;
    }
    return auto;
  };
  const offPerf = onPerfChange(() => {
    const next = getRenderScaleMode();
    const nextTarget = getTargetFps();
    if (next === mode && nextTarget === targetFps) return;
    mode = next;
    targetFps = nextTarget;
    if (mode === 'auto') auto = null; // restart at the top
    onModeChange();
  });
  const offCap = onFpsCapChange(() => {
    last = -1;
    ema = 0;
    if (mode === 'auto') {
      auto = null;
      onModeChange();
    }
  });
  return {
    resolve(ceiling) {
      if (mode === 'native') return ceiling;
      if (mode !== 'auto') return Math.min(mode, ceiling);
      return ensureAuto(ceiling).dpr;
    },
    frame(nowMs) {
      const dt = last < 0 ? 0 : nowMs - last;
      last = nowMs;
      if (dt > 0 && dt <= MAX_GAP_MS) {
        ema = ema === 0 ? dt : ema + READOUT_ALPHA * (dt - ema);
        perfTelemetry.frameMs = ema;
      }
      if (mode !== 'auto') return false;
      const active = auto ?? (autoCeiling > 0 ? ensureAuto(autoCeiling) : null);
      return active !== null && active.sample(dt, nowMs);
    },
    dispose() {
      offPerf();
      offCap();
    },
  };
}
