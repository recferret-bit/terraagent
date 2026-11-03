import { AdaptiveScale } from './adaptiveScale';
import { getDisplayRefreshMs } from './displayRefresh';
import { getRenderScaleMode, getTargetFps, onPerfChange, perfTelemetry } from './perfConfig';

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

/** Refresh interval AUTO holds (ms): F8 → PERF → TARGET FPS, else the display's measured one (null = unknown yet). */
export function targetRefreshMs(): number | null {
  const fps = getTargetFps();
  return fps === 'display' ? getDisplayRefreshMs() : 1000 / fps;
}
getDisplayRefreshMs(); // start the refresh probe at load, so menus and loading screens already measure the display

export function createRenderScaleController(onModeChange: () => void): RenderScaleController {
  let auto: AdaptiveScale | null = null;
  let autoCeiling = 0;
  let last = -1;
  let ema = 0;
  let mode = getRenderScaleMode();
  const off = onPerfChange(() => {
    const next = getRenderScaleMode();
    if (next === mode) return;
    mode = next;
    if (mode === 'auto') auto = null; // restart at the top
    onModeChange();
  });
  return {
    resolve(ceiling) {
      if (mode === 'native') return ceiling;
      if (mode !== 'auto') return Math.min(mode, ceiling);
      if (!auto || autoCeiling !== ceiling) {
        auto = new AdaptiveScale(ceiling, { refreshMs: targetRefreshMs });
        autoCeiling = ceiling;
      }
      return auto.dpr;
    },
    frame(nowMs) {
      const dt = last < 0 ? 0 : nowMs - last;
      last = nowMs;
      if (dt > 0 && dt <= MAX_GAP_MS) {
        ema = ema === 0 ? dt : ema + READOUT_ALPHA * (dt - ema);
        perfTelemetry.frameMs = ema;
      }
      return mode === 'auto' && auto !== null && auto.sample(dt, nowMs);
    },
    dispose: off,
  };
}
