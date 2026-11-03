import { getWaterUniforms } from '../waterConfig';
import { WIND_GLSL } from '../../../core/windConfig';
import { glslFloat } from '../../shaderInject';
import {
  WAVE_LAMBDA, WAVE_SLOPE, WAVE_SLOPE_MAX, WAVE_VERT_COUNT, WAVE_VERT_FADE, WAVE_VERT_PEAK, WAVE_WEIGHT, WIND_AMP,
} from '../waveModel';

const v4 = (a: readonly number[]) => a.map(glslFloat).join(', ');

/**
 * Wave GLSL for the water surface: quality tiers, shared uniforms, the wind-driven Gerstner sum and the small
 * per-pixel ripples. Both stages include `WATER_STAGE_COMMON_GLSL`; `WATER_DETAIL_GLSL` is fragment-only (it needs
 * `tHash` from `NOISE_GLSL`).
 */

/** Every `waterConfig` uniform is a float: declare them from the config's keys so the two never drift. */
const WATER_UNIFORM_DECLS = `uniform float ${Object.keys(getWaterUniforms()).join(', ')};`;

/**
 * Feature switches derived from the one `WATER_QUALITY` define (0 LOW, 1 MEDIUM, 2 HIGH).
 * LOW: 2 Gerstner waves, no ripples, no caustics, no parallax, 1 field fetch.
 * MED: 3 waves, 1 ripple octave, caustics, wind-onshore foam, 1 field fetch.
 * HIGH: 4 waves, 2 ripple octaves, caustics, refracted-bed parallax (+1 field fetch).
 */
export const WATER_TIER_GLSL = /* glsl */ `
#ifndef WATER_QUALITY
#define WATER_QUALITY 2
#endif
#if WATER_QUALITY >= 2
#define WATER_WAVE_COUNT 4
#define WATER_DETAIL_OCTAVES 2
#define WATER_CAUSTICS
#define WATER_PARALLAX
#define WATER_ONSHORE
#elif WATER_QUALITY == 1
#define WATER_WAVE_COUNT 3
#define WATER_DETAIL_OCTAVES 1
#define WATER_CAUSTICS
#define WATER_ONSHORE
#else
#define WATER_WAVE_COUNT 2
#define WATER_DETAIL_OCTAVES 0
#endif
`;

/**
 * Gerstner sum. Directions = wind direction rotated by fixed spreads; wavelengths scale with `uWaveScale`; the deep
 * water dispersion relation omega = sqrt(g k) makes long waves outrun short ones (no "everything at one speed" look).
 * Amplitude is set as a slope k*A (scale-invariant) from the LOCAL gusty wind, so gust fronts visibly roll across.
 */
export const WATER_WAVES_GLSL = /* glsl */ `
#define WATER_G 9.81
const vec4 WAVE_LAMBDA = vec4(${v4(WAVE_LAMBDA)});          // metres at uWaveScale = 1
const vec4 WAVE_SPREAD = vec4(0.0, 0.4712, -0.6632, 1.1345); // 0, +27, -38, +65 degrees off the wind
const vec4 WAVE_PHASE0 = vec4(0.0, 1.7, 4.1, 2.6);
const vec4 WAVE_WEIGHT = vec4(${v4(WAVE_WEIGHT)});
const float WAVE_SLOPE = ${glslFloat(WAVE_SLOPE)};     // k*A of the primary wave at wind amplitude 1
const float WAVE_SLOPE_MAX = ${glslFloat(WAVE_SLOPE_MAX)};  // k*A at a full gale: steepness is normalised to it
const float WAVE_VERT_PEAK = ${glslFloat(WAVE_VERT_PEAK)};  // m; values and CPU mirror in waveModel.ts

/** Wave amplitude factor from the local wind strength; never 0, so calm water keeps a residual swell. */
float waterWindAmp(float ws) { return ${glslFloat(WIND_AMP.base)} + ${glslFloat(WIND_AMP.gain)} * min(ws, ${glslFloat(WIND_AMP.maxWs)}); }

/** Phase of wave \`i\` at \`p\`; also returns its wavenumber and direction. */
float waterWavePhase(int i, vec2 p, out float k, out vec2 dir) {
  float c = cos(WAVE_SPREAD[i]), s = sin(WAVE_SPREAD[i]);
  dir = vec2(uWindDir.x * c - uWindDir.y * s, uWindDir.x * s + uWindDir.y * c);
  k = 6.2831853 / (WAVE_LAMBDA[i] * uWaveScale);
  return k * dot(dir, p) - sqrt(WATER_G * k) * uWaterTime + WAVE_PHASE0[i];
}

/**
 * Vertex height: only components whose wavelength the mesh can carry (hex lattice = 2 m, so >= ~8 m); a wave that
 * shrinks below that (uWaveScale < 1) fades out instead of popping per tile. Soft-clamped to WAVE_VERT_PEAK.
 */
float waterSwellHeight(vec2 p) {
  float ka0 = WAVE_SLOPE * waterWindAmp(windStrengthAt(p)) * uWaveHeight;
  float h = 0.0;
  for (int i = 0; i < ${WAVE_VERT_COUNT}; i++) {
    float k; vec2 dir;
    float th = waterWavePhase(i, p, k, dir);
    float fade = smoothstep(${glslFloat(WAVE_VERT_FADE[0])}, ${glslFloat(WAVE_VERT_FADE[1])}, WAVE_LAMBDA[i] * uWaveScale);
    h += fade * ka0 * WAVE_WEIGHT[i] / k * sin(th);
  }
  return WAVE_VERT_PEAK * tanh(h / WAVE_VERT_PEAK);
}

struct WaterWave { vec2 slope; float h; float jac; };

/**
 * Full analytic sum for the fragment: height, slope (dh/dx, dh/dz) and the Gerstner Jacobian (N.y term,
 * < 0.3 = crest about to fold -> whitecap foam). Steepness grows with the wind (choppy gale, rolling calm).
 */
WaterWave waterWaves(vec2 p, float ws) {
  WaterWave w;
  w.slope = vec2(0.0); w.h = 0.0; w.jac = 1.0;
  float ka0 = WAVE_SLOPE * waterWindAmp(ws) * uWaveHeight;
  float chop = uWaveSteep * ka0 / WAVE_SLOPE_MAX;
  for (int i = 0; i < WATER_WAVE_COUNT; i++) {
    float k; vec2 dir;
    float th = waterWavePhase(i, p, k, dir);
    float ka = ka0 * WAVE_WEIGHT[i];
    float s = sin(th), c = cos(th);
    w.h += ka / k * s;
    w.slope += dir * (ka * c);
    w.jac -= chop * WAVE_WEIGHT[i] * s;
  }
  return w;
}
`;

/** Shared by both stages: tier switches, wind + water uniforms, the wave set. */
export const WATER_STAGE_COMMON_GLSL = `${WATER_TIER_GLSL}
${WIND_GLSL}
${WATER_UNIFORM_DECLS}
${WATER_WAVES_GLSL}`;

/**
 * Short ripples (< 2 m) as per-pixel normals: value noise with analytic derivatives (no extra evaluations), stretched
 * across the wind and scrolling downwind. Each octave fades where a pixel covers more than ~half a ripple (no
 * shimmer at distance); `footprint` = length(fwidth(p)), taken by the caller in uniform control flow. ALU only.
 */
export const WATER_DETAIL_GLSL = /* glsl */ `
vec3 vnoiseD(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = tHash(i), b = tHash(i + vec2(1.0, 0.0)), c = tHash(i + vec2(0.0, 1.0)), d = tHash(i + vec2(1.0, 1.0));
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}

vec2 waterDetailSlope(vec2 p, float ws, float footprint) {
  vec2 s = vec2(0.0);
#if WATER_DETAIL_OCTAVES > 0
  vec2 W = uWindDir, C = vec2(-uWindDir.y, uWindDir.x);
  float amp = uWaterDetail * (0.016 + 0.026 * min(ws, 2.0)); // gentle: steeper ripples scatter sun glints over the whole lake
  float f = 1.6;
  for (int i = 0; i < WATER_DETAIL_OCTAVES; i++) {
    float fi = float(i);
    vec2 q = vec2(dot(p, W) * f - uWaterTime * (1.3 + 0.9 * fi), dot(p, C) * f * 0.55) + fi * 17.3;
    vec3 n = vnoiseD(q);
    float aa = 1.0 - smoothstep(0.25, 0.6, footprint * f);
    s += (amp * aa * f) * (n.y * W + n.z * 0.55 * C);
    amp *= 0.5; f *= 2.3;
  }
#endif
  return s;
}
`;
