import * as THREE from 'three';
import type { ColonyViewport } from '../../core/createColonyViewport';
import type { DescentHandoff } from '../../descent/types';
import type { DropRig } from '../../descent/dropRig';
import type { FittedModel } from '../../visuals/space/placeholders';
import type { StageGlobes } from '../stage/StageGlobes';
import type { SunRig } from '../stage/SunRig';

export const TA = 2.6, TB = 3.6, TC = 9.6;   // dolly | release | dive

/** Everything the deploy sequence borrows from the orbital stage. */
export interface DeployHost {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; viewport: ColonyViewport;
  sunDir: THREE.Vector3; sun: SunRig; carrier: FittedModel; globes: StageGlobes;
  /** Point the camera is currently looking at (shared with the idle camera so the hand-over is seamless). */
  lookNow: THREE.Vector3;
}

export interface Deploy {
  T: number; h: DescentHandoff; rig: DropRig;
  PC: THREE.Vector3; Rs: number; s: number; Q: THREE.Quaternion; ne: THREE.Vector3;
  podEnd: THREE.Vector3; camEnd: THREE.Vector3; tgtEnd: THREE.Vector3; qEnd: THREE.Quaternion;
  p0: THREE.Vector3; t0: THREE.Vector3; up0: THREE.Vector3; holdCam: THREE.Vector3; holdTgt: THREE.Vector3;
  dropDir: THREE.Vector3; released: boolean; tgtHold1: THREE.Vector3;
  P0: THREE.Vector3; q0: THREE.Quaternion; sc0: number; O0: THREE.Vector3; G0: THREE.Vector3; upR: THREE.Vector3; camR: THREE.Vector3; tgtR: THREE.Vector3;
  sunI0: number; sunC0: THREE.Color; hemi0: [THREE.Color, THREE.Color, number]; rim0: number; env0: number; exp0: number; bloom0: number;
  cloudS0: number; shell0: number; near0: number;
}
