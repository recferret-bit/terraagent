export type SuspensionClass =
  | 'spiderWalker'
  | 'heavyTracked'
  | 'lightRover'
  | 'bipedWalker'
  | 'multiLegged';

export interface SuspensionProfile {
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly bellyClearanceM: number;
  readonly midAxleWeight: number;
  readonly maxCompressionM: number;
  readonly slopePitchAlign: number;
  readonly slopeRollAlign: number;
  readonly uphillForwardLean: number;
  readonly downhillBrace: number;
  readonly omegaCorner: number;
  readonly zetaBump: number;
  readonly zetaRebound: number;
  readonly omegaHeave: number;
  readonly zetaHeave: number;
  readonly omegaTilt: number;
  readonly zetaTilt: number;
  readonly accelSquatGain: number;
  readonly turnBankGain: number;
  readonly gLoadGain: number;
  readonly roughnessHeaveM: number;
  readonly roughnessTiltRad: number;
  readonly slopeSurgeGainM: number;
  readonly maxTiltRad: number;
  readonly maxHeaveOffsetM: number;
}

export const SUSPENSION_PROFILES: Readonly<Record<SuspensionClass, SuspensionProfile>> = {
  spiderWalker: {
    halfLength: 0.52,
    halfWidth: 0.9,
    bellyClearanceM: 0.49,
    midAxleWeight: 0,
    maxCompressionM: 0.14,
    slopePitchAlign: 0.94,
    slopeRollAlign: 0.94,
    uphillForwardLean: 0.04,
    downhillBrace: 0,
    omegaCorner: 17.5,
    zetaBump: 0.48,
    zetaRebound: 0.72,
    omegaHeave: 14.5,
    zetaHeave: 0.6,
    omegaTilt: 13.5,
    zetaTilt: 0.64,
    accelSquatGain: 0.028,
    turnBankGain: 0.042,
    gLoadGain: 0.011,
    roughnessHeaveM: 0.016,
    roughnessTiltRad: 0.012,
    slopeSurgeGainM: 0.14,
    maxTiltRad: 0.54,
    maxHeaveOffsetM: 0.3,
  },
  heavyTracked: {
    halfLength: 0.62,
    halfWidth: 0.42,
    bellyClearanceM: 0.18,
    midAxleWeight: 0.28,
    maxCompressionM: 0.09,
    slopePitchAlign: 0.96,
    slopeRollAlign: 0.94,
    uphillForwardLean: 0,
    downhillBrace: 0,
    omegaCorner: 15.5,
    zetaBump: 0.54,
    zetaRebound: 0.76,
    omegaHeave: 13.0,
    zetaHeave: 0.66,
    omegaTilt: 11.5,
    zetaTilt: 0.7,
    accelSquatGain: 0.026,
    turnBankGain: 0.032,
    gLoadGain: 0.009,
    roughnessHeaveM: 0.012,
    roughnessTiltRad: 0.009,
    slopeSurgeGainM: 0.12,
    maxTiltRad: 0.52,
    maxHeaveOffsetM: 0.28,
  },
  lightRover: {
    halfLength: 0.48,
    halfWidth: 0.42,
    bellyClearanceM: 0.2,
    midAxleWeight: 0.34,
    maxCompressionM: 0.14,
    slopePitchAlign: 0.92,
    slopeRollAlign: 0.9,
    uphillForwardLean: 0,
    downhillBrace: 0,
    omegaCorner: 19.0,
    zetaBump: 0.42,
    zetaRebound: 0.66,
    omegaHeave: 16.5,
    zetaHeave: 0.5,
    omegaTilt: 15.0,
    zetaTilt: 0.56,
    accelSquatGain: 0.036,
    turnBankGain: 0.06,
    gLoadGain: 0.014,
    roughnessHeaveM: 0.022,
    roughnessTiltRad: 0.014,
    slopeSurgeGainM: 0.16,
    maxTiltRad: 0.54,
    maxHeaveOffsetM: 0.32,
  },
  bipedWalker: {
    halfLength: 0.24,
    halfWidth: 0.2,
    bellyClearanceM: 0.24,
    midAxleWeight: 0,
    maxCompressionM: 0.11,
    slopePitchAlign: 0.34,
    slopeRollAlign: 0.38,
    uphillForwardLean: 0.24,
    downhillBrace: -0.08,
    omegaCorner: 18.0,
    zetaBump: 0.52,
    zetaRebound: 0.74,
    omegaHeave: 15.5,
    zetaHeave: 0.62,
    omegaTilt: 13.0,
    zetaTilt: 0.66,
    accelSquatGain: 0.024,
    turnBankGain: 0.05,
    gLoadGain: 0.011,
    roughnessHeaveM: 0.014,
    roughnessTiltRad: 0.01,
    slopeSurgeGainM: 0.1,
    maxTiltRad: 0.36,
    maxHeaveOffsetM: 0.24,
  },
  multiLegged: {
    halfLength: 0.44,
    halfWidth: 0.42,
    bellyClearanceM: 0.24,
    midAxleWeight: 0.26,
    maxCompressionM: 0.08,
    slopePitchAlign: 0.92,
    slopeRollAlign: 0.92,
    uphillForwardLean: 0.04,
    downhillBrace: 0,
    omegaCorner: 23.0,
    zetaBump: 0.58,
    zetaRebound: 0.78,
    omegaHeave: 21.0,
    zetaHeave: 0.72,
    omegaTilt: 19.5,
    zetaTilt: 0.74,
    accelSquatGain: 0.014,
    turnBankGain: 0.03,
    gLoadGain: 0.007,
    roughnessHeaveM: 0.01,
    roughnessTiltRad: 0.008,
    slopeSurgeGainM: 0.08,
    maxTiltRad: 0.56,
    maxHeaveOffsetM: 0.22,
  },
};

export function classifySuspensionArchetype(archetypeId: string): SuspensionClass | null {
  if (
    !archetypeId ||
    archetypeId.startsWith('building.') ||
    archetypeId.startsWith('hive.') ||
    archetypeId.startsWith('fauna.hive.') ||
    archetypeId.startsWith('ship.') ||
    archetypeId.startsWith('prop.') ||
    archetypeId.startsWith('deposit.')
  ) {
    return null;
  }
  if (archetypeId.startsWith('fauna.')) {
    return 'multiLegged';
  }
  if (archetypeId === 'robot.hero') {
    return 'bipedWalker';
  }
  if (
    archetypeId === 'robot.tank' ||
    archetypeId === 'robot.artillery' ||
    archetypeId === 'robot.combat' ||
    archetypeId.includes('Spider') ||
    archetypeId.includes('spider')
  ) {
    return 'spiderWalker';
  }
  if (
    archetypeId === 'robot.miner' ||
    archetypeId.includes('Tracked') ||
    archetypeId.includes('tracked') ||
    archetypeId.includes('Heavy') ||
    archetypeId.includes('heavy')
  ) {
    return 'heavyTracked';
  }
  return 'lightRover';
}
