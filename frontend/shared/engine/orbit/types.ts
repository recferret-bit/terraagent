import * as THREE from 'three';
import type { PlanetSpec } from '../planets/PlanetSpec';

/** Space-menu backdrop: stars + planet globe + carrier ship in orbit. Owned by the "orbit/descent" workstream. */
export interface OrbitalStage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Smoothly swap the displayed planet (≈1.2s crossfade/rotate by default; `duration` stretches the whole morph: globe, nebula tint and moons). */
  setPlanet(spec: PlanetSpec, opts?: { duration?: number; continuousSpin?: boolean }): void;
  /** Terraform the currently shown planet: 0 = untouched … 4 = fully terraformed (see PlanetGlobe.setTerraform). */
  setTerraform(stage: number, smooth?: boolean): void;
  /** Axial spin of every globe in rad/s (default 0.025). `continuousSpin` on setPlanet keeps it forward-only through a morph. */
  setSpinRate(radPerSec: number): void;
  /**
   * DEPLOY: camera flies behind the carrier, the pod lowers into the bay, is released, and falls toward the REAL
   * menu planet; pod + camera shrink continuously (scale-dive) until the frame is the descent's frame `h.startAt`
   * rotated/scaled onto this globe. Returns the globe orientation the descent must adopt so the planets coincide.
   */
  beginDeploy(h: import('../../../game/descent/types').DescentHandoff, opts?: { biomeKey?: string }): { spinQuat: THREE.Quaternion; cloudRotY: number };
  /** 0..1 progress of the deploy sequence (1 = stage frame == descent frame `h.startAt`, safe to cut). */
  deployProgress(): number;
  /** Authored descent second the deploy sequence currently represents (for telemetry). */
  deployTn(): number;
  /** Idle menu motion (slow orbit + ship drift). */
  update(dt: number, time: number): void;
  dispose(): void;
}
export type CreateOrbitalStage = (viewport: import('../core/createColonyViewport').ColonyViewport, spec: PlanetSpec) => OrbitalStage;
