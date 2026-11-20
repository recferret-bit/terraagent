import * as THREE from 'three';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';
import { getWeatherUniforms } from '../../core/weatherConfig';
import { getWindUniforms, WIND_GLSL } from '../../core/windConfig';
import { bindViewFocusUniforms, VIEW_FOCUS_GLSL } from '../../core/viewFocus';
import {
  botanicalColor as C,
  jitterBotanicalTint,
  makeBotanicalBlob as blob,
  mergeBotanicalParts as done,
  paintBotanical as paint,
  xfBotanical as xf,
  type BotanicalGeo as G,
} from './botanicalGeo';
import {
  buildBoulderAtlasGeo,
  buildSpireAtlasGeo,
  makeBoulderGeo,
  makeSpireGeo,
} from './desertAndRockGeos';
import { Noise2 } from './noise';
import { ProceduralTextureRegistry } from '../ProceduralTextureRegistry';
import { glslFloat } from '../shaderInject';

export { buildBoulderAtlasGeo, buildSpireAtlasGeo, jitterBotanicalTint, makeBoulderGeo, makeSpireGeo };

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
  /** Optional tree breed index (`0..3`) within a multi-breed atlas geometry (`aBreed`). */
  breedIndex?: number;
  /** Optional per-breed / per-instance wind compliance multiplier (`0.3..1.8`). */
  windMul?: number;
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

export function makeBroadleafGeo(leafA: THREE.Color, leafB: THREE.Color, seed: number): G {
  const nz = new Noise2(seed);
  const trunk = xf(new THREE.CylinderGeometry(0.11, 0.2, 1.7, 6, 1), [0, 0.85, 0]);
  const parts: G[] = [paint(trunk, C(0x5a3d26), 0.1, 0, 1, 1)];
  const blobs: [number, number, number, number, THREE.Color][] = [
    [0, 2.4, 0, 1.25, leafA], [0.65, 2.0, 0.3, 0.8, leafB], [-0.55, 2.15, -0.35, 0.85, leafA], [0.1, 3.05, -0.1, 0.8, leafB], [-0.2, 2.0, 0.6, 0.7, leafB],
  ];
  blobs.forEach(([x, y, z, r, c], i) => parts.push(paint(xf(blob(r, 0, nz, 0.25, i * 3.1), [x, y, z], [1, 0.88, 1]), c, 0.07, 0.55, 10 + i)));
  return done(parts);
}

export function makePineGeo(a: THREE.Color, b: THREE.Color): G {
  const parts: G[] = [paint(xf(new THREE.CylinderGeometry(0.1, 0.2, 1.6, 6, 1), [0, 0.8, 0]), C(0x4a3424), 0.1, 0, 2, 1)];
  const tiers: [number, number, number][] = [[1.7, 1.6, 1.2], [1.4, 1.5, 2.3], [1.1, 1.4, 3.3], [0.75, 1.3, 4.2], [0.4, 1.1, 5.0]];
  tiers.forEach(([r, h, y], i) => {
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) { const s = 1 + 0.12 * Math.sin(k * 7.3 + i * 2.1); p.setX(k, p.getX(k) * s); p.setZ(k, p.getZ(k) * s); }
    parts.push(paint(xf(g, [0, y + h / 2 - 0.2, 0]), i % 2 ? a : b, 0.08, 0.35, 30 + i));
  });
  return done(parts);
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

const MULTI_BREED_COLOR_VERT = /* glsl */ `{
  vec3 taInstCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    float taBrIdx = floor((instanceColor.r + 0.01) / 8.0);
    float taWnIdx = floor((instanceColor.b + 0.01) / 8.0);
    taInstCol = vec3(instanceColor.r - taBrIdx * 8.0, instanceColor.g, instanceColor.b - taWnIdx * 8.0);
  #endif
  #if defined(USE_COLOR_ALPHA)
    vColor = vec4(1.0);
  #elif defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
    vColor = vec3(1.0);
  #endif
  #ifdef USE_COLOR
    vColor *= color;
  #endif
  #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
    vColor.xyz *= taInstCol;
  #endif
}`;

function wrapMultiBreedBegin(chunk: string): string {
  return `#include <begin_vertex>
#if defined(USE_INSTANCING) && defined(USE_INSTANCING_COLOR)
  float taBreedSel = floor((instanceColor.r + 0.01) / 8.0);
  float taWindMul = max(0.25, floor((instanceColor.b + 0.01) / 8.0) * 0.1);
  if (abs(aBreed - taBreedSel) > 0.4) {
    transformed = vec3(0.0);
  } else {
#else
  float taWindMul = 1.0;
  {
#endif
${chunk.replace('#include <begin_vertex>\n', '').replace(/\buSway\b/g, '(uSway * taWindMul)')}
  }`;
}

export function createFoliageMaterial(
  timeU: THREE.IUniform,
  sway: number,
  doubleSided = false,
  multiBreed = false,
): THREE.MeshStandardMaterial {
  const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, flatShading: true, side });
  const swayU = { value: sway };
  const swayBegin = multiBreed ? wrapMultiBreedBegin(FOLIAGE_SWAY_BEGIN) : FOLIAGE_SWAY_BEGIN;
  const breedDecl = multiBreed ? 'attribute float aBreed;\n' : '';

  const patchDepthSway = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(sh.uniforms, getWindUniforms());
    sh.uniforms.uTime = timeU; sh.uniforms.uSway = swayU; bindViewFocusUniforms(sh.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#define TA_FOCUS_SHADOW_PASS\n#include <common>\n${breedDecl}${FOLIAGE_WIND_DECL}`)
      .replace('#include <begin_vertex>', swayBegin);
  };
  const barkBundle = ProceduralTextureRegistry.get('treeBarkFissures', 128);
  const barkMapU = { value: barkBundle.map! };
  const barkRoughU = { value: barkBundle.roughnessMap! };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms(), getWindUniforms(), getWeatherUniforms());
    sh.uniforms.uTime = timeU; sh.uniforms.uSway = swayU;
    sh.uniforms.uBarkMap = barkMapU; sh.uniforms.uBarkRoughMap = barkRoughU;
    bindViewFocusUniforms(sh.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aBark;\n${breedDecl}${FOLIAGE_WIND_DECL}\nvarying vec3 vFW; varying vec3 vFN; varying vec4 vFBark;`)
      .replace('#include <begin_vertex>', `${swayBegin}
  vFBark = vec4(position, aBark);
#ifdef USE_INSTANCING
  vFW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vFN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vFN = normalize(mat3(modelMatrix) * objectNormal);
#endif`);
    if (multiBreed) {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', MULTI_BREED_COLOR_VERT);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uWetness, uRainIntensity;\nuniform sampler2D uBarkMap, uBarkRoughMap;\nvarying vec3 vFW; varying vec3 vFN; varying vec4 vFBark;\n${COLONY_VISION_AND_LIGHTS_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float taBarkMask = clamp(vFBark.w, 0.0, 1.0);
vec2 taBarkUvA = vec2(vFBark.x * 1.45, vFBark.y * 0.52);
vec2 taBarkUvB = vec2(vFBark.z * 1.45, vFBark.y * 0.52);
float taBarkBlend = abs(vFN.x) / max(abs(vFN.x) + abs(vFN.z), 0.001);
float taBarkFissure = mix(dot(texture2D(uBarkMap, taBarkUvA).rgb, vec3(0.3333)), dot(texture2D(uBarkMap, taBarkUvB).rgb, vec3(0.3333)), taBarkBlend);
float taBarkRough = mix(texture2D(uBarkRoughMap, taBarkUvA).r, texture2D(uBarkRoughMap, taBarkUvB).r, taBarkBlend);
diffuseColor.rgb *= mix(1.0, 0.78 + 0.44 * taBarkFissure, taBarkMask * 0.75);
if (uWetness > 0.001) {
  float fUp = clamp(vFN.y, 0.0, 1.0);
  diffuseColor.rgb *= mix(1.0, 0.66, uWetness);
  diffuseColor.rgb += vec3(0.04, 0.07, 0.11) * (uWetness * pow(fUp, 2.0));
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, taBarkRough, taBarkMask * 0.55);
roughnessFactor *= mix(1.0, 0.32, uWetness);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ vec3 taProj = evalColonyProjectorLight(vFW, vFN); totalEmissiveRadiance += diffuseColor.rgb * taProj + taProj * 0.05; }')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = applyColonyFovShroud(vFW, gl_FragColor.rgb);');
  };
  if (multiBreed) m.customProgramCacheKey = () => `ta-foliage-multibreed:${side}`;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side });
  if (multiBreed) depthMat.customProgramCacheKey = () => `ta-foliage-depth-multibreed:${side}`;
  depthMat.onBeforeCompile = patchDepthSway;
  m.userData.depthMaterial = depthMat;
  const origDispose = m.dispose.bind(m);
  m.dispose = () => { depthMat.dispose(); origDispose(); };
  return m;
}

const ROCK_MULTIBREED_BEGIN = `#include <begin_vertex>
#if defined(USE_INSTANCING) && defined(USE_INSTANCING_COLOR)
  if (abs(aBreed - floor((instanceColor.r + 0.01) / 8.0)) > 0.4) {
    transformed = vec3(0.0);
  }
#endif`;

/** Rock material: world-space grain + ground-up darkening, faceted, works with instanceColor & optional `aBreed` atlas. */
export function createRockMaterial(opts: { rough?: number; metal?: number; flat?: boolean; multiBreed?: boolean }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.rough ?? 0.9, metalness: opts.metal ?? 0, flatShading: opts.flat ?? true });
  m.shadowSide = THREE.DoubleSide;
  m.userData.receiveShadow = false;
  const multi = Boolean(opts.multiBreed);
  const breedDecl = multi ? 'attribute float aBreed;\n' : '';
  const beginChunk = multi ? ROCK_MULTIBREED_BEGIN : '#include <begin_vertex>';

  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms(), getWeatherUniforms());
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${breedDecl}varying vec3 vRW; varying vec3 vRN;`)
      .replace('#include <begin_vertex>', `${beginChunk}
#ifdef USE_INSTANCING
  vRW = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;
  vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
#else
  vRW = (modelMatrix * vec4(transformed,1.0)).xyz;
  vRN = normalize(mat3(modelMatrix) * objectNormal);
#endif`);
    if (multi) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', MULTI_BREED_COLOR_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uWetness, uRainIntensity;\nvarying vec3 vRW; varying vec3 vRN;\n${COLONY_VISION_AND_LIGHTS_GLSL}\nfloat rH(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y);} \nfloat rN(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rH(i),rH(i+vec2(1,0)),f.x),mix(rH(i+vec2(0,1)),rH(i+vec2(1,1)),f.x),f.y);}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{ float g = rN(vRW.xz*3.1 + vRW.y*1.7)*0.6 + rN(vRW.xz*9.0 - vRW.y*4.0)*0.4;
  float st = rN(vec2(vRW.x*0.4+vRW.z*0.3, vRW.y*2.2));
  diffuseColor.rgb *= 0.78 + 0.4*g;
  diffuseColor.rgb *= 0.85 + 0.3*st;
  diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(-0.2, 1.4, vRW.y));
  if (uWetness > 0.001) {
    float rUp = clamp(vRN.y, 0.0, 1.0);
    diffuseColor.rgb *= mix(1.0, 0.66, uWetness);
    diffuseColor.rgb += vec3(0.05, 0.08, 0.12) * (uWetness * pow(rUp, 2.0));
  } }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= mix(1.0, 0.32, uWetness);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ vec3 taProj = evalColonyProjectorLight(vRW, vRN); totalEmissiveRadiance += diffuseColor.rgb * taProj + taProj * 0.05; }')
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = applyColonyFovShroud(vRW, gl_FragColor.rgb);');
  };
  if (multi) {
    m.customProgramCacheKey = () => 'ta-rock-multibreed';
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depthMat.customProgramCacheKey = () => 'ta-rock-depth-multibreed';
    depthMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${breedDecl}`)
        .replace('#include <begin_vertex>', ROCK_MULTIBREED_BEGIN);
    };
    m.userData.depthMaterial = depthMat;
    const origDispose = m.dispose.bind(m);
    m.dispose = () => { depthMat.dispose(); origDispose(); };
  }
  return m;
}

export interface InstOpts {
  sx?: [number, number]; sy?: [number, number]; sink?: number; tilt?: number;
  tint?: (r: number, c: THREE.Color) => void; scaleMul?: (p: Place) => number;
  encodeBreedInColor?: boolean;
  castShadow?: boolean;
}
export function writeInstancedPlaces(im: THREE.InstancedMesh, places: readonly Place[], opt: InstOpts): THREE.InstancedMesh {
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
    if (opt.encodeBreedInColor) {
      const br = Math.max(0, Math.min(7, Math.round(p.breedIndex ?? 0)));
      const wn = Math.max(2, Math.min(20, Math.round((p.windMul ?? 1) * 10)));
      c.r = br * 8 + Math.max(0.2, Math.min(3.5, c.r));
      c.b = wn * 8 + Math.max(0.2, Math.min(3.5, c.b));
    }
    im.setColorAt(i, c);
  });
  im.instanceMatrix.clearUpdateRanges();
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) {
    im.instanceColor.clearUpdateRanges();
    im.instanceColor.needsUpdate = true;
  }
  if (im.material && (im.material as THREE.Material).userData?.depthMaterial) {
    im.customDepthMaterial = (im.material as THREE.Material).userData.depthMaterial as THREE.Material;
  }
  if (places.length > 0) {
    im.computeBoundingBox();
    im.computeBoundingSphere();
  }
  const matReceive = (im.material as THREE.Material | undefined)?.userData?.receiveShadow as boolean | undefined;
  im.castShadow = opt.castShadow ?? true;
  im.receiveShadow = matReceive ?? true;
  return im;
}

export function buildInstanced(geo: G, mat: THREE.Material, places: Place[], opt: InstOpts): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, places.length));
  return writeInstancedPlaces(im, places, opt);
}
