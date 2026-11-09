import { createLabStore } from '../../core/labStore';

/**
 * Water look (F8 → WATER). Shared by every water surface (hex planet water, prototype lakes) and the water fauna.
 * Wave direction comes from the wind (`core/windConfig.ts`); these are the water's own knobs.
 *
 * OFF = the cheap tier: quality is forced to LOW (no parallax bed, no caustics, fewer waves) and the fauna is hidden.
 */
export interface WaterParams {
  /** Wave height multiplier (on top of the wind-driven height). */
  waveHeight: number;
  /** Gerstner steepness / choppiness, 0 = rolling sines, 1 = sharp crests. */
  waveSteepness: number;
  /** Wavelength multiplier: < 1 short choppy waves, > 1 long swell. */
  waveScale: number;
  /** Wave clock speed multiplier (integrated on the CPU, so changing it never jumps the waves). */
  waveSpeed: number;
  /** Strength of the small per-pixel ripple normals. */
  detailNormal: number;
  /** Shore + crest foam amount. */
  foamAmount: number;
  /** Width of the shore foam band, metres from the water's edge. */
  foamWidth: number;
  /** Light absorption per metre of water: higher = murkier, deep water darkens sooner. */
  absorption: number;
  /** Depth of the refracted bed parallax (how far the bed appears to shift with the view). */
  parallax: number;
  /** Strength of the sunlit caustic network on the bed. */
  caustics: number;
  /** Sun reflection / glitter strength. */
  sunGlint: number;
  /** Base surface roughness (wind adds to it): low = mirror-sharp sun glint, high = broad sheen. */
  roughness: number;
  /** Strength of bot / building projector light reflections on the surface. */
  projectorReflect: number;
  /** Planar reflection strength (0 = off: the mirror pass is skipped entirely). */
  reflection: number;
  /** Reflection distortion by the wave + ripple normal (wind and waves drive it), multiplier. */
  reflectDistort: number;
  /** Index into `REFLECT_RES_SCALES`: the mirror render target's size relative to the canvas. */
  reflectRes: number;
  /** Debug view, >= 0.5 = MIRROR ONLY: the water shows just the sampled (distorted) mirror image, opaque (MED/HIGH). */
  reflectDebug: number;
  /** Fish density multiplier (0 = no fauna). */
  faunaDensity: number;
  /** 0 = LOW, 1 = MEDIUM, 2 = HIGH shader tier (a `define`: changing it recompiles the water program). */
  quality: number;
}

export const DEFAULT_WATER_PARAMS: Readonly<WaterParams> = {
  waveHeight: 1,
  waveSteepness: 0.55,
  waveScale: 1,
  waveSpeed: 1,
  detailNormal: 1,
  foamAmount: 1,
  foamWidth: 1.6,
  absorption: 1,
  parallax: 1,
  caustics: 1,
  sunGlint: 1,
  roughness: 0.1,
  projectorReflect: 1,
  reflection: 1,
  reflectDistort: 1,
  reflectRes: 1,
  reflectDebug: 0,
  faunaDensity: 1,
  quality: 2,
};

export const WATER_RANGES = {
  waveHeight: [0, 2],
  waveSteepness: [0, 1],
  waveScale: [0.5, 2],
  waveSpeed: [0, 2],
  detailNormal: [0, 2],
  foamAmount: [0, 2],
  foamWidth: [0.2, 4],
  absorption: [0.2, 3],
  parallax: [0, 2],
  caustics: [0, 2],
  sunGlint: [0, 3],
  roughness: [0.02, 0.5],
  projectorReflect: [0, 3],
  reflection: [0, 1.5],
  reflectDistort: [0, 2],
  reflectRes: [0, 2],
  reflectDebug: [0, 1],
  faunaDensity: [0, 2],
  quality: [0, 2],
} as const satisfies Record<keyof WaterParams, readonly [number, number]>;

export type WaterQuality = 0 | 1 | 2;

/** Mirror render-target scale per `reflectRes` index (× the canvas drawing-buffer size). */
export const REFLECT_RES_SCALES = [0.25, 0.5, 1] as const;

/** Strength handed to the pass while the debug view is on and the slider is at 0, so the pass still runs. */
export const REFLECT_DEBUG_MIN_STRENGTH = 0.01;

/** `?reflect=<strength>` (A/B links) and `?reflectDebug=1` (MIRROR ONLY), for this page load only. */
export function parseWaterUrl(q: URLSearchParams): Partial<WaterParams> {
  const out: Partial<WaterParams> = {};
  const r = q.get('reflect');
  if (r !== null && r.trim() !== '' && Number.isFinite(Number(r))) out.reflection = Number(r);
  const d = q.get('reflectDebug');
  if (d === '1' || d === 'true') out.reflectDebug = 1;
  if (d === '0' || d === 'false') out.reflectDebug = 0;
  return out;
}

const store = createLabStore<WaterParams>({
  key: 'terraagent.water',
  version: 1,
  urlFlag: 'water',
  defaultOn: true,
  defaults: DEFAULT_WATER_PARAMS,
  ranges: WATER_RANGES,
  urlParams: parseWaterUrl,
});

const MAX_TICK_S = 0.1;

const uniforms = {
  /** Wave clock (s), advanced by `tickWaterClock` at `waveSpeed`. */
  uWaterTime: { value: 0 },
  uWaveHeight: { value: DEFAULT_WATER_PARAMS.waveHeight },
  uWaveSteep: { value: DEFAULT_WATER_PARAMS.waveSteepness },
  uWaveScale: { value: DEFAULT_WATER_PARAMS.waveScale },
  uWaterDetail: { value: DEFAULT_WATER_PARAMS.detailNormal },
  uFoamAmount: { value: DEFAULT_WATER_PARAMS.foamAmount },
  uFoamWidth: { value: DEFAULT_WATER_PARAMS.foamWidth },
  uAbsorption: { value: DEFAULT_WATER_PARAMS.absorption },
  uParallax: { value: DEFAULT_WATER_PARAMS.parallax },
  uCaustics: { value: DEFAULT_WATER_PARAMS.caustics },
  uSunGlint: { value: DEFAULT_WATER_PARAMS.sunGlint },
  uWaterRoughness: { value: DEFAULT_WATER_PARAMS.roughness },
  uProjectorReflect: { value: DEFAULT_WATER_PARAMS.projectorReflect },
  /** Reflection UV distortion multiplier (× the wave normal). Strength is applied by the pass through `uReflOn`. */
  uReflDistort: { value: DEFAULT_WATER_PARAMS.reflectDistort },
  /** 1 = MIRROR ONLY debug view (a uniform branch: toggling it never recompiles). */
  uReflDebug: { value: DEFAULT_WATER_PARAMS.reflectDebug },
};

function applyParams(): void {
  const p = store.get();
  uniforms.uWaveHeight.value = p.waveHeight;
  uniforms.uWaveSteep.value = p.waveSteepness;
  uniforms.uWaveScale.value = p.waveScale;
  uniforms.uWaterDetail.value = p.detailNormal;
  uniforms.uFoamAmount.value = p.foamAmount;
  uniforms.uFoamWidth.value = p.foamWidth;
  uniforms.uAbsorption.value = p.absorption;
  uniforms.uParallax.value = p.parallax;
  uniforms.uCaustics.value = p.caustics;
  uniforms.uSunGlint.value = p.sunGlint;
  uniforms.uWaterRoughness.value = p.roughness;
  uniforms.uProjectorReflect.value = p.projectorReflect;
  uniforms.uReflDistort.value = p.reflectDistort;
  uniforms.uReflDebug.value = isReflectDebug(p) ? 1 : 0;
}

function isReflectDebug(p: Readonly<WaterParams>): boolean {
  return p.reflectDebug >= 0.5;
}
applyParams();
store.onChange(applyParams);

let lastTickMs = -1;

/** Advances the wave clock from real time; safe to call several times per frame (`createColonyViewport().render()`). */
export function tickWaterClock(nowMs = performance.now()): void {
  if (lastTickMs < 0) { lastTickMs = nowMs; return; }
  const dt = Math.min(MAX_TICK_S, Math.max(0, (nowMs - lastTickMs) / 1000));
  lastTickMs = nowMs;
  uniforms.uWaterTime.value += dt * store.get().waveSpeed;
}

/** Shared water uniforms. Assign these objects (not copies) into each water / fauna material. */
export function getWaterUniforms(): typeof uniforms {
  return uniforms;
}

/** Effective shader tier: the saved quality, or LOW while the WATER tab is off. */
export function getWaterQuality(): WaterQuality {
  return store.isOn() ? (Math.round(store.get().quality) as WaterQuality) : 0;
}

/** Effective fauna density (0 while the WATER tab is off). */
export function getFaunaDensity(): number {
  return store.isOn() ? store.get().faunaDensity : 0;
}

/**
 * Planar reflection strength this frame, 0 when the mirror pass must be skipped (WATER tab off, LOW tier, or the
 * REFLECTION slider at 0 with the debug view off). The debug view keeps the pass running at any strength.
 */
export function getReflectionStrength(): number {
  if (getWaterQuality() === 0) return 0;
  const p = store.get();
  return isReflectDebug(p) ? Math.max(p.reflection, REFLECT_DEBUG_MIN_STRENGTH) : p.reflection;
}

/** Mirror render-target scale (× drawing-buffer size) from the `reflectRes` slider. */
export function getReflectionResScale(): number {
  return REFLECT_RES_SCALES[Math.round(store.get().reflectRes)] ?? REFLECT_RES_SCALES[1];
}

export const isWaterFxOn = (): boolean => store.isOn();
export const setWaterFx = (on: boolean): boolean => store.setOn(on);
export const toggleWaterFx = (): boolean => store.toggle();
export const getWaterParams = (): Readonly<WaterParams> => store.get();
export const setWaterParams = (patch: Partial<WaterParams>): Readonly<WaterParams> => store.set(patch);
export const resetWaterParams = (): Readonly<WaterParams> => store.reset();
export const onWaterChange = (fn: (on: boolean, params: Readonly<WaterParams>) => void): (() => void) => store.onChange(fn);
