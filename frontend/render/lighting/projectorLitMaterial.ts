import type * as THREE from 'three';
import { glslFloat, injectAll } from '../visuals/shaderInject';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from './ColonyVisionAndLights';

/** Small constant fill the projector adds on top of `albedo × light`, as the terrain/scatter patches do. */
const PROJECTOR_FILL = 0.06;

/**
 * Lets a plain `MeshStandardMaterial` be lit by the colony projector lights (unit headlights, building floods). Those
 * lights are GPU uniforms (`ColonyVisionAndLights`), not three.js lights, so a stock material stays black under a beam
 * at night. Adds `albedo × projector diffuse` to the emissive radiance, the same term the Unifier, terrain and scatter
 * shaders use. Returns `mat` for chaining.
 */
export function applyColonyProjectorLight<T extends THREE.MeshStandardMaterial>(mat: T): T {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms());
    sh.vertexShader = injectAll(sh.vertexShader, [
      ['#include <common>', '#include <common>\nvarying vec3 vTaPlW; varying vec3 vTaPlN;'],
      ['#include <begin_vertex>', '#include <begin_vertex>\nvTaPlW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTaPlN = normalize(mat3(modelMatrix) * objectNormal);'],
    ], 'projector-lit vertex');
    sh.fragmentShader = injectAll(sh.fragmentShader, [
      ['#include <common>', `#include <common>\nvarying vec3 vTaPlW; varying vec3 vTaPlN;\n${COLONY_VISION_AND_LIGHTS_GLSL}`],
      ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n{ vec3 taProj = evalColonyProjectorLight(vTaPlW, normalize(vTaPlN)); totalEmissiveRadiance += diffuseColor.rgb * taProj + taProj * ${glslFloat(PROJECTOR_FILL)}; }`],
    ], 'projector-lit fragment');
  };
  mat.customProgramCacheKey = () => 'ta-projector-lit';
  return mat;
}
