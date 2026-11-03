import * as THREE from 'three';
import { getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';
import { getWindUniforms } from '../../core/windConfig';
import { bindViewFocusUniforms } from '../../core/viewFocus';
import { injectAll } from '../shaderInject';
import { getWaterQuality, getWaterUniforms, onWaterChange, type WaterQuality } from './waterConfig';
import { WATER_FRAGMENT_PAIRS, WATER_VERTEX_PAIRS } from './glsl/stages';

/**
 * Water surface material: MeshStandardMaterial (sun specular, IBL, shadows, fog stay three's PBR) patched in
 * `onBeforeCompile` with wind-driven Gerstner waves, Beer-Lambert volume, refracted-bed parallax, caustics, shore +
 * crest foam and projector reflections (GLSL chunks in `./glsl/`). One pass, no render targets; F8 → WATER / WIND
 * drive it through the shared uniform objects, the quality tier through the `WATER_QUALITY` define.
 */
export interface WaterMaterialOptions {
  shallow: number;
  deep: number;
  sky: number;
  foam?: number;
  /** R = bed height (m); with `shoreField` an RGBA field (G = distance to dry ground, B = water mask). */
  heightTex: THREE.Texture;
  /** World size (m) the field covers: uv = worldXZ / span + 0.5. */
  span: number;
  /** World Y of the still water surface. */
  level: number;
  shoreField?: boolean;
}

export interface WaterMaterialResult {
  material: THREE.MeshStandardMaterial;
  /** Per-surface uniforms (`uHeightTex` may be swapped by `.value`; `uTime` is kept for callers that tick it). */
  uniforms: Record<string, THREE.IUniform>;
  dispose(): void;
}

export function waterProgramKey(quality: WaterQuality, shoreField: boolean): string {
  return `ta-water:q${quality}:sf${shoreField ? 1 : 0}`;
}

/** Writes the water defines into `defines` (keeps three's own, e.g. `STANDARD`). */
export function applyWaterDefines(defines: Record<string, unknown>, quality: WaterQuality, shoreField: boolean): void {
  defines.WATER_QUALITY = quality;
  if (shoreField) defines.WATER_SHORE_FIELD = '';
  else delete defines.WATER_SHORE_FIELD;
}

/** Patches three's standard shader sources (as handed to `onBeforeCompile`); throws on a missing anchor. */
export function patchWaterShader(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = injectAll(shader.vertexShader, WATER_VERTEX_PAIRS, 'water vertex');
  shader.fragmentShader = injectAll(shader.fragmentShader, WATER_FRAGMENT_PAIRS, 'water fragment');
}

export function createWaterMaterial(o: WaterMaterialOptions): WaterMaterialResult {
  const shoreField = !!o.shoreField;
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.14, metalness: 0, transparent: true, opacity: 1, envMapIntensity: 1.2,
  });
  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color(o.shallow) },
    uDeepColor: { value: new THREE.Color(o.deep) },
    uFoamColor: { value: new THREE.Color(o.foam ?? 0xf4fdff) },
    uSky: { value: new THREE.Color(o.sky) },
    uHeightTex: { value: o.heightTex },
    uSpan: { value: o.span },
    uLevelW: { value: o.level },
  };
  let quality = getWaterQuality();
  material.defines ??= {};
  applyWaterDefines(material.defines, quality, shoreField);
  material.customProgramCacheKey = () => waterProgramKey(quality, shoreField);
  material.onBeforeCompile = (shader) => {
    // Shared objects by reference: F8 sliders, the wind/wave clocks and the projector rig update every water at once.
    Object.assign(shader.uniforms, getColonyVisionUniforms(), getWindUniforms(), getWaterUniforms(), uniforms);
    bindViewFocusUniforms(shader.uniforms); // waves / foam motion / caustics fade out off the view focus
    patchWaterShader(shader);
  };
  const unsubscribe = onWaterChange(() => {
    const next = getWaterQuality();
    if (next === quality) return;
    quality = next;
    applyWaterDefines(material.defines!, quality, shoreField);
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
