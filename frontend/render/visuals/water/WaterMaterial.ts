import * as THREE from 'three';
import { getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';
import { getWeatherUniforms } from '../../core/weatherConfig';
import { getWindUniforms } from '../../core/windConfig';
import { bindViewFocusUniforms } from '../../core/viewFocus';
import { injectAll } from '../shaderInject';
import { getWaterQuality, getWaterUniforms, onWaterChange, type WaterQuality } from './waterConfig';
import { WATER_FRAGMENT_PAIRS, WATER_VERTEX_PAIRS } from './glsl/stages';
import { getReflectionUniforms } from './reflection/reflectionUniforms';
import { captureMirrorSky, getMirrorSkyUniforms } from './mirrorSky';

/**
 * The surface's `renderOrder`: for every water surface (hex buckets, prototype lakes): strictly between the flat ground decals at the water level and the volumes above it.
 * After the fauna (0) and the projector ground-pool disc (`EntityProjectorRig`, 1), so the surface blends over them
 * as one layer; before the projector beam (2). At an EQUAL order three sorts the pool and each bucket by distance,
 * and the transparent surface writes depth: a pool drawn after a bucket was cut along the swelling 2 m triangles
 * (the vertex swell rises above the disc's +0.02 m) and a pool drawn between two buckets jumped in brightness at the
 * bucket border, both showing the lattice as big light / dark facets in a lamp's light pool at night.
 */
export const WATER_RENDER_ORDER = 1.5;

/**
 * Water surface material: MeshStandardMaterial (sun specular, IBL, shadows, fog stay three's PBR) patched in
 * `onBeforeCompile` with wind-driven Gerstner waves, Beer-Lambert volume, refracted-bed parallax, caustics, shore +
 * crest foam, projector reflections and (MED/HIGH) the planar mirror image of `reflection/` sampled with wave
 * distortion (GLSL chunks in `./glsl/`). F8 → WATER / WIND drive it through the shared uniform objects, the quality
 * tier through the `WATER_QUALITY` define.
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
    ...getWeatherUniforms(),
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
    // Shared objects by reference: F8 sliders, the wind/wave clocks, the projector rig and the mirror pass update every
    // water at once.
    Object.assign(
      shader.uniforms, getColonyVisionUniforms(), getWindUniforms(), getWaterUniforms(), getWeatherUniforms(),
      getReflectionUniforms(), getMirrorSkyUniforms(), uniforms,
    );
    bindViewFocusUniforms(shader.uniforms); // waves / foam motion / caustics fade out off the view focus
    patchWaterShader(shader);
  };
  material.onBeforeRender = (renderer, scene) => captureMirrorSky(scene, renderer.info.render.frame);
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
