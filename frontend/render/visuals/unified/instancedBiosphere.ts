import type * as THREE from 'three';

export const BIOSPHERE_INSTANCE_ATTR = 'aBioState';

const RIGID_SLEEP_GLSL = /* glsl */ `{
        float bioSleep = clamp(aBioState.w, 0.0, 1.0);
        if (bioSleep > 0.001) {
          if (abs(animType - 8.0) < 0.1) {
            // Rigid resting crouch proportional to species belly clearance so small mammals never clip underground.
            transformed.y -= bioSleep * uBioSleepDrop;
          } else if (abs(animType - 4.0) < 0.1) {
            float fold = bioSleep * uBioSleepDrop * clamp(transformed.y / max(pivot.y, 0.16), 0.0, 1.0);
            transformed.y = max(0.0, transformed.y - fold);
          }
        }
        }
        vec4 taWorldPosition = vec4(transformed, 1.0);`;

function patchBiosphereShader(material: THREE.Material, suffix: string, sleepDropU: THREE.IUniform<number>): void {
  const baseCompile = material.onBeforeCompile.bind(material);
  const baseKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${baseKey()}:biosphere-inst-v3:${suffix}`;
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile(shader, renderer);
    if (shader.uniforms.uTime) {
      shader.uniforms.uBioGlobalTime = shader.uniforms.uTime;
    }
    shader.uniforms.uBioSleepDrop = sleepDropU;
    shader.vertexShader = `attribute vec4 aBioState;\nuniform float uBioSleepDrop;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader
      .replace(/uniform float uTime;\s*/, 'uniform float uBioGlobalTime;\n')
      .replace(/uniform float uWalkWeight;\s*/g, '')
      .replace(/uniform float uWorkWeight;\s*/g, '')
      .replace(/\buWalkWeight\b/g, 'aBioState.y')
      .replace(/\buWorkWeight\b/g, 'aBioState.z')
      .replace(/\buTime\b/g, '(uBioGlobalTime + aBioState.x)')
      .replace('vec4 taWorldPosition = vec4(transformed, 1.0);', RIGID_SLEEP_GLSL);
  };
}

/**
 * Patches a `UnifiedColonyMaterial` pair (`material` + `depthMaterial`) to read per-instance
 * `aBioState` (`vec4(phaseOffset, walkWeight, workWeight, sleepCrouch)`), enabling 100+ animals
 * or birds per species in a single `InstancedMesh` draw call with unsynchronized strides, grazing,
 * drinking, species-proportional sleeping crouch, and wing-flapping.
 */
export function useBiosphereInstanceAttributes(
  material: THREE.Material,
  depthMaterial?: THREE.Material,
  sleepDrop = 0.16,
): void {
  const sleepDropU: THREE.IUniform<number> = { value: Math.max(0, sleepDrop) };
  patchBiosphereShader(material, 'color', sleepDropU);
  if (depthMaterial) patchBiosphereShader(depthMaterial, 'depth', sleepDropU);
}
