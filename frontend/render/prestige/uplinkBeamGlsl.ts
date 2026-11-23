/**
 * Orbital Uplink Beam shaders (Tier 1-2 Cyan Uplink & Tier 3+ Sovereign Gold-Cyan Spire), as named chunks composed by
 * `buildUplinkFragment` (AGENTS.md GLSL chunk rule). Local space: the beam rises along +Y from y = 0 to `uLen`.
 * Everything is HDR (> 1.1) so selective bloom picks it up.
 */
export const UPLINK_VERT = /* glsl */ `
uniform float uLen;
varying float vH; varying float vAz; varying vec3 vN; varying vec3 vV;
void main(){
  vH = clamp(position.y / uLen, 0.0, 1.0);
  vAz = atan(position.z, position.x);
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export const UPLINK_UNIFORMS = /* glsl */ `
uniform float uTime, uOn, uPower, uCore, uGold;
uniform vec3 uColor;
varying float vH; varying float vAz; varying vec3 vN; varying vec3 vV;`;

/** Hot centre line, soft silhouette: the column reads as a lit volume, not a flat tube. */
export const UPLINK_FRESNEL = /* glsl */ `
float uplinkFresnel(float sharp){
  return pow(abs(dot(normalize(vN), normalize(vV))), sharp);
}`;

/** Energy bands and helical filaments climbing the column. Slow, regular, never strobing. */
export const UPLINK_BANDS = /* glsl */ `
float uplinkBands(){
  float a = 0.5 + 0.5 * sin(vH * 70.0 - uTime * 5.5);
  float b = 0.5 + 0.5 * sin(vH * 23.0 - uTime * 2.1 + 1.7);
  float helix = pow(0.5 + 0.5 * sin(vAz * 3.0 + vH * 56.0 - uTime * 4.4), 2.4);
  return 0.52 + 0.28 * a + 0.14 * b + mix(0.16, 0.55, uGold) * helix;
}`;

/** Gentle pulse (about 0.27 Hz swing of 15 %) and the fades: bright at the emitter, gone into the sky. */
export const UPLINK_PULSE = /* glsl */ `
float uplinkPulse(){
  return 0.85 + 0.15 * sin(uTime * 1.7);
}
float uplinkFade(){
  return smoothstep(0.0, 0.015, vH) * pow(max(1.0 - vH, 0.0), 1.32);
}`;

export const UPLINK_MAIN = /* glsl */ `
void main(){
  if (uOn < 0.001) discard;
  float f = uplinkFresnel(mix(1.15, 2.6, uCore));
  float a = f * uplinkBands() * uplinkPulse() * uplinkFade() * uPower * uOn;
  vec3 hot = mix(vec3(1.5, 2.3, 2.7), vec3(2.5, 1.9, 0.72), uGold);
  vec3 c = mix(uColor, hot, uCore * f);
  gl_FragColor = vec4(c * a, 1.0);
}`;

/** The composed fragment shader. */
export function buildUplinkFragment(): string {
  return [UPLINK_UNIFORMS, UPLINK_FRESNEL, UPLINK_BANDS, UPLINK_PULSE, UPLINK_MAIN].join('\n');
}

/** Emitter glow: a flat radial disc where the beam leaves the hub (and at the upper sovereign crown). */
export const UPLINK_DISC_FRAG = /* glsl */ `
uniform float uTime, uOn, uPower;
uniform vec3 uColor;
varying vec2 vUv;
void main(){
  if (uOn < 0.001) discard;
  float d = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.55, 0.78, d) * (1.0 - smoothstep(0.78, 1.0, d)) * 0.55;
  float core = pow(max(1.0 - d, 0.0), 2.0);
  float a = (core + ring) * (0.82 + 0.18 * sin(uTime * 1.9)) * uPower * uOn;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export const UPLINK_DISC_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Holographic ascending pulse ring & orbiting astrolabe halo shader (HDR additive). */
export const UPLINK_HALO_VERT = /* glsl */ `
varying float vAng;
void main(){
  vAng = atan(position.z, position.x);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const UPLINK_HALO_FRAG = /* glsl */ `
uniform float uTime, uOn, uPower, uAlpha;
uniform vec3 uColor;
varying float vAng;
void main(){
  if (uOn < 0.001) discard;
  float shimmer = 0.72 + 0.28 * sin(vAng * 4.0 - uTime * 3.2);
  gl_FragColor = vec4(uColor * shimmer * uPower * uAlpha * uOn, 1.0);
}`;
