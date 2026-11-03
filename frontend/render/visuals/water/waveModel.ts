/**
 * The water's wave constants, shared by the GLSL (`glsl/waves.ts` interpolates them) and the CPU (the fauna sinks
 * below the wave troughs). One source, so the shader and the fish never disagree about how high the swell is.
 */

/** Wavelengths (m at `waveScale = 1`) and relative weights of the four Gerstner components. */
export const WAVE_LAMBDA = [9.0, 5.2, 3.1, 1.8] as const;
export const WAVE_WEIGHT = [1.0, 0.8, 0.65, 0.5] as const;
/** k*A of the primary wave at wind amplitude 1. */
export const WAVE_SLOPE = 0.075;
/** k*A at a full gale: steepness is normalised to it. */
export const WAVE_SLOPE_MAX = 0.16;
/** Soft clamp (m) of the vertex swell; the shallow bed is at -0.55 m and shores are pinned at -0.16 m. */
export const WAVE_VERT_PEAK = 0.12;
/** Components shorter than this fade out of the vertex swell (the hex water lattice is 2 m). */
export const WAVE_VERT_FADE: readonly [number, number] = [6.0, 9.0];
/** Only the two longest components can move vertices. */
export const WAVE_VERT_COUNT = 2;

/** Wave amplitude factor `BASE + GAIN * min(ws, MAX_WS)` from the local wind strength (never 0: calm water swells). */
export const WIND_AMP = { base: 0.3, gain: 0.75, maxWs: 2.5 } as const;
export const waterWindAmp = (ws: number): number => WIND_AMP.base + WIND_AMP.gain * Math.min(ws, WIND_AMP.maxWs);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Deepest trough (m below the still level) the vertex swell can reach for a wind strength (use the gusty peak,
 * `strength * (1 + gust)`), `waveHeight` and `waveScale`: the CPU mirror of `waterSwellHeight` with all components
 * in phase, soft-clamped the same way.
 */
export function swellTroughDepth(windStrength: number, waveHeight: number, waveScale: number): number {
  const ka0 = WAVE_SLOPE * waterWindAmp(windStrength) * waveHeight;
  let a = 0;
  for (let i = 0; i < WAVE_VERT_COUNT; i++) {
    const lambda = WAVE_LAMBDA[i]! * waveScale;
    a += smoothstep(WAVE_VERT_FADE[0], WAVE_VERT_FADE[1], lambda) * ka0 * WAVE_WEIGHT[i]! * lambda / (2 * Math.PI);
  }
  return WAVE_VERT_PEAK * Math.tanh(a / WAVE_VERT_PEAK);
}
