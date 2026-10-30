import { GLSL_NOISE } from '../../visuals/space/glslNoise';
import { SQ, LOD_DETAIL } from './lodDetail';

export const GLOBE_FRAG = /* glsl */ `
${SQ}${GLSL_NOISE}${LOD_DETAIL}
uniform float uKind, uSeed, uHasSea, uSeaLevel, uRadius, uTime, uOpacity, uSkyBlend, uSunI, uIce, uBump, uOpt;
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
  vec2 hrs = uOpt > 0.5 ? fbm3Both(q + (w - 0.5) * 0.9) : vec2(fbm3(q + (w - 0.5) * 0.9), fbm3lo(q + (w - 0.5) * 0.9));
  float hr = hrs.x;
  float h = smoothstep(0.22, 0.78, hr);
  float detail = fbm3lo(q * 7.0);
  float hLow = smoothstep(0.22, 0.78, hrs.y);
  vec3 alb; float isSea = 0.0; vec3 emis = vec3(0.0); float bh = h;
  float lvl = uSeaLevel;

  // ---- distance-faded fine detail (skipped entirely when the first extra octave is sub-pixel or on the orbit globe)
  float near = (uOpt > 0.5 && uRadius < 100.0) ? 0.0 : lodW(FD0, fp);
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
