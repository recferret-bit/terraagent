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
  /** Cloud shell (child of `spin`; drifts relative to the surface via rotation.y). */
  readonly clouds: THREE.Mesh;
  /** Limb/atmosphere shell (its ShaderMaterial exposes uShell = shell radius / planet radius). */
  readonly atmosphere: THREE.Mesh;
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
  /** 0..1 cloud presence, independent of the globe's opacity: 0 = clouds dissolved, 1 = full cover. Used by planet morphs. */
  setCloudPresence(v: number): void;
  /**
   * Terraforming progress 0..4 (continuous). Calling it switches the globe to its BARREN state (dust, dry seabeds) and
   * five player colonies then claim territory, one expanding front per whole step, each in its own colour. A claim stops
   * where it meets a neighbour (nearest-colony ownership), leaving a frozen two-sided border; fronts can never cross.
   * Inside a territory the world becomes habitable (grass, forest, new seas) with forge-city sprawl and 3D stacks around
   * the colony; clouds thicken and the atmosphere turns blue. Never called by the descent or the game menu.
   * `smooth` plays the stage continuously instead of in discrete steps (used to collapse a finished terraform before a morph).
   */
  setTerraform(stage: number, smooth?: boolean): void;
  /** Axial spin in rad/s (default 0.025, the menu's idle drift). Clouds drift relative to it. */
  setSpinRate(radPerSec: number): void;
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

/**
 * Procedural LOD ("streaming" without textures). The base fbm stops at ~120 cycles per unit-sphere
 * unit, which is ~35 world units on the R=4000 descent globe — a 200-px blob from low altitude.
 * Extra octaves are added past that, each faded in only once its lattice cell spans more than
 * ~2-4 screen pixels. The footprint is measured on the unit-sphere coordinate (fwidth(P)), so the
 * same rule works for the R=9.5 menu globe (all extra octaves faded out → loop skipped, look
 * unchanged) and the R=4000 descent globe. All derivative calls stay in uniform control flow.
 */
const LOD_DETAIL = /* glsl */ `
// weight of an octave with lattice frequency F (cycles per unit-sphere unit) at pixel footprint fp
float lodW(float F, float fp){ return 1.0 - smoothstep(0.22, 0.5, F * fp); }
// Up to N extra value-noise octaves from frequency F0 (x2.3 each), stopping at the first one that is
// sub-pixel. 'stretch' scales the sample axes (anisotropic wisps / streaks). Returns:
//  x = signed detail (zero mean, ~±0.6), y = signed ridged detail (zero mean),
//  z = height in unit-sphere units (amplitude ∝ 1/F → constant slope, i.e. self-similar relief)
vec3 lodOctaves(vec3 P, vec3 so, float F0, float fp, vec3 stretch, int N){
  vec3 acc = vec3(0.0);
  float F = F0, a = 1.0;
  vec3 p = P;
  for (int i = 0; i < 5; i++){
    if (i >= N) break;
    float wt = lodW(F, fp);
    if (wt < 0.002) break;                      // octaves only get finer → nothing left to add
    float n = vnoise3(p * stretch * F + so);    // |input| < ~1.3e4 → fract() precision stays fine
    acc.x += a * wt * (n - 0.5);
    acc.y += a * wt * (0.5 - abs(2.0 * n - 1.0));
    acc.z += wt * (n - 0.5) / F;
    p = ROT3 * p; so = so.yzx + 1.37;
    F *= 2.3; a *= 0.62;
  }
  return acc;
}
`;

const GLOBE_FRAG = /* glsl */ `
${SQ}${GLSL_NOISE}${LOD_DETAIL}
uniform float uKind, uSeed, uHasSea, uSeaLevel, uRadius, uTime, uOpacity, uSkyBlend, uSunI, uIce, uBump;
uniform vec3 uL0, uL1, uL2, uSea, uAtm, uSunDir, uSunColor, uSkyColor, uAccent;
uniform vec2 uHazeDist;
uniform float uAtmDensity;
uniform float uTerra, uBarren, uTerraSea, uTerraSmooth;       // terraform stage 0..4, barren-start mode (1 once setTerraform was called), new sea level
uniform vec3 uSeaT; uniform vec3 uCol[5]; uniform vec3 uPCol[5];  // new-ocean colour, colony beacons (object-space unit vectors), player colours
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vC; varying float vS;

const float FD0 = 150.0;   // first extra octave (base 'detail' fbm ends at ~123 cycles / unit sphere)

void main(){
  vec3 P = normalize(vObj);
  // screen-space footprint of the unit-sphere coordinate — uniform control flow, before any branch
  float fp = max(length(fwidth(P)), 1e-7);
  vec3 seedOff = vec3(uSeed * 0.37, uSeed * 0.11, uSeed * 0.23);
  vec3 q = P * 2.1 + seedOff;
  float w = fbm3(q * 1.7 + 3.1);
  float hr = fbm3(q + (w - 0.5) * 0.9);
  float h = smoothstep(0.22, 0.78, hr);
  float detail = fbm3lo(q * 7.0);
  float hLow = smoothstep(0.22, 0.78, fbm3lo(q + (w - 0.5) * 0.9));
  vec3 alb; float isSea = 0.0; vec3 emis = vec3(0.0); float bh = h;
  float lvl = uSeaLevel;

  // ---- distance-faded fine detail (skipped entirely when the first extra octave is sub-pixel)
  float near = lodW(FD0, fp);
  vec3 fd = vec3(0.0);
  vec3 so = fract(seedOff * 0.0713) * 13.0;     // small seed offset keeps high-frequency inputs < 1e4
  if (near > 0.002) {
    vec3 st = uKind < 0.5 ? vec3(1.0, 1.6, 1.0) : vec3(1.0);   // dune: rock streaks run along latitude
    fd = lodOctaves(P, so, FD0, fp, st, 5);
  }

  if (uKind < 0.5) {                           // DUNE
    float bands = sin((P.y * 15.0 + (w - 0.5) * 9.0 + hr * 4.0) * 3.14159) * 0.5 + 0.5;
    float ridge = 1.0 - abs(2.0 * fbm3(q * 3.4 + 4.0) - 1.0);
    alb = mix(uL1, uL2, bands * 0.8 + ridge * 0.2);
    alb = mix(uL0, alb, smoothstep(0.18, 0.5, h));
    alb *= 0.82 + 0.34 * detail;
    bh = hLow * 0.5;
    if (near > 0.002) {
      vec3 wind = vec3(0.819, 0.183, 0.544);    // unit vector: crests run perpendicular to it
      float field = smoothstep(0.32, 0.62, detail + fd.x * 0.3);         // dune fields vs. flats
      float rockM = (1.0 - smoothstep(0.16, 0.42, h)) * 0.7 + (1.0 - field) * 0.3;
      // dune crests: asymmetric sawtooth (gentle windward ramp, steep slip face), warped by the big field
      const float FC = 260.0;
      float wc = lodW(FC * 3.0, fp);
      // warp only by smooth fields (+ a touch of fine detail) so crests stay long and sinuous
      float ph = dot(P, wind) * FC + (w - 0.5) * 34.0 + (hr - 0.5) * 9.0 + (detail - 0.5) * 2.6 + fd.x * 0.22;
      float s = fract(ph);
      float prof = smoothstep(0.0, 0.7, s) * (1.0 - smoothstep(0.7, 1.0, s));
      float crest = wc * field * (1.0 - rockM);
      // sand ripples: fine sine stripes slightly off-axis, wobbling with the detail field
      const float FR = 2100.0;
      float wr = lodW(FR * 2.5, fp);
      float rip = sin(6.28318 * fract(dot(P, vec3(0.70, 0.43, 0.57)) * FR + fd.x * 2.2 + fd.y * 1.3));
      rip *= wr * (1.0 - rockM);
      // rock streaks: ridged detail exposed in the low rocky basins and between dune fields
      float streak = smoothstep(0.02, 0.22, fd.y + (detail - 0.5) * 0.35) * rockM * near;
      alb *= 1.0 + crest * (prof - 0.5) * 0.22 + rip * 0.05 + fd.x * 0.18;
      alb = mix(alb, uL0 * (0.7 + 0.6 * clamp(0.5 + fd.x, 0.0, 1.0)), streak * 0.75);
      bh += crest * prof * 1.3 / FC + rip * 0.35 / FR + fd.z * mix(1.2, 6.0, rockM);
    }
  } else if (uKind < 2.5) {                    // OCEAN FOREST / FOREST ROCK
    float hD = h + fd.x * 0.03;                 // coastline / contour breakup (0 from orbit)
    float lh = clamp((hD - lvl) / (1.0 - lvl), 0.0, 1.0);
    vec3 land = mix(uL0, uL1, smoothstep(0.0, 0.45, lh));
    land = mix(land, uL2, smoothstep(0.5, 0.95, lh));
    land *= 0.78 + 0.44 * detail;
    float rockFr = step(1.5, uKind);            // forestRock: more exposed granite
    float rockM = 0.0, rockRelief = 0.0;
    if (near > 0.002) {
      // forest canopy clumps with meadow clearings, rock patches on the highlands
      float forest = 1.0 - smoothstep(0.45, 0.85, lh);
      float canopy = smoothstep(-0.12, 0.16, fd.x + (detail - 0.5) * 0.6);
      vec3 shade = land * vec3(0.52, 0.66, 0.56);
      vec3 meadow = mix(land, uAccent, 0.22) * 1.18;
      land = mix(land, mix(meadow, shade, canopy), forest * near);
      land *= 1.0 + fd.y * 0.35 * forest;       // individual crowns
      float rockArg = fd.y + lh * (0.35 + 0.25 * rockFr) - 0.22 + (detail - 0.5) * 0.4;
      rockM = smoothstep(0.12, 0.3, rockArg) * near;
      rockRelief = smoothstep(-0.25, 0.45, rockArg) * near;   // wide ramp: a sharp mask in bh draws dark outlines
      vec3 rockC = mix(uL2, vec3(dot(uL2, vec3(0.333))), 0.35) * (0.72 + 0.5 * clamp(0.5 + fd.x, 0.0, 1.0));
      land = mix(land, rockC, rockM * (0.55 + 0.3 * rockFr));
    }
    float beach = 1.0 - smoothstep(0.0, 0.05, hD - lvl);
    land = mix(land, uAccent * 0.85, beach * 0.7 * step(0.5, uKind) * step(uKind, 1.5));
    isSea = (uHasSea > 0.5) ? 1.0 - smoothstep(lvl - 0.012, lvl, hD) : 0.0;
    float depth = clamp((lvl - hD) / max(lvl, 0.05), 0.0, 1.0);
    vec3 shallow = uSea * vec3(1.9, 1.75, 1.35);
    vec3 deep = uSea * 0.26;
    vec3 seaC = mix(shallow, deep, smoothstep(0.0, 0.4, depth));
    seaC *= 0.92 + 0.16 * fbm3lo(q * 9.0);
    // shallow water: caustic-like ridged brightening + sandbar mottling, only near the coast
    seaC *= 1.0 + (1.0 - smoothstep(0.0, 0.22, depth)) * (fd.y * 0.7 + fd.x * 0.25);
    alb = mix(land, seaC, isSea);
    float lat = abs(P.y) + (fbm3lo(q * 3.0) - 0.5) * 0.14 + fd.x * 0.035;   // ragged ice edge
    float ice = smoothstep(0.84, 0.9, lat) * uIce;
    alb = mix(alb, vec3(0.86, 0.92, 0.98) * (1.0 + fd.y * 0.12), ice);
    isSea *= (1.0 - ice);
    // bump flattens over water using the UNPERTURBED coast (the fine coast breakup is pixel-sharp,
    // and a step of |hLow - lvl| across it would draw dark outlines through dFdx/dFdy)
    float seaB = (uHasSea > 0.5) ? (1.0 - smoothstep(lvl - 0.03, lvl, h)) * (1.0 - ice) : 0.0;
    bh = mix(hLow + fd.z * (1.5 + 4.5 * rockRelief), lvl, seaB);
  }

  // ---- terraforming: BARREN start, then five players each claim territory one step at a time
  float terraLights = 0.0; vec3 terraLightCol = vec3(1.0, 0.72, 0.32);
  if (uBarren > 0.5) {
    float fl = floor(min(uTerra, 3.9999));
    float fr = uTerra >= 4.0 ? 1.0 : uTerra - fl;
    float stepE = uTerra >= 4.0 ? 4.0 : fl + smoothstep(0.0, 0.7, fr);          // expand in the first 70 % of a step, then hold
    float act = (uTerra >= 4.0 || uTerra <= 0.0) ? 0.0 : sin(3.14159 * clamp(fr / 0.7, 0.0, 1.0)); // front is "hot" only while it moves
    if (uTerraSmooth > 0.5) { stepE = uTerra; act = (uTerra > 0.0 && uTerra < 4.0) ? 0.6 : 0.0; }   // continuous (collapse) mode
    float Rf = stepE * 0.43;
    float rug = (fbm3lo(P * 5.5 + seedOff) - 0.5) * 0.34 + (fbm3lo(P * 14.0 + 3.0) - 0.5) * 0.1;
    // Ownership = nearest colony (ragged: alternate colonies get opposite offsets, so shared borders wobble). A front is
    // only ever the edge of the NEAREST colony's disc, so two claims meet on the equidistant line and stop. They cannot cross.
    float d1 = 9.0, d2 = 9.0, dc1 = 9.0; vec3 pc = vec3(1.0);
    for (int i = 0; i < 5; i++) {
      float d0 = acos(clamp(dot(P, uCol[i]), -1.0, 1.0));
      float d = max(d0 + rug * (mod(float(i), 2.0) < 0.5 ? 1.0 : -1.0), 0.0);
      if (d < d1) { d2 = d1; d1 = d; dc1 = d0; pc = uPCol[i]; } else if (d < d2) { d2 = d; }
    }
    float T = 1.0 - smoothstep(Rf - 0.07, Rf, d1);          // claimed by its nearest colony
    float T2 = 1.0 - smoothstep(Rf - 0.07, Rf, d2);         // the runner-up has claimed this far too → a border exists here
    float ring = exp(-sq((d1 - Rf) / 0.02));
    float lip = exp(-sq((d1 - Rf + 0.05) / 0.04));
    float gap = exp(-sq((d2 - d1) / 0.012)) * T2;                              // dark no-man's-land seam on the shared line
    float band = exp(-sq((d2 - d1 - 0.03) / 0.02)) * T2;                      // each side's own coloured edge, just inside it
    float borderGlow = exp(-sq((d2 - d1 - 0.05) / 0.06)) * T2;
    float core = exp(-sq(dc1 / 0.022));

    // barren world: dust and dry seabeds everywhere outside a claim
    float dry = 1.0 - T;
    float lumA = dot(alb, vec3(0.3, 0.59, 0.11));
    vec3 arid = mix(vec3(lumA), vec3(0.64, 0.44, 0.30) * lumA * 1.7, 0.7);
    vec3 bed = vec3(0.21, 0.15, 0.11) * (0.8 + 0.5 * detail);
    alb = mix(alb, mix(arid, bed, isSea), dry);
    isSea *= 1.0 - dry;

    // inside a claim: habitable biosphere (grass / forest, fresh seas in the basins)...
    vec3 green = mix(vec3(0.04, 0.20, 0.07), vec3(0.28, 0.48, 0.14), smoothstep(0.3, 0.85, h)) * (0.8 + 0.4 * detail);
    float newSea = T * (1.0 - smoothstep(uTerraSea - 0.012, uTerraSea, h));
    vec3 seaN = mix(uSeaT * 1.7, uSeaT * 0.3, smoothstep(0.0, 0.3, uTerraSea - h));
    alb = mix(alb, green, T * (1.0 - newSea));
    alb = mix(alb, seaN, newSea);
    isSea = max(isSea, newSea);
    // ...and forge-city sprawl: dense around the colony core, patchy outward, never on water
    float cf = fbm3lo(P * 8.0 + seedOff * 1.7);
    float cityM = smoothstep(0.52, 0.66, cf + 0.55 * exp(-dc1 * 3.2)) * T * (1.0 - newSea);
    vec2 uv = vec2(atan(P.z, P.x) * 19.099, asin(clamp(P.y, -1.0, 1.0)) * 38.197);   // ~120 street cells around the equator
    vec2 cell = abs(fract(uv) - 0.5);
    float grid = smoothstep(0.455, 0.5, max(cell.x, cell.y));
    float bk = fract(sin(dot(floor(uv), vec2(12.9898, 78.233))) * 43758.5453);
    vec3 cityCol = mix(vec3(0.05, 0.047, 0.052), vec3(0.17, 0.12, 0.085), bk * 0.8);   // gunmetal plates, rust and soot
    alb = mix(alb, cityCol, cityM);
    isSea *= 1.0 - cityM;
    bh = mix(bh, 0.3, cityM * 0.7);
    bh *= 1.0 - 0.5 * T;
    vec3 glow = mix(vec3(1.0, 0.5, 0.14), pc, 0.4);
    emis += glow * grid * cityM * (0.25 + 0.9 * step(0.62, bk));                       // lit streets and active factory blocks
    emis += vec3(1.0, 0.45, 0.1) * 3.0 * step(0.94, vnoise3(P * 260.0 + seedOff)) * cityM;   // foundry fires

    // the claims themselves, in each player's colour: moving front, frozen shared borders, colony beacon
    float hot = 0.22 + 0.78 * act;
    emis += pc * 2.3 * ring * hot;
    emis += pc * 0.55 * lip * hot * T;
    alb *= 1.0 - 0.8 * gap;
    emis += pc * 1.05 * band + pc * 0.3 * borderGlow;   // kept below ~1.2 so ACES + bloom don't bleach it to white
    emis += pc * 2.6 * core * step(0.5, stepE);
    // settlements between the cities: warm lights that densify as steps advance
    float dots = step(0.8, vnoise3(P * 150.0 + seedOff)) * (0.55 + 0.45 * step(0.5, vnoise3(P * 38.0)));
    terraLights = dots * T * (1.0 - cityM) * exp(-dc1 * 2.0) * smoothstep(0.5, 2.5, stepE) * (1.0 - isSea);
  }

  // ---- lighting
  vec3 Ng = normalize(vWN); vec3 V = normalize(cameraPosition - vWP); vec3 L = normalize(uSunDir);
  vec3 dpx = dFdx(vWP), dpy = dFdy(vWP);
  vec2 dH = vec2(dFdx(bh), dFdy(bh)) * (uBump * uRadius * vS);
  vec3 r1 = cross(dpy, Ng), r2 = cross(Ng, dpx);
  float det = dot(dpx, r1);
  vec3 Nb = abs(det) * Ng - sign(det) * (dH.x * r1 + dH.y * r2);
  vec3 N = dot(Nb, Nb) > 1e-20 ? normalize(Nb) : Ng;   // det == 0 at grazing angles → avoid normalize(0)
  N = normalize(mix(N, Ng, 0.85 * isSea));
  float ndlg = dot(Ng, L);
  float term = smoothstep(-0.03, 0.22, ndlg);
  emis += terraLightCol * 2.2 * terraLights * (1.0 - smoothstep(-0.12, 0.08, ndlg));
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
${SQ}${GLSL_NOISE}${LOD_DETAIL}
uniform float uSeed, uCover, uOpacity, uSunI, uTime, uCloudTween;
uniform vec3 uCloudCol, uSunDir, uSunColor, uAtm, uSkyColor; uniform vec2 uCloudNear; uniform float uSkyBlend; uniform vec2 uHazeDist;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vC; varying float vS;
const float CF0 = 170.0;   // first extra cloud octave (base fbm ends at ~114 cycles / unit sphere)
void main(){
  vec3 P = normalize(vObj);
  float fp = max(length(fwidth(P)), 1e-7);     // uniform control flow
  vec3 seedOff = vec3(uSeed * 0.21, uSeed * 0.07, uSeed * 0.13);
  vec3 q = P * 3.3 + seedOff;
  float wv = fbm3lo(q * 1.3 + 9.0);
  float n = fbm3(q + (wv - 0.5) * 1.1);
  // uCloudTween 1 → full cover; → 0 the threshold climbs through the noise, so cloud banks shrink to wisps and vanish
  // (or, running the other way, condense out of nothing) instead of just fading as a flat layer.
  float thr = mix(0.70, 0.40, uCover) + (1.0 - uCloudTween) * 0.62;
  // close-up erosion: zero-mean, footprint-faded octaves stretched along longitude → wispy, torn
  // edges and billow texture near the camera; exactly 0 from orbit so coverage is unchanged there.
  float wc0 = lodW(CF0, fp);
  if (wc0 > 0.002 && n > thr - 0.16 && n < thr + 0.5) {
    vec3 e = lodOctaves(P, fract(seedOff * 0.0917) * 11.0, CF0, fp, vec3(1.0, 2.4, 1.0), 4);
    float edge = 1.0 - smoothstep(thr + 0.1, thr + 0.45, n);    // erode edges hard, interiors softly
    n += e.x * (0.06 + 0.1 * edge) - e.y * 0.06 * edge;
  }
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
  gl_FragColor = vec4(col, a * 0.94 * uOpacity * near * smoothstep(0.0, 0.12, uCloudTween));
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
/** Per-world terraform targets: the new sea level and the colour of fresh water. */
const TERRA: Record<PlanetKind, { sea: number; seaColor: number }> = {
  dune: { sea: 0.46, seaColor: 0x1b78a0 },
  oceanForest: { sea: 0.6, seaColor: 0x1aa0c0 },
  forestRock: { sea: 0.36, seaColor: 0x2a80a8 },
};
/** Player territory colours (HDR-friendly, mutually distinct): ignition orange, signal blue, amber, magenta, cyan. */
const PLAYER_COLORS: [number, number, number][] = [[1.0, 0.42, 0.1], [0.22, 0.45, 1.0], [1.0, 0.85, 0.18], [0.92, 0.25, 0.95], [0.1, 0.95, 0.95]];
const playerColorVecs = () => PLAYER_COLORS.map(([r, g, b]) => new THREE.Vector3(r, g, b));
/** Five colony beacons spread around the globe (golden-angle longitudes, alternating hemispheres): one is always in view. */
function colonyPoints(seed: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const h = (n: number) => { const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < 5; i++) {
    const lon = (i / 5) * Math.PI * 2 + h(i) * 0.5;
    const lat = (i % 2 ? -1 : 1) * (0.18 + 0.4 * h(i + 9));
    pts.push(new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)));
  }
  return pts;
}
const TERRA_ATM = new THREE.Color(0x7fc4ff), DUSTY_ATM = new THREE.Color(0xd49a6a);
const smooth01 = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

export function createPlanetGlobe(spec: PlanetSpec, opts: PlanetGlobeOptions = {}): PlanetGlobe {
  const radius = opts.radius ?? 10;
  // Large (descent-scale) globes are seen from a few hundred units up: 160 segments of a R=4000
  // sphere are ~157-unit facets and a polygonal limb, so clamp to 512x256 there. Small globes stay cheap.
  const big = radius > 1000;
  const seg = big ? Math.max(opts.segments ?? 128, 512) : (opts.segments ?? 128);
  const o = spec.orbital;
  const col = (n: number) => new THREE.Color(n);
  const shared = {
    uSunDir: { value: new THREE.Vector3(0.486, 0.763, 0.347).normalize() },
    uSunI: { value: 1.05 }, uOpacity: { value: 1 }, uTime: { value: 0 },
    uSkyBlend: { value: 0 }, uSkyColor: { value: col(spec.sky.horizonColor) }, uAtmStrength: { value: 1 },
    uCloudNear: { value: new THREE.Vector2(0, 0.0001) }, uHazeDist: { value: new THREE.Vector2(100, 6000) },
  };
  const sunColor = { value: new THREE.Color(1.0, 0.95, 0.86) };
  const atmBase = col(o.atmosphereColor);
  const atm = { value: atmBase.clone() };
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
      uTerra: { value: 0 }, uBarren: { value: 0 }, uTerraSmooth: { value: 0 }, uTerraSea: { value: TERRA[spec.kind].sea },
      uSeaT: { value: col(TERRA[spec.kind].seaColor) }, uCol: { value: colonyPoints(spec.seed) }, uPCol: { value: playerColorVecs() },
    },
    // Permanently transparent: toggling `transparent` flips the OPAQUE define in three r174, which
    // swaps the program (shader recompile hitch mid-descent). With alpha = 1 the blend is a no-op.
    transparent: true, depthWrite: true,
  });
  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
    uniforms: {
      ...shared, uSeed: { value: (spec.seed * 3) % 991 }, uCover: { value: o.cloudCover }, uCloudTween: { value: 1 }, uCloudCol: { value: col(o.cloudColor) }, uAtm: atm, uSunColor: sunColor,
    },
  });
  const atmMat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: ATM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { ...shared, uAtm: atm, uAtmDensity: { value: o.atmosphereDensity }, uRadius: radiusU, uShell: { value: opts.atmScale ?? 1.07 } },
  });

  const group = new THREE.Group(); group.name = `PlanetGlobe:${spec.kind}`;
  const spin = new THREE.Group(); spin.rotation.z = o.axialTilt;
  const geo = new THREE.SphereGeometry(radius, seg, Math.round(seg / 2));
  // renderOrder 0 < clouds (2) < atmosphere (3); among other transparents the globe's far-away origin sorts it first.
  const surface = new THREE.Mesh(geo, surfMat); surface.renderOrder = 0; surface.frustumCulled = false;
  const cloudScale = opts.cloudScale ?? 1.012;
  const cloudGeo = new THREE.SphereGeometry(radius * cloudScale, Math.round(seg * 0.75), Math.round(seg * 0.375));
  const clouds = new THREE.Mesh(cloudGeo, cloudMat); clouds.renderOrder = 2; clouds.frustumCulled = false;
  const atmGeo = new THREE.SphereGeometry(radius * (opts.atmScale ?? 1.07), big ? 192 : 96, big ? 96 : 48);
  const atmo = new THREE.Mesh(atmGeo, atmMat); atmo.renderOrder = 3; atmo.frustumCulled = false;
  spin.add(surface, clouds);

  // colony beacons: one light pillar per player colony (in that player's colour) while a terraform step is running
  const beamU = { uBeam: { value: 0 } };
  const beamH = radius * 0.3;
  const beamGeo = new THREE.CylinderGeometry(radius * 0.004, radius * 0.016, beamH, 10, 1, true).translate(0, beamH / 2, 0);
  const beamMats = PLAYER_COLORS.map(([r, g, b]) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...beamU, uOpacity: shared.uOpacity, uColor: { value: new THREE.Vector3(r, g, b) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform float uBeam, uOpacity; uniform vec3 uColor; void main(){ float a = pow(1.0 - vUv.y, 1.7) * uBeam * uOpacity; gl_FragColor = vec4(uColor * 2.2, a); }',
  }));
  const beams = new THREE.Group(); beams.visible = false;
  const colonies = surfMat.uniforms.uCol.value as THREE.Vector3[];
  colonies.forEach((p, i) => {
    const b = new THREE.Mesh(beamGeo, beamMats[i]); b.renderOrder = 4; b.frustumCulled = false;
    b.position.copy(p).multiplyScalar(radius);
    b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p);
    beams.add(b);
  });
  spin.add(beams);

  // forge cities: 3D stacks, slabs and glowing caps around each colony. Built lazily (only globes that get terraformed pay),
  // they rise as their colony's front reaches them and sink away again with the globe's opacity during a morph.
  interface Item { pos: THREE.Vector3; quat: THREE.Quaternion; r: number; w: number; h: number; d: number; stack: boolean; owner: number; slot: number }
  let items: Item[] = [];
  let stacksM: THREE.InstancedMesh | null = null, slabsM: THREE.InstancedMesh | null = null, capsM: THREE.InstancedMesh | null = null;
  let nStacks = 0, nSlabs = 0;
  let curRf = 0;
  const ensureStructures = () => {
    if (stacksM) return;
    const rng = (a: number, b: number) => { const x = Math.sin(spec.seed * 91.7 + a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
    const Y = new THREE.Vector3(0, 1, 0), yaw = new THREE.Quaternion();
    colonies.forEach((n, ci) => {
      const t1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : Y).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      for (let k = 0; k < 21; k++) {
        const stack = k < 12;
        const r = 0.025 + 0.27 * Math.sqrt(rng(ci * 50 + k, 1)), az = rng(ci * 50 + k, 2) * Math.PI * 2;
        const dir = t1.clone().multiplyScalar(Math.cos(az)).addScaledVector(t2, Math.sin(az));
        const up = n.clone().multiplyScalar(Math.cos(r)).addScaledVector(dir, Math.sin(r)).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(Y, up);
        if (!stack) quat.multiply(yaw.setFromAxisAngle(Y, rng(ci * 50 + k, 3) * Math.PI));
        const near = 1 - r / 0.3;                                   // taller toward the colony core
        items.push(stack
          ? { pos: up.clone().multiplyScalar(radius * 0.998), quat, r, owner: ci, stack, slot: 0, w: radius * (0.011 + 0.01 * rng(k, ci)), h: radius * (0.03 + 0.05 * near * rng(k, ci + 3)), d: 0 }
          : { pos: up.clone().multiplyScalar(radius * 0.998), quat, r, owner: ci, stack, slot: 0, w: radius * (0.022 + 0.03 * rng(k, ci + 5)), h: radius * (0.008 + 0.016 * rng(k, ci + 7)), d: radius * (0.02 + 0.03 * rng(k, ci + 9)) });
      }
    });
    nStacks = items.filter((x) => x.stack).length; nSlabs = items.length - nStacks;
    const metal = new THREE.MeshStandardMaterial({ color: 0x3c3f49, metalness: 0.7, roughness: 0.45 });
    stacksM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.9, 1, 7).translate(0, 0.5, 0), metal, nStacks);
    slabsM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), metal, nSlabs);
    capsM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.6), fog: false }), nStacks);
    let si = 0, bi = 0; const c = new THREE.Color();
    for (const it of items) {
      if (it.stack) { it.slot = si; capsM.setColorAt(si++, c.setRGB(...PLAYER_COLORS[it.owner])); } else it.slot = bi++;
    }
    for (const m of [stacksM, slabsM, capsM]) { m.frustumCulled = false; m.renderOrder = 1; spin.add(m); }
  };
  const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const layoutStructures = () => {
    if (!stacksM || !slabsM || !capsM) return;
    const of = smooth01((opacity - 0.55) / 0.45);                    // sink away while the globe fades out / rise as it fades in
    for (const it of items) {
      const grow = smooth01((curRf - it.r - 0.03) / 0.12) * of;
      if (it.stack) {
        _s.set(it.w, Math.max(it.h * grow, 1e-5), it.w);
        stacksM.setMatrixAt(it.slot, _m.compose(it.pos, it.quat, _s));
        _p.set(0, 1, 0).applyQuaternion(it.quat).multiplyScalar(it.h * grow).add(it.pos);
        capsM.setMatrixAt(it.slot, _m.compose(_p, it.quat, _s.setScalar(Math.max(it.w * 0.55 * grow, 1e-5))));
      } else {
        _s.set(it.w, Math.max(it.h * grow, 1e-5), it.d);
        slabsM.setMatrixAt(it.slot, _m.compose(it.pos, it.quat, _s));
      }
    }
    for (const m of [stacksM, slabsM, capsM]) m.instanceMatrix.needsUpdate = true;
  };
  group.add(spin, atmo); // atmosphere is not tilted (rotation-invariant)

  let opacity = 1;
  let spinRate = 0.025;
  const api: PlanetGlobe = {
    group, spin, clouds, atmosphere: atmo, radius, spec, shared,
    setSunDirection(d) { shared.uSunDir.value.copy(d).normalize(); },
    setOpacity(v) {
      opacity = THREE.MathUtils.clamp(v, 0, 1); shared.uOpacity.value = opacity;
      surfMat.depthWrite = opacity > 0.5; // render state only — no needsUpdate / program switch
      group.visible = opacity > 0.002;
      layoutStructures();
    },
    setTerraform(stage, smooth = false) {
      const t = THREE.MathUtils.clamp(stage, 0, 4);
      surfMat.uniforms.uTerraSmooth.value = smooth ? 1 : 0;
      surfMat.uniforms.uTerra.value = t; surfMat.uniforms.uBarren.value = 1;   // calling this at all = start from a barren world
      const fl = Math.floor(Math.min(t, 3.9999)), fr = t >= 4 ? 1 : t - fl;
      const stepE = smooth ? t : t >= 4 ? 4 : fl + smooth01(fr / 0.7);            // same easing as the shader
      const act = smooth ? (t > 0 && t < 4 ? 0.6 : 0) : t >= 4 || t <= 0 ? 0 : Math.sin(Math.PI * Math.min(1, fr / 0.7));
      beamU.uBeam.value = t <= 0 ? 0 : (0.2 + 0.8 * act) * Math.min(1, stepE * 4);
      curRf = stepE * 0.43;
      if (t > 0) ensureStructures();
      layoutStructures();
      beams.visible = beamU.uBeam.value > 0.01;
      const k = stepE / 4;
      cloudMat.uniforms.uCover.value = Math.min(1, THREE.MathUtils.lerp(o.cloudCover * 0.3, o.cloudCover + 0.15, k));   // dry air → wet air
      atm.value.copy(atmBase).lerp(DUSTY_ATM, 0.45).lerp(atmBase.clone().lerp(TERRA_ATM, 0.55), k);                       // dusty haze → blue
    },
    setCloudPresence(v) { cloudMat.uniforms.uCloudTween.value = THREE.MathUtils.clamp(v, 0, 1); },
    update(dt, time) {
      shared.uTime.value = time;
      spin.rotation.y += dt * spinRate;
      clouds.rotation.y += dt * spinRate * 0.24; // clouds drift relative to the surface
    },
    setSpinRate(r) { spinRate = r; },
    dispose() {
      geo.dispose(); beamGeo.dispose(); beamMats.forEach((m) => m.dispose()); for (const m of [stacksM, slabsM, capsM]) if (m) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } cloudGeo.dispose(); atmGeo.dispose(); surfMat.dispose(); cloudMat.dispose(); atmMat.dispose();
      group.removeFromParent();
    },
  };
  return api;
}
