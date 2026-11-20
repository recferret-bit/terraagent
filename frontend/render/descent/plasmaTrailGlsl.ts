/**
 * Plasma Drop-Pod trail shader chunks (W28-12, Tier 2+). The sheath and core are alpha-blended (like the pod's own
 * plasma) so the cyan keeps its hue over the bright orange sky; the sparks are additive. Composed by `buildTrailFragment`; local space: the pod centre
 * at the origin, the pod falls along -y and the trail streams up behind it. Colours are HDR (> 1.1) for selective bloom.
 */
export const TRAIL_VERT = /* glsl */ `
uniform float uLen;
varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vS;
void main(){
  vP = position;
  vS = clamp(position.y / uLen, 0.0, 1.0);
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export const TRAIL_HEAD = /* glsl */ `
uniform float uI, uTime, uSeed;
uniform vec3 uHot, uCool;
varying vec3 vP; varying vec3 vN; varying vec3 vV; varying float vS;`;

/** Silhouette glow of the hollow sheath: the pod stays readable inside it. */
export const TRAIL_RIM = /* glsl */ `
float trailRim(float sharp){
  // never full strength: seen down its own axis (camera behind the pod) every pixel of the cone is edge-on
  return 0.12 + 0.5 * pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), sharp);
}`;

/** Streaks racing up the wake: angular lanes scrolling with time, so it reads as speed, not as a static cone. */
export const TRAIL_LANES = /* glsl */ `
float trailLanes(){
  float ang = atan(vP.z, vP.x);
  float lane = 0.5 + 0.5 * sin(ang * 9.0 + uSeed * 3.0 + sin(vP.y * 0.35 - uTime * 6.0) * 1.4);
  float flow = 0.5 + 0.5 * sin(vP.y * 1.4 - uTime * 24.0 + lane * 4.0);
  return 0.35 + 0.65 * lane * (0.55 + 0.45 * flow);
}`;

export const TRAIL_MAIN = /* glsl */ `
void main(){
  float rim = trailRim(2.4);
  float a = rim * trailLanes() * pow(max(1.0 - vS, 0.0), 1.5) * smoothstep(0.0, 0.05, vS);
  vec3 c = mix(uHot, uCool, smoothstep(0.0, 0.7, vS));
  gl_FragColor = vec4(c * 1.35, clamp(a * uI * 1.6, 0.0, 1.0));
}`;

export function buildTrailFragment(): string {
  return [TRAIL_HEAD, TRAIL_RIM, TRAIL_LANES, TRAIL_MAIN].join('\n');
}

/** Bright inner core streak (no lanes): a hot white-cyan thread down the axis. */
export const TRAIL_CORE_FRAG = [TRAIL_HEAD, TRAIL_RIM, /* glsl */ `
void main(){
  float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.1);
  float a = f * pow(max(1.0 - vS, 0.0), 1.2) * smoothstep(0.0, 0.03, vS) * (0.8 + 0.2 * sin(uTime * 31.0 + vS * 40.0));
  gl_FragColor = vec4(mix(vec3(0.8, 1.9, 2.3), uCool, vS), clamp(a * uI * 1.2, 0.0, 1.0));
}`].join('\n');

/** Shed sparks: points spawned at the pod, streaming up the wake and cooling from white-cyan to violet. */
export const TRAIL_SPARK_VERT = /* glsl */ `
attribute vec4 aSeed; uniform float uTime, uI, uScale, uLen, uR;
varying float vAge; varying float vK;
void main(){
  float life = 0.6 + aSeed.z * 0.7;
  float age = fract(uTime / life + aSeed.w);
  float ang = aSeed.x * 6.2831853;
  float r = uR * (0.25 + 0.9 * age * aSeed.y);
  vec3 p = vec3(cos(ang) * r, 0.2 + age * uLen * (0.35 + 0.65 * aSeed.y), sin(ang) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vAge = age; vK = aSeed.y;
  gl_PointSize = uScale * (2.0 + 5.0 * (1.0 - age)) * (14.0 / max(-mv.z, 1.0)) * step(0.02, uI);
}`;

export const TRAIL_SPARK_FRAG = /* glsl */ `
uniform float uI; uniform vec3 uHot, uCool;
varying float vAge; varying float vK;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; if (d > 1.0) discard;
  float a = (1.0 - d * d) * (1.0 - vAge);
  vec3 col = mix(uHot * 1.6, uCool * 1.4, smoothstep(0.0, 0.5, vAge + vK * 0.2));
  gl_FragColor = vec4(col * a * uI, 1.0);
}`;
