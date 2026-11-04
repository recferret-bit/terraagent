import * as THREE from 'three';
import {
  ArchetypeCatalog,
  createArchetypeMesh,
  type ArchetypeMesh,
  type FaunaVisualSpecies,
} from '@terra/render/kitbash';
import type { FaunaMode, FaunaSceneKind } from '../state';

export const FAUNA_TICK_MS = 200;
export const DT_TICK_S = FAUNA_TICK_MS / 1000;
export const WAVE_COOLDOWN_TICKS = 25;
export const MAX_EPISODE_WAVES = 3;

export type CosmeticGesture = 'foraging' | 'resting' | 'grooming' | 'tending_brood';
export const COSMETIC_GESTURES: readonly CosmeticGesture[] = [
  'foraging',
  'resting',
  'grooming',
  'tending_brood',
] as const;

export interface SeededRng {
  readonly draws: number;
  nextU32(): number;
  nextFloat(): number;
  nextRange(min: number, max: number): number;
  nextInt(lo: number, hi: number): number;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Deterministic xoshiro128** PRNG with explicit draw counter (`fauna-hives-spec.md` §3). */
export function createSeededRng(seed: number): SeededRng {
  const init = splitmix32(Math.trunc(seed) >>> 0);
  const st = new Uint32Array([init(), init(), init(), init()]);
  if (!(st[0] | st[1] | st[2] | st[3])) st[0] = 1;
  let draws = 0;
  const nextU32 = (): number => {
    draws += 1;
    const result = Math.imul(rotl(Math.imul(st[1]!, 5) >>> 0, 7), 9) >>> 0;
    const t = (st[1]! << 9) >>> 0;
    st[2]! ^= st[0]!;
    st[3]! ^= st[1]!;
    st[1]! ^= st[2]!;
    st[0]! ^= st[3]!;
    st[2]! ^= t;
    st[3] = rotl(st[3]!, 11);
    return result;
  };
  const nextFloat = () => nextU32() / 4294967296;
  return {
    get draws() {
      return draws;
    },
    nextU32,
    nextFloat,
    nextRange: (min, max) => min + nextFloat() * (max - min),
    nextInt: (lo, hi) => lo + Math.floor(nextFloat() * (hi - lo + 1)),
  };
}

/** Pure cosmetic presentation gesture derived from `(seed, bugId, tick)` without touching gameplay RNG. */
export function deriveCosmeticGesture(
  seed: number,
  bugId: string | number,
  tick: number,
): CosmeticGesture {
  const epoch = Math.floor(Math.max(0, tick) / 6);
  const str = `${Math.trunc(seed)}:${bugId}:${epoch}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return COSMETIC_GESTURES[splitmix32(h)() % COSMETIC_GESTURES.length]!;
}

export interface SpeciesTuning {
  initialResidents: number;
  maxResidents: number;
  speedMps: number;
  attackRangeM: number;
  attackIntervalTicks: number;
  wanderRadiusM: number;
}

export const SPECIES_TUNING: Readonly<Record<FaunaVisualSpecies, SpeciesTuning>> = {
  blackAnt: {
    initialResidents: 9,
    maxResidents: 12,
    speedMps: 2.2,
    attackRangeM: 1.35,
    attackIntervalTicks: 5,
    wanderRadiusM: 2.3,
  },
  blueBeetle: {
    initialResidents: 3,
    maxResidents: 3,
    speedMps: 0.9,
    attackRangeM: 1.6,
    attackIntervalTicks: 10,
    wanderRadiusM: 1.9,
  },
  greenSpitter: {
    initialResidents: 5,
    maxResidents: 6,
    speedMps: 1.5,
    attackRangeM: 4.2,
    attackIntervalTicks: 10,
    wanderRadiusM: 2.1,
  },
};

export interface FaunaHiveStat {
  hiveId: string;
  species: FaunaVisualSpecies;
  hiveArchetypeId: string;
  bugArchetypeId: string;
  mode: FaunaMode;
  residents: number;
  maxResidents: number;
  waveCount: number;
  position: { x: number; y: number; z: number };
  targetColony: string | null;
  nextWaveTicks: number;
}

export interface FaunaBugSnapshot {
  bugId: string;
  species: FaunaVisualSpecies;
  hiveId: string;
  archetypeId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  walkWeight: number;
  workWeight: number;
  gesture: CosmeticGesture;
  order: 'idle' | 'wander' | 'attack' | 'bite' | 'spit_acid';
}

export interface FaunaSceneStats {
  tick: number;
  rngDraws: number;
  mode: FaunaMode;
  modeLabel: 'NEUTRAL' | 'AGGRESSIVE';
  scene: FaunaSceneKind | null;
  biomeKey: string;
  seed: number;
  paused: boolean;
  populationCount: number;
  maxPopulation: number;
  waveCount: number;
  activeProjectiles: number;
  hives: FaunaHiveStat[];
  bugs: FaunaBugSnapshot[];
}

export interface FaunaRenderOptions {
  wire?: boolean;
  bloom?: boolean;
  shadows?: boolean;
  pixel?: boolean;
  culled?: boolean;
}

export interface HiveEntity {
  hiveId: string;
  species: FaunaVisualSpecies;
  hiveArchetypeId: string;
  bugArchetypeId: string;
  x: number;
  y: number;
  z: number;
  entranceX: number;
  entranceZ: number;
  maxResidents: number;
  waveCount: number;
  lastWaveTick: number;
  mesh: ArchetypeMesh;
}

export interface BugEntity {
  bugId: string;
  index: number;
  species: FaunaVisualSpecies;
  hiveId: string;
  archetypeId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  targetX: number;
  targetZ: number;
  attackOffsetX: number;
  attackOffsetZ: number;
  wanderTimerTicks: number;
  walkWeight: number;
  workWeight: number;
  gesture: CosmeticGesture;
  order: 'idle' | 'wander' | 'attack' | 'bite' | 'spit_acid';
  mesh: ArchetypeMesh;
}

export function buildSafeArchetypeMesh(
  resolvedId: string,
  fallbackId: string,
  biomeKey: string,
): ArchetypeMesh {
  const id = ArchetypeCatalog.has(resolvedId) ? resolvedId : fallbackId;
  return createArchetypeMesh(id, biomeKey);
}

export function stepPassiveBugState(
  bug: BugEntity,
  hive: HiveEntity,
  tuning: SpeciesTuning,
  rng: SeededRng,
): void {
  bug.wanderTimerTicks -= 1;
  const dx = bug.targetX - bug.x;
  const dz = bug.targetZ - bug.z;
  const dist = Math.hypot(dx, dz);

  if (bug.wanderTimerTicks <= 0) {
    const angle = rng.nextRange(0, Math.PI * 2);
    const r = rng.nextRange(0.65, tuning.wanderRadiusM);
    bug.targetX = hive.entranceX + Math.cos(angle) * r;
    bug.targetZ = hive.entranceZ + Math.sin(angle) * r;
    bug.wanderTimerTicks = rng.nextInt(4, 12);
  }

  if (dist > 0.1) {
    const step = Math.min(dist, tuning.speedMps * DT_TICK_S);
    bug.x += (dx / dist) * step;
    bug.z += (dz / dist) * step;
    bug.yaw = Math.atan2(dx, dz);
    bug.walkWeight = 1;
    bug.workWeight = 0;
    bug.order = 'wander';
  } else {
    bug.walkWeight = 0;
    bug.order = 'idle';
    bug.workWeight = bug.gesture === 'foraging' || bug.gesture === 'tending_brood' ? 0.85 : 0;
  }
}

export function stepAggressiveBugState(
  bug: BugEntity,
  tuning: SpeciesTuning,
  dummyPos: THREE.Vector3,
  tick: number,
  onFireAcid: (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => void,
): void {
  const goalX = dummyPos.x + bug.attackOffsetX;
  const goalZ = dummyPos.z + bug.attackOffsetZ;
  const dx = dummyPos.x - bug.x;
  const dz = dummyPos.z - bug.z;
  const distToDummy = Math.hypot(dx, dz);

  if (distToDummy > tuning.attackRangeM) {
    const gdx = goalX - bug.x;
    const gdz = goalZ - bug.z;
    const gDist = Math.max(0.001, Math.hypot(gdx, gdz));
    const step = Math.min(gDist, tuning.speedMps * DT_TICK_S);
    bug.x += (gdx / gDist) * step;
    bug.z += (gdz / gDist) * step;
    bug.yaw = Math.atan2(gdx, gdz);
    bug.walkWeight = 1;
    bug.workWeight = 0;
    bug.order = 'attack';
  } else {
    bug.yaw = Math.atan2(dx, dz);
    bug.walkWeight = 0.15;
    bug.workWeight = 1.0;
    if (bug.species === 'greenSpitter') {
      bug.order = 'spit_acid';
      if ((tick + bug.index * 3) % tuning.attackIntervalTicks === 0) {
        onFireAcid({ x: bug.x, y: 0.65, z: bug.z }, { x: dummyPos.x, y: 0.55, z: dummyPos.z });
      }
    } else {
      bug.order = 'bite';
    }
  }
}
