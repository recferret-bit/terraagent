import { COLONY_VISION_AND_LIGHTS_GLSL } from '../../../lighting/ColonyVisionAndLights';
import { VIEW_FOCUS_GLSL } from '../../../core/viewFocus';
import { NOISE_GLSL } from '../../terrain/glsl';
import { WATER_FOAM_GLSL } from './foam';
import { WATER_MIRROR_COMMON_GLSL, WATER_MIRROR_FRAG_GLSL, WATER_MIRROR_VERT_GLSL } from './mirror';
import { WATER_REFLECT_GLSL } from './reflections';
import { WATER_HEX_CLIP_GLSL, WATER_VOLUME_GLSL } from './surface';
import { WATER_DETAIL_GLSL, WATER_STAGE_COMMON_GLSL } from './waves';

/**
 * Injection tables for the water's MeshStandardMaterial (`[three.js anchor, replacement]`, applied in order with
 * `injectAll`, which throws on a missing anchor). The surface is evaluated ONCE in the `color_fragment` stage into
 * `wa*` locals at main() scope; the roughness, normal, emissive and output stages only read them.
 *
 * Per-fragment cost (beyond MeshStandardMaterial + the shared FoV shroud):
 *   LOW  : 1 field fetch, 2 Gerstner waves, shore foam (3 value noises), no ripples / caustics / parallax / mirror.
 *   MED  : 1 field fetch, 3 waves, 1 ripple octave, caustics (2 noises), onshore foam (screen derivatives),
 *          mirror reflection: 1 tap (+1 vec4 varying, 2 vec4 MADs for the distortion, ~25 ALU for the sky key (two
 *          colour-segment distances) and the over-composite; no extra texture fetch).
 *   HIGH : 2 field fetches (bed + refracted bed), 4 waves, 2 ripple octaves, caustics, parallax,
 *          mirror reflection: 3 taps (centre + 2 along the mirror-image vertical: the stretch toward the viewer).
 *   Mirror taps are skipped (uniform branch) while `uReflOn` = 0, i.e. the pass did not run this frame.
 *   All  : 1 sparkle noise for the sun glint; the projector loop is the existing one (diffuse + specular together).
 *   Off the view focus (`viewFocusWeight` = 0, only when zoomed out with the focus capped): no vertex swell, no waves,
 *   ripples, caustics, crest foam, foam motion or sparkle; a still surface with the static shore band. The weight
 *   fades over WATER_FOCUS_FADE metres and scales the AMPLITUDES (never the clocks), so the edge cannot pop or smear.
 */

/** View-focus weight + its fade distance (m) for both stages (`core/viewFocus.ts`; `uViewFocus` is shared). */
const WATER_FOCUS_GLSL = /* glsl */ `${VIEW_FOCUS_GLSL}
#define WATER_FOCUS_FADE 12.0`;

const VARYINGS = /* glsl */ `varying vec3 vWaterWorldPos;
varying float vWaterMask;
varying vec2 vWaterPos;`;

export const WATER_UNIFORMS_GLSL = /* glsl */ `uniform float uRainIntensity, uWetness, uPuddleLevel, uStormDarkness, uWeatherTime, uWaterElectroIntensity;
uniform vec2 uWaterElectroOrigin;`;

const VERT_MAIN = /* glsl */ `
vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
vWaterWorldPos = wp; // undisplaced: the hex clip compares it with vWaterPos
${WATER_MIRROR_VERT_GLSL}
float waterVert = smoothstep(-0.14, -0.02, position.y); // shore vertices are pinned at y = -0.16
vWaterMask = waterVert;
vWaterPos = waterVert * (wp.xz * 0.5);
float waFocusV = viewFocusWeight(wp.xz, WATER_FOCUS_FADE) * waterVert;
if (waFocusV > 0.0) transformed.y += waterSwellHeight(wp.xz) * waFocusV;`;

const FRAG_DECLS = /* glsl */ `${VARYINGS}
${WATER_UNIFORMS_GLSL}
uniform sampler2D uHeightTex;
uniform float uSpan, uLevelW;
uniform vec3 uSky, uShallowColor, uDeepColor, uFoamColor;
${COLONY_VISION_AND_LIGHTS_GLSL}
${WATER_STAGE_COMMON_GLSL}
${WATER_FOCUS_GLSL}
${NOISE_GLSL}
${WATER_DETAIL_GLSL}
${WATER_HEX_CLIP_GLSL}
${WATER_VOLUME_GLSL}
${WATER_FOAM_GLSL}
${WATER_REFLECT_GLSL}
${WATER_MIRROR_COMMON_GLSL}
${WATER_MIRROR_FRAG_GLSL}`;

/** Field: R = bed height (m); with WATER_SHORE_FIELD also G = distance to dry ground (m). One fetch. */
const FRAG_FIELD = /* glsl */ `
vec2 waP = vWaterWorldPos.xz;
vec4 waField = texture2D(uHeightTex, waP / uSpan + 0.5);
float waDepth = max(uLevelW - waField.r, 0.28 * vWaterMask);
#ifdef WATER_SHORE_FIELD
float waShore = waField.g;
#else
float waShore = max(uLevelW - waField.r, 0.0) * WATER_SHORE_PER_DEPTH;
#endif
float waMaskShore = clamp((vWaterMask - 0.46) * 1.85, 0.0, 2.0) + smoothstep(0.86, 0.99, vWaterMask) * 4.0;
float waEffShore = min(waShore, waMaskShore);
float waBank = waterHexClip(waP);`;

const FRAG_WAVES = /* glsl */ `
float waFocus = viewFocusWeight(waP, WATER_FOCUS_FADE); // 0 off the view focus: still, cheap water
float waFootprint = length(fwidth(waP)); // derivatives stay in uniform control flow
float waWind = uWindStrength;
WaterWave waW = WaterWave(vec2(0.0), 0.0, 1.0);
vec2 waSlope = vec2(0.0);
if (waFocus > 0.0) {
  waWind = mix(uWindStrength, windStrengthAt(waP), waFocus);
  waW = waterWaves(waP, waWind);
  waW.slope *= waFocus; waW.h *= waFocus; waW.jac = mix(1.0, waW.jac, waFocus);
  waSlope = waW.slope + waterDetailSlope(waP, waWind, waFootprint) * waFocus;
  if (uRainIntensity > 0.01) {
    waSlope += waterRainRippleSlope(waP, uWeatherTime, uRainIntensity) * (0.28 + 0.35 * uRainIntensity) * waFocus;
  }
}
vec3 waN = normalize(vec3(-waSlope.x, max(waW.jac, 0.2), -waSlope.y));
vec3 waV = normalize(cameraPosition - vWaterWorldPos);
vec3 waR = waterRefractDir(waV, waN);`;

const FRAG_BODY = /* glsl */ `
#ifdef WATER_PARALLAX
vec2 waBedP = waP + waterParallaxOffset(waR, waDepth);
float waPathDepth = max(uLevelW - texture2D(uHeightTex, waBedP / uSpan + 0.5).r, 0.28 * vWaterMask);
#else
vec2 waBedP = waP;
float waPathDepth = waDepth;
#endif
WaterBody waB = waterBody(waPathDepth, -waR.y, uShallowColor, uDeepColor);
#ifdef WATER_CAUSTICS
if (waFocus > 0.0) waB.color += waterCausticLight(waBedP, waPathDepth, waB.alpha) * waFocus;
#endif
float waRainBubbles = (waFocus > 0.0 && uRainIntensity > 0.01) ? waterRainBubbles(waP, uWeatherTime, uRainIntensity) * waFocus : 0.0;
float waFoam = waterShoreFoam(waP, waEffShore, waterOnshore(waEffShore, waP, waWind), waFocus);
if (waFocus > 0.0) waFoam += waterCrestFoam(waP, waW, waWind) * waFocus;
waFoam = clamp(waFoam * uFoamAmount + waRainBubbles * 0.78, 0.0, 0.96);
float waRough = waterRoughness(waWind, waFoam, waN);
vec3 waSpecEmis = waterRainSurfaceHighlight(waP, waRainBubbles, uRainIntensity, uFoamColor);
vec3 waFoamTint = mix(uFoamColor, vec3(0.96, 0.98, 1.0), 0.75);
diffuseColor.rgb = mix(waB.color, waFoamTint, clamp(waFoam * 0.95, 0.0, 0.96));
if (uWaterElectroIntensity > 0.001) {
  vec3 waElectro = waterElectrocutionField(waP, uWaterElectroIntensity, uWaterElectroOrigin, uWeatherTime) * smoothstep(0.05, 0.35, vWaterMask);
  diffuseColor.rgb = min(vec3(1.0), diffuseColor.rgb + waElectro * 0.65);
  waSpecEmis += waElectro * 2.2;
}
float waFoamAlpha = waFoam * 0.94 * smoothstep(0.0, 0.25, waBank);
diffuseColor.a = max(waB.alpha * waBank, waFoamAlpha);`;

/**
 * Planar mirror (MED/HIGH, only while the pass ran), main scope for FRAG_OUTPUT: rgb = the sampled (distorted) mirror
 * radiance, a = its cover. Plain sky texels get no cover (`waterMirrorObject`): the water keeps its own sky tint there.
 */
const FRAG_MIRROR = /* glsl */ `
vec4 waMirror = vec4(0.0);
#ifdef WATER_MIRROR
if (uReflOn > 0.0) {
  waMirror.rgb = waterMirror(waN, waWind, waRough);
  waMirror.a = waterMirrorWeight(dot(waN, waV), waFoam, waMirror.rgb);
}
#endif`;

/** Mirror sample, sky fresnel tint, projector diffuse + specular (one loop), sun glint. `normal` is the wave normal by now. */
const FRAG_EMISSIVE = /* glsl */ `${FRAG_MIRROR}
{
  vec3 waVv = normalize(vViewPosition);
  float waFr = pow(1.0 - saturate(dot(normal, waVv)), 3.0);
  vec3 waPd = vec3(0.0), waPs = vec3(0.0);
  colonyProjectorLighting(vWaterWorldPos, waN, waV, waterSpecShininess(waterProjectorRoughness(waRough)), waPd, waPs);
  // lamps are tiny HDR sources: a physical 2-6 % Fresnel at diorama angles hides them, so floor it (stylised)
  waSpecEmis += waPs * (max(waterFresnel(dot(waN, waV)), 0.4) * uProjectorReflect);
#if NUM_DIR_LIGHTS > 0
  waSpecEmis += waterSunGlint(normal, waVv, directionalLights[0].direction, directionalLights[0].color, waP, waRough, waFocus);
#endif
  totalEmissiveRadiance += uSky * waFr * 0.55 * (1.0 - clamp(uNightFactor, 0.0, 1.0) * 0.88)
    + diffuseColor.rgb * waPd + waPd * 0.12 + waSpecEmis;
}`;

/**
 * Glints and lamps are not hidden by transparency: alpha rises by their luminance (keeps the bank fade). The mirror
 * image then lies OVER that water with cover c = waMirror.a x bank, whatever its brightness (a dark tree hides the bed
 * as well as a bright one): premultiplied, out = c x mirror + (1 - c) x water, alpha = c + (1 - c) x a. The sun glint
 * and lamp reflections (not in the mirror texture) stay on top at their old strength. Debug: the mirror image alone.
 */
const FRAG_OUTPUT = /* glsl */ `
diffuseColor.a = clamp(diffuseColor.a + dot(totalSpecular + waSpecEmis, vec3(0.299, 0.587, 0.114)) * waBank, 0.0, 1.0);
#ifdef WATER_MIRROR
if (uReflOn > 0.0) {
  float waMc = waMirror.a * waBank;
  float waMa = waMc + (1.0 - waMc) * diffuseColor.a;
  vec3 waGlint = reflectedLight.directSpecular + waSpecEmis;
  outgoingLight = (waMirror.rgb * waMc + diffuseColor.a * ((1.0 - waMc) * outgoingLight + waMc * waGlint)) / max(waMa, 1e-4);
  diffuseColor.a = waMa;
  if (uReflDebug > 0.5) { outgoingLight = waMirror.rgb; diffuseColor.a = 1.0; }
}
#endif`;

const FRAG_FOG = /* glsl */ `
#ifdef USE_FOG
  { float eg = smoothstep(0.5, 0.93, length(vWaterWorldPos.xz) / (uSpan * 0.5)); // same radial fade as the terrain edge
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, eg); gl_FragColor.a = mix(gl_FragColor.a, 1.0, eg); }
#endif
gl_FragColor.rgb = applyColonyFovShroud(vWaterWorldPos, gl_FragColor.rgb);`;

export const WATER_VERTEX_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#include <common>', `#include <common>\n${VARYINGS}\n${WATER_STAGE_COMMON_GLSL}\n${WATER_FOCUS_GLSL}\n${WATER_MIRROR_COMMON_GLSL}`],
  ['#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`],
];

export const WATER_FRAGMENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#include <common>', `#include <common>\n${FRAG_DECLS}`],
  ['#include <color_fragment>', `#include <color_fragment>\n${FRAG_FIELD}\n${FRAG_WAVES}\n${FRAG_BODY}`],
  ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = waRough;'],
  ['#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(waN, 0.0)).xyz);'],
  ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`],
  ['#include <opaque_fragment>', `${FRAG_OUTPUT}\n#include <opaque_fragment>`],
  ['#include <fog_fragment>', `#include <fog_fragment>\n${FRAG_FOG}`],
];
