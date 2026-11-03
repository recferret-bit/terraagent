import * as THREE from 'three';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '../../../lighting/ColonyVisionAndLights';
import { getWaterUniforms } from '../waterConfig';
import { FAUNA_WATER_VERT_GLSL, faunaWaterUniforms } from './faunaWater';
import { BOB_AMP, DART_GAIN, DART_PERIOD, DART_START, PATH_WOBBLE } from './faunaPlacement';

/**
 * Zero-CPU fish motion + look (MeshStandardMaterial + onBeforeCompile). Per instance: `aSwim` (centre xz, loop
 * radius, signed angular speed), `aFish` (phase, depth, length, species), `aOffset` (school frame offset, wiggle
 * phase); per vertex: `aBody` (length position, shade, accent). The path, heading (finite difference along the
 * loop), darts, bob and tail wiggle are closed-form in `uTime`; `faunaPlacement.ts` `fishPathPoint` mirrors the path.
 */

const f = (n: number) => n.toFixed(5);

const FISH_VERT_COMMON = /* glsl */ `#include <common>
${FAUNA_WATER_VERT_GLSL}
uniform float uTime, uFaunaSink;
attribute vec4 aSwim;
attribute vec4 aFish;
attribute vec4 aOffset;
attribute vec3 aBody;
varying vec3 vFishW;
varying vec3 vFishN;
varying vec3 vFishBody;
varying float vFishDepth;
float fishDartX(float t, float phase) {
  float u = t / ${f(DART_PERIOD)} + phase * 3.7;
  return clamp((fract(u) - ${f(DART_START)}) / ${f(1 - DART_START)}, 0.0, 1.0);
}
float fishClock(float t, float phase) {
  float u = t / ${f(DART_PERIOD)} + phase * 3.7;
  float x = fishDartX(t, phase);
  return t + ${f(DART_GAIN)} * (floor(u) + x * x * (3.0 - 2.0 * x));
}
vec2 fishLoop(float phase, float th) {
  float rho = aSwim.z * (1.0 + ${f(PATH_WOBBLE)} * sin(2.0 * th + phase * 11.0));
  return aSwim.xy + rho * vec2(cos(th), sin(th));
}`;

/** Runs once per vertex (in place of beginnormal_vertex): bends + orients the normal, keeps the posed point for begin_vertex. */
const FISH_VERT_MOTION = /* glsl */ `
float fPhase = aFish.x;
float fClk = fishClock(uTime, fPhase);
float fDx = fishDartX(uTime, fPhase);
float fBurst = 6.0 * fDx * (1.0 - fDx) * ${f(DART_GAIN / (DART_PERIOD * (1 - DART_START)))}; // extra speed while darting
float fTh = fPhase * 6.2831853 + aSwim.w * fClk;
float fDir = aSwim.w < 0.0 ? -1.0 : 1.0;
vec2 fP0 = fishLoop(fPhase, fTh);
vec2 fFwd = normalize(fishLoop(fPhase, fTh + 0.05 * fDir) - fP0);
vec2 fSide = vec2(-fFwd.y, fFwd.x);
vec2 fC = fP0 + fFwd * aOffset.x + fSide * aOffset.y;
float fL = aBody.x;
float fFreq = aFish.w > 0.5 ? 4.2 : 8.5;
float fWig = fFreq * fClk + aOffset.w * 6.2831853 - fL * 4.0;
float fAmpK = 0.8 + 0.5 * min(fBurst, 2.0);
float fAmp = (0.02 + 0.11 * fL * fL) * fAmpK;
vec3 fLocal = position;
fLocal.x += sin(fWig) * fAmp;
float fDxdL = -4.0 * cos(fWig) * fAmp + sin(fWig) * 0.22 * fL * fAmpK;
float fBend = atan(fDxdL); // centreline yaw: z runs nose (+) to tail (-), so dx/dz = -dx/dL
float fYawC = cos(fBend), fYawS = sin(fBend);
// rotY(heading) * rotY(bend): heading maps +Z to (fFwd.x, fFwd.y).
vec2 fHx = vec2(fFwd.y * fYawC + fFwd.x * fYawS, fFwd.x * fYawC - fFwd.y * fYawS);
vec3 fN = vec3(normal.x * fHx.x + normal.z * fHx.y, normal.y, -normal.x * fHx.y + normal.z * fHx.x);
vec3 fS = fLocal * aFish.z;
vec3 fishPos = vec3(fC.x + fS.x * fFwd.y + fS.z * fFwd.x,
  -aFish.y - uFaunaSink + aOffset.z + ${f(BOB_AMP)} * sin(uTime * 1.1 + fPhase * 17.0) + fS.y,
  fC.y - fS.x * fFwd.x + fS.z * fFwd.y);
fishPos.xz += faunaRefractShift(fC, -fishPos.y); // the image wobbles with the waves above
vec3 objectNormal = fN;
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`;

const FISH_VERT_BEGIN = /* glsl */ `vec3 transformed = fishPos;
vFishW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFishN = normalize(mat3(modelMatrix) * objectNormal);
vFishBody = vec3(aBody.yz, aFish.w);
vFishDepth = max(0.0, -transformed.y);`;

const FISH_FRAG_COMMON = /* glsl */ `#include <common>
varying vec3 vFishW;
varying vec3 vFishN;
varying vec3 vFishBody;
varying float vFishDepth;
uniform vec3 uFishBack0, uFishBack1, uFishBelly0, uFishBelly1, uFishAccent0, uFishAccent1, uFishDeep;
uniform float uAbsorption, uFishGlow;
${COLONY_VISION_AND_LIGHTS_GLSL}`;

const FISH_FRAG_COLOR = /* glsl */ `#include <color_fragment>
float fishSp = step(0.5, vFishBody.z);
vec3 fishAccent = mix(uFishAccent0, uFishAccent1, fishSp);
float fishMurk = 1.0 - exp(-(vFishDepth + 0.2) * uAbsorption * 2.0); // view path through the water above
{ vec3 back = mix(uFishBack0, uFishBack1, fishSp), belly = mix(uFishBelly0, uFishBelly1, fishSp);
  vec3 col = mix(belly, back, smoothstep(0.3, 0.75, vFishBody.x)); // countershading: dark back, light belly
  col = mix(col, fishAccent, vFishBody.y * 0.85);
  diffuseColor.rgb = mix(col, uFishDeep, fishMurk * 0.75); }`;

const FISH_FRAG_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
{ vec3 taProj = evalColonyProjectorLight(vFishW, vFishN);
  totalEmissiveRadiance += diffuseColor.rgb * taProj * 0.6;
  // Bioluminescent fins at night only (HDR > 1.1 so they bloom); none by day.
  totalEmissiveRadiance += fishAccent * vFishBody.y * uFishGlow * clamp(uNightFactor, 0.0, 1.0) * (1.0 - fishMurk * 0.5); }`;

export interface FishPalette { back: number; belly: number; accent: number }
/** Schooling fish: silver-teal; solitary fish: dark olive-bronze with a rust tail. */
export const FISH_PALETTES: readonly [FishPalette, FishPalette] = [
  { back: 0x2f5f66, belly: 0xc9d8d4, accent: 0x5fd6d0 },
  { back: 0x3a3a24, belly: 0xa89a74, accent: 0xc0603a },
];

/**
 * `time` = the water's `uTime` IUniform (pauses with the game); `deepColor` = the water's deep colour IUniform;
 * `sink` = the shared wave sink (`faunaSink.ts`).
 */
export function createFishMaterial(time: THREE.IUniform, deepColor: THREE.IUniform, sink: THREE.IUniform): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.22 });
  m.name = 'waterFauna';
  const c = (hex: number) => ({ value: new THREE.Color(hex) });
  const local: Record<string, THREE.IUniform> = {
    uTime: time, uFaunaSink: sink, uFishDeep: deepColor, uAbsorption: getWaterUniforms().uAbsorption, uFishGlow: { value: 1.6 },
    uFishBack0: c(FISH_PALETTES[0].back), uFishBelly0: c(FISH_PALETTES[0].belly), uFishAccent0: c(FISH_PALETTES[0].accent),
    uFishBack1: c(FISH_PALETTES[1].back), uFishBelly1: c(FISH_PALETTES[1].belly), uFishAccent1: c(FISH_PALETTES[1].accent),
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms(), faunaWaterUniforms(), local);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', FISH_VERT_COMMON)
      .replace('#include <beginnormal_vertex>', FISH_VERT_MOTION)
      .replace('#include <begin_vertex>', FISH_VERT_BEGIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', FISH_FRAG_COMMON)
      .replace('#include <color_fragment>', FISH_FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', FISH_FRAG_EMISSIVE)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.rgb = applyColonyFovShroud(vFishW, gl_FragColor.rgb);');
  };
  m.customProgramCacheKey = () => 'terra-water-fauna-1';
  return m;
}
