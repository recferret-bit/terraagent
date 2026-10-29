import * as THREE from 'three';
import type { PlanetSpec } from '../planets/PlanetSpec';

/** Space-menu backdrop: stars + planet globe + carrier ship in orbit. Owned by the "orbit/descent" workstream. */
export interface OrbitalStage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Smoothly swap the displayed planet (≈1.2s crossfade/rotate). */
  setPlanet(spec: PlanetSpec): void;
  /**
   * DEPLOY: freeze the carrier, lower the drop pod into its bay and dolly the camera (smoothly, from wherever it is)
   * into the descent's carrier-local hand-off pose while lights/exposure converge to the descent's first frame.
   */
  beginDeploy(h: import('../descent/types').DescentHandoff, opts?: { duration?: number; biomeKey?: string }): void;
  /** 0..1 progress of the deploy dolly (1 = parked on the hand-off pose, safe to cut). */
  deployProgress(): number;
  /** Idle menu motion (slow orbit + ship drift). */
  update(dt: number, time: number): void;
  dispose(): void;
}
export type CreateOrbitalStage = (viewport: import('../core/createColonyViewport').ColonyViewport, spec: PlanetSpec) => OrbitalStage;
