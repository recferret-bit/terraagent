/**
 * Underwater bed tint, applied by the TERRAIN shader to ground below the water level. The water surface is
 * alpha-blended with one scalar alpha, so it cannot tint what it covers per channel; without this a pale sand bed
 * shows through shallow water as milky white. Beer-Lambert along the down-and-up light path (red dies first), with
 * the same extinction and `uAbsorption` the water surface uses, so bed and surface agree. ALU only.
 */

/** Extinction (1/m) at `uAbsorption = 1`; shared with the surface volume (`surface.ts`). */
export const WATER_SIGMA_GLSL = /* glsl */ `const vec3 WATER_SIGMA = vec3(1.1, 0.5, 0.36);`;

export const WATER_BED_TINT_GLSL = /* glsl */ `
uniform float uAbsorption;
${WATER_SIGMA_GLSL}
/** depth = metres of water above the fragment (<= 0: dry), gate = 1 on water tiles. */
vec3 waterBedTint(vec3 col, float depth, float gate) {
  float d = max(depth, 0.0);
  vec3 T = exp(-WATER_SIGMA * (d * 2.2 * uAbsorption));
  return mix(col, col * T, gate * smoothstep(0.0, 0.04, d));
}
`;
