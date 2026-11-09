import type * as THREE from 'three';
import { getWindUniforms } from '../../../core/windConfig';
import { getWaterUniforms } from '../waterConfig';
import { WATER_STAGE_COMMON_GLSL } from '../glsl/waves';

/**
 * What makes the fauna read as BELOW the surface (fish and jellies share it):
 * - they are drawn before the water (default render order, the water is `WATER_RENDER_ORDER`), so the surface's alpha,
 *   glints, foam and sky reflection lie over them;
 * - their apparent position wobbles with the surface waves above them (refraction: the image shifts against the local
 *   wave slope, more the deeper it is), using the same Gerstner sum as the water itself;
 * - they tint toward the water's deep colour with depth (in each material).
 * Vertex-only, a handful of ALU per vertex; no extra pass or texture.
 */

/** Apparent shift (m) per metre of depth per unit of wave slope; about (1 - 1/1.33) with some artistic gain. */
const REFRACT_GAIN = 1.4;

export const FAUNA_WATER_VERT_GLSL = /* glsl */ `
${WATER_STAGE_COMMON_GLSL}
/** Refracted image offset (world xz) of a point \`depth\` metres below the surface at \`p\`. */
vec2 faunaRefractShift(vec2 p, float depth) {
  WaterWave w = waterWaves(p, windStrengthAt(p));
  return -w.slope * (depth * ${REFRACT_GAIN.toFixed(2)});
}
`;

/** The shared wind + wave uniform objects the refraction wobble reads (assign by reference). */
export function faunaWaterUniforms(): Record<string, THREE.IUniform> {
  return { ...getWindUniforms(), ...getWaterUniforms() };
}
