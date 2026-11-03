export type InteractionTargetKind =
  | 'tree'
  | 'rock'
  | 'dune'
  | 'hole'
  | 'flat'
  | 'metals'
  | 'minerals'
  | 'oil'
  | 'repair';

export type ParticleRole = 'primary' | 'secondary' | 'accent';

export type ParticleGeometryKind =
  | 'leafCluster'
  | 'pineNeedle'
  | 'barkSlab'
  | 'woodSplinter'
  | 'rockShard'
  | 'slateChunk'
  | 'sandGrain'
  | 'dustCloud'
  | 'soilClod'
  | 'crystalShard'
  | 'oreNugget'
  | 'oilDroplet'
  | 'weldSpark'
  | 'energyOrb'
  | 'shockRing';

export interface ParticleLayerSpec {
  /** Human-readable layer name (used by particle-effect-validator reports). */
  name: string;
  /** 60 / 30 / 10 visual hierarchy role: 'primary' (target matter), 'secondary' (contrast/structure/dust), 'accent' (HDR energy). */
  role: ParticleRole;
  /** 3D low-poly mesh chunk geometry (never flat 2D billboard sprites). */
  geometry: ParticleGeometryKind;
  /** Number of pooled 3D instances in this emitter layer. */
  count: number;
  /** Base sRGB hex color (e.g., 0x3ca342 for canopy leaves, 0x593a22 for bark). */
  color: number;
  /** Optional alternate sRGB hex color blended per instance for organic/mineral variation. */
  colorAlt?: number;
  /** HDR emissive multiplier; accent layers must use >= 3.0 to trigger selective UnrealBloomPass. */
  emissiveIntensity?: number;
  /** PBR surface roughness (clamped >= 0.35 for non-emissive matter). */
  roughness?: number;
  /** PBR metallic factor (0.0 for organic/stone, 0.6..0.9 for metallic ore/hull chips). */
  metalness?: number;
  /** [minScale, maxScale] in metres. */
  sizeRange: [number, number];
  /** [minSpeed, maxSpeed] ejection speed in m/s. */
  speedRange: [number, number];
  /** [minUp, maxUp] vertical velocity boost in m/s. */
  upwardBias: [number, number];
  /** Ejection cone half-angle in radians (0..PI). */
  spreadCone: number;
  /** Gravitational acceleration in m/s^2 (positive pulls toward ground, negative rises). */
  gravity: number;
  /** Exponential air-drag coefficient (1/s). */
  drag: number;
  /** Ground-plane restitution coefficient (0..0.85). Heavy chunks bounce & skitter on the hex surface. */
  bounce: number;
  /** 3D angular tumbling speed in rad/s. */
  spinSpeed: number;
  /** [minLife, maxLife] particle lifetime in seconds. */
  lifetimeRange: [number, number];
  /** Optional tangential vortex swirl speed around the impact normal (m/s). */
  swirl?: number;
  /** Optional velocity-aligned elongation factor (e.g. for high-speed sparks and wind-sheared sand). */
  stretchByVelocity?: number;
}

export interface ToolBeamSpec {
  /** Inner HDR core hex color. */
  coreColor: number;
  /** Outer plasma/laser sheath hex color. */
  glowColor: number;
  /** HDR bloom intensity (must be >= 3.0). */
  emissiveIntensity: number;
  /** Radius of each tool cutter beam in metres. */
  beamRadius: number;
  /** Target-surface cutting sweep radius in metres. */
  sweepRadius: number;
  /** Cutting sweep angular frequency in rad/s. */
  sweepFreq: number;
  /** High-frequency energy pulse rate in rad/s. */
  pulseFreq: number;
  /** Ground impact ring hex color. */
  ringColor: number;
}

export interface ParticlePresetSpec {
  /** Unique preset ID, e.g. 'work.tree', 'work.rock', 'work.dune'. */
  id: string;
  /** Canonical interaction target category. */
  targetKind: InteractionTargetKind;
  /** Display label for playground & validator reports. */
  label: string;
  /** Brief description of the 60/30/10 object breakdown. */
  notes: string;
  /** Articulated tool cutter beam & ground impact ring configuration. */
  toolBeam: ToolBeamSpec;
  /** Multi-layer 3D instanced particle specification (>= 4 layers across primary/secondary/accent). */
  layers: ParticleLayerSpec[];
}

export interface ActiveWorkSiteInput {
  /** Unique worker entity ID (or 'playground' in storybook). */
  workerId: string;
  /** Interaction target kind resolved from tile terrain/deposit/job. */
  targetKind: InteractionTargetKind;
  /** Optional explicit preset ID override. */
  presetId?: string;
  /** World-space root position of the working bot. */
  botOrigin: [number, number, number];
  /** One or two world-space tool muzzle / hand positions on the bot. */
  toolOrigins: [number, number, number][];
  /** World-space center of the object being worked on (tree trunk, rock outcrop, dune crest, hole, deposit). */
  targetPos: [number, number, number];
  /** World-space Y elevation of the hex ground at the target site (for physical ground bounce). */
  groundY: number;
  /** Work blend weight (0..1). */
  intensity?: number;
}
