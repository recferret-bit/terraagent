import { COLONY_VISION_AND_LIGHTS_GLSL } from '../../../lighting/ColonyVisionAndLights';
import { VIEW_FOCUS_GLSL } from '../../../core/viewFocus';
import { NOISE_GLSL } from '../../terrain/glsl';
import { WATER_FOAM_GLSL } from './foam';
import { WATER_REFLECT_GLSL } from './reflections';
import { WATER_HEX_CLIP_GLSL, WATER_VOLUME_GLSL } from './surface';
import { WATER_DETAIL_GLSL, WATER_STAGE_COMMON_GLSL } from './waves';

/**
 * Injection tables for the water's MeshStandardMaterial (`[three.js anchor, replacement]`, applied in order with
 * `injectAll`, which throws on a missing anchor). The surface is evaluated ONCE in the `color_fragment` stage into
 * `wa*` locals at main() scope; the roughness, normal, emissive and output stages only read them.
 *
 * Per-fragment cost (beyond MeshStandardMaterial + the shared FoV shroud):
 *   LOW  : 1 field fetch, 2 Gerstner waves, shore foam (3 value noises), no ripples / caustics / parallax.
 *   MED  : 1 field fetch, 3 waves, 1 ripple octave, caustics (2 noises), onshore foam (screen derivatives).
 *   HIGH : 2 field fetches (bed + refracted bed), 4 waves, 2 ripple octaves, caustics, parallax.
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

const VERT_MAIN = /* glsl */ `
vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
vWaterWorldPos = wp; // undisplaced: the hex clip compares it with vWaterPos
float waterVert = smoothstep(-0.14, -0.02, position.y); // shore vertices are pinned at y = -0.16
vWaterMask = waterVert;
vWaterPos = waterVert * (wp.xz * 0.5);
float waFocusV = viewFocusWeight(wp.xz, WATER_FOCUS_FADE) * waterVert;
if (waFocusV > 0.0) transformed.y += waterSwellHeight(wp.xz) * waFocusV;`;

const FRAG_DECLS = /* glsl */ `${VARYINGS}
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
${WATER_REFLECT_GLSL}`;

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
float waFoam = waterShoreFoam(waP, waShore, waterOnshore(waShore, waP, waWind), waFocus);
if (waFocus > 0.0) waFoam += waterCrestFoam(waP, waW, waWind) * waFocus;
waFoam = clamp(waFoam * uFoamAmount, 0.0, 0.92);
float waRough = waterRoughness(waWind, waFoam, waN);
vec3 waSpecEmis = vec3(0.0);
diffuseColor.rgb = mix(waB.color, uFoamColor, waFoam);
diffuseColor.a = max(waB.alpha, waFoam * 0.95) * waBank;`;

/** Sky fresnel tint, projector diffuse + specular (one loop), sun glint. `normal` is the wave normal by now. */
const FRAG_EMISSIVE = /* glsl */ `
{
  vec3 waVv = normalize(vViewPosition);
  float waFr = pow(1.0 - saturate(dot(normal, waVv)), 3.0);
  vec3 waPd = vec3(0.0), waPs = vec3(0.0);
  colonyProjectorLighting(vWaterWorldPos, waN, waV, waterSpecShininess(waterProjectorRoughness(waRough)), waPd, waPs);
  // lamps are tiny HDR sources: a physical 2-6 % Fresnel at diorama angles hides them, so floor it (stylised)
  waSpecEmis = waPs * (max(waterFresnel(dot(waN, waV)), 0.4) * uProjectorReflect);
#if NUM_DIR_LIGHTS > 0
  waSpecEmis += waterSunGlint(normal, waVv, directionalLights[0].direction, directionalLights[0].color, waP, waRough, waFocus);
#endif
  totalEmissiveRadiance += uSky * waFr * 0.55 * (1.0 - clamp(uNightFactor, 0.0, 1.0) * 0.88)
    + diffuseColor.rgb * waPd + waPd * 0.12 + waSpecEmis;
}`;

/** A reflection is not hidden by transparency: raise alpha by the reflected luminance (keeps the bank fade). */
const FRAG_OUTPUT = /* glsl */ `
diffuseColor.a = clamp(diffuseColor.a + dot(totalSpecular + waSpecEmis, vec3(0.299, 0.587, 0.114)) * waBank, 0.0, 1.0);`;

const FRAG_FOG = /* glsl */ `
#ifdef USE_FOG
  { float eg = smoothstep(0.5, 0.93, length(vWaterWorldPos.xz) / (uSpan * 0.5)); // same radial fade as the terrain edge
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, eg); gl_FragColor.a = mix(gl_FragColor.a, 1.0, eg); }
#endif
gl_FragColor.rgb = applyColonyFovShroud(vWaterWorldPos, gl_FragColor.rgb);`;

export const WATER_VERTEX_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#include <common>', `#include <common>\n${VARYINGS}\n${WATER_STAGE_COMMON_GLSL}\n${WATER_FOCUS_GLSL}`],
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
