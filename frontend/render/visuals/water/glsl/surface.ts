import { WATER_SIGMA_GLSL } from './bed';

/**
 * Water body GLSL (fragment): hex-exact tile clip, Beer-Lambert volume colour/opacity, refracted-bed parallax and
 * caustics. All ALU except the one optional parallax field fetch, which the caller does.
 */

/**
 * Hex-exact clip for the hex planet water (tile readability): the fragment's tile must be the one whose centre
 * `vWaterPos / vWaterMask` interpolates to, else discard. Returns the alpha fade at hex edges next to dry banks.
 * On the prototype plane (mask 1 everywhere) it never discards.
 */
export const WATER_HEX_CLIP_GLSL = /* glsl */ `
float waterHexClip(vec2 p) {
  vec2 tp = p * 0.5;
  float hr = tp.y * 1.1547005;
  vec2 ax = vec2(tp.x - hr * 0.5, hr);
  vec3 cube = vec3(ax.x, -ax.x - ax.y, ax.y);
  vec3 rc = floor(cube + 0.5);
  vec3 df = abs(rc - cube);
  if (df.x > df.y && df.x > df.z) rc.x = -rc.y - rc.z; else if (df.y > df.z) rc.y = -rc.x - rc.z; else rc.z = -rc.x - rc.y;
  vec2 cen = vec2(rc.x + rc.z * 0.5, rc.z * 0.8660254);
  vec2 ho = tp - cen;
  float he = 0.5 - max(max(abs(ho.x), abs(dot(ho, vec2(0.5, 0.8660254)))), abs(dot(ho, vec2(-0.5, 0.8660254))));
  float inWaterHex = step(0.05, vWaterMask) * step(length(cen - vWaterPos / max(vWaterMask, 1e-4)), 0.72);
  if (inWaterHex < 0.5) discard;
  float nearDryBank = 1.0 - smoothstep(0.52, 0.72, vWaterMask);
  return mix(1.0, smoothstep(0.0, 0.12, he * 2.0), nearDryBank);
}
`;

/**
 * Volume. Per-channel extinction (red dies first) along the refracted in-water path, x `uAbsorption`. Transmittance
 * drives both the in-scatter colour (shallow -> deep palette) and the opacity, so shallow water shows the terrain bed
 * through it and deep water goes mostly opaque (alpha <= 0.8, so fauna under it still shows). Deepest water darkens a little more ("deep").
 */
export const WATER_VOLUME_GLSL = /* glsl */ `
${WATER_SIGMA_GLSL}
const vec3 WATER_LUMA = vec3(0.2, 0.5, 0.3);
/** Fallback shore distance per metre of depth when the texture has no distance channel (approx. 1:3 bank). */
const float WATER_SHORE_PER_DEPTH = 3.0;

struct WaterBody { vec3 color; float alpha; };

/** Refracted view ray into the water (air -> water, n = 1.33). */
vec3 waterRefractDir(vec3 V, vec3 N) { return refract(-V, N, 0.7518797); }

/** Where the refracted ray meets a flat bed \`depth\` below: texture-space parallax, clamped to 3 m. */
vec2 waterParallaxOffset(vec3 R, float depth) {
  vec2 off = R.xz / max(-R.y, 0.25) * (depth * uParallax);
  float l = length(off);
  return l > 3.0 ? off * (3.0 / l) : off;
}

WaterBody waterBody(float depth, float pathCos, vec3 shallow, vec3 deep) {
  float thick = depth / max(pathCos, 0.2);
  vec3 T = exp(-WATER_SIGMA * (thick * uAbsorption));
  float tl = dot(T, WATER_LUMA);
  WaterBody b;
  b.color = mix(deep, shallow, smoothstep(0.02, 0.95, tl)) * (1.0 - 0.28 * smoothstep(1.6, 4.5, thick * uAbsorption));
  b.color = mix(b.color, shallow * 1.15, (1.0 - smoothstep(0.0, 0.8, depth)) * 0.25);
  // capped below 1: the terrain tints the bed itself (bed.ts), and fish / jellies must show through deep water
  b.alpha = clamp(0.4 + (1.0 - tl) * 0.6, 0.4, 0.8);
  return b;
}

/**
 * Sunlit caustic web on the (parallax-shifted) bed point: the zero set of the difference of two drifting value
 * noises. x uCaustics x daylight, fading with depth and with how much of the bed the water hides.
 */
vec3 waterCausticLight(vec2 bp, float depth, float alpha) {
  vec2 q = bp * 0.9;
  float t = uWaterTime;
  float a = vnoise(q + vec2(0.23, 0.11) * t);
  float b = vnoise(q * 1.31 + vec2(-0.17, 0.21) * t + 7.3);
  float web = 1.0 - min(abs(a - b) * 3.2, 1.0);
  web *= web; web *= web;
  float k = uCaustics * (1.0 - clamp(uNightFactor, 0.0, 1.0)) * exp(-depth * 0.7) * (1.0 - alpha * 0.6);
  return vec3(0.55, 0.68, 0.62) * (web * k * 0.3);
}
`;
