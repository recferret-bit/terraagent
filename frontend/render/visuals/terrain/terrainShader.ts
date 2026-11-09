/** GLSL for the terrain material: composed from named chunks, injected by `applyTerrainShader`. */
import type * as THREE from 'three';
import { getWeatherUniforms } from '../../core/weatherConfig';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '../../lighting/ColonyVisionAndLights';
import { TERRAFORM_EVAL_GLSL, TERRAFORM_UNIFORMS_GLSL } from '../TerrainAndWaterShaders';
import { NOISE_GLSL } from './glsl';
import { injectAll } from '../shaderInject';
import { WATER_BED_TINT_GLSL } from '../water/glsl/bed';
import { getWaterUniforms } from '../water/waterConfig';

const VERT_COMMON = /* glsl */ `#include <common>
attribute float aAO; attribute float aRock; varying vec3 vLP; varying vec3 vLN; varying float vAO; varying float vRock;`;
const VERT_BEGIN = /* glsl */ `#include <begin_vertex>
vLP = position; vLN = normal; vAO = aAO; vRock = aRock;`;

const FRAG_DECLS = /* glsl */ `uniform float uTime, uKind, uLevel, uExt;
uniform float uRainIntensity, uWetness, uPuddleLevel, uStormDarkness, uWeatherTime;
uniform float uPuddleElectroIntensity;
uniform vec2 uPuddleElectroOrigin;
uniform vec3 uLow, uHigh, uRock, uRockDark, uAccent; uniform vec2 uWind;
varying vec3 vLP; varying vec3 vLN; varying float vAO; varying float vRock;
vec3 gBump; vec3 gEmis; float gRough;

float evalPuddleNoiseField(vec2 wp) {
  return (vnoise(wp * 0.22 + vec2(3.7, -5.1)) * 0.65 + vnoise(wp * 0.47 - vec2(1.9, 4.3)) * 0.35) + (vnoise(wp * 0.55) - 0.5) * 0.28;
}

vec3 evalPuddleElectrocution(vec2 p, float electroInt, vec2 origin, float t, float puddleThreshold) {
  const float MAX_R = 4.6;
  vec2 dp = p - origin;
  float r = length(dp);
  if (electroInt <= 0.001 || r > MAX_R) return vec3(0.0);
  float pOrigin = evalPuddleNoiseField(origin);
  float pMid1 = evalPuddleNoiseField(mix(origin, p, 0.35));
  float pMid2 = evalPuddleNoiseField(mix(origin, p, 0.70));
  float minPuddlePath = min(pOrigin, min(pMid1, pMid2));
  float connectedPuddle = smoothstep(puddleThreshold - 0.06, puddleThreshold + 0.01, minPuddlePath);
  if (connectedPuddle <= 0.001) return vec3(0.0);
  float age = clamp(1.0 - electroInt, 0.0, 1.0);
  float frontR = mix(1.4, MAX_R, smoothstep(0.0, 0.32, age));
  if (r > frontR) return vec3(0.0);
  float radialEnv = (1.0 - smoothstep(frontR * 0.65, frontR, r)) * (1.0 - smoothstep(MAX_R * 0.72, MAX_R, r));
  float ang = atan(dp.y, dp.x);
  float w1 = vnoise(p * 0.75 + vec2(t * 2.5, -t * 2.0)) - 0.5;
  float w2 = vnoise(p * 1.85 - vec2(t * 4.5, t * 3.8)) - 0.5;
  float b1 = abs(sin(ang * 5.0 + w1 * 3.6 + w2 * 1.4 - r * 0.32));
  float armWidth1 = mix(0.095, 0.025, clamp(r / MAX_R, 0.0, 1.0));
  float m1 = smoothstep(armWidth1, 0.0, b1);
  float b2 = abs(sin(ang * 11.0 - w1 * 2.8 + w2 * 3.8 + r * 0.75));
  float m2 = smoothstep(0.06, 0.0, b2) * smoothstep(0.4, 1.8, r) * (1.0 - smoothstep(2.5, MAX_R * 0.9, r));
  float b3 = abs(sin(r * 2.3 - ang * 3.0 + w1 * 4.8 + w2 * 2.4 - t * 14.0));
  float m3 = smoothstep(0.055, 0.0, b3) * clamp(m1 * 1.4 + m2 * 1.2 + 0.25, 0.0, 1.0);
  float surge = 0.55 + 0.45 * sin(r * 2.8 - t * 22.0 + w2 * 5.0);
  float flicker = 0.72 + 0.28 * sin(t * 58.0 + r * 3.5 + ang * 4.0);
  float web = clamp(m1 * 1.25 + m2 * 0.85 + m3 * 0.7, 0.0, 1.0) * (0.65 + 0.55 * surge);
  float coreFlash = exp(-r * r * 0.22) * smoothstep(0.35, 1.0, electroInt);
  vec3 boltCyan = vec3(0.18, 0.78, 1.0);
  vec3 boltCore = vec3(0.75, 0.96, 1.45);
  vec3 col = mix(boltCyan, boltCore, clamp(m1 * 0.75 + coreFlash, 0.0, 1.0));
  return col * (web + coreFlash * 0.85) * radialEnv * connectedPuddle * electroInt * flicker * 2.1;
}
`;

const STRATA_ROCK = /* glsl */ `// Rock surface = three rock "materials" blended by soft alpha masks (no hard bands):
//   base sandstone (palette rock) · pale bleached sandstone · dark desert varnish.
// Masks are low-frequency, domain-warped fbm stretched horizontally (a hint of bedding, never a stripe), a soft
// height gradient (sun-bleached tops, darker feet), and long vertical streak masks for varnish running down faces.
vec3 strataRock(vec2 p, float y, vec3 rock, vec3 dark, vec3 light){
  vec2 w = vec2(fbm3(p * 0.035 + 7.0), fbm3(p * 0.035 - 3.0)) * 18.0;
  vec2 q = p + w;
  float bed = fbm3(vec2(q.x * 0.04 + q.y * 0.03, y * 0.09 + fbm3(q * 0.05) * 0.8));   // soft, wavy bedding field
  float mPale = smoothstep(0.48, 0.8, bed + (y - 8.0) * 0.016);                          // more bleached higher up
  float along = dot(p, vec2(0.71, 0.71)) + w.x * 0.15;
  float drip = fbm3(vec2(along * 0.9, y * 0.06 + 0.3 * fbm3(p * 0.2)));
  float mVarn = smoothstep(0.46, 0.76, drip) * (0.6 + 0.4 * smoothstep(2.0, 10.0, y));
  vec3 c = mix(rock * 1.05, light, mPale * 0.5);
  c = mix(c, dark, mVarn * 0.7);
  c *= mix(0.86, 1.06, smoothstep(0.0, 12.0, y));                                        // gentle vertical gradient
  c *= 0.93 + 0.14 * fbm3(q * 0.6);                                                      // broad mottling
  c *= 0.95 + 0.1 * vnoise(p * 4.0 + y * 1.3);                                           // fine grain
  return c;
}`;

/** Per-kind ground colouring (writes `col`, `gRough`; reads the shared locals declared in COLOR_PRE). */
const KIND_DUNE = /* glsl */ `    // ---- dune: wind-carved sand, rippled
    float ht = smoothstep(0.2, 4.8, y);
    col = mix(uLow*0.76, uHigh*1.08, clamp(ht*0.92 + 0.28*nL + 0.12*n1 - 0.08, 0.0, 1.0));
    float ph = dot(p,uWind)*2.7 + 2.4*vnoise(p*0.25) + 1.6*nL;
    float flatF = 1.0 - smoothstep(0.12,0.45,sl);
    gBump += -vec3(uWind.x,0.0,uWind.y)*cos(ph)*0.32*flatF;
    col *= 1.0 + 0.09*sin(ph)*flatF;
    col = mix(col, uAccent, smoothstep(0.55,0.8,vnoise(p*0.09+3.0))*0.18);
    float duneSlope = smoothstep(0.012, 0.085, sl) * (1.0 - smoothstep(0.08, 0.35, vRock));
    float leeward = clamp(dot(N.xz, uWind) * 3.2, -1.0, 1.0);
    col = mix(col, uHigh * 1.14, duneSlope * clamp(-leeward, 0.0, 1.0) * 0.32);
    col = mix(col, uLow * 0.72, duneSlope * (0.35 + 0.65 * clamp(leeward, 0.0, 1.0)) * 0.48);
    // scree apron: gravel speckles of the cliff rock scattered over the sand below steep faces
    // bedrock only where the mesa mask says so — steep dune slip faces stay sand
    // noise-broken mask so the rock/sand boundary is ragged rather than following triangle edges
    float rk = vRock < 0.0 ? smoothstep(0.52, 0.75, sl) : clamp(vRock + ((vnoise(p * 1.7) - 0.5) * 0.24 + (vnoise(p * 5.0) - 0.5) * 0.08) * smoothstep(0.01, 0.25, vRock), 0.0, 1.0);
    float scree = smoothstep(0.04, 0.28, rk) * (1.0 - smoothstep(0.28, 0.52, rk)) * smoothstep(0.04, 0.14, sl); // aprons only, never on flat tops or sand dunes
    float pebble = smoothstep(0.62, 0.8, vnoise(p * 6.5) * 0.7 + vnoise(p * 17.0) * 0.45);
    col = mix(col, mix(rockCol, uRockDark, 0.35), scree * pebble * 0.55);
    col = mix(col, uLow * 0.92, scree * 0.25);
    float cliff = smoothstep(0.18, 0.42, rk) * smoothstep(0.03, 0.12, sl);   // ledges and full cliff walls stay rock; only flat tops get the cap
    col = mix(col, rockCol, cliff);
    // caprock: flat mesa tops get a darker, wind-polished crust
    float cap = (1.0 - smoothstep(0.06, 0.2, sl)) * smoothstep(0.75, 0.98, vRock); // un-noised mask → no speckle on tops
    // plateau tops: smooth gradient from bleached crust to a soft wind-blown sand veil (low-frequency, no blotches)
    float veil = smoothstep(0.35, 0.75, fbm3(p * 0.06 + 2.0));
    vec3 crust = mix(rockCol, mix(uRock, uAccent, 0.35), 0.4);
    col = mix(col, mix(crust, mix(crust, uHigh, 0.6), veil), cap);
    gRough = mix(0.95, 0.82, cliff);
`;
const KIND_OCEAN_FOREST = /* glsl */ `    // ---- ocean forest: sand, grass, wet shore
    float above = y - uLevel;
    float sand = (1.0 - smoothstep(0.35, 1.15 + 0.5*n1, above)) * shoreGate;
    float hgt = smoothstep(0.5, 6.5, y);
    vec3 grass = mix(uLow, uHigh, clamp(hgt + 0.4*(n2-0.5) + 0.2*(nL-0.5), 0.0, 1.0));
    grass = mix(grass, grass*vec3(0.8,0.95,0.7), smoothstep(0.5,0.7,fbm3(p*0.16))*0.7);
    col = mix(grass, uAccent, sand);
    float wet = (1.0 - smoothstep(0.0, 0.55, above)) * shoreGate;
    col = mix(col, col*vec3(0.55,0.58,0.55), wet);
    float under = 1.0 - smoothstep(-2.6, 0.0, above);
    col = mix(col, uAccent*vec3(0.62,0.66,0.62), under*0.8*step(above,0.0)*shoreGate);
    col = mix(col, rockCol, rockMask*smoothstep(0.0,0.5,above));
    gRough = mix(0.95, 0.55, wet);
`;
const KIND_FOREST_ROCK = /* glsl */ `    // ---- forest rock: moss, meadow, cliffs
    float hgt = smoothstep(0.0, 8.0, y);
    col = mix(uLow, uHigh, clamp(hgt*0.6 + 0.5*(n2-0.4), 0.0, 1.0));
    float meadow = smoothstep(0.52,0.62, fbm3(p*0.055+7.0));
    col = mix(col, mix(uHigh, uAccent, 0.2), meadow*(1.0-rockMask));
    col = mix(col, uLow*0.7, (1.0-meadow)*smoothstep(0.45,0.7,n1)*0.5);
    float dirt = smoothstep(0.2,0.32,sl)*(1.0-rockMask);
    col = mix(col, vec3(0.30,0.24,0.17), dirt*0.6);
    col = mix(col, rockCol, rockMask);
    float above = y - uLevel;
    float shoreSand = (1.0 - smoothstep(-0.02, 0.08, above)) * smoothstep(-0.32, -0.04, above) * (1.0 - rockMask) * shoreGate;
    col = mix(col, vec3(0.78, 0.68, 0.48) * (0.92 + 0.16 * n2), shoreSand * 0.75);
    col = mix(col, vec3(0.26, 0.23, 0.18), (1.0 - smoothstep(-0.35, -0.04, above)) * 0.65 * shoreGate);
  
`;

const COLOR_PRE = /* glsl */ `{
  vec2 p = vLP.xz; float y = vLP.y;
  vec3 N = normalize(vLN);
  float sl = 1.0 - N.y;
  float n1 = vnoise(p*0.35), n2 = fbm3(p*1.7), nL = fbm3(p*0.045);
  float fine = vnoise(p*7.0);
  vec3 col; gEmis = vec3(0.0); gRough = 0.92; gBump = vec3(0.0);
  vec3 rockCol = strataRock(p, y, uRock, uRockDark, mix(uRock, uAccent, 0.45));
  float rockMask = smoothstep(0.30, 0.50, sl);
  float shoreGate = TA_WATER_GATE;                                          // 0 = dry land whatever its height
`;
const COLOR_POST = /* glsl */ `  col *= 0.9 + 0.2*n2;
  col *= mix(0.42, 1.0, smoothstep(0.25, 1.0, vAO));                       // baked AO: creases & cliff feet
  col = mix(vec3(dot(col, vec3(0.3,0.59,0.11))), col, 1.3) * 0.92;
  // micro bump
  vec2 e = vec2(0.06,0.0);
  float b0 = vnoise(p*2.4)*0.6 + vnoise(p*6.1)*0.3;
  float bx = vnoise((p+e.xy)*2.4)*0.6 + vnoise((p+e.xy)*6.1)*0.3;
  float bz = vnoise((p+e.yx)*2.4)*0.6 + vnoise((p+e.yx)*6.1)*0.3;
  gBump += -vec3(bx-b0, 0.0, bz-b0)/0.06*0.07;
#ifndef TA_HEX_TERRAFORM
  vec2 tfGridUv = clamp(vLP.xz / uExt + 0.5, 0.0, 1.0);
  vec4 tfWorldSample = texture2D(uTerraformMap, tfGridUv);
  evalTerraformSurface(col, gRough, gEmis, p, tfWorldSample.r, tfWorldSample.g, uTime);
#endif
  diffuseColor.rgb = col;
}`;

const TERRAIN_WEATHER_GLSL = /* glsl */ `
void evalTerrainWeather(
  inout vec3 col,
  inout float rough,
  inout vec3 bump,
  inout vec3 emis,
  vec3 worldPos,
  vec3 worldN,
  float waterLevel,
  float waterGate,
  float hexShore
) {
  float aboveWater = mix(
    1.0 - smoothstep(0.62, 0.94, hexShore),
    smoothstep(waterLevel + 0.06, waterLevel + 0.18, worldPos.y),
    waterGate
  );
  if (aboveWater <= 0.001) return;
  float steep = 1.0 - clamp(worldN.y, 0.0, 1.0);
  if (uWetness > 0.001) {
    float wet = uWetness * aboveWater;
    col *= mix(1.0, 0.62, wet * (1.0 - 0.35 * steep));
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(luma), col, 1.0 + 0.18 * wet);
    float upSheen = pow(clamp(worldN.y, 0.0, 1.0), 2.0);
    vec3 viewDirW = normalize(cameraPosition - worldPos);
    float fresnelW = pow(1.0 - max(0.0, dot(worldN, viewDirW)), 2.5);
    col += vec3(0.06, 0.09, 0.14) * (wet * upSheen * (0.45 + 0.55 * fresnelW));
    rough = mix(rough, 0.22, wet * 0.75);
  }
  if (uPuddleLevel > 0.01 && steep < 0.22) {
    vec2 wp = worldPos.xz;
    float puddleNoise = evalPuddleNoiseField(wp);
    float puddleThreshold = mix(0.76, 0.44, uPuddleLevel);
    float puddleMask = smoothstep(puddleThreshold - 0.09, puddleThreshold + 0.04, puddleNoise)
      * (1.0 - smoothstep(0.06, 0.22, steep))
      * aboveWater
      * (1.0 - smoothstep(0.25, 0.55, hexShore))
      * step(0.01, uPuddleLevel);
    if (puddleMask > 0.001) {
      float puddleRim = smoothstep(0.0, 0.35, puddleMask) * (1.0 - smoothstep(0.35, 0.88, puddleMask));
      col *= mix(1.0, 0.70, puddleRim);
      vec3 viewDirP = normalize(cameraPosition - worldPos);
      float pFresnel = 0.28 + 0.72 * pow(1.0 - max(0.0, viewDirP.y), 3.0);
      vec3 puddleCol = mix(col * 0.52, vec3(0.14, 0.20, 0.28), 0.74);
      puddleCol = mix(puddleCol, vec3(0.32, 0.44, 0.60), pFresnel * 0.55);
      bump = mix(bump, bump * 0.06, puddleMask);
      if (uRainIntensity > 0.01) {
        vec2 puv = wp * 1.4;
        vec2 pcell = floor(puv);
        float prnd = tHash(pcell);
        float pr = fract(uWeatherTime * 1.7 + prnd);
        vec2 pcenter = (vec2(prnd, fract(prnd * 17.3)) - 0.5) * 0.36;
        vec2 pdv = fract(puv) - 0.5 - pcenter;
        float pdist = length(pdv) + 1e-4;
        float pring = sin(pdist * 36.0 - uWeatherTime * 14.0) * exp(-pdist * 4.8) * (1.0 - pr);
        float pSplash = clamp(pring, 0.0, 1.0) * uRainIntensity;
        puddleCol += vec3(0.32, 0.44, 0.56) * (pSplash * 0.65);
        emis += vec3(0.12, 0.18, 0.26) * (pSplash * puddleMask);
        bump += vec3(pdv.x / pdist, 0.0, pdv.y / pdist) * (pring * 0.14 * uRainIntensity * puddleMask);
      }
      col = mix(col, puddleCol, puddleMask * 0.88);
      if (uPuddleElectroIntensity > 0.001) {
        vec3 puddleElectro = evalPuddleElectrocution(wp, uPuddleElectroIntensity, uPuddleElectroOrigin, uTime, puddleThreshold) * puddleMask;
        col += puddleElectro * 0.65;
        emis += puddleElectro * 2.2;
      }
      rough = mix(rough, 0.05, puddleMask);
    }
  }
}
`;

/**
 * Water-level bands (shore sand, wet ground, lake-bed mud) assume land rises out of the water as a continuous
 * heightfield. A material whose dry ground can sit at or below the water level defines `TA_WATER_GATE` (1 on water
 * tiles, 0 on dry ground) before this chunk; the hex terrain does (`hexEdges.ts`), since it levels flat land to 0 m.
 */
const FRAG_COMMON = `#include <common>
${TERRAFORM_UNIFORMS_GLSL}
#define TA_TERRAIN_SHADER 1
#ifndef TA_WATER_GATE
#define TA_WATER_GATE 1.0
#endif
#ifndef TA_HEX_SHORE_VAL
#define TA_HEX_SHORE_VAL 0.0
#endif
${NOISE_GLSL}
${FRAG_DECLS}
float hash1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
${STRATA_ROCK}
${TERRAFORM_EVAL_GLSL}
${WATER_BED_TINT_GLSL}
${TERRAIN_WEATHER_GLSL}
${COLONY_VISION_AND_LIGHTS_GLSL}`;

const FRAG_COLOR = `#include <color_fragment>
${COLOR_PRE}  if (uKind < 0.5) {
${KIND_DUNE}  } else if (uKind < 1.5) {
${KIND_OCEAN_FOREST}  } else {
${KIND_FOREST_ROCK}  }
${COLOR_POST}`;

const FRAG_FOG = /* glsl */ `#include <fog_fragment>
#ifdef USE_FOG
  { float eg = smoothstep(0.5, 0.93, length(vLP.xz) / uExt); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, eg); } // radial, so the patch never reads as a square
#endif
gl_FragColor.rgb = applyColonyFovShroud(vLP, gl_FragColor.rgb);`;

export function applyTerrainShader(sh: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>) {
  Object.assign(
    sh.uniforms,
    getColonyVisionUniforms(),
    getWeatherUniforms(),
    { uAbsorption: getWaterUniforms().uAbsorption },
    uniforms,
  );
  sh.vertexShader = injectAll(sh.vertexShader, [
    ['#include <common>', VERT_COMMON],
    ['#include <begin_vertex>', VERT_BEGIN],
  ], 'terrain vertex');
  sh.fragmentShader = injectAll(sh.fragmentShader, [
    ['#include <common>', FRAG_COMMON],
    ['#include <color_fragment>', FRAG_COLOR],
    // after the colour AND the hex beach (`alphatest_fragment`, hexEdges.ts): ground under water is tinted by depth, dry ground gets wetness + puddles
    ['#include <roughnessmap_fragment>', `diffuseColor.rgb = waterBedTint(diffuseColor.rgb, uLevel - vLP.y, TA_WATER_GATE);\nevalTerrainWeather(diffuseColor.rgb, gRough, gBump, gEmis, vLP, normalize(vLN), uLevel, TA_WATER_GATE, TA_HEX_SHORE_VAL);\n#include <roughnessmap_fragment>\nroughnessFactor = gRough;`],
    ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix*vec4(gBump,0.0)).xyz);`],
    ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>\nvec3 taProj = evalColonyProjectorLight(vLP, normalize(vLN + gBump));\ntotalEmissiveRadiance += gEmis + diffuseColor.rgb * taProj + taProj * 0.06;`],
    ['#include <fog_fragment>', FRAG_FOG],
  ], 'terrain fragment');
}
