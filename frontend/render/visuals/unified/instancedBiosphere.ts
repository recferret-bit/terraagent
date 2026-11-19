import type * as THREE from 'three';

export const BIOSPHERE_INSTANCE_ATTR = 'aBioState';

function patchBiosphereShader(material: THREE.Material, suffix: string): void {
  const baseCompile = material.onBeforeCompile.bind(material);
  const baseKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${baseKey()}:biosphere-inst-v1:${suffix}`;
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile(shader, renderer);
    if (shader.uniforms.uTime) {
      shader.uniforms.uBioGlobalTime = shader.uniforms.uTime;
    }
    shader.vertexShader = `attribute vec4 aBioState;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader
      .replace(/uniform float uTime;\s*/, 'uniform float uBioGlobalTime;\n')
      .replace(/uniform float uWalkWeight;\s*/g, '')
      .replace(/uniform float uWorkWeight;\s*/g, '')
      .replace(/\buWalkWeight\b/g, 'aBioState.y')
      .replace(/\buWorkWeight\b/g, 'aBioState.z')
      .replace(/\buTime\b/g, '(uBioGlobalTime + aBioState.x)')
      .replace(
        'vec4 taWorldPosition = vec4(transformed, 1.0);',
        'transformed.y *= (1.0 - 0.36 * clamp(aBioState.w, 0.0, 1.0));\n        vec4 taWorldPosition = vec4(transformed, 1.0);',
      );
  };
}

/**
 * Patches a `UnifiedColonyMaterial` pair (`material` + `depthMaterial`) to read per-instance
 * `aBioState` (`vec4(phaseOffset, walkWeight, workWeight, sleepCrouch)`), enabling 100+ animals
 * or birds per species in a single `InstancedMesh` draw call with unsynchronized strides, grazing,
 * drinking, sleeping crouch, and wing-flapping.
 */
export function useBiosphereInstanceAttributes(
  material: THREE.Material,
  depthMaterial?: THREE.Material,
): void {
  patchBiosphereShader(material, 'color');
  if (depthMaterial) patchBiosphereShader(depthMaterial, 'depth');
}
