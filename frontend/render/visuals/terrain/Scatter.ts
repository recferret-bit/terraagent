import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';
import { getWindUniforms, WIND_GLSL } from '../../core/windConfig';
import { bindViewFocusUniforms, VIEW_FOCUS_GLSL } from '../../core/viewFocus';
import { Noise2, mulberry32 } from './noise';
import { glslFloat } from '../shaderInject';

export interface Place {
  x: number;
  y: number;
  z: number;
  rot: number;
  s: number;
  r: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  stage?: 'full' | 'half' | 'depleted';
  /** Instance colour multiplier (> 1 brightens), e.g. the accent step of a tier 2/3 deposit. */
  tintMul?: number;
}

/** Jittered-grid scatter; `prob(x,z,r)` returns acceptance probability (0 = reject). */
export function scatterGrid(rng: () => number, extent: number, cell: number, prob: (x: number, z: number, r: number) => number): Place[] {
  const out: Place[] = [];
  const n = Math.floor((extent * 2) / cell);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -extent + (i + 0.5 + (rng() - 0.5) * 0.95) * cell, z = -extent + (j + 0.5 + (rng() - 0.5) * 0.95) * cell;
    const r = rng(), rot = rng() * Math.PI * 2, s = rng();
    const p = prob(x, z, r);
    if (p > 0 && rng() < p) out.push({ x, y: 0, z, rot, s, r: rng() });
  }
  return out;
}

type G = THREE.BufferGeometry;
function paint(g: G, color: THREE.Color, jitter = 0, topBoost = 0, seed = 1): G {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const p = out.getAttribute('position'), n = p.count;
  const col = new Float32Array(n * 3);
  const rng = mulberry32(seed);
  const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
  const hgt = Math.max(1e-3, box.max.y - box.min.y);
  const tmp = new THREE.Color();
  for (let t = 0; t < n; t += 3) {
    const k = 1 + (rng() - 0.5) * 2 * jitter; // per-face shade
    for (let v = 0; v < 3; v++) {
      const y = (p.getY(t + v) - box.min.y) / hgt;
      tmp.copy(color).multiplyScalar(k * (1 + topBoost * (y - 0.5)));
      col[(t + v) * 3] = tmp.r; col[(t + v) * 3 + 1] = tmp.g; col[(t + v) * 3 + 2] = tmp.b;
    }
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}
function xf(g: G, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]): G {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
  return g;
}
function blob(radius: number, detail: number, noise: Noise2, amp: number, seedOff: number): G {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + amp * noise.n(v.x * 1.7 + seedOff, v.y * 1.7 + v.z * 1.3);
    p.setXYZ(i, v.x * d, v.y * d, v.z * d);
  }
  g.computeVertexNormals();
  return g;
}
const C = (h: number | THREE.Color) => (h instanceof THREE.Color ? h.clone() : new THREE.Color(h));
const done = (parts: G[]) => { const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!; m.computeVertexNormals(); return m; };

export function makeBroadleafGeo(leafA: THREE.Color, leafB: THREE.Color, seed: number): G {
  const nz = new Noise2(seed);
  const trunk = xf(new THREE.CylinderGeometry(0.11, 0.2, 1.7, 6, 1), [0, 0.85, 0]);
  const parts: G[] = [paint(trunk, C(0x5a3d26), 0.1, 0, 1)];
  const blobs: [number, number, number, number, THREE.Color][] = [
    [0, 2.4, 0, 1.25, leafA], [0.65, 2.0, 0.3, 0.8, leafB], [-0.55, 2.15, -0.35, 0.85, leafA], [0.1, 3.05, -0.1, 0.8, leafB], [-0.2, 2.0, 0.6, 0.7, leafB],
  ];
  blobs.forEach(([x, y, z, r, c], i) => parts.push(paint(xf(blob(r, 0, nz, 0.25, i * 3.1), [x, y, z], [1, 0.88, 1]), c, 0.07, 0.55, 10 + i)));
  return done(parts);
}

export function makePalmGeo(leaf: THREE.Color): G {
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, 1.4, 0.1), new THREE.Vector3(0.55, 2.8, 0.1), new THREE.Vector3(0.5, 4.2, 0.0)]);
  const trunk = new THREE.TubeGeometry(curve, 8, 0.13, 5, false);
  const parts: G[] = [paint(trunk, C(0x8a6a46), 0.12, 0.2, 3)];
  const top = curve.getPoint(1);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const leafG = new THREE.PlaneGeometry(0.55, 2.4, 1, 5);
    const lp = leafG.getAttribute('position');
    for (let k = 0; k < lp.count; k++) {
      const t = Math.min(1, Math.max(0, (lp.getY(k) + 1.2) / 2.4)); // 0..1 along frond
      const w = Math.sin(t * Math.PI * 0.95 + 0.1);
      lp.setXYZ(k, lp.getX(k) * (0.35 + w), t * 2.2, -Math.pow(t, 1.8) * 1.3 + Math.abs(lp.getX(k)) * 0.3);
    }
    leafG.rotateX(-0.45); leafG.rotateY(a);
    xf(leafG, [top.x, top.y, top.z]);
    parts.push(paint(leafG, leaf, 0.12, 0.5, 20 + i));
  }
  parts.push(paint(xf(new THREE.IcosahedronGeometry(0.2, 0), [top.x, top.y - 0.1, top.z]), C(0x6b4a2a), 0.1, 0, 5));
  return done(parts);
}

export function makePineGeo(a: THREE.Color, b: THREE.Color): G {
  const parts: G[] = [paint(xf(new THREE.CylinderGeometry(0.1, 0.2, 1.6, 6, 1), [0, 0.8, 0]), C(0x4a3424), 0.1, 0, 2)];
  const tiers: [number, number, number][] = [[1.7, 1.6, 1.2], [1.4, 1.5, 2.3], [1.1, 1.4, 3.3], [0.75, 1.3, 4.2], [0.4, 1.1, 5.0]];
  tiers.forEach(([r, h, y], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) { const s = 1 + 0.12 * Math.sin(k * 7.3 + i * 2.1); p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s); }
    parts.push(paint(xf(g, [0, y + h / 2 - 0.2, 0]), i % 2 ? a : b, 0.08, 0.35, 30 + i));
  });
  return done(parts);
}

/** Low-poly faceted boulder. Deep base skirt below y=0 for sloped ground contact, noisy faceted top. */
export function makeBoulderGeo(seed: number, tint = new THREE.Color(1, 1, 1)): G {
  const nz = new Noise2(seed);
  const g = blob(1, 1, nz, 0.38, seed * 1.7);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -0.52) p.setY(i, -0.52 + (y + 0.52) * 0.15);
    else if (y > 0) p.setY(i, y * 1.14);
  }
  g.computeVertexNormals();
  return paint(g, tint, 0.1, 0.3, seed);
}

/** Tall rock spire / obsidian shard: tapered hexagonal prism with kinks and underground skirt (-0.26..+1.12). */
export function makeSpireGeo(seed: number, tint = new THREE.Color(1, 1, 1)): G {
  const nz = new Noise2(seed);
  const g = new THREE.CylinderGeometry(0.32, 0.90, 1.38, 6, 6);
  g.translate(0, 0.43, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const yPos = Math.max(0, y);
    const k = 1 + 0.25 * nz.n(p.getX(i) * 3 + 5, y * 3 + p.getZ(i) * 3);
    p.setXYZ(i, p.getX(i) * k + yPos * yPos * 0.25 * nz.n(seed, 1), y, p.getZ(i) * k + yPos * yPos * 0.2 * nz.n(seed, 2));
  }
  g.computeVertexNormals();
  return paint(g, tint, 0.12, 0.45, seed);
}

/** Foliage vertex uniforms: the material's own clock + sway multiplier, and the shared wind (`core/windConfig.ts`). */
/** How strongly the wind bends and shakes the trees (lean, sway and flutter growth; the faint idle sway is fixed). */
export const FOLIAGE_WIND_GAIN = 0.5;

/**
 * Per-tree response traits (shared by the GLSL below and its TS mirror `foliageTreeTraits`). Size is the instance's
 * height scale (`|M[1]|`, ~0.35..0.7 on the hex planet, ~0.8..1.9 on the prototype surfaces).
 */
export const FOLIAGE_TREE = {
  /** Trunk-mode angular frequency (rad/s) of a tree of height scale `sizeRef`; f ~ 1/sqrt(height), ±20 % per tree. */
  omega0: 2.6,
  sizeRef: 0.6,
  /** Extra phase per metre of gust-front travel (`uWindPhase`): stronger wind swings a little faster, slider-safe. */
  windPhaseK: 0.1,
  /** How far downwind (m, x mass x size) a tree samples the gust field: the gust it felt a moment ago. */
  lagMin: 2.0,
  lagSpan: 4.0,
  /** View-focus fade (m) outside the focus radius over which sway dies out. */
  focusFade: 16,
} as const;

const FOLIAGE_WIND_DECL = /* glsl */ `uniform float uTime, uSway;
${WIND_GLSL}${VIEW_FOCUS_GLSL}
vec4 foliageTraits(vec2 p) {
  vec4 p4 = fract(vec4(p.xyx, p.y) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}`;

/**
 * Wind displacement, shared by the colour and the shadow-depth program (else shadows detach from the trees). Every
 * tree is its own damped oscillator: a stable hash of its position plus its height scale give it a natural frequency
 * (bigger = slower, ±20 %), a mass (heavier = leans less, lags more), a random phase, a lean bearing jittered ±10° and
 * an elliptical orbit (handedness + axis ratio). Inertia: the tree reads the gust envelope at two points downwind
 * (what passed it a moment ago and a little longer ago, since fronts travel downwind with `uWindPhase`): their mean
 * drives the lean (lagged + smoothed), their difference is the gust's rate of change, which surges the lean past its
 * mean while a front passes (overshoot, springing back as it leaves) and pumps the oscillation amplitude, so each tree
 * swings hardest just after a front reaches it and then settles. Modes: trunk sway (∝ height, slow), crown shiver
 * (upper crown only, 2.6..3.4x faster, stronger on small trees, with a bending wave up the crown) and turbulence
 * flutter (per vertex). All phases are per-tree constants x CPU-integrated clocks (`uTime`, `uWindPhase`,
 * `uWindTime`), so slider moves never jump. Everything per vertex depends only on `position` + instance data, so the
 * faces of the merged non-indexed geometry stay closed. Outside the view focus the whole thing is skipped. The
 * world-space offset is mapped into instance space with M^-1 = S^-2 * M^T (M = rotation * scale).
 */
const FOLIAGE_SWAY_BEGIN = /* glsl */ `#include <begin_vertex>
{
#ifdef USE_INSTANCING
  mat3 fwM = mat3(instanceMatrix);
  vec2 fwP = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;
#else
  mat3 fwM = mat3(1.0);
  vec2 fwP = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
#endif
  float fwVw = viewFocusWeight(fwP, ${glslFloat(FOLIAGE_TREE.focusFade)});
  if (fwVw > 0.0) {
  float fwH = max(position.y, 0.0);
  vec3 fwS2 = max(vec3(dot(fwM[0], fwM[0]), dot(fwM[1], fwM[1]), dot(fwM[2], fwM[2])), vec3(1e-4));
  vec4 fwR = foliageTraits(fwP);
  float fwSq = clamp(sqrt(sqrt(fwS2.y) / ${glslFloat(FOLIAGE_TREE.sizeRef)}), 0.6, 1.9);
  float fwJit = 0.8 + 0.4 * fwR.x;
  float fwOm = ${glslFloat(FOLIAGE_TREE.omega0)} * fwJit / fwSq;
  float fwMass = 0.75 + 0.5 * fwR.y;
  float fwComp = 1.0 / fwMass;
  float fwLag = clamp((${glslFloat(FOLIAGE_TREE.lagMin)} + ${glslFloat(FOLIAGE_TREE.lagSpan)} * fwR.w) * fwMass * fwSq, 1.0, 12.0);
  float fwG1 = windGustAt(fwP + uWindDir * (fwLag * 0.35));
  float fwG2 = windGustAt(fwP + uWindDir * fwLag);
  float fwGain = uWindStrength * ${glslFloat(FOLIAGE_WIND_GAIN)};
  float fwS = min(max(0.0, uWindStrength * (1.0 + uWindGust * 0.5 * (fwG1 + fwG2))), 3.0) * ${glslFloat(FOLIAGE_WIND_GAIN)}; // wind-driven only; idle sway not scaled
  float fwDg = (fwG1 - fwG2) * uWindGust;
  float fwEx = 1.0 + 1.2 * min(abs(fwDg) * min(uWindStrength, 1.0), 1.0);
  vec2 fwD = normalize(uWindDir + vec2(-uWindDir.y, uWindDir.x) * (fract(fwR.y * 3.7) - 0.5) * 0.35);
  vec2 fwX = vec2(-fwD.y, fwD.x);
  float fwLean = fwH * fwH * 0.014 * uSway * fwComp * max(fwS + 0.6 * fwDg * fwGain, -0.04);
  float fwSzA = clamp(fwSq, 0.8, 1.25);
  float fwA1 = uTime * fwOm + uWindPhase * ${glslFloat(FOLIAGE_TREE.windPhaseK)} * fwJit + fwR.z * 6.2832;
  float fwAmp1 = fwH * uSway * fwComp * fwSzA * (0.009 + 0.015 * fwS) * fwEx;
  float fwOrb = fwR.w > 0.5 ? 1.5708 : -1.5708;
  float fwEcc = 0.25 + 0.4 * fract(fwR.x * 7.31);
  float fwCw = smoothstep(1.2, 4.5, fwH);
  float fwA2 = uTime * fwOm * (2.6 + 0.8 * fract(fwR.z * 13.7)) + uWindPhase * 0.25 + fwR.y * 19.0 + fwH * 0.7;
  float fwAmp2 = fwCw * uSway * clamp(1.0 / fwSq, 0.7, 1.4) * (0.02 + 0.045 * fwS) * fwEx;
  float fwAlong = fwLean + sin(fwA1) * fwAmp1 + sin(fwA2) * fwAmp2;
  float fwAcross = sin(fwA1 + fwOrb) * fwAmp1 * fwEcc + cos(fwA2 * 1.31 + fwR.x * 5.0) * fwAmp2 * 0.8;
  float fwF = fwH * uSway * uWindTurb * (0.004 + 0.01 * fwS);
  float fwT = uWindTime * fwJit;
  vec2 fwFl = vec2(sin(fwT * 9.0 + dot(position, vec3(3.1, 1.7, 2.3)) + fwR.z * 31.0),
                   cos(fwT * 7.3 + dot(position, vec3(1.9, 2.9, 1.3)) + fwR.w * 29.0)) * fwF;
  vec2 fwOff = fwD * fwAlong + fwX * fwAcross + fwFl;
  vec3 fwW = vec3(fwOff.x, -0.5 * fwLean * fwLean / max(fwH, 0.5), fwOff.y);
  vec3 fwL = transpose(fwM) * fwW;
  transformed += fwL * fwVw / fwS2;
  }
}`;

const fr = Math.fround;
const fract = (v: number) => v - Math.floor(v);

/**
 * TS mirror of the shader's per-tree traits (`foliageTraits` + the trait lines of `FOLIAGE_SWAY_BEGIN`), for tests and
 * tuning. It models the GPU hash in float32 steps; it is not bit-exact with every GPU.
 */
export function foliageTreeTraits(x: number, z: number, sizeY: number = FOLIAGE_TREE.sizeRef): { hash: [number, number, number, number]; omega: number; phase: number; lag: number; compliance: number } {
  const p = [fract(fr(x * 0.1031)), fract(fr(z * 0.1030)), fract(fr(x * 0.0973)), fract(fr(z * 0.1099))] as [number, number, number, number];
  const d = fr(p[0] * (p[3] + 33.33) + p[1] * (p[2] + 33.33) + p[2] * (p[0] + 33.33) + p[3] * (p[1] + 33.33));
  const [a, b, c, e] = p.map((v) => fr(v + d)) as [number, number, number, number];
  const hash: [number, number, number, number] = [fract(fr((a + b) * c)), fract(fr((a + c) * b)), fract(fr((b + c) * e)), fract(fr((c + e) * a))];
  const sq = Math.min(1.9, Math.max(0.6, Math.sqrt(sizeY / FOLIAGE_TREE.sizeRef)));
  const mass = 0.75 + 0.5 * hash[1];
  return {
    hash,
    omega: (FOLIAGE_TREE.omega0 * (0.8 + 0.4 * hash[0])) / sq,
    phase: hash[2] * 6.2832,
    lag: Math.min(12, Math.max(1, (FOLIAGE_TREE.lagMin + FOLIAGE_TREE.lagSpan * hash[3]) * mass * sq)),
    compliance: 1 / mass,
  };
}

export function createFoliageMaterial(timeU: THREE.IUniform, sway: number, doubleSided = false): THREE.MeshStandardMaterial {
  const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: true, side });
  const swayU = { value: sway };
  const patchDepthSway = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(sh.uniforms, getWindUniforms());
    sh.uniforms.uTime = timeU; sh.uniforms.uSway = swayU; bindViewFocusUniforms(sh.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#define TA_FOCUS_SHADOW_PASS\n#include <common>\n${FOLIAGE_WIND_DECL}`)
      .replace('#include <begin_vertex>', FOLIAGE_SWAY_BEGIN);
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms(), getWindUniforms());
    sh.uniforms.uTime = timeU; sh.uniforms.uSway = swayU; bindViewFocusUniforms(sh.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${FOLIAGE_WIND_DECL}\nvarying vec3 vFW; varying vec3 vFN;`)
      .replace('#include <begin_vertex>', `${FOLIAGE_SWAY_BEGIN}
#ifdef USE_INSTANCING
  vFW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vFN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vFN = normalize(mat3(modelMatrix) * objectNormal);
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFW; varying vec3 vFN;\n${COLONY_VISION_AND_LIGHTS_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ vec3 taProj = evalColonyProjectorLight(vFW, vFN); totalEmissiveRadiance += diffuseColor.rgb * taProj + taProj * 0.05; }')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = applyColonyFovShroud(vFW, gl_FragColor.rgb);');
  };
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side });
  depthMat.onBeforeCompile = patchDepthSway;
  m.userData.depthMaterial = depthMat;
  const origDispose = m.dispose.bind(m);
  m.dispose = () => { depthMat.dispose(); origDispose(); };
  return m;
}

/** Rock material: world-space grain + ground-up darkening, faceted, works with instanceColor. */
export function createRockMaterial(opts: { rough?: number; metal?: number; flat?: boolean }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.9, metalness: opts.metal ?? 0, flatShading: opts.flat ?? true });
  m.shadowSide = THREE.DoubleSide;
  m.userData.receiveShadow = false;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms());
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vRW = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;
  vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vRW = (modelMatrix * vec4(position,1.0)).xyz;
  vRN = normalize(mat3(modelMatrix) * objectNormal);
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRW; varying vec3 vRN;\n${COLONY_VISION_AND_LIGHTS_GLSL}\nfloat rH(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y);} \nfloat rN(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rH(i),rH(i+vec2(1,0)),f.x),mix(rH(i+vec2(0,1)),rH(i+vec2(1,1)),f.x),f.y);}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ float g = rN(vRW.xz*3.1 + vRW.y*1.7)*0.6 + rN(vRW.xz*9.0 - vRW.y*4.0)*0.4;
  float st = rN(vec2(vRW.x*0.4+vRW.z*0.3, vRW.y*2.2));
  diffuseColor.rgb *= 0.78 + 0.4*g;
  diffuseColor.rgb *= 0.85 + 0.3*st;
  diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(-0.2, 1.4, vRW.y)); }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ vec3 taProj = evalColonyProjectorLight(vRW, vRN); totalEmissiveRadiance += diffuseColor.rgb * taProj + taProj * 0.05; }')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = applyColonyFovShroud(vRW, gl_FragColor.rgb);');
  };
  return m;
}

export interface InstOpts {
  sx?: [number, number]; sy?: [number, number]; sink?: number; tilt?: number;
  tint?: (r: number, c: THREE.Color) => void; scaleMul?: (p: Place) => number;
}
export function buildInstanced(geo: G, mat: THREE.Material, places: Place[], opt: InstOpts): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, places.length));
  im.count = places.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3(), c = new THREE.Color();
  const sx = opt.sx ?? [0.8, 1.3], sy = opt.sy ?? sx;
  places.forEach((p, i) => {
    const k = opt.scaleMul ? opt.scaleMul(p) : 1;
    const a = (sx[0] + (sx[1] - sx[0]) * p.s) * k;
    const b = (sy[0] + (sy[1] - sy[0]) * ((p.s * 7.13 + p.r * 0.5) % 1)) * k;
    const ax = a * (p.scaleX ?? 1);
    const by = b * (p.scaleY ?? 1);
    const az = a * (p.scaleZ ?? p.scaleX ?? 1);
    e.set((p.r - 0.5) * (opt.tilt ?? 0), p.rot, (((p.s * 13.7) % 1) - 0.5) * (opt.tilt ?? 0));
    q.setFromEuler(e); s.set(ax, by, az); t.set(p.x, p.y - (opt.sink ?? 0) * by, p.z);
    m.compose(t, q, s); im.setMatrixAt(i, m);
    c.setRGB(1, 1, 1); opt.tint?.(p.r, c);
    if (p.stage === 'depleted') c.multiplyScalar(0.58);
    else if (p.stage === 'half' && (p.scaleY ?? 1) < 0.35) c.multiplyScalar(0.72);
    if (p.tintMul !== undefined) c.multiplyScalar(p.tintMul);
    im.setColorAt(i, c);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  if (mat.userData?.depthMaterial) im.customDepthMaterial = mat.userData.depthMaterial as THREE.Material;
  if (places.length > 0) {
    im.computeBoundingBox();
    im.computeBoundingSphere();
  }
  im.castShadow = true; im.receiveShadow = (mat.userData?.receiveShadow as boolean | undefined) ?? true;
  return im;
}
