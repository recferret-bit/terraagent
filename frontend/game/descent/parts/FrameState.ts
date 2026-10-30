import * as THREE from 'three';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { clamp, smoothstep } from '../math';
import type { Trajectory } from './Trajectory';

/** Everything the frame parts share and never reassign. */
export interface DescentContext {
  viewport: ColonyViewport;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  spec: PlanetSpec;
  surface: PlanetSurface;
  /** Atmosphere density of the planet. */
  dens: number;
  startAt: number;
  tScale: number;
  /** Direction TO the sun (== viewport sun offset, so lighting is continuous at handover). */
  sunDir: THREE.Vector3;
  traj: Trajectory;
  /** Parent of every descent object (removed on cleanup). */
  root: THREE.Group;
}

/** Per-frame values written by early parts and read by later ones (and by the next frame: `camPos`). */
export class FrameState {
  tn = 0; dtn = 0;
  /** Pod altitude above the ground. */
  yRel = 0;
  /** Reentry envelope, plasma intensity, heat, retro-thrust envelope, cloud-deck-crossing blend. */
  P = 0; plasmaI = 0; heat = 0; thr = 0; cb = 0;
  readonly podBase = new THREE.Vector3();
  readonly podCenter = new THREE.Vector3();
  readonly camPos = new THREE.Vector3();
  readonly camTgt = new THREE.Vector3();

  /** Phase envelopes for authored second `tn`. */
  setEnvelopes(dens: number) {
    const tn = this.tn;
    this.P = smoothstep(14.6, 17.5, tn) * (1 - smoothstep(21.3, 23.6, tn));
    this.plasmaI = this.P * (0.55 + 1.1 * dens);
    this.heat = clamp(smoothstep(14.8, 19, tn) * (1 - smoothstep(22, 28, tn)) * (0.6 + 0.5 * dens));
    this.thr = smoothstep(28.9, 29.6, tn) * (1 - smoothstep(34.0, 34.4, tn));
  }
}

/** One single-purpose slice of the per-frame update; the sequence runs its parts in a fixed order. */
export interface FramePart {
  update(f: FrameState): void;
  /** Called when the timeline is (re)started or seeked. */
  reset?(): void;
  dispose?(): void;
}
