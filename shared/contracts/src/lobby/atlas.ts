import { z } from 'zod';
import { HomePlanetId } from '../rest/home';
import { PlanetType, ResourceKey, TileCoord } from '../ws/sim';

/** Planet visual look (D-33): 1-to-1 with PlanetType (`desert` ↔ `dune`, `ocean` ↔ `oceanForest`, `temperate` ↔ `forestRock`). */
export const PLANET_LOOKS = ['dune', 'oceanForest', 'forestRock'] as const;
export const PlanetLookSchema = z.enum(PLANET_LOOKS);
export type PlanetLook = z.infer<typeof PlanetLookSchema>;

export const PLANET_LOOK_FOR_TYPE: Readonly<Record<PlanetType, PlanetLook>> = {
  desert: 'dune',
  ocean: 'oceanForest',
  temperate: 'forestRock',
};

export const PLANET_TYPE_FOR_LOOK: Readonly<Record<PlanetLook, PlanetType>> = {
  dune: 'desert',
  oceanForest: 'ocean',
  forestRock: 'temperate',
};

export const planetLookForType = (type: PlanetType): PlanetLook => PLANET_LOOK_FOR_TYPE[type];
export const planetTypeForLook = (look: PlanetLook): PlanetType => PLANET_TYPE_FOR_LOOK[look];

/**
 * Canonical persistent worlds (MATCHMAKING §0, D-12 amendment, D-33):
 * Exactly three canonical worlds exist, one per PlanetType. Their IDs are valid ULID-shaped `pl_` identifiers
 * (`PlanetId` and `HomePlanetId`) and never rotate or create overflow instances.
 */
export interface CanonicalPlanetDef {
  readonly id: string;
  readonly name: string;
  readonly type: PlanetType;
  readonly look: PlanetLook;
  readonly seed: string;
}

export const CANONICAL_PLANETS: Readonly<Record<PlanetType, CanonicalPlanetDef>> = {
  desert: {
    id: 'pl_01JKHAR0NDVNEST00000000000',
    name: 'Kharon Dunes',
    type: 'desert',
    look: 'dune',
    seed: 'w11-kharon-dunes-v1',
  },
  ocean: {
    id: 'pl_01JTHA1ASSAVERDE0000000001',
    name: 'Thalassa Verde',
    type: 'ocean',
    look: 'oceanForest',
    seed: 'w11-thalassa-verde-v1',
  },
  temperate: {
    id: 'pl_01JGRAN1TEH0110W0000000002',
    name: 'Granite Hollow',
    type: 'temperate',
    look: 'forestRock',
    seed: 'w11-granite-hollow-v1',
  },
} as const;

export const CANONICAL_PLANET_LIST: readonly CanonicalPlanetDef[] = [
  CANONICAL_PLANETS.desert,
  CANONICAL_PLANETS.ocean,
  CANONICAL_PLANETS.temperate,
] as const;

export const CANONICAL_PLANET_IDS: readonly [string, string, string] = [
  CANONICAL_PLANETS.desert.id,
  CANONICAL_PLANETS.ocean.id,
  CANONICAL_PLANETS.temperate.id,
] as const;

export const CanonicalPlanetIdSchema = z.enum(CANONICAL_PLANET_IDS);
export type CanonicalPlanetId = z.infer<typeof CanonicalPlanetIdSchema>;

export const canonicalPlanetForType = (type: PlanetType): CanonicalPlanetDef => CANONICAL_PLANETS[type];

export function canonicalPlanetById(id: string): CanonicalPlanetDef | null {
  return CANONICAL_PLANET_LIST.find((p) => p.id === id) ?? null;
}

export function isCanonicalPlanetId(id: string): id is CanonicalPlanetId {
  return canonicalPlanetById(id) !== null;
}

/**
 * Stable canonical gameplay sector ID: `sec_<macroQ>_<macroR>` (e.g. `sec_0_0`, `sec_-1_1`).
 * Gameplay sectors are distinct from the 8x8 internal storage buckets (`SECTOR_TILES`).
 */
export const SECTOR_ID_REGEX = /^sec_(-?\d+)_(-?\d+)$/;
export type SectorId = string;
export const SectorIdSchema = z
  .string()
  .regex(SECTOR_ID_REGEX, 'expected canonical sector id like sec_0_0 or sec_-1_1')
  .refine((s: string): boolean => {
    const parsed = parseSectorId(s);
    return parsed !== null && formatSectorId(parsed.macroQ, parsed.macroR) === s;
  }, 'sector coordinates must be canonical integers without leading zeros');

export function formatSectorId(macroQ: number, macroR: number): SectorId {
  if (!Number.isInteger(macroQ) || !Number.isInteger(macroR)) {
    throw new RangeError(`sector macro coordinates must be integers, got (${macroQ}, ${macroR})`);
  }
  return `sec_${macroQ === 0 ? 0 : macroQ}_${macroR === 0 ? 0 : macroR}`;
}

export function parseSectorId(sectorId: string): { macroQ: number; macroR: number } | null {
  const m = SECTOR_ID_REGEX.exec(sectorId);
  if (!m) return null;
  const macroQ = Number(m[1]);
  const macroR = Number(m[2]);
  if (!Number.isSafeInteger(macroQ) || !Number.isSafeInteger(macroR)) return null;
  if (`sec_${macroQ === 0 ? 0 : macroQ}_${macroR === 0 ? 0 : macroR}` !== sectorId) return null;
  return { macroQ, macroR };
}

/** Stable continent ID (`cont_0`, `cont_main`, etc.). */
export const CONTINENT_ID_REGEX = /^cont_[a-z0-9][a-z0-9_-]{0,31}$/;
export const ContinentIdSchema = z.string().regex(CONTINENT_ID_REGEX, 'expected continent id like cont_0');
export type ContinentId = z.infer<typeof ContinentIdSchema>;

export function formatContinentId(key: number | string): ContinentId {
  const s = `cont_${String(key).trim().toLowerCase()}`;
  return ContinentIdSchema.parse(s);
}

/** Stable landing slot ID inside a sector: `slot_<sectorId>_<slotIndex>` (e.g. `slot_sec_0_0_0`). */
export const LANDING_SLOT_ID_REGEX = /^slot_(sec_-?\d+_-?\d+)_(\d+)$/;
export type LandingSlotId = string;
export const LandingSlotIdSchema = z
  .string()
  .regex(LANDING_SLOT_ID_REGEX, 'expected landing slot id like slot_sec_0_0_0')
  .refine((s: string): boolean => {
    const parsed = parseLandingSlotId(s);
    return parsed !== null && formatLandingSlotId(parsed.sectorId, parsed.slotIndex) === s;
  }, 'landing slot id must use canonical sector id and non-negative integer index');

export function formatLandingSlotId(sectorId: SectorId, slotIndex: number): LandingSlotId {
  const sec = parseSectorId(sectorId);
  if (!sec) throw new RangeError(`invalid sectorId "${sectorId}"`);
  if (!Number.isInteger(slotIndex) || slotIndex < 0) {
    throw new RangeError(`slotIndex must be a non-negative integer, got ${slotIndex}`);
  }
  return `slot_${formatSectorId(sec.macroQ, sec.macroR)}_${slotIndex}`;
}

export function parseLandingSlotId(
  slotId: string,
): { sectorId: SectorId; macroQ: number; macroR: number; slotIndex: number } | null {
  const m = LANDING_SLOT_ID_REGEX.exec(slotId);
  if (!m) return null;
  const sec = parseSectorId(m[1]!);
  if (!sec) return null;
  const slotIndex = Number(m[2]!);
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0 || String(slotIndex) !== m[2]) return null;
  return {
    sectorId: formatSectorId(sec.macroQ, sec.macroR),
    macroQ: sec.macroQ,
    macroR: sec.macroR,
    slotIndex,
  };
}

/** W11 small-world planning fixture defaults and rollout bounds (W11 contract, WE-33). */
export const W11_DEFAULT_SECTOR_RADIUS = 48;
export const W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR = 4;
export const W11_SUPPORTED_FOUNDING_SEATS = [3, 4, 5] as const;
export const W11_DEFAULT_LAND_SECTORS = 7;
export const W11_SEVEN_SECTOR_COORDS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
] as const;
export const W11_MAX_SMALL_ATLAS_SECTORS = 19;
export const W11_MAX_SMALL_ATLAS_TILES = 140_000;
export const W11_MAX_SMALL_ATLAS_COLONIES = 64;

export const SectorKindSchema = z.enum(['land', 'ocean']);
export type SectorKind = z.infer<typeof SectorKindSchema>;

export const SafeLandingSlotV1Schema = z.strictObject({
  slotId: LandingSlotIdSchema,
  sectorId: SectorIdSchema,
  slotIndex: z.number().int().nonnegative(),
  q: TileCoord,
  r: TileCoord,
});
export type SafeLandingSlotV1 = z.infer<typeof SafeLandingSlotV1Schema>;

export const SectorNeighbourV1Schema = z.strictObject({
  dir: z.number().int().min(0).max(5),
  macroQ: z.number().int(),
  macroR: z.number().int(),
  sectorId: SectorIdSchema.nullable(),
});
export type SectorNeighbourV1 = z.infer<typeof SectorNeighbourV1Schema>;

/** Regional resource endowment metadata pinned in atlas/sector manifests (W11-46, ECONOMY §2.2). */
export const ResourceInheritanceSourceSchema = z.enum([
  'global',
  'planetType',
  'planetId',
  'sectorArchetype',
  'sectorId',
]);
export type ResourceInheritanceSource = z.infer<typeof ResourceInheritanceSourceSchema>;

export const RegionalResourceManifestHookV1Schema = z.strictObject({
  profileId: z.string().min(1).max(64),
  endowmentHash: z.string().min(1).max(128),
  sourceLayer: ResourceInheritanceSourceSchema,
  depositDensityPer1000Tiles: z.number().nonnegative(),
  mainResource: ResourceKey.optional(),
  scarceResources: z.array(ResourceKey).optional(),
  sourceAttribution: z.record(ResourceKey, ResourceInheritanceSourceSchema).optional(),
});
export type RegionalResourceManifestHookV1 = z.infer<typeof RegionalResourceManifestHookV1Schema>;

export const SectorConfigV1Schema = z
  .strictObject({
    sectorId: SectorIdSchema,
    continentId: ContinentIdSchema.nullable(),
    macroQ: z.number().int(),
    macroR: z.number().int(),
    kind: SectorKindSchema,
    radius: z.number().int().min(8).max(96),
    foundingCapacity: z.number().int().min(0).max(16),
    archetype: z.string().min(1).max(64).optional(),
    resourceProfileId: z.string().min(1).max(64).optional(),
  })
  .superRefine((sec, ctx) => {
    const expectedId = formatSectorId(sec.macroQ, sec.macroR);
    if (sec.sectorId !== expectedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectorId'],
        message: `sectorId "${sec.sectorId}" does not match macro coordinates (${sec.macroQ}, ${sec.macroR})`,
      });
    }
    if (sec.kind === 'ocean' && sec.foundingCapacity !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['foundingCapacity'],
        message: 'ocean sectors cannot have founding capacity',
      });
    }
    if (sec.kind === 'land' && sec.continentId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['continentId'],
        message: 'land sectors must belong to a continentId',
      });
    }
  });
export type SectorConfigV1 = z.infer<typeof SectorConfigV1Schema>;

export const SectorManifestV1Schema = z
  .strictObject({
    sectorId: SectorIdSchema,
    continentId: ContinentIdSchema.nullable(),
    macroQ: z.number().int(),
    macroR: z.number().int(),
    centerQ: TileCoord,
    centerR: TileCoord,
    kind: SectorKindSchema,
    radius: z.number().int().min(8).max(96),
    tileCount: z.number().int().positive(),
    foundingCapacity: z.number().int().min(0).max(16),
    validatedSafeSites: z.number().int().min(0).max(16),
    safeLandingSlots: z.array(SafeLandingSlotV1Schema),
    neighbours: z.array(SectorNeighbourV1Schema).length(6),
    resourceEndowment: RegionalResourceManifestHookV1Schema.optional(),
  })
  .superRefine((sec, ctx) => {
    if (sec.sectorId !== formatSectorId(sec.macroQ, sec.macroR)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sectorId'],
        message: `sectorId "${sec.sectorId}" does not match (${sec.macroQ}, ${sec.macroR})`,
      });
    }
    if (sec.kind === 'ocean' && (sec.foundingCapacity !== 0 || sec.validatedSafeSites !== 0 || sec.safeLandingSlots.length !== 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['foundingCapacity'],
        message: 'ocean sectors have zero founding seats and zero safe landing slots',
      });
    }
    if (sec.validatedSafeSites !== sec.safeLandingSlots.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validatedSafeSites'],
        message: 'validatedSafeSites must equal safeLandingSlots.length',
      });
    }
    if (sec.validatedSafeSites > sec.foundingCapacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validatedSafeSites'],
        message: 'validatedSafeSites cannot exceed foundingCapacity',
      });
    }
    for (let i = 0; i < sec.safeLandingSlots.length; i++) {
      const slot = sec.safeLandingSlots[i]!;
      if (slot.sectorId !== sec.sectorId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['safeLandingSlots', i, 'sectorId'],
          message: `landing slot ${slot.slotId} belongs to ${slot.sectorId}, expected ${sec.sectorId}`,
        });
      }
    }
  });
export type SectorManifestV1 = z.infer<typeof SectorManifestV1Schema>;

export const AtlasBoundsV1Schema = z.strictObject({
  minQ: TileCoord,
  maxQ: TileCoord,
  minR: TileCoord,
  maxR: TileCoord,
  totalTiles: z.number().int().positive(),
  maxColonies: z.number().int().positive(),
  maxSectors: z.number().int().positive(),
});
export type AtlasBoundsV1 = z.infer<typeof AtlasBoundsV1Schema>;

export const AtlasConfigV1Schema = z
  .strictObject({
    planetId: HomePlanetId,
    planetType: PlanetType,
    seed: z.string().min(1).max(128),
    topologyVersion: z.number().int().positive(),
    genVersion: z.number().int().positive(),
    configVersion: z.number().int().positive(),
    sectorRadius: z.number().int().min(8).max(96),
    foundingSeatsPerSector: z.number().int().min(1).max(16),
    sectors: z.array(SectorConfigV1Schema).min(1),
    resourceProfileId: z.string().min(1).max(64).optional(),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < cfg.sectors.length; i++) {
      const s = cfg.sectors[i]!;
      if (seen.has(s.sectorId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sectors', i, 'sectorId'],
          message: `duplicate sectorId "${s.sectorId}" in atlas config`,
        });
      }
      seen.add(s.sectorId);
    }
  });
export type AtlasConfigV1 = z.infer<typeof AtlasConfigV1Schema>;

export const AtlasManifestV1Schema = z
  .strictObject({
    planetId: HomePlanetId,
    planetType: PlanetType,
    look: PlanetLookSchema,
    seed: z.string().min(1).max(128),
    atlasVersion: z.number().int().positive(),
    topologyVersion: z.number().int().positive(),
    genVersion: z.number().int().positive(),
    configVersion: z.number().int().positive(),
    configHash: z.string().min(1).max(128),
    atlasHash: z.string().min(1).max(128),
    resourceProfileId: z.string().min(1).max(64),
    resourceProfileHash: z.string().min(1).max(128),
    sectorRadius: z.number().int().min(8).max(96),
    foundingSeatsPerSector: z.number().int().min(1).max(16),
    totalSectors: z.number().int().positive(),
    landSectors: z.number().int().positive(),
    oceanSectors: z.number().int().nonnegative(),
    nominalCapacity: z.number().int().nonnegative(),
    validatedCapacity: z.number().int().nonnegative(),
    bounds: AtlasBoundsV1Schema,
    sectors: z.array(SectorManifestV1Schema).min(1),
  })
  .superRefine((m, ctx) => {
    if (m.look !== planetLookForType(m.planetType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['look'],
        message: `look "${m.look}" does not match planetType "${m.planetType}"`,
      });
    }
    if (m.totalSectors !== m.sectors.length || m.landSectors + m.oceanSectors !== m.totalSectors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalSectors'],
        message: 'totalSectors must equal sectors.length and landSectors + oceanSectors',
      });
    }
    const sumNominal = m.sectors.reduce((acc, s) => acc + s.foundingCapacity, 0);
    const sumValidated = m.sectors.reduce((acc, s) => acc + s.validatedSafeSites, 0);
    if (m.nominalCapacity !== sumNominal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nominalCapacity'],
        message: `nominalCapacity (${m.nominalCapacity}) must equal sum of sector foundingCapacity (${sumNominal})`,
      });
    }
    if (m.validatedCapacity !== sumValidated) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validatedCapacity'],
        message: `validatedCapacity (${m.validatedCapacity}) must equal sum of sector validatedSafeSites (${sumValidated})`,
      });
    }
  });
export type AtlasManifestV1 = z.infer<typeof AtlasManifestV1Schema>;
