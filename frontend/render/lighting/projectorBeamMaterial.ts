import * as THREE from 'three';
import { glslFloat, injectAll } from '../visuals/shaderInject';

/**
 * Exponent of the view-facing fade of the beam shell: a fragment's alpha is scaled by `|N·V|^k`. Looking straight
 * through the cone (long path through the lit haze) keeps it bright; the silhouette, where the view grazes the shell
 * (no path through the haze), fades to 0. That is what a volumetric cone looks like and it removes the hard straight
 * silhouette lines a flat additive shell draws across the screen.
 */
export const BEAM_FACING_POWER = 1.4;

/**
 * Additive, depth-tested (no depth write), double-sided material for the projector beam shell
 * (`EntityProjectorRig`). A `MeshBasicMaterial` so `opacity` drives power as before, plus the view-facing fade.
 * The beam geometry must carry normals.
 */
export function createProjectorBeamMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = injectAll(shader.vertexShader, [
      ['#include <common>', '#include <common>\nvarying vec3 vBeamN;\nvarying vec3 vBeamView;'],
      ['#include <project_vertex>', '#include <project_vertex>\nvBeamN = normalize(normalMatrix * normal);\nvBeamView = -mvPosition.xyz;'],
    ], 'projector-beam vertex');
    shader.fragmentShader = injectAll(shader.fragmentShader, [
      ['#include <common>', '#include <common>\nvarying vec3 vBeamN;\nvarying vec3 vBeamView;'],
      [
        '#include <alphatest_fragment>',
        `diffuseColor.a *= pow(abs(dot(normalize(vBeamN), normalize(vBeamView))), ${glslFloat(BEAM_FACING_POWER)});\n#include <alphatest_fragment>`,
      ],
    ], 'projector-beam fragment');
  };
  mat.customProgramCacheKey = () => 'projector-beam-facing-v1';
  return mat;
}
