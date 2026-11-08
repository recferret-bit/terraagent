import * as THREE from 'three';

/**
 * GLSL shader chunks for instanced combat range and view rings (`UO-C-08`, `CLIENT.md` §8b).
 * Split into named chunk constants composed by builders (`AGENTS.md` §6).
 *
 * `aRingStyle` (`vec4`):
 *   - `x`: opacity (`0..1`)
 *   - `y`: dashSegments (`0` = solid ring, `> 0` = angular dash count around the circle)
 *   - `z`: dutyCycle (`0..1`, fraction of each dash segment that is drawn)
 *   - `w`: ringKind (`0 = weapon`, `1 = minRange`, `2 = viewRange`, `3 = enemyWeapon`, `4 = ghostWeapon`)
 */

export const RING_VERTEX_HEADER_GLSL = /* glsl */ `
#ifndef USE_INSTANCING
attribute mat4 instanceMatrix;
#endif
attribute vec3 aRingColor;
attribute vec4 aRingStyle;
varying vec2 vRingLocalXZ;
varying vec3 vRingColor;
varying vec4 vRingStyle;
`;

export const RING_VERTEX_MAIN_GLSL = /* glsl */ `
void main() {
  vRingLocalXZ = position.xz;
  vRingColor = aRingColor;
  vRingStyle = aRingStyle;
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const RING_FRAGMENT_HEADER_GLSL = /* glsl */ `
uniform float uTime;
varying vec2 vRingLocalXZ;
varying vec3 vRingColor;
varying vec4 vRingStyle;
`;

export const RING_FRAGMENT_DASH_GLSL = /* glsl */ `
float computeRingDashMask(vec2 localXZ, float dashSegments, float dutyCycle) {
  if (dashSegments <= 0.5) return 1.0;
  float angle = atan(localXZ.y, localXZ.x);
  float normAngle = (angle + 3.14159265359) / 6.28318530718;
  float phase = fract(normAngle * dashSegments);
  return step(phase, dutyCycle);
}
`;

export const RING_FRAGMENT_RADIAL_GLSL = /* glsl */ `
float computeRingRadialMask(vec2 localXZ, float ringKind) {
  float r = length(localXZ);
  float innerEdge = (ringKind > 1.5 && ringKind < 2.5) ? 0.982 : 0.97;
  if (r < innerEdge || r > 1.0) return 0.0;
  return 1.0;
}
`;

export const RING_FRAGMENT_MAIN_GLSL = /* glsl */ `
void main() {
  float opacity = vRingStyle.x;
  float dashSegments = vRingStyle.y;
  float dutyCycle = vRingStyle.z;
  float ringKind = vRingStyle.w;
  float dashMask = computeRingDashMask(vRingLocalXZ, dashSegments, dutyCycle);
  float radialMask = computeRingRadialMask(vRingLocalXZ, ringKind);
  float alpha = opacity * dashMask * radialMask;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(vRingColor, alpha);
}
`;

export function buildRingVertexShader(): string {
  return [RING_VERTEX_HEADER_GLSL, RING_VERTEX_MAIN_GLSL].join('\n');
}

export function buildRingFragmentShader(): string {
  return [
    RING_FRAGMENT_HEADER_GLSL,
    RING_FRAGMENT_DASH_GLSL,
    RING_FRAGMENT_RADIAL_GLSL,
    RING_FRAGMENT_MAIN_GLSL,
  ].join('\n');
}

export interface RingShaderUniforms {
  [name: string]: THREE.IUniform;
  uTime: { value: number };
}

export function createRingShaderMaterial(): THREE.ShaderMaterial & { uniforms: RingShaderUniforms } {
  const uniforms: RingShaderUniforms = {
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'instanced-range-rings-material',
    uniforms,
    vertexShader: buildRingVertexShader(),
    fragmentShader: buildRingFragmentShader(),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  return mat as THREE.ShaderMaterial & { uniforms: RingShaderUniforms };
}
