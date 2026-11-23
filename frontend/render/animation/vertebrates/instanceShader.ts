import type * as THREE from 'three';

function patchVertebrateInstancedShader(material: THREE.Material, suffix: string): void {
  const baseCompile = material.onBeforeCompile.bind(material);
  const baseKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${baseKey()}:vertebrate-inst-v1:${suffix}`;
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile(shader, renderer);
    if (shader.uniforms.uTime) {
      shader.uniforms.uBioGlobalTime = shader.uniforms.uTime;
    }
    shader.vertexShader = `attribute vec4 aBioState;\n${shader.vertexShader}`
      .replace(/uniform float uTime;\s*/, 'uniform float uBioGlobalTime;\n')
      .replace(/uniform float uWalkWeight;\s*/g, '')
      .replace(/uniform float uWorkWeight;\s*/g, '')
      .replace(/uniform float uVertRun;\s*/g, '')
      .replace(/uniform float uVertSleep;\s*/g, '')
      .replace(/\buWalkWeight\b/g, 'clamp(aBioState.y, 0.0, 1.0)')
      .replace(/\buVertRun\b/g, 'clamp(aBioState.y - 1.0, 0.0, 1.0)')
      .replace(/\buWorkWeight\b/g, 'aBioState.z')
      .replace(/\buVertSleep\b/g, 'clamp(aBioState.w, 0.0, 1.0)')
      .replace(/\buTime\b/g, '(uBioGlobalTime + aBioState.x)');
  };
}

/**
 * Connects per-instance `aBioState` (`[phaseOffset, walkOrFlapAndRun, workOrFeed, sleepCrouch]`)
 * cleanly to the shared `VERTEBRATE_ANIMATION` vertex shader for both visible and depth shadow passes.
 */
export function useVertebrateInstanceAttributes(
  material: THREE.Material,
  depthMaterial?: THREE.Material,
): void {
  patchVertebrateInstancedShader(material, 'color');
  if (depthMaterial) patchVertebrateInstancedShader(depthMaterial, 'depth');
}
