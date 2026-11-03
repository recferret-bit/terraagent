import * as THREE from 'three';

/**
 * Shader-driven lightning along the grid cables (skill `planetary-lighting-and-lightning`, "Grid overload arcs"):
 * an HDR plasma packet travels from the upstream end of every conductor (Hub → pylons → buildings), and around it the
 * overlay tube is re-jittered every ~60 ms ring by ring (`RINGS_PER_M` in `cableGeometry.ts`), the per-frame cost of
 * the bolt re-subdivision in `LightningStrikeSystem` without any CPU geometry work. Everything is in the vertex
 * shader; the CPU only advances `uTime`.
 *
 * States (`aCable.w`): 0 off (overlay culled), 1 brownout (slow, sputtering amber), 2 online (steady cyan packets),
 * 3 overload (fast crimson arcs, wider jitter).
 */

/**
 * `uTime` wraps at this many seconds (keeps the hash arguments small for GPU float precision). 198 s is a whole number
 * of packet spacings for every state (speed × 198 / spacing = 54, 154, 616), so the packets never jump at the wrap.
 */
export const CABLE_TIME_WRAP_S = 198;

/** Uniforms and attributes shared by the vertex chunks. */
const ARC_VERTEX_DECL = /* glsl */ `
uniform float uTime;
attribute vec4 aCable;
attribute vec3 aSide;
varying float vGlow;
varying float vState;
float arcHash(float n) { return fract(sin(mod(n, 3571.0)) * 43758.5453123); }
`;

/** Per state: packet speed (m/s), spacing between packets (m), jitter amplitude (m), resting shimmer (0..1). */
const ARC_STATE_PARAMS = /* glsl */ `
vec4 arcStateParams(float s) {
  if (s > 2.5) return vec4(14.0, 4.5, 0.32, 0.22);
  if (s > 1.5) return vec4(7.0, 9.0, 0.24, 0.07);
  return vec4(3.0, 11.0, 0.12, 0.03);
}
`;

/** The travelling packet: sharp leading edge, fading tail, `0..1`. */
const ARC_PACKET = /* glsl */ `
float arcPacket(float metres, float speed, float spacing, float seed) {
  float head = fract((metres - uTime * speed) / spacing + seed);
  float w = min(0.6, 2.6 / spacing);
  return smoothstep(0.0, w, head) * (1.0 - smoothstep(w * 0.82, w, head));
}
`;

const ARC_VERTEX_MAIN = /* glsl */ `
void main() {
  float state = aCable.w;
  float t = aCable.x;
  float metres = t * aCable.y;
  float seed = aCable.z;
  vec4 sp = arcStateParams(state);
  float packet = arcPacket(metres, sp.x, sp.y, seed);
  // Brownout sputters: whole-cable dropouts at ~9 Hz.
  float sputter = state < 1.5 ? step(0.45, arcHash(floor(uTime * 9.0) + seed * 71.0)) : 1.0;
  float on = step(0.5, state) * sputter;
  // Jagged arc: each ring (one per 1/3 m) jumps to a new offset ~16 times a second; the ends stay on the insulators.
  float frame = floor(uTime * 16.0);
  float ring = floor(metres * 3.0);
  float jx = arcHash(ring * 12.9898 + frame * 78.233 + seed * 37.719) - 0.5;
  float jy = arcHash(ring * 39.3467 + frame * 11.135 + seed * 53.171) - 0.5;
  float pin = sin(3.14159265 * t);
  float amp = (0.15 + 0.85 * packet) * sp.z * pin;
  vec3 p = position + normal * (0.012 + 0.06 * packet) + (aSide * jx + vec3(0.0, 1.0, 0.0) * jy) * amp;
  vGlow = on * (sp.w + packet);
  vState = state;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // Off cables collapse to a point behind the camera: no fragments at all.
  gl_Position = on > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const ARC_FRAGMENT = /* glsl */ `
uniform vec3 uColorOnline;
uniform vec3 uColorBrownout;
uniform vec3 uColorOverload;
uniform float uStrength;
varying float vGlow;
varying float vState;
void main() {
  vec3 col = vState > 2.5 ? uColorOverload : (vState > 1.5 ? uColorOnline : uColorBrownout);
  gl_FragColor = vec4(col * vGlow * uStrength, 1.0);
}
`;

export interface CableArcUniforms {
  [name: string]: THREE.IUniform;
  uTime: { value: number };
  uStrength: { value: number };
  uColorOnline: { value: THREE.Color };
  uColorBrownout: { value: THREE.Color };
  uColorOverload: { value: THREE.Color };
}

/** HDR plasma colours (> 1.1 so the selective bloom, threshold 1.1, wraps the packet in a corona). */
export const CABLE_ARC_COLORS = {
  online: new THREE.Color(0.45, 0.88, 1.0).multiplyScalar(6.0),
  brownout: new THREE.Color(1.0, 0.55, 0.12).multiplyScalar(3.4),
  overload: new THREE.Color(1.0, 0.22, 0.16).multiplyScalar(5.0),
} as const;

export function buildCableArcVertexShader(): string {
  return [ARC_VERTEX_DECL, ARC_STATE_PARAMS, ARC_PACKET, ARC_VERTEX_MAIN].join('\n');
}

/** Additive, unlit, no depth write: drawn over the dark conductor tube from the same geometry. */
export function createCableArcMaterial(): THREE.ShaderMaterial & { uniforms: CableArcUniforms } {
  const uniforms: CableArcUniforms = {
    uTime: { value: 0 },
    uStrength: { value: 1 },
    uColorOnline: { value: CABLE_ARC_COLORS.online.clone() },
    uColorBrownout: { value: CABLE_ARC_COLORS.brownout.clone() },
    uColorOverload: { value: CABLE_ARC_COLORS.overload.clone() },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'grid-cable-arc',
    uniforms,
    vertexShader: buildCableArcVertexShader(),
    fragmentShader: ARC_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  return mat as THREE.ShaderMaterial & { uniforms: CableArcUniforms };
}
