import * as THREE from 'three';
import { getWindUniforms } from '../../../core/windConfig';
import { getWaterUniforms } from '../waterConfig';
import { WATER_STAGE_COMMON_GLSL } from '../glsl/waves';

export const MAX_AQUATIC_THREATS = 8;

export interface AquaticThreatZone {
  x: number;
  z: number;
  radius: number;
  strength: number;
}

export interface AquaticThreatUniforms {
  uThreatCount: THREE.IUniform<number>;
  uThreatZones: THREE.IUniform<THREE.Vector4[]>;
}

export function createAquaticThreatUniforms(): AquaticThreatUniforms {
  return {
    uThreatCount: { value: 0 },
    uThreatZones: { value: Array.from({ length: MAX_AQUATIC_THREATS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
}

/** CPU mirror of GLSL `faunaThreatEvade` for deterministic biosphere evasion verification. */
export function evalAquaticThreatEvasion(
  x: number,
  z: number,
  threats: readonly AquaticThreatZone[],
  maxShift = 2.4,
  maxDive = 0.45,
): { dx: number; dz: number; diveY: number; panic: number } {
  let pushX = 0;
  let pushZ = 0;
  let panic = 0;
  const n = Math.min(MAX_AQUATIC_THREATS, threats.length);
  for (let i = 0; i < n; i++) {
    const tz = threats[i]!;
    const dx = x - tz.x;
    const dz = z - tz.z;
    const dist = Math.hypot(dx, dz);
    if (dist < tz.radius && tz.radius > 0.01) {
      const w = 1 - dist / tz.radius;
      const pAmt = w * w * tz.strength;
      const inv = dist > 0.001 ? 1 / dist : 0;
      pushX += (dist > 0.001 ? dx * inv : 1) * (pAmt * 2.8);
      pushZ += (dist > 0.001 ? dz * inv : 0) * (pAmt * 2.8);
      if (pAmt > panic) panic = pAmt;
    }
  }
  const safeMaxShift = Math.max(0, maxShift);
  const pLen = Math.hypot(pushX, pushZ);
  if (safeMaxShift <= 1e-4) {
    pushX = 0;
    pushZ = 0;
  } else if (pLen > safeMaxShift && pLen > 1e-4) {
    const k = safeMaxShift / pLen;
    pushX *= k;
    pushZ *= k;
  }
  return {
    dx: pushX,
    dz: pushZ,
    diveY: Math.min(Math.max(0, maxDive), panic * 0.36),
    panic: Math.min(1.5, panic),
  };
}

/** Apparent shift (m) per metre of depth per unit of wave slope; about (1 - 1/1.33) with some artistic gain. */
const REFRACT_GAIN = 1.4;

export const FAUNA_WATER_VERT_GLSL = /* glsl */ `
${WATER_STAGE_COMMON_GLSL}
uniform int uThreatCount;
uniform vec4 uThreatZones[${MAX_AQUATIC_THREATS}];
struct FaunaEvasion {
  vec2 shiftXZ;
  float diveY;
  float panic;
};
FaunaEvasion faunaThreatEvade(vec2 p, float maxShift, float maxDive) {
  vec2 push = vec2(0.0);
  float panic = 0.0;
  for (int i = 0; i < ${MAX_AQUATIC_THREATS}; i++) {
    if (i >= uThreatCount) break;
    vec4 tz = uThreatZones[i];
    vec2 d = p - tz.xy;
    float dist = length(d);
    if (dist < tz.z && tz.z > 0.01) {
      float w = 1.0 - dist / tz.z;
      float pAmt = w * w * tz.w;
      vec2 dir = dist > 0.001 ? d / dist : vec2(1.0, 0.0);
      push += dir * (pAmt * 2.8);
      panic = max(panic, pAmt);
    }
  }
  float safeShift = max(0.0, maxShift);
  float pLen = length(push);
  if (safeShift <= 0.0001) push = vec2(0.0);
  else if (pLen > safeShift && pLen > 0.0001) push *= safeShift / pLen;
  return FaunaEvasion(push, min(max(0.0, maxDive), panic * 0.36), min(1.5, panic));
}
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
