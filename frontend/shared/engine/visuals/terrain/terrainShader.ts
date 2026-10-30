/** GLSL for the terrain material: composed from named chunks, injected by `applyTerrainShader`. */
import type * as THREE from 'three';
import { NOISE_GLSL } from './glsl';

const VERT_COMMON = /* glsl */ `#include <common>
attribute float aAO; attribute float aRock; varying vec3 vLP; varying vec3 vLN; varying float vAO; varying float vRock;`;
const VERT_BEGIN = /* glsl */ `#include <begin_vertex>
vLP = position; vLN = normal; vAO = aAO; vRock = aRock;`;

const FRAG_DECLS = /* glsl */ `uniform float uTime, uKind, uLevel, uExt;
uniform vec3 uLow, uHigh, uRock, uRockDark, uAccent; uniform vec2 uWind;
varying vec3 vLP; varying vec3 vLN; varying float vAO; varying float vRock;
vec3 gBump; vec3 gEmis; float gRough;
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
    float ht = smoothstep(-0.5, 4.5, y);
    col = mix(uLow*0.8, uHigh*1.05, clamp(ht*0.9 + 0.3*nL + 0.12*n1 - 0.1, 0.0, 1.0));
    float ph = dot(p,uWind)*2.7 + 2.4*vnoise(p*0.25) + 1.6*nL;
    float flatF = 1.0 - smoothstep(0.12,0.45,sl);
    gBump += -vec3(uWind.x,0.0,uWind.y)*cos(ph)*0.24*flatF;
    col *= 1.0 + 0.06*sin(ph)*flatF;
    col = mix(col, uAccent, smoothstep(0.55,0.8,vnoise(p*0.09+3.0))*0.18);
    float crest = smoothstep(0.1,0.3,sl)*(1.0-rockMask);
    col = mix(col, uLow*0.85, crest*0.3);
    // scree apron: gravel speckles of the cliff rock scattered over the sand below steep faces
    // bedrock only where the mesa mask says so — steep dune slip faces stay sand
    // noise-broken mask so the rock/sand boundary is ragged rather than following triangle edges
    float rk = vRock < 0.0 ? smoothstep(0.52, 0.75, sl) : clamp(vRock + (vnoise(p * 1.7) - 0.5) * 0.35 + (vnoise(p * 5.0) - 0.5) * 0.12, 0.0, 1.0);
    float scree = smoothstep(0.05, 0.6, rk) * (1.0 - smoothstep(0.75, 0.95, rk)) * smoothstep(0.04, 0.14, sl); // aprons only, never on flat tops
    float pebble = smoothstep(0.62, 0.8, vnoise(p * 6.5) * 0.7 + vnoise(p * 17.0) * 0.45);
    col = mix(col, mix(rockCol, uRockDark, 0.35), scree * pebble * 0.8);
    col = mix(col, uLow * 0.92, scree * 0.25);
    float cliff = smoothstep(0.62, 0.9, rk) * smoothstep(0.03, 0.12, sl);   // ledges stay rock too; only flat tops get the cap
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
    float sand = 1.0 - smoothstep(0.35, 1.15 + 0.5*n1, above);
    float hgt = smoothstep(0.5, 6.5, y);
    vec3 grass = mix(uLow, uHigh, clamp(hgt + 0.4*(n2-0.5) + 0.2*(nL-0.5), 0.0, 1.0));
    grass = mix(grass, grass*vec3(0.8,0.95,0.7), smoothstep(0.5,0.7,fbm3(p*0.16))*0.7);
    col = mix(grass, uAccent, sand);
    float wet = 1.0 - smoothstep(0.0, 0.55, above);
    col = mix(col, col*vec3(0.55,0.58,0.55), wet);
    float under = 1.0 - smoothstep(-2.6, 0.0, above);
    col = mix(col, uAccent*vec3(0.62,0.66,0.62), under*0.8*step(above,0.0));
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
    float above = y - uLevel; col = mix(col, vec3(0.22,0.2,0.15), (1.0-smoothstep(0.0,0.6,above))*0.8);
  
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
  diffuseColor.rgb = col;
}`;

const FRAG_COMMON = `#include <common>
${FRAG_DECLS}${NOISE_GLSL}
float hash1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
${STRATA_ROCK}`;

const FRAG_COLOR = `#include <color_fragment>
${COLOR_PRE}  if (uKind < 0.5) {
${KIND_DUNE}  } else if (uKind < 1.5) {
${KIND_OCEAN_FOREST}  } else {
${KIND_FOREST_ROCK}  }
${COLOR_POST}`;

const FRAG_FOG = /* glsl */ `#include <fog_fragment>
#ifdef USE_FOG
  { float eg = smoothstep(0.5, 0.93, length(vLP.xz) / uExt); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, eg); } // radial, so the patch never reads as a square
#endif`;

export function applyTerrainShader(sh: THREE.WebGLProgramParametersWithUniforms, uniforms: Record<string, THREE.IUniform>) {
  Object.assign(sh.uniforms, uniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', VERT_COMMON)
    .replace('#include <begin_vertex>', VERT_BEGIN);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', FRAG_COMMON)
    .replace('#include <color_fragment>', FRAG_COLOR)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = gRough;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix*vec4(gBump,0.0)).xyz);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmis;`)
    .replace('#include <fog_fragment>', FRAG_FOG);
}
