import * as THREE from 'three';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '../../../lighting/ColonyVisionAndLights';
import { getWaterUniforms } from '../waterConfig';
import { FAUNA_WATER_VERT_GLSL, faunaWaterUniforms } from './faunaWater';
import { BOB_AMP, DART_GAIN, DART_PERIOD, DART_START, PATH_WOBBLE } from './faunaPlacement';

/**
 * Zero-CPU aquatic fauna motion + look (MeshStandardMaterial + onBeforeCompile).
 * Supports 4 species in one draw call:
 *  - 0 (`SPECIES_SCHOOL`): pelagic schooling fish
 *  - 1 (`SPECIES_SOLITARY`): solitary cruiser fish
 *  - 2 (`SPECIES_MINNOW`): bright shallow-water reef/brook shoal minnows
 *  - 3 (`SPECIES_RAY`): diamond-winged undulating manta / river rays
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
}
float fishSinkFactor(float depth) {
  float t = clamp((depth - 0.14) / 0.22, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}`;

const FISH_VERT_MOTION = /* glsl */ `
float fPhase = aFish.x;
float fSp = aFish.w;
float isRay = step(2.5, fSp);
float fClk = fishClock(uTime, fPhase);
float fDx = fishDartX(uTime, fPhase);
float fBurst = 6.0 * fDx * (1.0 - fDx) * ${f(DART_GAIN / (DART_PERIOD * (1 - DART_START)))};
float fTh = fPhase * 6.2831853 + aSwim.w * fClk;
float fDir = aSwim.w < 0.0 ? -1.0 : 1.0;
vec2 fP0 = fishLoop(fPhase, fTh);
vec2 fFwd = normalize(fishLoop(fPhase, fTh + 0.05 * fDir) - fP0);
vec2 fSide = vec2(-fFwd.y, fFwd.x);
vec2 fC = fP0 + fFwd * aOffset.x + fSide * aOffset.y;
float fL = aBody.x;
float fFreq = isRay > 0.5 ? 3.2 : (fSp > 1.5 ? 10.5 : (fSp > 0.5 ? 4.2 : 8.5));
float fWig = fFreq * fClk + aOffset.w * 6.2831853 - fL * 4.0;
float fAmpK = 0.8 + 0.5 * min(fBurst, 2.0);
float fAmp = (0.02 + 0.11 * fL * fL) * fAmpK * (1.0 - 0.65 * isRay);
vec3 fLocal = position;
if (isRay > 0.5) {
  // Morph fusiform ring mesh into a wide diamond pectoral-winged manta/river ray with whip tail
  float wingChord = smoothstep(-0.24, 0.08, position.z) * (1.0 - smoothstep(0.14, 0.48, position.z));
  float wingScale = 1.4 + 6.2 * wingChord;
  fLocal.x *= wingScale;
  fLocal.y *= 0.26;
  float spanDist = abs(fLocal.x);
  fLocal.y += sin(fWig - spanDist * 3.4) * spanDist * 0.28;
} else {
  fLocal.x += sin(fWig) * fAmp;
}
float fDxdL = (-4.0 * cos(fWig) * fAmp + sin(fWig) * 0.22 * fL * fAmpK) * (1.0 - isRay);
float fBend = atan(fDxdL);
float fYawC = cos(fBend), fYawS = sin(fBend);
vec2 fHx = vec2(fFwd.y * fYawC + fFwd.x * fYawS, fFwd.x * fYawC - fFwd.y * fYawS);
vec3 fN = vec3(normal.x * fHx.x + normal.z * fHx.y, normal.y, -normal.x * fHx.y + normal.z * fHx.x);
vec3 fS = fLocal * aFish.z;
float effSink = uFaunaSink * fishSinkFactor(aFish.y);
vec3 fishPos = vec3(fC.x + fS.x * fFwd.y + fS.z * fFwd.x,
  -aFish.y - effSink + aOffset.z + ${f(BOB_AMP)} * sin(uTime * 1.1 + fPhase * 17.0) + fS.y,
  fC.y - fS.x * fFwd.x + fS.z * fFwd.y);
fishPos.xz += faunaRefractShift(fC, -fishPos.y);
vec3 objectNormal = normalize(fN);
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
uniform vec3 uFishBack0, uFishBack1, uFishBack2, uFishBack3;
uniform vec3 uFishBelly0, uFishBelly1, uFishBelly2, uFishBelly3;
uniform vec3 uFishAccent0, uFishAccent1, uFishAccent2, uFishAccent3;
uniform vec3 uFishDeep;
uniform float uAbsorption, uFishGlow;
${COLONY_VISION_AND_LIGHTS_GLSL}`;

const FISH_FRAG_COLOR = /* glsl */ `#include <color_fragment>
float spId = vFishBody.z;
vec3 fBack = spId < 0.5 ? uFishBack0 : (spId < 1.5 ? uFishBack1 : (spId < 2.5 ? uFishBack2 : uFishBack3));
vec3 fBelly = spId < 0.5 ? uFishBelly0 : (spId < 1.5 ? uFishBelly1 : (spId < 2.5 ? uFishBelly2 : uFishBelly3));
vec3 fishAccent = spId < 0.5 ? uFishAccent0 : (spId < 1.5 ? uFishAccent1 : (spId < 2.5 ? uFishAccent2 : uFishAccent3));
float fishMurk = 1.0 - exp(-(vFishDepth + 0.14) * uAbsorption * 1.5);
{ vec3 col = mix(fBelly, fBack, smoothstep(0.28, 0.72, vFishBody.x));
  col = mix(col, fishAccent, vFishBody.y * 0.88);
  // Crisp sunlit dorsal iridescence so swimming fish/rays read clearly through the water surface by day
  float dayGlint = (1.0 - clamp(uNightFactor, 0.0, 1.0)) * smoothstep(0.38, 0.90, vFishBody.x) * 0.48;
  col += fishAccent * dayGlint + fBelly * (dayGlint * 0.18);
  diffuseColor.rgb = mix(col, uFishDeep, fishMurk * 0.34); }`;

const FISH_FRAG_EMISSIVE = /* glsl */ `#include <emissivemap_fragment>
{ vec3 taProj = evalColonyProjectorLight(vFishW, vFishN);
  totalEmissiveRadiance += diffuseColor.rgb * taProj * 0.65;
  totalEmissiveRadiance += fishAccent * (vFishBody.y * 0.8 + 0.2 * smoothstep(0.6, 1.0, vFishBody.x)) * uFishGlow * clamp(uNightFactor, 0.0, 1.0) * (1.0 - fishMurk * 0.45); }`;

export interface FishPalette { back: number; belly: number; accent: number }
export type AquaticBiomePaletteSet = readonly [FishPalette, FishPalette, FishPalette, FishPalette];

export const AQUATIC_BIOME_PALETTES: Readonly<Record<string, AquaticBiomePaletteSet>> = {
  oceanForest: [
    { back: 0x1e8ca6, belly: 0xe6f4f1, accent: 0x56f0e5 }, // Reef school: turquoise-silver + cyan fins
    { back: 0xc85a32, belly: 0xf4dca8, accent: 0xffb703 }, // Solitary reef tang/grouper: coral-gold
    { back: 0x2ec4b6, belly: 0xf8fff8, accent: 0xffe66d }, // Shallow chromis minnows: bright aqua-gold
    { back: 0x1d4e89, belly: 0xe8eef5, accent: 0x64dfdf }, // Coastal manta ray: cobalt back, ivory belly
  ],
  forestRock: [
    { back: 0x356b6e, belly: 0xd8e4df, accent: 0x72efdd }, // Highland char school: silver-teal
    { back: 0x4a4e32, belly: 0xd6c79c, accent: 0xe06d44 }, // Solitary salmon/trout: olive-bronze + crimson
    { back: 0x529677, belly: 0xeef5ec, accent: 0xb5e48c }, // Shallow brook minnows: emerald-silver
    { back: 0x3d5467, belly: 0xd4dde4, accent: 0x8ecae6 }, // River ray: slate-blue + pale rim
  ],
  dune: [
    { back: 0xb57c38, belly: 0xf2e2ba, accent: 0xffca3a },
    { back: 0x8c4a27, belly: 0xdcc49a, accent: 0xff924c },
    { back: 0xd4a34b, belly: 0xfaf0d7, accent: 0xffe169 },
    { back: 0x6e5844, belly: 0xe4d5be, accent: 0xf4a261 },
  ],
};

export const FISH_PALETTES: readonly [FishPalette, FishPalette] = [
  AQUATIC_BIOME_PALETTES.forestRock![0],
  AQUATIC_BIOME_PALETTES.forestRock![1],
];

export function createFishMaterial(
  time: THREE.IUniform,
  deepColor: THREE.IUniform,
  sink: THREE.IUniform,
  biomeKind = 'forestRock',
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.24 });
  m.name = 'waterFauna';
  const pal = AQUATIC_BIOME_PALETTES[biomeKind] ?? AQUATIC_BIOME_PALETTES.forestRock!;
  const c = (hex: number) => ({ value: new THREE.Color(hex) });
  const local: Record<string, THREE.IUniform> = {
    uTime: time, uFaunaSink: sink, uFishDeep: deepColor, uAbsorption: getWaterUniforms().uAbsorption, uFishGlow: { value: 1.75 },
    uFishBack0: c(pal[0].back), uFishBelly0: c(pal[0].belly), uFishAccent0: c(pal[0].accent),
    uFishBack1: c(pal[1].back), uFishBelly1: c(pal[1].belly), uFishAccent1: c(pal[1].accent),
    uFishBack2: c(pal[2].back), uFishBelly2: c(pal[2].belly), uFishAccent2: c(pal[2].accent),
    uFishBack3: c(pal[3].back), uFishBelly3: c(pal[3].belly), uFishAccent3: c(pal[3].accent),
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
  m.customProgramCacheKey = () => `terra-water-fauna-2:${biomeKind}`;
  return m;
}
