import type * as THREE from 'three';
import type { PlanetKind } from '../planets/PlanetSpec';

export type AvianFlightPattern =
  | 'canopyOrbit'
  | 'thermalSoar'
  | 'veeFormation'
  | 'figureEight'
  | 'waterSkim'
  | 'ridgePatrol';

export type BirdHabitatPref = 'forest' | 'water' | 'rock' | 'open';

export type BirdFlockState =
  | 'PATROLLING'
  | 'SOARING'
  | 'SKIMMING'
  | 'FLEEING_FOREST'
  | 'FLEEING_BATTLE'
  | 'FLEEING_AGGRESSOR';

export type AnimalDiet = 'predator' | 'grassEater' | 'treeBrowser';
export type AnimalSocial = 'solo' | 'group';

export type AnimalScheduleState =
  | 'SLEEPING'
  | 'DRINKING'
  | 'EATING_GRASS'
  | 'BROWSING_TREES'
  | 'HUNTING'
  | 'ROAMING'
  | 'FLEEING_PREDATOR'
  | 'FLEEING_AGGRESSOR';

export interface CircadianSlot {
  /** Inclusive start hour in `[0..24)`. */
  fromHour: number;
  /** Exclusive end hour in `(0..24]`. */
  toHour: number;
  activity: Exclude<AnimalScheduleState, 'FLEEING_PREDATOR' | 'FLEEING_AGGRESSOR'>;
}

export interface BirdSpeciesSpec {
  id: string;
  label: string;
  biome: PlanetKind;
  pattern: AvianFlightPattern;
  habitatPref: BirdHabitatPref;
  flockSize: readonly [number, number];
  altitude: readonly [number, number];
  speed: number;
  orbitRadius: number;
  flapBase: number;
  scale: number;
}

export interface LandAnimalSpeciesSpec {
  id: string;
  label: string;
  biome: PlanetKind;
  diet: AnimalDiet;
  social: AnimalSocial;
  groupSize: readonly [number, number];
  walkSpeed: number;
  runSpeed: number;
  scale: number;
  schedule: readonly CircadianSlot[];
}

export interface BiosphereAggressor {
  x: number;
  z: number;
  radius?: number;
  working?: boolean;
}

export interface BiosphereBattleHotspot {
  x: number;
  z: number;
  radius: number;
  ttl: number;
}

export interface HabitatAnchor {
  x: number;
  z: number;
  tileIndex: number;
}

export interface BiosphereHabitatIndex {
  readonly halfSize: number;
  readonly forestAnchors: HabitatAnchor[];
  readonly forestTileSet: Set<number>;
  readonly waterAnchors: HabitatAnchor[];
  readonly grassAnchors: HabitatAnchor[];
  readonly rockAnchors: HabitatAnchor[];
  readonly colonizedAnchors: HabitatAnchor[];
  isPassableLand(x: number, z: number): boolean;
  heightAt(x: number, z: number): number;
}

export interface BirdMemberState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  pitch: number;
  roll: number;
  phase: number;
  flapWeight: number;
  scale: number;
}

export interface BirdFlock {
  readonly id: number;
  readonly species: BirdSpeciesSpec;
  readonly speciesSlot: number;
  pattern: AvianFlightPattern;
  state: BirdFlockState;
  homeX: number;
  homeZ: number;
  homeTileIndex: number;
  targetX: number;
  targetZ: number;
  orbitAngle: number;
  stateTimer: number;
  relocations: number;
  readonly members: BirdMemberState[];
}

export interface LandAnimalAgent {
  readonly id: number;
  readonly groupId: number;
  readonly species: LandAnimalSpeciesSpec;
  readonly speciesSlot: number;
  readonly canAttackPlayer: false;
  state: AnimalScheduleState;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  homeX: number;
  homeZ: number;
  goalX: number;
  goalZ: number;
  phase: number;
  walkWeight: number;
  workWeight: number;
  sleepCrouch: number;
  scale: number;
  pauseTimer: number;
}

export interface BiosphereCounts {
  birdSpecies: number;
  birdFlocks: number;
  birdsTotal: number;
  landSpecies: number;
  landGroups: number;
  landAnimalsTotal: number;
}

export interface PlanetBiosphere {
  readonly group: THREE.Group;
  readonly birdMeshes: readonly THREE.InstancedMesh[];
  readonly animalMeshes: readonly THREE.InstancedMesh[];
  counts(): BiosphereCounts;
  getBirdFlocks(): readonly BirdFlock[];
  getLandAnimals(): readonly LandAnimalAgent[];
  setAggressors(aggressors: readonly BiosphereAggressor[]): void;
  noteBattleAt(x: number, z: number, radius?: number, ttl?: number): void;
  /** Optional `[0..1)` solar cycle override (`0 = midnight`, `0.25 = dawn`, `0.5 = noon`, `0.75 = dusk`). */
  setTimeOfDayOverride(time01: number | null): void;
  onHabitatChanged(habitat: BiosphereHabitatIndex): void;
  tick(dt: number): void;
  dispose(): void;
}
