import type * as THREE from 'three';
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { PlanetSurface } from '../planets/surface/types';
import type { ColonyViewport } from '../core/createColonyViewport';

export type DescentPhase = 'orbit' | 'release' | 'freefall' | 'reentry' | 'chute' | 'retro' | 'touchdown';

export interface DescentTelemetry {
  /** Seconds since start (0..duration). */
  t: number; duration: number; progress: number;
  phase: DescentPhase;
  /** Fake-but-plausible HUD numbers. */
  altitudeKm: number; speedKmh: number; gForce: number; heatPct: number;
  /** Short HUD caption for the current beat, e.g. "Atmospheric interface — hold on". */
  caption: string;
}

/**
 * The ~35 s cinematic: carrier releases the hero robot's drop pod in orbit → freefall → plasma reentry →
 * chute → retro-thrusters → touchdown on `surface.landingSite`, with the camera zooming from the whole
 * planet down to the 28° diorama gameplay camera pose. Owned by "orbit/descent" workstream.
 *
 * Ownership model: the GAME owns `scene`/`camera` (normally viewport.scene / viewport.camera) and the surface.
 * Descent temporarily adds its own objects (stars, globe, ship, pod, FX), may override scene.background/fog/
 * lights/camera FOV during the dive, and on complete/skip/dispose MUST remove all its temp objects, restore
 * lights/fog via `viewport.applySky(spec)`, leave the camera at `finalPose` (FOV 28), and hand over the hero.
 */
/** What the menu stage needs to dolly into a frame that matches the descent's first frame (carrier-local units). */
export interface DescentHandoff {
  startAt: number;
  camLocal: THREE.Vector3; targetLocal: THREE.Vector3; upLocal: THREE.Vector3;
  /** Direction TO the sun in carrier-local space. */
  sunLocal: THREE.Vector3;
  sunColor: THREE.Color; sunIntensity: number;
  hemiColor: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number;
  exposure: number; envIntensity: number; bloom: number;
  bayGlow: number; podYawLocal: number;
  /** World scale of carrier.root inside the descent (the drop rig is expressed in descent world units). */
  carrierScale: number;
  /** Telemetry to show while the hand-off dolly plays. */
  tel: DescentTelemetry;
}

export interface DescentSequence {
  readonly duration: number; // default 35
  /** Hand-off pose/lighting for a seamless cut from the menu stage. */
  readonly handoff: DescentHandoff;
  /** Where the camera ends (gameplay diorama pose). Valid immediately after creation. */
  readonly finalPose: { position: THREE.Vector3; target: THREE.Vector3 };
  start(): void;
  /** Advance + prepare the frame (does NOT call viewport.render()). Returns true while running. */
  update(dt: number): boolean;
  /** Jump to touchdown (skip) — must end in the same final state as a full run. */
  skip(): void;
  onTelemetry(cb: (t: DescentTelemetry) => void): void;
  /** Fired once at touchdown. `hero` is the robot.hero mesh standing at surface.landingSite, already detached from descent objects and added to `scene`. */
  onComplete(cb: (hero: THREE.Object3D) => void): void;
  dispose(): void;
}

export interface DescentOptions {
  viewport: ColonyViewport;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  spec: PlanetSpec;
  /** Already added to `scene` by the game before start(); descent may hide it during orbit phases. */
  surface: PlanetSurface;
  duration?: number; // default 35
  /** Authored second to begin at (0 = top; 2 = carrier hand-off with the bay arming). */
  startAt?: number;
}
export type CreateDescentSequence = (opts: DescentOptions) => DescentSequence;
