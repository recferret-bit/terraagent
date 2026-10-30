import * as THREE from 'three';
import { isShaderOptimized } from '../core/perfConfig';
import { GLSL_NOISE } from '../visuals/space/glslNoise';
import type { PlanetKind } from '../planets/PlanetSpec';

/** Orbital description in the stage's world units (planet radius = 9.5). */
export interface MoonDef {
  name: string;
  radius: number;
  orbit: number;          // distance from planet centre
  period: number;         // seconds per revolution (negative = retrograde)
  incline: number;        // rad, tilt of the orbital plane around the X axis
  node: number;           // rad, rotation of the orbital plane around Y
  phase: number;          // start angle
  spin: number;           // rad/s
  // look
  base: number; dark: number; tint: number;
  craters: number;        // crater density
  bump: number;
  irregular?: number;     // 0..1 lumpy asteroid-like silhouette
  ice?: number;           // 0..1 bright icy sheen / lineae
  banding?: number;       // 0..1 dusty banding
}

/** Each planet gets its own distinct moons. */
export const MOON_DEFS: Record<string, MoonDef[]> = {
  dune: [
    { name: 'Kesh', radius: 1.7, orbit: 19, period: 150, incline: 0.55, node: 0.3, phase: 0.8, spin: 0.05, base: 0xb59a78, dark: 0x6d5a45, tint: 0xd8a469, craters: 1.0, bump: 1.0, banding: 0.5 },
    { name: 'Mote', radius: 0.7, orbit: 14.5, period: 66, incline: -0.35, node: 1.4, phase: 3.4, spin: 0.35, base: 0x7b6a5c, dark: 0x3b3029, tint: 0x9a6a48, craters: 1.8, bump: 1.4, irregular: 0.7 },
  ],
  oceanForest: [
    { name: 'Selene Glass', radius: 2.3, orbit: 22, period: 190, incline: 0.45, node: -0.4, phase: 2.2, spin: 0.03, base: 0xe4eef6, dark: 0x8ea5bb, tint: 0xbfe3ff, craters: 0.45, bump: 0.55, ice: 1.0 },
    { name: 'Pebble', radius: 0.55, orbit: 15.2, period: 52, incline: -0.7, node: 0.9, phase: 4.9, spin: 0.5, base: 0x8a8d91, dark: 0x45484d, tint: 0x9bb0c0, craters: 1.6, bump: 1.2, irregular: 0.5 },
  ],
  forestRock: [
    { name: 'Tor', radius: 1.9, orbit: 20, period: 130, incline: 0.3, node: 0.6, phase: 1.5, spin: 0.04, base: 0x9b9a96, dark: 0x4a4a4d, tint: 0xb8b7b0, craters: 1.5, bump: 1.4 },
    { name: 'Splinter', radius: 0.62, orbit: 13.6, period: -58, incline: 0.8, node: -1.1, phase: 5.6, spin: 0.6, base: 0x5f5750, dark: 0x2a2623, tint: 0x6e6258, craters: 1.2, bump: 1.6, irregular: 1.0 },
  ],
};

const VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
void main(){
  vObj = normalize(position); vWN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
${GLSL_NOISE}
uniform vec3 uBase, uDark, uTint, uSunDir; uniform float uSeed, uCraters, uBump, uIce, uBand, uSunI, uOpt;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
// Cheap worley crater field: bowl + raised rim, 2 octaves.
float craterField(vec3 p, float scale){
  vec3 q = p * scale; vec3 i = floor(q), f = fract(q);
  float h = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash13(i + g + uSeed), hash13(i + g + uSeed + 17.0), hash13(i + g + uSeed + 41.0));
    float on = hash13(i + g + uSeed + 7.0);
    if (on < 0.55) continue;
    float r = 0.18 + 0.3 * hash13(i + g + uSeed + 99.0);
    float d = length(f - g - o) / r;
    float bowl = -(1.0 - smoothstep(0.0, 1.0, d)) * 0.9;
    float rim = exp(-pow(max(d - 1.0, 0.0) * 6.0, 2.0)) * 0.35 * step(1.0, d + 0.0001);
    h += bowl + rim;
  }
  return h;
}
float height(vec3 p){
  float c = uOpt > 0.5 ? craterField(p, 3.6) * 1.15 : (craterField(p, 3.2) * 0.9 + craterField(p, 7.5) * 0.45);
  return c * uCraters + (fbm3lo(p * 3.0 + uSeed) - 0.5) * 0.7;
}
void main(){
  vec3 P = normalize(vObj);
  float h = height(P);
  vec3 Ng = normalize(vWN);
  vec3 N;
  if (uOpt > 0.5) {
    vec3 dpx = dFdx(vWP), dpy = dFdy(vWP);
    vec2 dH = vec2(dFdx(h), dFdy(h)) * (0.06 * uBump);
    vec3 r1 = cross(dpy, Ng), r2 = cross(Ng, dpx);
    float det = dot(dpx, r1);
    vec3 Nb = abs(det) * Ng - sign(det) * (dH.x * r1 + dH.y * r2);
    N = dot(Nb, Nb) > 1e-20 ? normalize(Nb) : Ng;
  } else {
    // finite-difference bump in object space (the moon spin is slow, so world≈object for lighting)
    float e = 0.012;
    vec3 t1 = normalize(cross(P, vec3(0.0, 1.0, 0.01))); vec3 t2 = cross(P, t1);
    float hx = height(normalize(P + t1 * e)) - h, hy = height(normalize(P + t2 * e)) - h;
    N = normalize(Ng - (t1 * hx + t2 * hy) / e * 0.06 * uBump);
  }
  vec3 L = normalize(uSunDir);
  float albN = fbm3lo(P * 5.0 + uSeed * 0.7);
  vec3 alb = mix(uDark, uBase, smoothstep(0.15, 0.85, albN + h * 0.18));
  alb = mix(alb, uTint, uBand * smoothstep(0.4, 0.8, fbm3lo(vec3(P.y * 9.0, P.x * 1.5, P.z * 1.5) + uSeed)) * 0.6);
  // bright ejecta around fresh craters
  alb *= 1.0 + clamp(h * -0.2, 0.0, 0.25);
  if (uIce > 0.0) {
    float lin = 1.0 - abs(2.0 * fbm3(P * 4.0 + 3.0) - 1.0);
    alb = mix(alb, uTint, uIce * smoothstep(0.86, 0.98, lin) * 0.75);
    alb = mix(alb, vec3(0.93, 0.97, 1.0), uIce * 0.3);
  }
  float ndl = dot(N, L); float ndlg = dot(Ng, L);
  float term = smoothstep(-0.02, 0.18, ndlg);
  float diff = max(ndl, 0.0) * term;
  vec3 V = normalize(cameraPosition - vWP);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 40.0) * uIce * 0.5 * term;
  vec3 col = alb * (vec3(0.014, 0.018, 0.034) + vec3(1.0, 0.96, 0.9) * uSunI * diff) + spec;
  col += uTint * pow(1.0 - max(dot(Ng, V), 0.0), 3.0) * 0.04 * term;
  gl_FragColor = vec4(clamp(col, 0.0, 40.0), 1.0);
}`;

export interface Moon {
  readonly group: THREE.Group;
  readonly def: MoonDef;
  update(planetPos: THREE.Vector3, time: number): void;
  dispose(): void;
}

function lumpy(geo: THREE.SphereGeometry, amount: number, seed: number) {
  const p = geo.attributes.position; const v = new THREE.Vector3();
  // cheap seeded 3D value-noise-ish lumpiness
  const f = (x: number, y: number, z: number) => Math.sin(x * 2.1 + seed) * Math.cos(y * 2.7 + seed * 1.3) + Math.sin(z * 3.1 + x * 1.7 + seed * 0.7) * 0.6;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const n = v.clone().normalize();
    const k = 1 + amount * 0.22 * (f(n.x * 1.6, n.y * 1.6, n.z * 1.6) + 0.4 * f(n.x * 4, n.y * 4, n.z * 4));
    v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

export function createMoon(def: MoonDef, sunDir: THREE.Vector3, seed: number): Moon {
  const geo = new THREE.SphereGeometry(def.radius, def.irregular ? 48 : 64, def.irregular ? 32 : 40);
  if (def.irregular) { lumpy(geo, def.irregular, seed); geo.scale(1, 0.82, 0.92); }
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uBase: { value: new THREE.Color(def.base) }, uDark: { value: new THREE.Color(def.dark) }, uTint: { value: new THREE.Color(def.tint) },
      uSunDir: { value: sunDir.clone().normalize() }, uSeed: { value: seed % 53 }, uCraters: { value: def.craters }, uBump: { value: def.bump },
      uIce: { value: def.ice ?? 0 }, uBand: { value: def.banding ?? 0 }, uSunI: { value: 1.15 }, uOpt: { value: isShaderOptimized() ? 1 : 0 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const group = new THREE.Group(); group.name = `Moon:${def.name}`; group.add(mesh);
  const axis = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  const plane = new THREE.Euler(def.incline, def.node, 0, 'YXZ');
  return {
    group, def,
    update(planetPos, time) {
      mat.uniforms.uOpt.value = isShaderOptimized() ? 1 : 0;
      const a = def.phase + (time / def.period) * Math.PI * 2;
      tmp.set(Math.cos(a) * def.orbit, 0, Math.sin(a) * def.orbit).applyEuler(plane);
      group.position.copy(planetPos).add(tmp);
      mesh.rotation.y = time * def.spin; mesh.rotation.x = 0.3 * Math.sin(time * def.spin * 0.5);
      void axis;
    },
    dispose() { geo.dispose(); mat.dispose(); group.removeFromParent(); },
  };
}

export const moonsFor = (kind: PlanetKind | string): MoonDef[] => MOON_DEFS[kind] ?? [];
