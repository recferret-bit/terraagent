export const SQ = `float sq(float x){ return x * x; }
`;

/**
 * Procedural LOD ("streaming" without textures). The base fbm stops at ~120 cycles per unit-sphere
 * unit, which is ~35 world units on the R=4000 descent globe — a 200-px blob from low altitude.
 * Extra octaves are added past that, each faded in only once its lattice cell spans more than
 * ~2-4 screen pixels. The footprint is measured on the unit-sphere coordinate (fwidth(P)), so the
 * same rule works for the R=9.5 menu globe (all extra octaves faded out → loop skipped, look
 * unchanged) and the R=4000 descent globe. All derivative calls stay in uniform control flow.
 */
export const LOD_DETAIL = /* glsl */ `
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
