import type * as THREE from 'three';
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { PlanetSurface } from '../planets/surface/types';
import type { PrecomputedGlobeSpheres } from '../visuals/terrain/TerrainGrid';
import type { ColonyViewport } from '../core/createColonyViewport';

export type DescentPhase = 'orbit' | 'release' | 'freefall' | 'reentry' | 'chute' | 'approach' | 'retro' | 'touchdown';

export type DescentAtmoLayer =
  | 'EXOSPHERE'
  | 'THERMOSPHERE'
  | 'MESOSPHERE'
  | 'STRATOSPHERE'
  | 'TROPOSPHERE'
  | 'BOUNDARY';

export type DescentThermalState =
  | 'BAY STANDBY'
  | 'VACUUM VENT'
  | 'COLD SOAK'
  | 'SLIP HEATING'
  | 'PLASMA ABLATION'
  | 'SHIELD SEP'
  | 'CONVECTIVE COOL'
  | 'RETRO WASH'
  | 'AMBIENT';

export type DescentCommsState = 'LOCKED' | 'DEGRADED' | 'BLACKOUT';
export type DescentAtmoStatus = 'VACUUM TRACE' | 'IONIZED INTAKE' | 'ANALYSIS LOCKED';
export type DescentSolarPeriod = 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';
export type DescentMechState = 'stby' | 'act' | 'warn' | 'ok';
export type DescentGuidanceState =
  | 'ORBITAL NAV'
  | 'ENTRY CORRIDOR'
  | 'PLASMA INERTIAL'
  | 'RADAR ALT LOCK'
  | 'PAD CONTACT';

export type DescentBeaconState = 'STANDBY' | 'ORBITAL' | 'BLACKOUT' | 'ACQUIRED' | 'LOCKED';

export interface DescentMechIndicator {
  readonly code: string;
  readonly text: string;
  readonly state: DescentMechState;
}

export interface DescentPodSystems {
  readonly clamps: DescentMechIndicator;
  readonly shield: DescentMechIndicator;
  readonly chute: DescentMechIndicator;
  readonly retro: DescentMechIndicator;
  readonly gear: DescentMechIndicator;
  readonly hatch: DescentMechIndicator;
}

export interface DescentGasSample {
  readonly formula: string;
  readonly name: string;
  /** Target planet mole fraction in percent (0..100). */
  readonly pct: number;
  readonly role: 'inert' | 'oxidizer' | 'greenhouse' | 'trace';
}

export interface DescentTelemetry {
  /** Seconds since start (0..duration). */
  t: number; duration: number; progress: number;
  phase: DescentPhase;
  /** Flight kinematics & loads. */
  altitudeKm: number; speedKmh: number; gForce: number; heatPct: number;
  /** Heat-shield / hull skin temperature, °C (conditioned bay -> cold space soak -> ~2000 °C plasma -> ambient). */
  hullTempC: number;
  /** Instantaneous rate of hull temperature change (°C/s), framerate-independent. */
  hullTempRateCs?: number;
  /** Short HUD caption for the current beat, e.g. "Atmospheric interface — hold on". */
  caption: string;
  /** Extended aerospace & planetary environmental telemetry. */
  mach?: number;
  verticalSpeedMs?: number;
  peakG?: number;
  staticPressureKpa?: number;
  dynamicPressureKpa?: number;
  isMaxQ?: boolean;
  atmoLayer?: DescentAtmoLayer;
  thermalState?: DescentThermalState;
  commsState?: DescentCommsState;
  commsSignalPct?: number;
  surfaceGravityG?: number;
  ambientTempC?: number;
  localSolarClock?: string;
  localDayPeriod?: DescentSolarPeriod;
  intakeProgress?: number;
  atmoStatus?: DescentAtmoStatus;
  atmoSummary?: string;
  atmoGases?: readonly DescentGasSample[];
  atmoDensityKgM3?: number;
  ppO2Kpa?: number;
  downrangeKm?: number;
  guidanceState?: DescentGuidanceState;
  beaconState?: DescentBeaconState;
  /** Radar altimeter AGL in meters once heat shield separates (`null` while masked by heat shield). */
  radarAltM?: number | null;
  podSystems?: DescentPodSystems;
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
  /** `0..1` SpaceBackdrop sun-disc visibility at `startAt` (`0` in nightside umbra, `1` on sunlit dayside). */
  sunDisc?: number;
  hemiColor: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number;
  exposure: number; envIntensity: number; bloom: number;
  bayGlow: number; podYawLocal: number;
  /** World scale of carrier.root inside the descent (the drop rig is expressed in descent world units). */
  carrierScale: number;
  /** Telemetry to show while the hand-off dolly plays. */
  tel: DescentTelemetry;
  /** Telemetry for any authored second (the menu stage plays authored 0..startAt itself). */
  telAt(tn: number): DescentTelemetry;
  /** Frame `startAt` in descent world space — the menu stage reproduces it (scaled + rotated) on its own globe. */
  R: number; centre: THREE.Vector3; fov: number; podH: number;
  pod: THREE.Vector3; podQuat: THREE.Quaternion; cam: THREE.Vector3; camTarget: THREE.Vector3;
  /** Direction TO the sun in descent world space (lights + globe shading). */
  sunDir: THREE.Vector3;
}

export interface DescentSequence {
  readonly duration: number; // default 35
  /** Hand-off pose/lighting for a seamless cut from the menu stage. */
  readonly handoff: DescentHandoff;
  /** Orient the descent globe (world quaternion of its spin group + cloud drift) so it matches the menu globe at the cut. */
  alignGlobe(spinQuat: THREE.Quaternion, cloudRotY: number): void;
  /** Sync sky/fog/telemetry to an authoritative server planet spec if resolved during orbital/entry flight. */
  syncPlanetSpec?(spec: PlanetSpec): void;
  /** Refresh orbital entry sun direction & umbra lighting on `handoff` from live `dayNightConfig`; returns true if changed. */
  syncHandoffSolar?(opts?: { updateEntryDir?: boolean; dtSec?: number }): boolean;
  /** Use y=0 landing-pad datum when an online HexTerrain replaces the procedural preview surface. */
  setExternalGround?(active: boolean): void;
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
  /** Detaches scene objects immediately and slices part GPU disposal across idle animation frames. */
  disposeDeferred?(): void;
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
  /** Optional worker-precomputed `PlanetGlobe` high-poly spheres (`@terra/render/planets/prep`). */
  precomputedGlobeSpheres?: PrecomputedGlobeSpheres;
  /** When true, `finish()` / `skip()` slices part GPU disposal across idle frames instead of stalling the handoff frame. */
  deferPartDispose?: boolean;
}
export type CreateDescentSequence = (opts: DescentOptions) => DescentSequence;
