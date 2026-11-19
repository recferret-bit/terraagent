import * as THREE from 'three';
import { getWeatherUniforms } from '../../core/weatherConfig';
import { getWindUniforms } from '../../core/windConfig';
import { bindViewFocusUniforms, VIEW_FOCUS_GLSL } from '../../core/viewFocus';
import { getColonyVisionUniforms, COLONY_VISION_AND_LIGHTS_GLSL } from '../../lighting/ColonyVisionAndLights';
import { injectAll } from '../../visuals/shaderInject';
import { NOISE_GLSL } from '../../visuals/terrain/glsl';
import { WATER_RENDER_ORDER } from '../../visuals/water/WaterMaterial';
import { getWaterQuality, getWaterUniforms, onWaterChange } from '../../visuals/water/waterConfig';
import { WATER_STAGE_COMMON_GLSL } from '../../visuals/water/glsl/waves';

/** Draw right after the water surface buckets (`WATER_RENDER_ORDER = 1.5`) and before projector beam cones (`2`). */
export const WATERFALL_RENDER_ORDER = WATER_RENDER_ORDER + 0.05;

export interface WaterfallMaterialOptions {
  shallow: number;
  deep: number;
  sky: number;
  foam?: number;
  span: number;
  sharedTime?: THREE.IUniform<number>;
}

export interface WaterfallMaterialResult {
  material: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

const WF_VERT_COMMON = /* glsl */ `attribute vec2 aFlowUV;
attribute vec3 aWaterfallMeta;
varying vec3 vWfWorldPos;
varying vec3 vWfWorldNormal;
varying vec2 vWfFlowUV;
varying vec3 vWfMeta;
${WATER_STAGE_COMMON_GLSL}
${VIEW_FOCUS_GLSL}`;

const WF_VERT_BEGIN = /* glsl */ `
vWfFlowUV = aFlowUV;
vWfMeta = aWaterfallMeta;
{
  vec3 wfWp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float wfDrop = aFlowUV.y;
  float wfLayer = aWaterfallMeta.z;
  float wfFocus = viewFocusWeight(wfWp0.xz, 12.0);
  if (wfFocus > 0.0) {
    float wfSwell = waterSwellHeight(wfWp0.xz) * (1.0 - smoothstep(0.0, 0.24, wfDrop));
    float wfRipple = sin(aFlowUV.x * 3.1 - wfDrop * 7.5 + uWaterTime * 4.4) * 0.045
      + cos(aFlowUV.x * 5.7 - wfDrop * 12.0 + uWaterTime * 6.1) * 0.025;
    float wfFlutter = smoothstep(0.06, 0.35, wfDrop) * (1.0 - smoothstep(0.75, 1.0, wfDrop) * 0.35);
    transformed += objectNormal * (wfRipple * wfFlutter * (1.0 + wfLayer * 0.55) * wfFocus);
    transformed.y += wfSwell * wfFocus;
    vec2 wfWindPush = uWindDir * (wfDrop * wfDrop * 0.28 * min(uWindStrength, 2.0) * (1.0 + wfLayer * 0.65) * wfFocus);
    transformed.xz += wfWindPush;
  }
  vWfWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWfWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
}`;

const WF_FRAG_COMMON = /* glsl */ `varying vec3 vWfWorldPos;
varying vec3 vWfWorldNormal;
varying vec2 vWfFlowUV;
varying vec3 vWfMeta;
uniform float uTime, uSpan;
uniform vec3 uSky, uShallowColor, uDeepColor, uFoamColor;
${COLONY_VISION_AND_LIGHTS_GLSL}
${WATER_STAGE_COMMON_GLSL}
${NOISE_GLSL}`;

const WF_FRAG_COLOR = /* glsl */ `
float wfDrop = vWfFlowUV.y;
float wfArc = vWfFlowUV.x;
float wfBank = smoothstep(0.0, 1.0, vWfMeta.x);
float wfDepth = clamp(vWfMeta.y, 0.0, 1.0);
float wfLayer = vWfMeta.z;
float wfT = uWaterTime + uTime * 0.001;
float wfSpeed = 3.2 + 0.8 * wfLayer;
vec2 wfFlowCoord = vec2(wfArc * 1.45, wfDrop * 2.4 - wfT * wfSpeed);
float wfStreakA = fbm3(wfFlowCoord * vec2(1.0, 0.65));
float wfStreakB = vnoise(vec2(wfArc * 3.4 + sin(wfDrop * 4.0 - wfT * 2.5) * 0.35, wfDrop * 4.5 - wfT * wfSpeed * 1.35));
float wfStreaks = smoothstep(0.28, 0.82, wfStreakA * 0.6 + wfStreakB * 0.45);
float wfSprayNoise = fbm3(vec2(wfArc * 1.15 - dot(vWfWorldPos.xz, vec2(-uWindDir.y, uWindDir.x)) * 0.14, wfDrop * 2.2 - wfT * 2.1));
vec3 wfBodyCol = mix(uShallowColor, uDeepColor, wfDepth * (1.0 - wfDrop * 0.45));
wfBodyCol = mix(wfBodyCol, uShallowColor * 1.2, smoothstep(0.14, 0.82, wfDrop) * 0.55);
float wfLipFoam = (1.0 - smoothstep(0.04, 0.24, wfDrop)) * (0.58 + 0.42 * wfStreakB);
float wfRibbonFoam = wfStreaks * smoothstep(0.06, 0.32, wfDrop) * (0.62 + 0.38 * wfDrop);
float wfMistZone = smoothstep(0.50, 0.88, wfDrop) * (0.45 + 0.55 * wfSprayNoise);
float wfVeilBreak = smoothstep(0.24, 0.78, wfSprayNoise * 0.55 + wfStreakB * 0.45);
float wfFoam = clamp((max(wfLipFoam, wfRibbonFoam * 0.85) + wfMistZone * 0.72) * (0.4 + 0.6 * clamp(uFoamAmount, 0.0, 1.5)), 0.0, 1.0);
if (wfLayer > 0.5) wfFoam = max(wfFoam, wfVeilBreak * 0.92);
vec3 wfFoamTint = mix(uFoamColor, vec3(0.95, 0.98, 1.0), 0.72);
diffuseColor.rgb = mix(wfBodyCol, wfFoamTint, clamp(wfFoam * 0.88 + wfLayer * 0.38, 0.0, 0.96));
float wfTopFade = smoothstep(0.0, 0.05, wfDrop);
float wfDissolveNoise = fbm3(vec2(wfArc * 1.6, wfDrop * 3.0 - wfT * 2.6));
float wfBottomMask = 1.0 - smoothstep(0.65, 0.99, wfDrop);
float wfBottomWisps = clamp((1.0 - smoothstep(0.58, 0.95, wfDrop + (0.5 - wfDissolveNoise) * 0.28)) * wfBottomMask * 1.35, 0.0, 1.0);
float wfBaseAlpha = mix(0.66, 0.86, wfDepth) * (0.72 + 0.28 * wfStreakA);
float wfVeilAlpha = wfVeilBreak * smoothstep(0.08, 0.45, wfDrop) * 0.46;
float wfAlpha = (wfLayer > 0.5 ? wfVeilAlpha : max(wfBaseAlpha, wfFoam * 0.9)) * wfTopFade * wfBottomWisps * wfBank;
diffuseColor.a = clamp(wfAlpha, 0.0, 0.92);`;

const WF_FRAG_EMISSIVE = /* glsl */ `{
  vec3 wfV = normalize(cameraPosition - vWfWorldPos);
  vec3 wfN = normalize(vWfWorldNormal);
  float wfFr = pow(1.0 - saturate(dot(wfN, wfV)), 2.8);
  vec3 wfPd = vec3(0.0), wfPs = vec3(0.0);
  colonyProjectorLighting(vWfWorldPos, wfN, wfV, 32.0, wfPd, wfPs);
  totalEmissiveRadiance += uSky * wfFr * 0.35 * (1.0 - clamp(uNightFactor, 0.0, 1.0) * 0.85)
    + diffuseColor.rgb * wfPd + wfPs * (0.35 * uProjectorReflect);
}`;

const WF_FRAG_FOG = /* glsl */ `
#ifdef USE_FOG
  { float wfEg = smoothstep(0.5, 0.93, length(vWfWorldPos.xz) / (uSpan * 0.5));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, wfEg); }
#endif
gl_FragColor.rgb = applyColonyFovShroud(vWfWorldPos, gl_FragColor.rgb);`;

export function patchWaterfallShader(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = injectAll(
    shader.vertexShader,
    [
      ['#include <common>', `#include <common>\n${WF_VERT_COMMON}`],
      ['#include <begin_vertex>', `#include <begin_vertex>\n${WF_VERT_BEGIN}`],
    ],
    'hex waterfall vertex',
  );
  shader.fragmentShader = injectAll(
    shader.fragmentShader,
    [
      ['#include <common>', `#include <common>\n${WF_FRAG_COMMON}`],
      ['#include <color_fragment>', `#include <color_fragment>\n${WF_FRAG_COLOR}`],
      ['#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.14, 0.62, clamp(wfFoam + wfLayer * 0.35, 0.0, 1.0));'],
      ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${WF_FRAG_EMISSIVE}`],
      ['#include <fog_fragment>', `#include <fog_fragment>\n${WF_FRAG_FOG}`],
    ],
    'hex waterfall fragment',
  );
}

/** Animated waterfall cascade material matching the colony water palette, wind, projectors, and FoV shroud. */
export function createWaterfallMaterial(opts: WaterfallMaterialOptions): WaterfallMaterialResult {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.22,
    metalness: 0,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 1.0,
  });
  const uniforms: Record<string, THREE.IUniform> = {
    ...getWeatherUniforms(),
    uTime: opts.sharedTime ?? { value: 0 },
    uShallowColor: { value: new THREE.Color(opts.shallow) },
    uDeepColor: { value: new THREE.Color(opts.deep) },
    uFoamColor: { value: new THREE.Color(opts.foam ?? 0xf4fdff) },
    uSky: { value: new THREE.Color(opts.sky) },
    uSpan: { value: opts.span },
  };
  let quality = getWaterQuality();
  material.defines ??= {};
  material.defines.WATER_QUALITY = quality;
  material.customProgramCacheKey = () => `ta-hex-waterfall:q${quality}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(
      shader.uniforms,
      getColonyVisionUniforms(),
      getWindUniforms(),
      getWaterUniforms(),
      getWeatherUniforms(),
      uniforms,
    );
    bindViewFocusUniforms(shader.uniforms);
    patchWaterfallShader(shader);
  };
  const unsubscribe = onWaterChange(() => {
    const next = getWaterQuality();
    if (next === quality) return;
    quality = next;
    material.defines!.WATER_QUALITY = quality;
    material.needsUpdate = true;
  });
  return {
    material,
    uniforms,
    dispose() {
      unsubscribe();
      material.dispose();
    },
  };
}
