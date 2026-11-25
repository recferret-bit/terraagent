import type * as THREE from 'three';
import type { MotionTrack } from '@terra/render/motion/entityMotion';
import type { UnitSuspensionState } from '@terra/render/motion/terrainSuspension';

export interface EntityMeshRecord {
  id: number; kind: number; owner: number; q: number; r: number; x: number; y: number; rot: number;
  hp: number; hpMax: number; state: number; progress: number; buildStage: number;
  tier?: number;
  archetypeId?: string;
  mesh: THREE.Object3D; targetPos: THREE.Vector3; targetYaw: number; walk: number; work: number;
  /** Poses by tick, drawn at the shared render clock (smooth constant-speed walking, see `entityMotion.ts`). */
  track: MotionTrack;
  /** The drawn pose moved during the last half tick (drives the walk animation, in step with what is drawn). */
  trackMoving: boolean;
  /** Visual 3D terrain suspension & chassis attitude state for mobile units on sloped ground. */
  suspension?: UnitSuspensionState;
  /** Smoothed authoritative world XZ prior to transient visual slope-surge offset. */
  trackWorldX?: number;
  trackWorldZ?: number;
  lightLevel?: number; // drawn light level 0..1 (entityVisionSync eases it to the sim's `entityLightLevel`)
}

