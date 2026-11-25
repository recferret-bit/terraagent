import * as THREE from 'three';
import {
  RING_HEIGHT_MIN,
  RING_HEIGHT_SPAN,
  RING_SEGMENTS,
  RING_SLOPE_MIN,
  RING_SLOPE_SPAN,
} from './ringHeightTexture';

/**
 * GLSL shader chunks for terrain-conforming, render-on-top instanced range and view rings (`UO-C-08`, `CLIENT.md` §8b).
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
attribute vec3 aRingVertex;
attribute float aRingRow;
attribute vec3 aRingColor;
attribute vec4 aRingStyle;
uniform sampler2D uHeightTex;
uniform vec2 uHeightTexSize;
uniform vec4 uHeightParams;
varying float vRingRadial;
varying float vRingAngleNorm;
varying vec3 vRingColor;
varying vec4 vRingStyle;

float decodeRingU16(vec2 bytesNorm, float minVal, float spanVal) {
  float hi = floor(bytesNorm.x * 255.0 + 0.5);
  float lo = floor(bytesNorm.y * 255.0 + 0.5);
  float t = (hi * 256.0 + lo) / 65535.0;
  return minVal + t * spanVal;
}
`;

export const RING_VERTEX_MAIN_GLSL = /* glsl */ `
void main() {
  float segTex = aRingVertex.x;
  float edgeSign = aRingVertex.y;
  vRingRadial = edgeSign;
  vRingAngleNorm = aRingVertex.z;
  vRingColor = aRingColor;
  vRingStyle = aRingStyle;

  vec3 ringCenter = instanceMatrix[3].xyz;
  float ringRadius = max(0.05, length(instanceMatrix[0].xyz));
  float ringKind = aRingStyle.w;
  float isView = (ringKind > 1.5 && ringKind < 2.5) ? 1.0 : 0.0;
  float baseHalfW = mix(0.22, 0.17, isView);
  float halfW = clamp(min(baseHalfW, ringRadius * 0.08), 0.04, 0.24);

  vec2 uv = vec2((segTex + 0.5) / uHeightTexSize.x, (aRingRow + 0.5) / uHeightTexSize.y);
  vec4 encoded = texture2D(uHeightTex, uv);
  float centerY = decodeRingU16(encoded.rg, uHeightParams.x, uHeightParams.y);
  float slopeDY = decodeRingU16(encoded.ba, uHeightParams.z, uHeightParams.w);

  vec2 dir = normalize(position.xz + vec2(1e-6, 0.0));
  float rWorld = max(0.02, ringRadius + edgeSign * halfW);
  vec3 drapedLocal = vec3(
    ringCenter.x + dir.x * rWorld,
    centerY + edgeSign * 0.5 * slopeDY,
    ringCenter.z + dir.y * rWorld
  );
  vec4 worldPosition = modelMatrix * vec4(drapedLocal, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const RING_FRAGMENT_HEADER_GLSL = /* glsl */ `
uniform float uTime;
varying float vRingRadial;
varying float vRingAngleNorm;
varying vec3 vRingColor;
varying vec4 vRingStyle;
`;

export const RING_FRAGMENT_DASH_GLSL = /* glsl */ `
float computeRingDashMask(float angleNorm, float dashSegments, float dutyCycle, float time, float ringKind) {
  if (dashSegments <= 0.5) return 1.0;
  float segs = max(1.0, floor(dashSegments + 0.5));
  float isView = (ringKind > 1.5 && ringKind < 2.5) ? 1.0 : 0.0;
  float drift = isView * (time * 0.012);
  float phase = fract((angleNorm + drift) * segs);
  float feather = 0.06;
  float rise = smoothstep(0.0, feather, phase);
  float fall = 1.0 - smoothstep(dutyCycle - feather, dutyCycle, phase);
  return rise * fall;
}
`;

export const RING_FRAGMENT_RADIAL_GLSL = /* glsl */ `
vec2 computeRingRadialMask(float radialEdge, float ringKind) {
  float d = abs(radialEdge);
  float isView = (ringKind > 1.5 && ringKind < 2.5) ? 1.0 : 0.0;
  float coreHalf = mix(0.46, 0.36, isView);
  float core = 1.0 - smoothstep(coreHalf - 0.10, coreHalf + 0.08, d);
  float halo = 1.0 - smoothstep(0.55, 1.0, d);
  return vec2(core, halo);
}
`;

export const RING_FRAGMENT_MAIN_GLSL = /* glsl */ `
void main() {
  float opacity = vRingStyle.x;
  float dashSegments = vRingStyle.y;
  float dutyCycle = vRingStyle.z;
  float ringKind = vRingStyle.w;
  float dashMask = computeRingDashMask(vRingAngleNorm, dashSegments, dutyCycle, uTime, ringKind);
  vec2 radial = computeRingRadialMask(vRingRadial, ringKind);
  float core = radial.x;
  float halo = radial.y;
  vec3 voidBg = vec3(0.043, 0.055, 0.075);
  vec3 finalColor = mix(voidBg, vRingColor, core);
  float alpha = opacity * dashMask * max(core, halo * 0.62);
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(finalColor, alpha);
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
  uHeightTex: { value: THREE.DataTexture | null };
  uHeightTexSize: { value: THREE.Vector2 };
  uHeightParams: { value: THREE.Vector4 };
}

export function createRingShaderMaterial(
  heightTex: THREE.DataTexture | null = null,
  maxInstances = 1,
): THREE.ShaderMaterial & { uniforms: RingShaderUniforms } {
  const uniforms: RingShaderUniforms = {
    uTime: { value: 0 },
    uHeightTex: { value: heightTex },
    uHeightTexSize: { value: new THREE.Vector2(RING_SEGMENTS, Math.max(1, maxInstances)) },
    uHeightParams: {
      value: new THREE.Vector4(RING_HEIGHT_MIN, RING_HEIGHT_SPAN, RING_SLOPE_MIN, RING_SLOPE_SPAN),
    },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'instanced-range-rings-material',
    uniforms,
    vertexShader: buildRingVertexShader(),
    fragmentShader: buildRingFragmentShader(),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  return mat as THREE.ShaderMaterial & { uniforms: RingShaderUniforms };
}
