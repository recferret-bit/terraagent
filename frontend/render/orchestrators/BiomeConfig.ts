import { hashGroundSeed } from '@terra/sim/grid/hex';
import type { BirdSpeciesSpec, LandAnimalSpeciesSpec } from '../biosphere/biosphereTypes';
import { DEFAULT_BIRD_GROUPS_PER_SPECIES } from '../biosphere/BirdFlockSim';
import { BIRDS_BY_BIOME, LAND_ANIMALS_BY_BIOME } from '../biosphere/speciesCatalog';
import { PLANET_KINDS, PLANET_SPECS, type PlanetKind, type PlanetSpec } from '../planets/PlanetSpec';
import { GROUND_FLORA_KINDS, GROUND_OBJECT_SPECS, type GroundFloraKind } from '../planets/hex/flora/groundObjectCatalog';
import { HEX_WATER_LEVEL } from '../planets/hex/hexWater';
import {
  BUG_POOL_THRESHOLDS,
  resolveResourceNodePoolThreshold,
  resolveRockNodePoolThreshold,
  resolveTreeNodePoolThreshold,
  scaleCellPoolForRadius,
  type CellPoolSpec,
  type PoolThresholdSpec,
} from '../pools';
import { BREEDS_BY_BIOME, type TreeBreedId } from '../visuals/terrain/treeBreeds';

export type CellPoolConfig = CellPoolSpec;

export interface BiomeOrchestratorConfig {
  readonly version: 1;
  readonly planet: {
    readonly kind: PlanetKind;
    readonly seed: number;
    readonly radius: number;
    readonly edges: number;
  };
  readonly terrain: {
    readonly chunkSize: number;
    readonly dirtyReach: number;
    readonly waterLevel: number;
    readonly generateInWorker: boolean;
  };
  readonly trees: {
    readonly enabled: boolean;
    readonly standPropKind: 'pine' | 'duneTree';
    readonly includeWadiTrees: boolean;
    readonly breeds: readonly TreeBreedId[];
    readonly cellSizeM: number;
    readonly nodePoolThreshold: number;
    readonly pool: CellPoolConfig;
  };
  readonly groundObjects: {
    readonly enabled: boolean;
    readonly floraKinds: readonly Exclude<GroundFloraKind, 'duneTree'>[];
    readonly rockKinds: readonly ('boulder' | 'spire')[];
    readonly cellSizeM: number;
    readonly rockCellSizeM: number;
    readonly rockNodePoolThreshold: number;
    readonly pools: Readonly<Record<string, CellPoolConfig>>;
  };
  readonly resources: {
    readonly enabled: boolean;
    readonly depositKinds: readonly ('metals' | 'minerals' | 'oil')[];
    readonly cellSizeM: number;
    readonly nodePoolThreshold: number;
    readonly pools: Readonly<Record<'metals' | 'minerals' | 'oil', CellPoolConfig>>;
  };
  readonly birds: {
    readonly enabled: boolean;
    readonly groupsPerType: number;
    readonly collisionChecks: false;
    readonly species: readonly BirdSpeciesSpec[];
    readonly pools: Readonly<Record<string, PoolThresholdSpec>>;
  };
  readonly animals: {
    readonly enabled: boolean;
    readonly groupsPerType: number;
    readonly species: readonly LandAnimalSpeciesSpec[];
    readonly pools: Readonly<Record<string, PoolThresholdSpec>>;
  };
  readonly bugs: {
    readonly enabled: boolean;
    readonly speciesIds: readonly string[];
    readonly pools: Readonly<Record<string, PoolThresholdSpec>>;
  };
}

export type BiomeOrchestratorOverrides = Partial<{
  edges: number;
  generateInWorker: boolean;
  birdGroupsPerType: number;
  animalGroupsPerType: number;
}>;

export function floraKindsForBiome(kind: PlanetKind): Exclude<GroundFloraKind, 'duneTree'>[] {
  return GROUND_FLORA_KINDS.filter(
    (fk): fk is Exclude<GroundFloraKind, 'duneTree'> =>
      fk !== 'duneTree' && GROUND_OBJECT_SPECS[fk].biomes.includes(kind),
  );
}

/**
 * Builds the authoritative JSON-serializable `BiomeOrchestratorConfig` scoped strictly to `look.kind`
 * (only loading endemic birds [2 groups/type], endemic mammals, biome tree breeds, and compatible ground objects).
 */
export function buildBiomeOrchestratorConfig(
  look: PlanetSpec,
  radius: number,
  overrides: BiomeOrchestratorOverrides = {},
): BiomeOrchestratorConfig {
  const kind: PlanetKind = PLANET_KINDS.includes(look.kind) ? look.kind : 'forestRock';
  const planetSeed = hashGroundSeed(look.seed, 17);
  const standPropKind = kind === 'dune' ? 'duneTree' : 'pine';
  const floraKinds = floraKindsForBiome(kind);
  const rockKinds = ['boulder', 'spire'] as const;
  const birdGroups = Math.max(1, Math.floor(overrides.birdGroupsPerType ?? DEFAULT_BIRD_GROUPS_PER_SPECIES));
  const animalGroups = Math.max(1, Math.floor(overrides.animalGroupsPerType ?? 2));
  const birdSpecies = BIRDS_BY_BIOME[kind];
  const animalSpecies = LAND_ANIMALS_BY_BIOME[kind];

  const safeRadius = Math.max(1, Math.floor(radius));
  const groundPools: Record<string, CellPoolConfig> = {};
  for (const fk of floraKinds) groundPools[fk] = scaleCellPoolForRadius(fk, safeRadius, 32);
  for (const rk of rockKinds) groundPools[rk] = scaleCellPoolForRadius(rk, safeRadius, 64);

  const birdPools: Record<string, PoolThresholdSpec> = {};
  for (const sp of birdSpecies) {
    const cap = birdGroups * sp.flockSize[1];
    birdPools[sp.id] = { initialSize: cap, threshold: cap, hardCap: true };
  }

  const animalPools: Record<string, PoolThresholdSpec> = {};
  for (const sp of animalSpecies) {
    const cap = Math.max(1, animalGroups * sp.groupSize[1]);
    animalPools[sp.id] = { initialSize: cap, threshold: cap, hardCap: true };
  }

  return {
    version: 1,
    planet: {
      kind,
      seed: planetSeed,
      radius: safeRadius,
      edges: overrides.edges ?? 0.55,
    },
    terrain: {
      chunkSize: 32,
      dirtyReach: 3,
      waterLevel: HEX_WATER_LEVEL,
      generateInWorker: overrides.generateInWorker ?? true,
    },
    trees: {
      enabled: true,
      standPropKind,
      includeWadiTrees: kind === 'dune',
      breeds: BREEDS_BY_BIOME[kind].map((b) => b.id),
      cellSizeM: 32,
      nodePoolThreshold: resolveTreeNodePoolThreshold(safeRadius),
      pool: scaleCellPoolForRadius(standPropKind, safeRadius, 32),
    },
    groundObjects: {
      enabled: true,
      floraKinds,
      rockKinds,
      cellSizeM: 32,
      rockCellSizeM: 64,
      rockNodePoolThreshold: resolveRockNodePoolThreshold(safeRadius),
      pools: groundPools,
    },
    resources: {
      enabled: true,
      depositKinds: ['metals', 'minerals', 'oil'],
      cellSizeM: 64,
      nodePoolThreshold: resolveResourceNodePoolThreshold(safeRadius),
      pools: {
        metals: scaleCellPoolForRadius('metals', safeRadius, 64),
        minerals: scaleCellPoolForRadius('minerals', safeRadius, 64),
        oil: scaleCellPoolForRadius('oil', safeRadius, 64),
      },
    },
    birds: {
      enabled: true,
      groupsPerType: birdGroups,
      collisionChecks: false,
      species: birdSpecies,
      pools: birdPools,
    },
    animals: {
      enabled: true,
      groupsPerType: animalGroups,
      species: animalSpecies,
      pools: animalPools,
    },
    bugs: {
      enabled: true,
      speciesIds: Object.keys(BUG_POOL_THRESHOLDS),
      pools: { ...BUG_POOL_THRESHOLDS },
    },
  };
}

export function serializeBiomeOrchestratorConfig(config: BiomeOrchestratorConfig): string {
  return JSON.stringify(config);
}

/**
 * Parses and validates a JSON string or object into a complete, biome-filtered `BiomeOrchestratorConfig`.
 */
export function parseBiomeOrchestratorConfig(input: string | Partial<BiomeOrchestratorConfig>): BiomeOrchestratorConfig {
  const raw: Partial<BiomeOrchestratorConfig> =
    typeof input === 'string' ? (JSON.parse(input) as Partial<BiomeOrchestratorConfig>) : input;
  if (!raw || typeof raw !== 'object' || !raw.planet) {
    throw new Error('Invalid BiomeOrchestrator JSON config: missing "planet" block');
  }
  const kind: PlanetKind = PLANET_KINDS.includes(raw.planet.kind as PlanetKind) ? raw.planet.kind : 'forestRock';
  const baseSpec: PlanetSpec = {
    ...PLANET_SPECS[kind],
    seed: typeof raw.planet.seed === 'number' && Number.isFinite(raw.planet.seed) ? raw.planet.seed : PLANET_SPECS[kind].seed,
  };
  const defaults = buildBiomeOrchestratorConfig(baseSpec, raw.planet.radius ?? 16, {
    edges: raw.planet.edges,
    generateInWorker: raw.terrain?.generateInWorker,
    birdGroupsPerType: raw.birds?.groupsPerType,
    animalGroupsPerType: raw.animals?.groupsPerType,
  });

  // Enforce planet-biome exclusivity even when partial custom JSON overrides are supplied.
  const validBirdIds = new Set(BIRDS_BY_BIOME[kind].map((s) => s.id));
  const validAnimalIds = new Set(LAND_ANIMALS_BY_BIOME[kind].map((s) => s.id));
  const validFlora = new Set<string>(floraKindsForBiome(kind));
  const validRocks = new Set<string>(['boulder', 'spire']);
  const validDeposits = new Set<string>(['metals', 'minerals', 'oil']);
  const validBugIds = new Set<string>(Object.keys(BUG_POOL_THRESHOLDS));

  const birdGroups = defaults.birds.groupsPerType;
  const birdSpecies = (raw.birds?.species ?? defaults.birds.species).filter((s) => validBirdIds.has(s.id));
  const birdPools: Record<string, PoolThresholdSpec> = {};
  for (const sp of birdSpecies) {
    const cap = Math.max(1, birdGroups * sp.flockSize[1]);
    birdPools[sp.id] = raw.birds?.pools?.[sp.id] ?? { initialSize: cap, threshold: cap, hardCap: true };
  }

  const animalGroups = defaults.animals.groupsPerType;
  const animalSpecies = (raw.animals?.species ?? defaults.animals.species).filter((s) => validAnimalIds.has(s.id));
  const animalPools: Record<string, PoolThresholdSpec> = {};
  for (const sp of animalSpecies) {
    const cap = Math.max(1, animalGroups * sp.groupSize[1]);
    animalPools[sp.id] = raw.animals?.pools?.[sp.id] ?? { initialSize: cap, threshold: cap, hardCap: true };
  }

  const bugSpeciesIds = (raw.bugs?.speciesIds ?? defaults.bugs.speciesIds).filter((id) => validBugIds.has(id));
  const bugPools: Record<string, PoolThresholdSpec> = {};
  for (const id of bugSpeciesIds) {
    bugPools[id] = raw.bugs?.pools?.[id] ?? defaults.bugs.pools[id]!;
  }

  return {
    ...defaults,
    planet: { ...defaults.planet },
    terrain: { ...defaults.terrain, ...(raw.terrain ?? {}) },
    trees: { ...defaults.trees, ...(raw.trees ?? {}), standPropKind: defaults.trees.standPropKind, breeds: defaults.trees.breeds },
    groundObjects: {
      ...defaults.groundObjects,
      ...(raw.groundObjects ?? {}),
      floraKinds: (raw.groundObjects?.floraKinds ?? defaults.groundObjects.floraKinds).filter((k) => validFlora.has(k)),
      rockKinds: (raw.groundObjects?.rockKinds ?? defaults.groundObjects.rockKinds).filter(
        (k): k is 'boulder' | 'spire' => validRocks.has(k),
      ),
      pools: { ...defaults.groundObjects.pools, ...(raw.groundObjects?.pools ?? {}) },
    },
    resources: {
      ...defaults.resources,
      ...(raw.resources ?? {}),
      depositKinds: (raw.resources?.depositKinds ?? defaults.resources.depositKinds).filter(
        (k): k is 'metals' | 'minerals' | 'oil' => validDeposits.has(k),
      ),
      pools: { ...defaults.resources.pools, ...(raw.resources?.pools ?? {}) },
    },
    birds: {
      ...defaults.birds,
      ...(raw.birds ?? {}),
      groupsPerType: birdGroups,
      collisionChecks: false,
      species: birdSpecies,
      pools: birdPools,
    },
    animals: {
      ...defaults.animals,
      ...(raw.animals ?? {}),
      groupsPerType: animalGroups,
      species: animalSpecies,
      pools: animalPools,
    },
    bugs: {
      ...defaults.bugs,
      ...(raw.bugs ?? {}),
      speciesIds: bugSpeciesIds,
      pools: bugPools,
    },
  };
}
