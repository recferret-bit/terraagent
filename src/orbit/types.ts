import * as THREE from 'three';
import type { PlanetSpec } from '../planets/PlanetSpec';

/** Space-menu backdrop: stars + planet globe + carrier ship in orbit. Owned by the "orbit/descent" workstream. */
export interface OrbitalStage {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Smoothly swap the displayed planet (≈1.2s crossfade/rotate). */
  setPlanet(spec: PlanetSpec): void;
  /** Idle menu motion (slow orbit + ship drift). */
  update(dt: number, time: number): void;
  dispose(): void;
}
export type CreateOrbitalStage = (viewport: import('../core/createColonyViewport').ColonyViewport, spec: PlanetSpec) => OrbitalStage;
