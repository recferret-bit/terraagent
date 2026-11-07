import type * as THREE from 'three';
import type { MotionTrack } from '@terra/render/motion/entityMotion';

export interface EntityMeshRecord {
  id: number; kind: number; owner: number; q: number; r: number; x: number; y: number; rot: number;
  hp: number; hpMax: number; state: number; progress: number; buildStage: number;
  mesh: THREE.Object3D; targetPos: THREE.Vector3; targetYaw: number; walk: number; work: number;
  /** Poses by tick, drawn at the shared render clock (smooth constant-speed walking, see `entityMotion.ts`). */
  track: MotionTrack;
  /** The drawn pose moved during the last half tick (drives the walk animation, in step with what is drawn). */
  trackMoving: boolean;
}

