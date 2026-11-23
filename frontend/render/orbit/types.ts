import type * as THREE from 'three';
import type { PlanetSpec } from '../planets/PlanetSpec';

export interface OrbitalGlobeMarkerInput {
  readonly id: string;
  /** Angular offset on front hemisphere in radians: yaw (-0.85..0.85), pitch (-0.75..0.75). */
  readonly yaw: number;
  readonly pitch: number;
  readonly role: 'sector' | 'target' | 'player' | 'bot';
  readonly players?: number;
  readonly bots?: number;
  readonly isHomeBase?: boolean;
}

export interface ProjectedAnchor2D {
  readonly id: string;
  readonly role: OrbitalGlobeMarkerInput['role'] | 'scanLimb' | 'presenceLimb';
  /** Normalized 0..1 viewport coordinates (0,0 = top-left, 1,1 = bottom-right). */
  readonly nx: number;
  readonly ny: number;
  readonly visible: boolean;
  readonly players?: number;
  readonly bots?: number;
  readonly isHomeBase?: boolean;
  readonly centerNx?: number;
  readonly centerNy?: number;
}

/** The planet's Lead Patron (W28-12): plain data from the app. Render never reads wallets or contracts. */
export interface OrbitalLeadPatron {
  /** Display name drawn beside the flagship, e.g. `ISS <handle>.near`. Server text: render it with `textContent`. */
  readonly carrierName: string;
}

/** Screen anchor of the flagship carrier (normalized 0..1 viewport coordinates, 0,0 = top-left). */
export interface ProjectedFlagship {
  readonly name: string;
  readonly nx: number;
  readonly ny: number;
  readonly visible: boolean;
}

export interface OrbitalProjectedFrame {
  readonly globeNx: number;
  readonly globeNy: number;
  readonly globeRadiusNormY: number;
  readonly anchors: readonly ProjectedAnchor2D[];
  readonly time?: number;
  readonly pointerX?: number;
  readonly pointerY?: number;
  /** Present while a Lead Patron's flagship is parked in the skybox. */
  readonly flagship?: ProjectedFlagship;
}

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
  /** Configure 3D sector / player / bot target markers rendered on the front hemisphere of the orbital globe. */
  setHighlights(markers: readonly OrbitalGlobeMarkerInput[]): void;
  /** Project the globe center, limb anchors, and all active 3D markers into normalized 0..1 screen coordinates. */
  projectHighlights(): OrbitalProjectedFrame;
  /**
   * DEPLOY: camera flies behind the carrier, the pod lowers into the bay, is released, and falls toward the REAL
   * menu planet; pod + camera shrink continuously (scale-dive) until the frame is the descent's frame `h.startAt`
   * rotated/scaled onto this globe. Returns the globe orientation the descent must adopt so the planets coincide.
   */
  beginDeploy(h: import('../descent/types').DescentHandoff, opts?: { biomeKey?: string }): { spinQuat: THREE.Quaternion; cloudRotY: number };
  /** Retargets the orbital entry corridor and lighting before pod release (`T < 3.6s`) if online `welcome` updates the solar clock. */
  retargetDeploy?(h: import('../descent/types').DescentHandoff): { spinQuat: THREE.Quaternion; cloudRotY: number } | null;
  /** 0..1 progress of the deploy sequence (1 = stage frame == descent frame `h.startAt`, safe to cut). */
  deployProgress(): number;
  /** Authored descent second the deploy sequence currently represents (for telemetry). */
  deployTn(): number;
  /**
   * Park (or remove, with `null`) the Lead Patron's named flagship carrier in the skybox (W28-12). Cleared by
   * `setPlanet`; the app sets it again once the new planet's prestige is known.
   */
  setLeadPatron?(patron: OrbitalLeadPatron | null): void;
  /** Idle menu motion (slow orbit + ship drift). */
  update(dt: number, time: number): void;
  /** Pod-free orbital dive straight toward the player's existing base sector. */
  beginCameraDive?(opts?: { yaw?: number; pitch?: number; duration?: number }): void;
  /** 0..1 progress of the pod-free orbital camera dive. */
  cameraDiveProgress?(): number;
  /** Slices GPU disposal of globes, backdrop, parallax layers, moons, satellites, and carrier across idle frames. */
  disposeDeferred?(): void;
  dispose(): void;
}
export type CreateOrbitalStage = (viewport: import('../core/createColonyViewport').ColonyViewport, spec: PlanetSpec) => OrbitalStage;
