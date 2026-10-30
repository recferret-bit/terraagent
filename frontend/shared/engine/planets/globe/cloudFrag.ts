import { GLSL_NOISE } from '../../visuals/space/glslNoise';
import { SQ, LOD_DETAIL } from './lodDetail';

export const CLOUD_FRAG = /* glsl */ `
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
