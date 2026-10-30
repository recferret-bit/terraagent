/** Shared GLSL noise chunk (hash/value-noise/fbm) for space + descent shaders. No sin()-hash → stable across GPUs. */
export const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  float a=hash13(i), b=hash13(i+vec3(1,0,0)), c=hash13(i+vec3(0,1,0)), d=hash13(i+vec3(1,1,0));
  float e=hash13(i+vec3(0,0,1)), g=hash13(i+vec3(1,0,1)), h=hash13(i+vec3(0,1,1)), k=hash13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y), mix(mix(e,g,f.x),mix(h,k,f.x),f.y), f.z);
}
float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y);
}
const mat3 ROT3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbm3(vec3 p){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++) { s += a * vnoise3(p); n += a; p = ROT3 * p * 2.03 + 11.7; a *= 0.5; }
  return s / n;
}
float fbm3lo(vec3 p){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise3(p); n += a; p = ROT3 * p * 2.03 + 5.3; a *= 0.5; }
  return s / n;
}
float fbm2(vec2 p){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise2(p); n += a; p = mat2(1.6,1.2,-1.2,1.6) * p + 3.1; a *= 0.5; }
  return s / n;
}
float fbm2Fast(vec2 p){
  float s = 0.5 * vnoise2(p); p = mat2(1.6,1.2,-1.2,1.6) * p + 3.1;
  s += 0.25 * vnoise2(p);
  return s / 0.75;
}
float fbm3Dome(vec3 p){
  float s = 0.5 * vnoise3(p); p = ROT3 * p * 2.03 + 5.3;
  s += 0.25 * vnoise3(p);
  return s / 0.75;
}
vec2 fbm3Both(vec3 p){
  float a = 0.5, s = 0.0, n = 0.0, s4 = 0.0, n4 = 1.0;
  for (int i = 0; i < 6; i++) {
    s += a * vnoise3(p); n += a;
    if (i == 3) { s4 = s; n4 = n; }
    p = ROT3 * p * 2.03 + 11.7; a *= 0.5;
  }
  return vec2(s / n, s4 / n4);
}
`;
