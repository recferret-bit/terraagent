import { glslFloat } from '../../shaderInject';

/**
 * Planar mirror reflection GLSL (contract: `reflection/reflectionUniforms.ts`). Compiled only where the tier defines
 * `WATER_MIRROR` (MED = 1 tap, HIGH = 3 taps); LOW has no reflection code at all. `uReflDistort` and `uReflDebug` are
 * `waterConfig` uniforms, declared with the others by `WATER_STAGE_COMMON_GLSL`; the sky key uniforms come from
 * `../mirrorSky.ts` (captured per water draw).
 */

/**
 * Distortion as a WORLD offset of the mirrored point (metres per unit of wave-normal tilt): base + gain x wind, so a
 * calm day stays close to a mirror and a gale smears. Projected through `uReflMatrix`, it is rotation-correct for any
 * camera yaw and shrinks with distance by itself (perspective divide). Kept well under the size of what is reflected
 * (bots 1-2 m, trees / buildings 2-5 m): at 0.4 + 0.8 x wind a bot's image smeared into a pale blob.
 */
export const MIRROR_DISTORT_BASE_M = 0.15;
export const MIRROR_DISTORT_WIND_M = 0.35;
/** Vertical streak half-length (mirror-texture uv) at HIGH: base + gain x surface roughness. */
export const MIRROR_STREAK_BASE = 0.002;
export const MIRROR_STREAK_ROUGH = 0.012;
/**
 * Fresnel floor: a physical 2-6 % at the ~42 degree diorama pitch would hide the reflection (stylised, cf. 0.4 for
 * lamps). Only reflected OBJECTS get this cover (see the sky key below), so it can be high without milking the lake.
 */
export const MIRROR_FRESNEL_FLOOR = 0.75;
/**
 * Sky key (`../mirrorSky.ts`): the mirror's sky is the sky dome, a gradient on one RGB segment horizon -> top (or the
 * flat background), which holds no image, only a bright wash. Texels within KEY0 of it (relative colour distance) are
 * sky and leave the water as it is (its own Fresnel sky tint and IBL); texels beyond KEY1 are reflected objects at
 * full cover. Fogged distant objects fade toward the horizon colour and so fade out of the mirror too.
 */
export const MIRROR_SKY_KEY0 = 0.04;
export const MIRROR_SKY_KEY1 = 0.2;
/** How much foam mattes the mirror (1 = fully: the shore foam band would swallow every shoreline reflection). */
export const MIRROR_FOAM_MATTE = 0.5;

/** Both stages, after `WATER_STAGE_COMMON_GLSL` (needs the tier defines): the mirror projection + its varying. */
export const WATER_MIRROR_COMMON_GLSL = /* glsl */ `
#ifdef WATER_MIRROR
uniform mat4 uReflMatrix;
varying vec4 vWaterReflPos; // mirror clip space of the UNDISPLACED surface point (incl. the 0..1 bias)
#endif`;

/** Vertex: `wp` is the undisplaced world position (before the swell). */
export const WATER_MIRROR_VERT_GLSL = /* glsl */ `
#ifdef WATER_MIRROR
vWaterReflPos = uReflMatrix * vec4(wp, 1.0);
#endif`;

/** Fragment helpers. */
export const WATER_MIRROR_FRAG_GLSL = /* glsl */ `
#ifdef WATER_MIRROR
uniform sampler2D uReflTex;
uniform vec4 uReflRect;
uniform float uReflOn;
uniform vec3 uReflSkyLo, uReflSkyHi; // sky dome horizon / top colour (linear): the sky segment
uniform vec3 uReflBg;                // the flat background colour
uniform float uReflSkyKey;           // 0 = nothing to key on: every texel is an object

/** Clamps into the region the pass rendered this frame, half a texel in (bilinear never reads past it). */
vec2 waterMirrorClamp(vec2 uv) {
  vec2 ht = 0.5 / vec2(textureSize(uReflTex, 0));
  return clamp(uv, uReflRect.xy + ht, max(uReflRect.zw - ht, uReflRect.xy + ht));
}

/**
 * Mirror image seen through the wave normal \`N\` (wind waves + ripples, already x the view-focus weight): the
 * mirrored point is shifted by a world offset along N.xz, then projected. HIGH adds two taps along the mirror-image
 * vertical (reflections stretch toward the viewer), spread by roughness. Linear HDR radiance.
 */
vec3 waterMirror(vec3 N, float ws, float rough) {
  vec2 waveShear = vec2(
    sin(vWaterWorldPos.z * 4.8 + uWaterTime * 5.2) + 0.5 * sin(vWaterWorldPos.z * 11.5 - uWaterTime * 7.8),
    cos(vWaterWorldPos.x * 4.4 - uWaterTime * 4.6) + 0.45 * sin((vWaterWorldPos.x + vWaterWorldPos.z) * 8.2 + uWaterTime * 6.4)
  );
  float shearScale = uReflDistort * (0.28 + 0.18 * min(ws, 2.0) + 0.35 * clamp(uRainIntensity, 0.0, 1.0));
  vec2 off = N.xz * (uReflDistort * (${glslFloat(MIRROR_DISTORT_BASE_M)} + ${glslFloat(MIRROR_DISTORT_WIND_M)} * min(ws, 2.0)))
    + waveShear * (shearScale * 0.62);
  vec4 c0 = vWaterReflPos + uReflMatrix[0] * off.x + uReflMatrix[2] * off.y;
  vec2 uv = c0.xy / max(c0.w, 1e-3);
  vec3 col0 = texture2D(uReflTex, waterMirrorClamp(uv)).rgb;
  vec3 col = col0;
#if WATER_MIRROR_TAPS > 1
  vec2 shearOff = waveShear * shearScale;
  vec4 cA = c0 + uReflMatrix[0] * shearOff.x + uReflMatrix[2] * (shearOff.y * 0.65);
  vec4 cB = c0 - uReflMatrix[0] * (shearOff.x * 0.92) - uReflMatrix[2] * (shearOff.y * 0.75);
  vec2 st = vec2(waveShear.x * 0.016 * uReflDistort, uReflDistort * (${glslFloat(MIRROR_STREAK_BASE)} + ${glslFloat(MIRROR_STREAK_ROUGH)} * rough));
  vec3 colA = texture2D(uReflTex, waterMirrorClamp(cA.xy / max(cA.w, 1e-3) + st)).rgb;
  vec3 colB = texture2D(uReflTex, waterMirrorClamp(cB.xy / max(cB.w, 1e-3) - st)).rgb;
  vec3 baseCol = col0 * 0.5 + 0.25 * (colA + colB);
  float lum0 = max(col0.r, max(col0.g, col0.b));
  float lumA = max(colA.r, max(colA.g, colA.b));
  float lumB = max(colB.r, max(colB.g, colB.b));
  float hdrLum = max(lum0, max(lumA, lumB));
  float hdrWeight = smoothstep(0.85, 1.45, hdrLum);
  float rippleMod = 0.58 + 0.42 * sin(vWaterWorldPos.z * 9.5 - uWaterTime * 8.5 + waveShear.x * 2.6);
  vec3 hdrCol = (max(colA, colB) * 0.66 + (col0 + colA + colB) * 0.24) * rippleMod;
  col = mix(baseCol, hdrCol, hdrWeight);
#endif
  return col;
}

/** Relative colour distance from \`c\` to the RGB segment [a, b]. */
float waterSkyDistance(vec3 c, vec3 a, vec3 b) {
  vec3 ab = b - a;
  vec3 p = a + ab * clamp(dot(c - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(c - p) / (length(p) + 0.05);
}

/** 0 where the mirror texel is plain sky (dome gradient or background), 1 where it shows an object. */
float waterMirrorObject(vec3 c) {
  if (uReflSkyKey < 0.5) return 1.0;
  float d = min(waterSkyDistance(c, uReflSkyLo, uReflSkyHi), waterSkyDistance(c, uReflBg, uReflBg));
  return smoothstep(${glslFloat(MIRROR_SKY_KEY0)}, ${glslFloat(MIRROR_SKY_KEY1)}, d);
}

/** Cover of the mirror image over the water: floored Fresnel x strength x object key; foam is half matte. */
float waterMirrorWeight(float ndv, float foam, vec3 mirror) {
  float w = min(max(waterFresnel(ndv), ${glslFloat(MIRROR_FRESNEL_FLOOR)}) * uReflOn, 1.0);
  return w * (1.0 - foam * ${glslFloat(MIRROR_FOAM_MATTE)}) * waterMirrorObject(mirror);
}
#endif`;
