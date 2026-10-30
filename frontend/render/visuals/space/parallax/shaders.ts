import { GLSL_NOISE } from '../glslNoise';

export const STAR_VERT = /* glsl */ `
attribute float aSize; attribute float aSeed; attribute vec3 aCol;
uniform float uTime, uScale; varying vec3 vCol; varying float vTw;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale;
  vTw = 0.75 + 0.25 * sin(uTime * (0.8 + aSeed * 2.2) + aSeed * 40.0);
  vCol = aCol;
}`;
export const STAR_FRAG = /* glsl */ `
varying vec3 vCol; varying float vTw; uniform float uBright;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
  float core = exp(-d * d * 7.0); float halo = exp(-d * 3.2) * 0.25;
  float a = (core + halo) * step(d, 1.0);
  gl_FragColor = vec4(vCol * uBright * vTw * a, a);
}`;

export const NEB_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uA, uB; uniform float uTime, uI, uSeed; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * vec2(3.2, 2.0) + vec2(uSeed, uSeed * 0.7);
  vec2 w = vec2(fbm2(p * 1.1 + uTime * 0.004), fbm2(p * 1.1 + 7.0 - uTime * 0.003));
  float n = fbm2(p * 1.6 + (w - 0.5) * 1.8);
  float m = smoothstep(0.42, 0.85, n);
  float lane = smoothstep(0.35, 0.8, fbm2(p * 3.2 + 11.0 + w));
  vec3 col = mix(uA, uB, smoothstep(0.3, 0.8, fbm2(p * 0.8 + 3.0))) * m * (0.45 + 0.8 * lane);
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
  gl_FragColor = vec4(col * uI * edge, 1.0);
}`;

export const GIANT_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uA, uB, uSunDir; uniform float uSeed, uTime;
varying vec3 vObj; varying vec3 vWN;
void main(){
  vec3 P = normalize(vObj);
  float band = sin(P.y * 22.0 + fbm3lo(P * 3.0 + uSeed) * 4.0 + uTime * 0.02) * 0.5 + 0.5;
  vec3 alb = mix(uA, uB, band * 0.8 + fbm3lo(P * 9.0) * 0.2);
  float d = clamp(dot(normalize(vWN), normalize(uSunDir)), 0.0, 1.0);
  float term = smoothstep(0.0, 0.3, d);
  gl_FragColor = vec4(alb * (0.02 + 0.9 * term), 1.0);
}`;
export const OBJ_VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vWN;
void main(){ vObj = position; vWN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const RING_FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uCol; varying vec3 vObj;
void main(){
  float r = length(vObj.xy);
  float t = smoothstep(1.35, 1.4, r) * (1.0 - smoothstep(2.15, 2.2, r));
  float bands = 0.55 + 0.45 * sin(r * 70.0 + fbm2(vec2(r * 14.0, 0.0)) * 6.0);
  float gap = 1.0 - smoothstep(0.0, 0.02, abs(r - 1.8));
  gl_FragColor = vec4(uCol * bands * (1.0 - 0.8 * gap) * 0.75, t * 0.85 * bands);
}`;

export const NEB_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
