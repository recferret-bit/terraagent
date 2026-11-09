import * as THREE from 'three';

/**
 * Shared planar-reflection uniforms (contract between the mirror pass `WaterReflectionPass.ts`, which writes them once
 * per frame, and the water shader, which assigns these objects by reference in `onBeforeCompile`).
 *
 * - `uReflTex`    the mirror render target's colour texture (linear HDR, HalfFloat; null until the first pass).
 * - `uReflMatrix` world → mirror clip space incl. the 0..1 bias (`bias · proj · view` of the mirror camera): the shader
 *                 projects the undisplaced world position with it and divides by w to get the texture UV.
 * - `uReflRect`   (u0, v0, u1, v1): the texture region the pass actually rendered this frame (scissored to the visible
 *                 water); the shader clamps its distorted UV into it.
 * - `uReflOn`     reflection strength applied this frame; 0 = the pass did not run (skipped), the shader must not sample.
 *
 * `uReflDistort` (the distortion multiplier) lives with the other WATER sliders in `waterConfig.ts`.
 */
const uniforms = {
  uReflTex: { value: null as THREE.Texture | null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  uReflOn: { value: 0 },
};

export type ReflectionUniforms = typeof uniforms;

/** Shared reflection uniforms. Assign these objects (not copies) into each water material. */
export function getReflectionUniforms(): ReflectionUniforms {
  return uniforms;
}
