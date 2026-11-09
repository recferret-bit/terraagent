import { createLabStore } from './labStore';
import {
  setViewFocusEnabled, setViewFocusFrozen, setViewFocusMargin, VIEW_FOCUS_MARGIN, VIEW_FOCUS_MARGIN_RANGE,
} from './viewFocus';

export type ViewportPreset = 'auto' | '2560x1440' | '1920x1080' | '1280x720';

export const VIEWPORT_PRESETS: Record<ViewportPreset, { label: string; width: number; height: number } | null> = {
  auto: null,
  '2560x1440': { label: '2560×1440', width: 2560, height: 1440 },
  '1920x1080': { label: '1920×1080', width: 1920, height: 1080 },
  '1280x720': { label: '1280×720', width: 1280, height: 720 },
};

const OPT_KEY = 'terraagent.opt';
const RES_KEY = 'terraagent.res';

function readInitialOpt(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('opt');
    if (q === '0' || q === 'false') return false;
    if (q === '1' || q === 'true') return true;
    const saved = localStorage.getItem(OPT_KEY);
    return saved === null ? true : saved === '1';
  } catch { return true; }
}

function readInitialPreset(): ViewportPreset {
  try {
    const q = new URLSearchParams(location.search).get('res') as ViewportPreset | null;
    if (q && q in VIEWPORT_PRESETS) return q;
    const saved = localStorage.getItem(RES_KEY) as ViewportPreset | null;
    if (saved && saved in VIEWPORT_PRESETS) return saved;
  } catch { /* ignore */ }
  return 'auto';
}

let optimized = readInitialOpt();
let preset: ViewportPreset = readInitialPreset();
const listeners = new Set<(opt: boolean, res: ViewportPreset) => void>();

const notify = () => listeners.forEach((fn) => fn(optimized, preset));

export const isShaderOptimized = (): boolean => optimized;
export const getViewportPreset = (): ViewportPreset => preset;
export const getPresetDimensions = (p: ViewportPreset = preset) => VIEWPORT_PRESETS[p];

export function setShaderOptimized(v: boolean): boolean {
  if (optimized === v) return optimized;
  optimized = v;
  try { localStorage.setItem(OPT_KEY, v ? '1' : '0'); } catch { /* private mode */ }
  notify();
  return optimized;
}

export function setViewportPreset(p: ViewportPreset): ViewportPreset {
  if (!(p in VIEWPORT_PRESETS) || preset === p) return preset;
  preset = p;
  try { localStorage.setItem(RES_KEY, p); } catch { /* private mode */ }
  notify();
  return preset;
}

export function onPerfConfigChange(fn: (opt: boolean, res: ViewportPreset) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ------------------------------------------------------------------ F8 → PERF (runtime performance optimisations)

/**
 * The F8 PERF tab store. ON (default) = "PERF OPTIMISATIONS": adaptive/fixed render scale, view focus with the
 * margin below, daytime secondary shadow skipped. OFF = the plain A/B baseline: native pixel ratio, view focus off
 * (`setViewFocusEnabled(false)`), secondary shadow always rendered. `?perf=0|1` overrides the saved switch.
 */
export interface PerfParams {
  /** Index into `RENDER_SCALES`: 0 = AUTO (dynamic resolution), else a fixed pixel ratio. */
  renderScale: number;
  /** Index into `TARGET_FPS`: the frame rate AUTO holds (0 = the display's refresh rate, capped at 120). */
  targetFps: number;
  /** View focus radius = visible footprint × this (`viewFocus.ts`). */
  focusMargin: number;
  /** Debug: 1 = draw the focus + visible-footprint circles on the ground, 2 = also freeze the focus where it is. */
  focusRing: number;
  /** 1 = keep rendering the faint secondary ("moon") shadow by day; 0 = fade it out by day and skip its map. */
  daySecondaryShadow: number;
  /** 1 = keep the faint night sun shadow next to the moon's; 0 = fade it out at night and skip its map (one light). */
  nightSunShadow: number;
}

/** Render-scale choices; 0 (AUTO) is resolved per frame by `AdaptiveScale`. Fixed values are capped at the display DPR. */
export const RENDER_SCALES = ['auto', 1, 1.25, 1.5, 2] as const;
/** AUTO render-scale targets: 'display' = the measured refresh rate (`displayRefresh.ts`), capped at 120 FPS. */
export const TARGET_FPS = ['display', 60, 120] as const;

export const DEFAULT_PERF_PARAMS: Readonly<PerfParams> = {
  renderScale: 0,
  targetFps: 0,
  focusMargin: VIEW_FOCUS_MARGIN,
  focusRing: 0,
  daySecondaryShadow: 0,
  nightSunShadow: 0,
};

export const PERF_RANGES = {
  renderScale: [0, RENDER_SCALES.length - 1],
  targetFps: [0, TARGET_FPS.length - 1],
  focusMargin: VIEW_FOCUS_MARGIN_RANGE,
  focusRing: [0, 2],
  daySecondaryShadow: [0, 1],
  nightSunShadow: [0, 1],
} as const satisfies Record<keyof PerfParams, readonly [number, number]>;

/** `?scale=auto|1|1.25|1.5|2` → `renderScale` index; `?fps=display|60|120` → `targetFps`; `?focusRing=0|1|2` (2 = ring + frozen focus). */
export function parsePerfUrl(q: URLSearchParams): Partial<PerfParams> {
  const out: Partial<PerfParams> = {};
  const scale = q.get('scale');
  if (scale !== null) {
    const i = RENDER_SCALES.findIndex((s) => String(s) === scale || (typeof s === 'number' && s === Number(scale)));
    if (i >= 0) out.renderScale = i;
  }
  const fps = q.get('fps');
  if (fps !== null) {
    const i = TARGET_FPS.findIndex((f) => String(f) === fps);
    if (i >= 0) out.targetFps = i;
  }
  const ring = q.get('focusRing');
  if (ring === '1' || ring === 'true') out.focusRing = 1;
  if (ring === '2' || ring === 'freeze') out.focusRing = 2;
  if (ring === '0' || ring === 'false') out.focusRing = 0;
  return out;
}

const perf = createLabStore<PerfParams>({
  key: 'terraagent.perf',
  version: 2, // v2: focus margin default 1.5 → 1.0 (quad focus), target FPS, night sun shadow
  urlFlag: 'perf',
  defaultOn: true,
  defaults: DEFAULT_PERF_PARAMS,
  ranges: PERF_RANGES,
  urlParams: parsePerfUrl,
});

let focusAppliedOn: boolean | null = null;
function applyPerfToViewFocus(): void {
  const on = perf.isOn();
  setViewFocusMargin(perf.get().focusMargin);
  setViewFocusFrozen(on && perf.get().focusRing >= 1.5);
  // Only switch the focus on a PERF on/off transition, so `?focus=0` (focus off, PERF on) survives slider edits.
  if (focusAppliedOn !== on && (focusAppliedOn !== null || !on)) setViewFocusEnabled(on);
  focusAppliedOn = on;
}
applyPerfToViewFocus();
perf.onChange(applyPerfToViewFocus);

export const isPerfOn = (): boolean => perf.isOn();
export const setPerf = (on: boolean): boolean => perf.setOn(on);
export const togglePerf = (): boolean => perf.toggle();
export const getPerfParams = (): Readonly<PerfParams> => perf.get();
export const setPerfParams = (patch: Partial<PerfParams>): Readonly<PerfParams> => perf.set(patch);
export const resetPerfParams = (): Readonly<PerfParams> => perf.reset();
export const onPerfChange = (fn: (on: boolean, params: Readonly<PerfParams>) => void): (() => void) => perf.onChange(fn);

/** The render-scale choice in effect: 'auto', a fixed ratio, or 'native' while PERF is off. */
export function getRenderScaleMode(): 'auto' | 'native' | number {
  if (!perf.isOn()) return 'native';
  return RENDER_SCALES[Math.round(perf.get().renderScale)] ?? 'auto';
}

/** Frame rate AUTO render scale holds: 'display' (measured refresh, ≤ 120) or a fixed rate. */
export function getTargetFps(): 'display' | number {
  return TARGET_FPS[Math.round(perf.get().targetFps)] ?? 'display';
}

export const isFocusRingOn = (): boolean => perf.isOn() && perf.get().focusRing >= 0.5;

/** True when the daytime secondary shadow should fade out and stop rendering its map (PERF on, setting OFF). */
export const skipDaySecondaryShadow = (): boolean => perf.isOn() && perf.get().daySecondaryShadow < 0.5;

/** True when the faint night sun shadow should fade out and stop rendering its map (PERF on, setting OFF). */
export const skipNightSunShadow = (): boolean => perf.isOn() && perf.get().nightSunShadow < 0.5;

/** Live numbers for the PERF tab readout, written by the viewport each frame (last rendered viewport wins). */
export const perfTelemetry = {
  /** Pixel ratio the canvas renders at. */
  dpr: 1,
  canvasW: 0,
  canvasH: 0,
  /** Smoothed frame interval (ms). */
  frameMs: 0,
  /** Water reflection mirror pass ran this frame (`visuals/water/reflection/WaterReflectionPass.ts`). */
  reflectOn: false,
  /** Smoothed CPU time of the mirror render call (ms; 0 while skipped). */
  reflectMs: 0,
  /** Mirror render-target size (px). */
  reflectW: 0,
  reflectH: 0,
  /** Fraction of the mirror target the scissor rect covered this frame (0 while skipped). */
  reflectRect: 0,
};
