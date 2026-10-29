import * as THREE from 'three';
import type { PlanetKind, PlanetSpec } from './PlanetSpec';
import { GLSL_NOISE } from '../visuals/space/glslNoise';

const KIND_INDEX: Record<PlanetKind, number> = { dune: 0, oceanForest: 1, forestRock: 2 };

export interface PlanetGlobeOptions {
  radius?: number;
  segments?: number;
  /** Cloud shell radius multiplier (default 1.012). */
  cloudScale?: number;
  /** Atmosphere shell radius multiplier (default 1.07). */
  atmScale?: number;
}

export interface PlanetGlobe {
  readonly group: THREE.Group;   // position / scale / fade this
  readonly spin: THREE.Group;    // axial tilt + rotation
  readonly radius: number;
  readonly spec: PlanetSpec;
  readonly shared: {
    uSunDir: THREE.IUniform<THREE.Vector3>; uSunI: THREE.IUniform<number>; uOpacity: THREE.IUniform<number>;
    uTime: THREE.IUniform<number>; uSkyBlend: THREE.IUniform<number>; uSkyColor: THREE.IUniform<THREE.Color>; uAtmStrength: THREE.IUniform<number>;
    uCloudNear: THREE.IUniform<THREE.Vector2>; uHazeDist: THREE.IUniform<THREE.Vector2>;
  };
  setSunDirection(worldDir: THREE.Vector3): void;
  /** 0..1 fade of the entire globe (surface, clouds, atmosphere). */
  setOpacity(o: number): void;
  update(dt: number, time: number): void;
  dispose(): void;
}

const VERT = /* glsl */ `
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vC; varying float vS;
void main(){
  vObj = position; vWN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz;
  vC = modelMatrix[3].xyz; vS = length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SQ = `float sq(float x){ return x * x; }
`;
const GLOBE_FRAG = /* glsl */ `
${SQ}${GLSL_NOISE}
uniform float uKind, uSeed, uHasSea, uSeaLevel, uRadius, uTime, uOpacity, uSkyBlend, uSunI, uIce, uBump;
uniform vec3 uL0, uL1, uL2, uSea, uAtm, uSunDir, uSunColor, uSkyColor, uAccent;
uniform vec2 uHazeDist;
uniform float uAtmDensity;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vC; varying float vS;

void main(){
  vec3 P = normalize(vObj);
  vec3 q = P * 2.1 + vec3(uSeed * 0.37, uSeed * 0.11, uSeed * 0.23);
  float w = fbm3(q * 1.7 + 3.1);
  float hr = fbm3(q + (w - 0.5) * 0.9);
  float h = smoothstep(0.22, 0.78, hr);
  float detail = fbm3lo(q * 7.0);
  float hLow = smoothstep(0.22, 0.78, fbm3lo(q + (w - 0.5) * 0.9));
  vec3 alb; float isSea = 0.0; vec3 emis = vec3(0.0); float bh = h;
  float lvl = uSeaLevel;

  if (uKind < 0.5) {                           // DUNE
    float bands = sin((P.y * 15.0 + (w - 0.5) * 9.0 + hr * 4.0) * 3.14159) * 0.5 + 0.5;
    float ridge = 1.0 - abs(2.0 * fbm3(q * 3.4 + 4.0) - 1.0);
    alb = mix(uL1, uL2, bands * 0.8 + ridge * 0.2);
    alb = mix(uL0, alb, smoothstep(0.18, 0.5, h));
    alb *= 0.82 + 0.34 * detail;
    bh = hLow * 0.5;
  } else if (uKind < 2.5) {                    // OCEAN FOREST / FOREST ROCK
    float lh = clamp((h - lvl) / (1.0 - lvl), 0.0, 1.0);
    vec3 land = mix(uL0, uL1, smoothstep(0.0, 0.45, lh));
    land = mix(land, uL2, smoothstep(0.5, 0.95, lh));
    land *= 0.78 + 0.44 * detail;
    float beach = smoothstep(0.05, 0.0, h - lvl);
    land = mix(land, uAccent * 0.85, beach * 0.7 * step(0.5, uKind) * step(uKind, 1.5));
    isSea = (uHasSea > 0.5) ? smoothstep(lvl, lvl - 0.012, h) : 0.0;
    float depth = clamp((lvl - h) / max(lvl, 0.05), 0.0, 1.0);
    vec3 shallow = uSea * vec3(1.9, 1.75, 1.35);
    vec3 deep = uSea * 0.26;
    vec3 seaC = mix(shallow, deep, smoothstep(0.0, 0.4, depth));
    seaC *= 0.92 + 0.16 * fbm3lo(q * 9.0);
    alb = mix(land, seaC, isSea);
    float lat = abs(P.y) + (fbm3lo(q * 3.0) - 0.5) * 0.14;
    float ice = smoothstep(0.84, 0.9, lat) * uIce;
    alb = mix(alb, vec3(0.86, 0.92, 0.98), ice);
    isSea *= (1.0 - ice);
    bh = mix(hLow, lvl, isSea);
  }

  // ---- lighting
  vec3 Ng = normalize(vWN); vec3 V = normalize(cameraPosition - vWP); vec3 L = normalize(uSunDir);
  vec3 dpx = dFdx(vWP), dpy = dFdy(vWP);
  vec2 dH = vec2(dFdx(bh), dFdy(bh)) * (uBump * uRadius * vS);
  vec3 r1 = cross(dpy, Ng), r2 = cross(Ng, dpx);
  float det = dot(dpx, r1);
  vec3 N = normalize(abs(det) * Ng - sign(det) * (dH.x * r1 + dH.y * r2));
  N = normalize(mix(N, Ng, 0.85 * isSea));
  float ndlg = dot(Ng, L);
  float term = smoothstep(-0.03, 0.22, ndlg);
  float diff = clamp(dot(N, L), 0.0, 1.0) * term;
  vec3 amb = vec3(0.020, 0.026, 0.045) + uAtm * 0.018;
  vec3 col = alb * (amb + uSunColor * uSunI * diff);
  float tw = exp(-sq(ndlg / 0.16));
  col += mix(uAtm, vec3(1.0, 0.5, 0.25), 0.45) * tw * (dot(alb, vec3(0.33)) + 0.05) * 0.5 * uAtmDensity;
  // ocean specular glint + sky reflection
  vec3 Hh = normalize(L + V);
  float nh = max(dot(N, Hh), 0.0);
  float sp = (pow(nh, 220.0) * 2.6 + pow(nh, 26.0) * 0.16) * isSea * term;
  col += uSunColor * sp;
  col += uAtm * isSea * pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.3 * term;
  col += emis;
  // aerial perspective when seen from inside the atmosphere (descent)
  float dist = distance(cameraPosition, vWP);
  float haze = uSkyBlend * smoothstep(uHazeDist.x, uHazeDist.y, dist);
  col = mix(col, uSkyColor, haze);
  col = clamp(col, 0.0, 60.0);
  gl_FragColor = vec4(col, uOpacity);
}`;

const CLOUD_FRAG = /* glsl */ `
${SQ}${GLSL_NOISE}
uniform float uSeed, uCover, uOpacity, uSunI, uTime;
uniform vec3 uCloudCol, uSunDir, uSunColor, uAtm, uSkyColor; uniform vec2 uCloudNear; uniform float uSkyBlend; uniform vec2 uHazeDist;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vC; varying float vS;
void main(){
  vec3 P = normalize(vObj);
  vec3 q = P * 3.3 + vec3(uSeed * 0.21, uSeed * 0.07, uSeed * 0.13);
  float wv = fbm3lo(q * 1.3 + 9.0);
  float n = fbm3(q + (wv - 0.5) * 1.1);
  float thr = mix(0.70, 0.40, uCover);
  float a = smoothstep(thr, thr + 0.15, n);
  vec3 Ng = normalize(vWN); vec3 L = normalize(uSunDir);
  float ndl = dot(Ng, L);
  float lit = smoothstep(-0.08, 0.45, ndl);
  float thick = smoothstep(thr, thr + 0.35, n);
  vec3 col = uCloudCol * (0.025 + lit * (1.0 - 0.28 * thick)) * (uSunColor * uSunI);
  col += mix(uAtm, vec3(1.0, 0.55, 0.3), 0.5) * exp(-sq(ndl / 0.18)) * 0.2 * a;
  float dist = distance(cameraPosition, vWP);
  float near = smoothstep(uCloudNear.x, uCloudNear.y, dist);
  col = mix(col, uSkyColor, uSkyBlend * smoothstep(uHazeDist.x, uHazeDist.y, dist));
  gl_FragColor = vec4(col, a * 0.94 * uOpacity * near);
}`;

const ATM_FRAG = /* glsl */ `
${SQ}uniform vec3 uAtm, uSunDir; uniform float uAtmDensity, uRadius, uShell, uOpacity, uAtmStrength, uSunI;
varying vec3 vWP; varying vec3 vC; varying float vS;
void main(){
  vec3 ro = cameraPosition; vec3 rd = normalize(vWP - ro);
  vec3 oc = vC - ro; float tca = dot(oc, rd); float d2 = dot(oc, oc) - tca * tca; float d = sqrt(max(d2, 0.0));
  float R = uRadius * vS; float Rs = R * uShell;
  float glow; vec3 hitN;
  if (d < R) {
    float t0 = tca - sqrt(max(R * R - d2, 0.0));
    hitN = normalize(ro + rd * t0 - vC);
    float cs = sqrt(max(1.0 - d2 / (R * R), 0.0));
    glow = pow(1.0 - cs, 2.4);
  } else {
    float h = clamp((d - R) / (Rs - R), 0.0, 1.0);
    glow = (exp(-h * 5.0) - exp(-5.0)) / (1.0 - exp(-5.0));
    hitN = normalize(ro + rd * tca - vC);
  }
  float nl = dot(hitN, normalize(uSunDir));
  float lit = smoothstep(-0.3, 0.45, nl);
  float twi = exp(-sq(nl / 0.22));
  vec3 col = uAtm * glow * (0.06 + lit * 1.5) * (0.35 + uAtmDensity);
  col += vec3(1.0, 0.5, 0.26) * twi * glow * 0.45 * uAtmDensity;
  col *= uOpacity * uAtmStrength;
  col = clamp(col, 0.0, 60.0);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Procedural planet globe (surface + clouds + Fresnel/limb atmosphere) for one PlanetSpec. */
export function createPlanetGlobe(spec: PlanetSpec, opts: PlanetGlobeOptions = {}): PlanetGlobe {
  const radius = opts.radius ?? 10;
  const seg = opts.segments ?? 128;
  const o = spec.orbital;
  const col = (n: number) => new THREE.Color(n);
  const shared = {
    uSunDir: { value: new THREE.Vector3(0.486, 0.763, 0.347).normalize() },
    uSunI: { value: 1.05 }, uOpacity: { value: 1 }, uTime: { value: 0 },
    uSkyBlend: { value: 0 }, uSkyColor: { value: col(spec.sky.horizonColor) }, uAtmStrength: { value: 1 },
    uCloudNear: { value: new THREE.Vector2(0, 0.0001) }, uHazeDist: { value: new THREE.Vector2(100, 6000) },
  };
  const sunColor = { value: new THREE.Color(1.0, 0.95, 0.86) };
  const atm = { value: col(o.atmosphereColor) };
  const radiusU = { value: radius };

  const surfMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: GLOBE_FRAG,
    uniforms: {
      ...shared, uKind: { value: KIND_INDEX[spec.kind] }, uSeed: { value: spec.seed % 997 },
      uHasSea: { value: o.sea !== undefined ? 1 : 0 }, uSeaLevel: { value: o.seaLevel },
      uRadius: radiusU, uIce: { value: spec.kind === 'dune' ? 0 : spec.kind === 'oceanForest' ? 0.8 : 0.55 },
      uBump: { value: 0.1 },
      uL0: { value: col(o.land[0]) }, uL1: { value: col(o.land[1]) }, uL2: { value: col(o.land[2]) },
      uSea: { value: col(o.sea ?? 0x000000) }, uAtm: atm, uSunColor: sunColor,
      uAccent: { value: col(spec.palette.accent) }, uAtmDensity: { value: o.atmosphereDensity },
    },
    transparent: false,
  });
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      ...shared, uSeed: { value: (spec.seed * 3) % 991 }, uCover: { value: o.cloudCover }, uCloudCol: { value: col(o.cloudColor) }, uAtm: atm, uSunColor: sunColor,
    },
  });
  const atmMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: ATM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { ...shared, uAtm: atm, uAtmDensity: { value: o.atmosphereDensity }, uRadius: radiusU, uShell: { value: opts.atmScale ?? 1.07 } },
  });

  const group = new THREE.Group(); group.name = `PlanetGlobe:${spec.kind}`;
  const spin = new THREE.Group(); spin.rotation.z = o.axialTilt;
  const geo = new THREE.SphereGeometry(radius, seg, Math.round(seg / 2));
  const surface = new THREE.Mesh(geo, surfMat); surface.frustumCulled = false;
  const cloudScale = opts.cloudScale ?? 1.012;
  const cloudGeo = new THREE.SphereGeometry(radius * cloudScale, Math.round(seg * 0.75), Math.round(seg * 0.375));
  const clouds = new THREE.Mesh(cloudGeo, cloudMat); clouds.renderOrder = 2; clouds.frustumCulled = false;
  const atmGeo = new THREE.SphereGeometry(radius * (opts.atmScale ?? 1.07), 96, 48);
  const atmo = new THREE.Mesh(atmGeo, atmMat); atmo.renderOrder = 3; atmo.frustumCulled = false;
  spin.add(surface, clouds);
  group.add(spin, atmo); // atmosphere is not tilted (rotation-invariant)

  let opacity = 1;
  const api: PlanetGlobe = {
    group, spin, radius, spec, shared,
    setSunDirection(d) { shared.uSunDir.value.copy(d).normalize(); },
    setOpacity(v) {
      opacity = THREE.MathUtils.clamp(v, 0, 1); shared.uOpacity.value = opacity;
      surfMat.transparent = opacity < 0.999; surfMat.depthWrite = opacity > 0.5; surfMat.needsUpdate = true;
      group.visible = opacity > 0.002;
    },
    update(dt, time) {
      shared.uTime.value = time;
      spin.rotation.y += dt * 0.025;
      clouds.rotation.y += dt * 0.006; // clouds drift relative to the surface
    },
    dispose() {
      geo.dispose(); cloudGeo.dispose(); atmGeo.dispose(); surfMat.dispose(); cloudMat.dispose(); atmMat.dispose();
      group.removeFromParent();
    },
  };
  return api;
}
