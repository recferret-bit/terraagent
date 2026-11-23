import type * as THREE from 'three';

/**
 * Semantic vertebrate rig roles encoded into `aVertJoint.w`:
 * - 1: Body / torso / chest / pelvis / tucked legs
 * - 2: Mammal neck / head / jaw / nose / eyes / ears / antlers / horns
 * - 3: Mammal tail
 * - 4: Mammal upper leg (scapula + humerus or thigh/haunch)
 * - 5: Mammal lower leg (forearm + carpus/cannon or gaskin + hock + cannon)
 * - 6: Mammal paw / cloven hoof (tracks ankle cleanly, stays level on ground)
 * - 7: Bird inner wing (shoulder coverts + cambered secondary airfoil)
 * - 8: Bird outer wing (wrist alula + outer hand + primary feather blades)
 * - 9: Bird tail fan (rectrices + upper tail coverts)
 * - 10: Bird neck / head / beak / crest (flight-stabilized)
 */
export type VertebrateRole = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface VertebratePartRig {
  role: VertebrateRole;
  /** Secondary joint in model space (elbow/stifle for legs; wrist for wings; optional params). */
  joint?: THREE.Vector3Tuple;
  /** Ground foot contact point for legs; optional metadata otherwise. */
  tip?: THREE.Vector3Tuple;
  /** Phase offset (mammal legs) or species tuning scalar. */
  meta?: number;
}

export interface VertebrateRigConfig {
  /** 0 = quadruped mammal, 1 = flying bird. */
  isBird: 0 | 1;
  /** Center of mass height in model metres. */
  comY: number;
  /** Safe vertical crouch drop when sleeping (`0` for birds). */
  sleepDrop: number;
  /** Maximum stride excursion in Z (m) or wing stroke amp (rad). */
  strideLen: number;
  /** Maximum vertical foot lift in Y (m) or wingtip bend amp (rad). */
  liftHeight: number;
  /** Gait or wingbeat base frequency multiplier (rad/s). */
  gaitFreq: number;
  /** Maximum safe neck pitch downward during sleep (rad). */
  headSleepPitch: number;
  /** Normalized bird size class (`0` = tiny passerine/diver, `1` = giant pelagic/thermal soarer). */
  birdSize?: number;
}

export interface VertebratePose {
  time: number;
  walk: number;
  run: number;
  work: number;
  sleep: number;
  config: VertebrateRigConfig;
}

export interface VertebratePartInput {
  role: VertebrateRole;
  pivot: THREE.Vector3Tuple;
  joint: THREE.Vector3Tuple;
  tip: THREE.Vector3Tuple;
  meta: number;
}
