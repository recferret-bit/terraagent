import {
  RESOURCE_KEYS,
  T1_RESOURCE_KEYS,
  type PlanetType,
  type ResourceInheritanceSource,
  type ResourceKey,
} from '@terra/contracts';
import type {
  RegionalResourceLayerPatch,
  RegionalResourceMap,
  RegionalResourceSourceLayer,
} from './regionalResourceTypes';

export const CANONICAL_RESOURCE_KEYS: readonly ResourceKey[] = RESOURCE_KEYS;

export const STARTER_ELIGIBLE_T1_RESOURCE_KEYS: readonly ResourceKey[] = T1_RESOURCE_KEYS;

export const ESSENTIAL_T1_STARTER_DEPOSIT_KEYS: readonly ResourceKey[] = [
  'metals.t1',
  'minerals.t1',
] as const;

export const T2_RESOURCE_KEYS: readonly ResourceKey[] = [
  'metals.t2',
  'minerals.t2',
  'bio.t2',
] as const;

export const T3_RESOURCE_KEYS: readonly ResourceKey[] = [
  'metals.t3',
  'minerals.t3',
  'bio.t3',
] as const;

export const W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000 = 12;

export const SOURCE_LAYER_TO_CONTRACT: Readonly<
  Record<RegionalResourceSourceLayer, ResourceInheritanceSource>
> = {
  global_default: 'global',
  planet_type: 'planetType',
  planet_id: 'planetId',
  sector_archetype: 'sectorArchetype',
  sector_id: 'sectorId',
};

export const CONTRACT_TO_SOURCE_LAYER: Readonly<
  Record<ResourceInheritanceSource, RegionalResourceSourceLayer>
> = {
  global: 'global_default',
  planetType: 'planet_type',
  planetId: 'planet_id',
  sectorArchetype: 'sector_archetype',
  sectorId: 'sector_id',
};

export function toContractSourceLayer(
  layer: RegionalResourceSourceLayer,
): ResourceInheritanceSource {
  return SOURCE_LAYER_TO_CONTRACT[layer];
}

export function fromContractSourceLayer(
  source: ResourceInheritanceSource,
): RegionalResourceSourceLayer {
  return CONTRACT_TO_SOURCE_LAYER[source];
}

const RESOURCE_KEY_ALIASES: Readonly<Record<string, ResourceKey>> = {
  'metals.t1': 'metals.t1',
  'metals.t2': 'metals.t2',
  'metals.t3': 'metals.t3',
  'minerals.t1': 'minerals.t1',
  'minerals.t2': 'minerals.t2',
  'minerals.t3': 'minerals.t3',
  'bio.water': 'bio.water',
  'bio.biomass': 'bio.biomass',
  'bio.t2': 'bio.t2',
  'bio.t3': 'bio.t3',
  'water.t1': 'bio.water',
  'biomass.t1': 'bio.biomass',
  'oil.t2': 'bio.t2',
  'crystals.t3': 'minerals.t3',
  'crystal.t3': 'minerals.t3',
  'iron.t1': 'metals.t1',
  'silica.t1': 'minerals.t1',
};

export function normalizeRegionalResourceKey(key: string): ResourceKey | null {
  return RESOURCE_KEY_ALIASES[key] ?? null;
}

export function isT1StarterEligibleResource(key: ResourceKey): boolean {
  return (STARTER_ELIGIBLE_T1_RESOURCE_KEYS as readonly string[]).includes(key);
}

export function isT3Resource(key: ResourceKey): boolean {
  return (T3_RESOURCE_KEYS as readonly string[]).includes(key);
}

/**
 * Layer 1 (`global_default`) baseline across all 10 canonical `ResourceKey`s (`ECON-GEO-01`).
 */
export const GLOBAL_DEFAULT_RESOURCE_MAP: RegionalResourceMap = {
  'metals.t1': {
    occurrenceWeightBp: 100,
    reserveUnitsMin: 800,
    reserveUnitsMax: 1400,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 100,
    starterGuarantee: true,
  },
  'metals.t2': {
    occurrenceWeightBp: 55,
    reserveUnitsMin: 500,
    reserveUnitsMax: 900,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 55,
    starterGuarantee: false,
  },
  'metals.t3': {
    occurrenceWeightBp: 25,
    reserveUnitsMin: 250,
    reserveUnitsMax: 500,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 25,
    starterGuarantee: false,
  },
  'minerals.t1': {
    occurrenceWeightBp: 100,
    reserveUnitsMin: 800,
    reserveUnitsMax: 1400,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 100,
    starterGuarantee: true,
  },
  'minerals.t2': {
    occurrenceWeightBp: 55,
    reserveUnitsMin: 500,
    reserveUnitsMax: 900,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 55,
    starterGuarantee: false,
  },
  'minerals.t3': {
    occurrenceWeightBp: 30,
    reserveUnitsMin: 200,
    reserveUnitsMax: 450,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 30,
    starterGuarantee: false,
  },
  'bio.water': {
    occurrenceWeightBp: 100,
    reserveUnitsMin: 600,
    reserveUnitsMax: 1200,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 120,
    terraformFindWeightBp: 80,
    starterGuarantee: true,
  },
  'bio.biomass': {
    occurrenceWeightBp: 100,
    reserveUnitsMin: 500,
    reserveUnitsMax: 1000,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 90,
    terraformFindWeightBp: 90,
    starterGuarantee: true,
  },
  'bio.t2': {
    occurrenceWeightBp: 70,
    reserveUnitsMin: 600,
    reserveUnitsMax: 1100,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 65,
    starterGuarantee: false,
  },
  'bio.t3': {
    occurrenceWeightBp: 25,
    reserveUnitsMin: 220,
    reserveUnitsMax: 450,
    extractionYieldBp: 10000,
    renewableUnitsPerSimHour: 0,
    terraformFindWeightBp: 25,
    starterGuarantee: false,
  },
};

export const GLOBAL_DEFAULT_RESOURCE_PATCH: RegionalResourceLayerPatch = {
  profileId: 'w11-global-default-v1',
  depositDensityPer1000Tiles: W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000,
  resources: GLOBAL_DEFAULT_RESOURCE_MAP,
};

/**
 * Layer 2 (`planet_type`) presets from `ECONOMY.md` §2.2 (`ECON-GEO-01`):
 * - `desert`: Iron (`metals.t1`) 150, Silica (`minerals.t1`) 160, Water (`bio.water`) 30, Biomass (`bio.biomass`) 20, Exotic crystal (`minerals.t3`) 15.
 * - `ocean`: Iron 60, Silica 80, Water 180, Biomass 150, Exotic crystal 60.
 * - `temperate`: Iron 100, Silica 120, Water 110, Biomass 100, Exotic crystal 100.
 */
export const PLANET_TYPE_RESOURCE_PRESETS: Readonly<
  Record<PlanetType, RegionalResourceLayerPatch>
> = {
  desert: {
    profileId: 'w11-bootstrap-desert-v1',
    depositDensityPer1000Tiles: W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000,
    resources: {
      'metals.t1': {
        occurrenceWeightBp: 150,
        reserveUnitsMin: 1150,
        reserveUnitsMax: 1850,
        extractionYieldBp: 12000,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 150,
        starterGuarantee: true,
      },
      'metals.t2': {
        occurrenceWeightBp: 70,
        terraformFindWeightBp: 70,
      },
      'minerals.t1': {
        occurrenceWeightBp: 160,
        reserveUnitsMin: 950,
        reserveUnitsMax: 1550,
        extractionYieldBp: 11000,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 160,
        starterGuarantee: true,
      },
      'minerals.t2': {
        occurrenceWeightBp: 65,
        terraformFindWeightBp: 65,
      },
      'minerals.t3': {
        occurrenceWeightBp: 15,
        reserveUnitsMin: 150,
        reserveUnitsMax: 320,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 15,
        starterGuarantee: false,
      },
      'bio.water': {
        occurrenceWeightBp: 30,
        reserveUnitsMin: 300,
        reserveUnitsMax: 600,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 35,
        terraformFindWeightBp: 25,
        starterGuarantee: true,
      },
      'bio.biomass': {
        occurrenceWeightBp: 20,
        reserveUnitsMin: 250,
        reserveUnitsMax: 500,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 20,
        terraformFindWeightBp: 20,
        starterGuarantee: false,
      },
      'bio.t2': {
        occurrenceWeightBp: 110,
        reserveUnitsMin: 700,
        reserveUnitsMax: 1250,
        extractionYieldBp: 11000,
        terraformFindWeightBp: 105,
      },
      'bio.t3': {
        occurrenceWeightBp: 15,
        terraformFindWeightBp: 15,
      },
    },
  },
  ocean: {
    profileId: 'w11-bootstrap-ocean-v1',
    depositDensityPer1000Tiles: W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000,
    resources: {
      'metals.t1': {
        occurrenceWeightBp: 60,
        reserveUnitsMin: 650,
        reserveUnitsMax: 1150,
        extractionYieldBp: 9500,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 60,
        starterGuarantee: true,
      },
      'metals.t2': {
        occurrenceWeightBp: 45,
        terraformFindWeightBp: 45,
      },
      'minerals.t1': {
        occurrenceWeightBp: 80,
        reserveUnitsMin: 750,
        reserveUnitsMax: 1250,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 80,
        starterGuarantee: true,
      },
      'minerals.t2': {
        occurrenceWeightBp: 50,
        terraformFindWeightBp: 50,
      },
      'minerals.t3': {
        occurrenceWeightBp: 60,
        reserveUnitsMin: 220,
        reserveUnitsMax: 460,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 60,
        starterGuarantee: false,
      },
      'bio.water': {
        occurrenceWeightBp: 180,
        reserveUnitsMin: 900,
        reserveUnitsMax: 1600,
        extractionYieldBp: 12000,
        renewableUnitsPerSimHour: 240,
        terraformFindWeightBp: 180,
        starterGuarantee: true,
      },
      'bio.biomass': {
        occurrenceWeightBp: 150,
        reserveUnitsMin: 750,
        reserveUnitsMax: 1350,
        extractionYieldBp: 11500,
        renewableUnitsPerSimHour: 180,
        terraformFindWeightBp: 150,
        starterGuarantee: true,
      },
      'bio.t2': {
        occurrenceWeightBp: 65,
        terraformFindWeightBp: 65,
      },
      'bio.t3': {
        occurrenceWeightBp: 40,
        terraformFindWeightBp: 40,
      },
    },
  },
  temperate: {
    profileId: 'w11-bootstrap-temperate-v1',
    depositDensityPer1000Tiles: W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000,
    resources: {
      'metals.t1': {
        occurrenceWeightBp: 100,
        reserveUnitsMin: 850,
        reserveUnitsMax: 1450,
        extractionYieldBp: 10500,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 100,
        starterGuarantee: true,
      },
      'metals.t2': {
        occurrenceWeightBp: 60,
        terraformFindWeightBp: 60,
      },
      'minerals.t1': {
        occurrenceWeightBp: 120,
        reserveUnitsMin: 950,
        reserveUnitsMax: 1550,
        extractionYieldBp: 11000,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 120,
        starterGuarantee: true,
      },
      'minerals.t2': {
        occurrenceWeightBp: 65,
        terraformFindWeightBp: 65,
      },
      'minerals.t3': {
        occurrenceWeightBp: 100,
        reserveUnitsMin: 280,
        reserveUnitsMax: 540,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 0,
        terraformFindWeightBp: 100,
        starterGuarantee: false,
      },
      'bio.water': {
        occurrenceWeightBp: 110,
        reserveUnitsMin: 650,
        reserveUnitsMax: 1150,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 120,
        terraformFindWeightBp: 110,
        starterGuarantee: true,
      },
      'bio.biomass': {
        occurrenceWeightBp: 100,
        reserveUnitsMin: 600,
        reserveUnitsMax: 1100,
        extractionYieldBp: 10000,
        renewableUnitsPerSimHour: 100,
        terraformFindWeightBp: 100,
        starterGuarantee: true,
      },
      'bio.t2': {
        occurrenceWeightBp: 75,
        terraformFindWeightBp: 75,
      },
      'bio.t3': {
        occurrenceWeightBp: 30,
        terraformFindWeightBp: 30,
      },
    },
  },
};

/**
 * Illustrative sector-archetype overrides (`ECONOMY.md` §2.2 `desert_crystal_ridge` with crystal weight 80).
 * Notice `'heartland'` and `'frontier'` are absent here so baseline sectors inherit their planet-type profile untouched.
 */
export const DESERT_CRYSTAL_RIDGE_OVERRIDE: RegionalResourceLayerPatch = {
  profileId: 'desert_crystal_ridge',
  resources: {
    'minerals.t3': {
      occurrenceWeightBp: 80,
      reserveUnitsMin: 300,
      reserveUnitsMax: 620,
      terraformFindWeightBp: 80,
      starterGuarantee: false,
    },
  },
};

export const SECTOR_ARCHETYPE_RESOURCE_OVERRIDES: Readonly<
  Record<string, RegionalResourceLayerPatch>
> = {
  desert_crystal_ridge: DESERT_CRYSTAL_RIDGE_OVERRIDE,
  'desert-crystal-ridge': DESERT_CRYSTAL_RIDGE_OVERRIDE,
  crystal_ridge: DESERT_CRYSTAL_RIDGE_OVERRIDE,
};

export const BOOTSTRAP_NAMED_RESOURCE_PROFILES: Readonly<
  Record<string, RegionalResourceLayerPatch>
> = {
  'w11-global-default-v1': GLOBAL_DEFAULT_RESOURCE_PATCH,
  'w11-bootstrap-desert-v1': PLANET_TYPE_RESOURCE_PRESETS.desert,
  'w11-bootstrap-ocean-v1': PLANET_TYPE_RESOURCE_PRESETS.ocean,
  'w11-bootstrap-temperate-v1': PLANET_TYPE_RESOURCE_PRESETS.temperate,
  desert_crystal_ridge: DESERT_CRYSTAL_RIDGE_OVERRIDE,
  'desert-crystal-ridge': DESERT_CRYSTAL_RIDGE_OVERRIDE,
  crystal_ridge: DESERT_CRYSTAL_RIDGE_OVERRIDE,
};
