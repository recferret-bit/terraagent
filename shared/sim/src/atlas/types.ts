import {
  W11_SEVEN_SECTOR_COORDS,
  type AtlasConfigV1,
  type AtlasManifestV1,
  type ContinentId,
  type RegionalResourceManifestHookV1,
  type ResourceKey,
  type SafeLandingSlotV1,
  type SectorId,
  type SectorKind,
  type SectorNeighbourV1,
} from '@terra/contracts';
import type { PlanetType } from '../kernel/state';
import type { AtlasLandingValidationReport, ValidateAtlasLandingSitesOptions } from './landingTypes';
import type {
  RegionalResourceLayerPatch,
  RegionalResourceResolutionConfig,
  ResolvedAtlasResourceProfile,
  ResolvedSectorResourceProfile,
} from './regionalResourceTypes';

export * from './landingTypes';

/** Alias matching US spelling alongside `@terra/contracts` `SectorNeighbourV1`. */
export type SectorNeighborV1 = SectorNeighbourV1;
export type { SectorNeighbourV1 };

export interface GlobalTileSectorLookup {
  readonly sectorId: SectorId;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly localQ: number;
  readonly localR: number;
  readonly localIndex: number;
}

export interface SectorTileEntry {
  readonly q: number;
  readonly r: number;
  readonly localQ: number;
  readonly localR: number;
  readonly localIndex: number;
}

export interface TileSectorNeighbor extends GlobalTileSectorLookup {
  readonly dir: number;
  readonly oppositeDir: number;
  readonly q: number;
  readonly r: number;
  readonly crossesSectorBoundary: boolean;
}

export type TileSectorNeighbour = TileSectorNeighbor;

export interface AtlasTileOwner extends GlobalTileSectorLookup {
  readonly atlasIndex: number;
  readonly q: number;
  readonly r: number;
  readonly sectorOrdinal: number;
  readonly kind: SectorKind;
}

export interface AtlasSeamNeighbor extends GlobalTileSectorLookup {
  readonly dir: number;
  readonly oppositeDir: number;
  readonly q: number;
  readonly r: number;
  readonly inAtlas: boolean;
}

export interface AtlasSeamTile {
  readonly q: number;
  readonly r: number;
  readonly sectorId: SectorId;
  readonly macroQ: number;
  readonly macroR: number;
  readonly localQ: number;
  readonly localR: number;
  readonly localIndex: number;
  readonly neighbors: readonly AtlasSeamNeighbor[];
  readonly crossSectorNeighbors: readonly AtlasSeamNeighbor[];
}

export interface AtlasCornerTile extends GlobalTileSectorLookup {
  readonly q: number;
  readonly r: number;
  readonly inAtlas: boolean;
}

export interface AtlasCornerTriple {
  readonly key: string;
  readonly tiles: readonly [AtlasCornerTile, AtlasCornerTile, AtlasCornerTile];
  readonly sectorIds: readonly [SectorId, SectorId, SectorId];
  readonly allInAtlas: boolean;
}

export interface AtlasSectorPartition {
  readonly sectorId: SectorId;
  readonly ordinal: number;
  readonly kind: SectorKind;
  readonly continentId: ContinentId | null;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly tileCount: number;
  readonly neighbors: readonly SectorNeighborV1[];
  readonly atlasNeighbors: readonly SectorNeighborV1[];
  readonly tiles: readonly SectorTileEntry[];
  readonly seamTiles: readonly AtlasSeamTile[];
}

export interface BuildSmallAtlasPartitionOptions {
  readonly sectorRadius?: number;
  readonly landCoords?: readonly (readonly [number, number])[];
  readonly oceanCoords?: readonly (readonly [number, number])[];
  readonly includeOceanHalo?: boolean;
  readonly continentId?: ContinentId;
}

export interface AtlasPartition {
  readonly sectorRadius: number;
  readonly tilesPerSector: number;
  readonly sectors: readonly AtlasSectorPartition[];
  readonly sectorById: ReadonlyMap<SectorId, AtlasSectorPartition>;
  readonly landSectorIds: readonly SectorId[];
  readonly oceanSectorIds: readonly SectorId[];
  readonly tiles: readonly AtlasTileOwner[];
  readonly tileByKey: ReadonlyMap<string, AtlasTileOwner>;
  readonly seamTiles: readonly AtlasSeamTile[];
  readonly cornerTriples: readonly AtlasCornerTriple[];
  readonly bounds: {
    readonly minQ: number;
    readonly maxQ: number;
    readonly minR: number;
    readonly maxR: number;
    readonly totalTiles: number;
  };
  getTile(q: number, r: number): AtlasTileOwner | null;
}

/** Ring-2 ocean halo around the default 7-sector land continent (12 macro hexes at macro distance 2). */
export const W11_OCEAN_HALO_SECTOR_COORDS: readonly (readonly [number, number])[] = [
  [2, 0],
  [2, -1],
  [2, -2],
  [1, -2],
  [0, -2],
  [-1, -1],
  [-2, 0],
  [-2, 1],
  [-2, 2],
  [-1, 2],
  [0, 2],
  [1, 1],
] as const;

export const W11_SMALL_ATLAS_SECTOR_COORDS: readonly (readonly [number, number])[] = [
  ...W11_SEVEN_SECTOR_COORDS,
  ...W11_OCEAN_HALO_SECTOR_COORDS,
] as const;

export interface GenerateSmallAtlasOptions extends BuildSmallAtlasPartitionOptions {
  readonly planetId?: string;
  readonly planetType?: PlanetType;
  readonly seed?: string;
  readonly worldSalt?: string;
  readonly foundingSeatsPerSector?: number;
  readonly resourceProfileId?: string;
  readonly regionalResourceConfig?: RegionalResourceResolutionConfig;
  readonly sectorArchetypes?: Readonly<Record<SectorId, string>>;
  readonly sectorResourceOverrides?: Readonly<Record<SectorId, RegionalResourceLayerPatch>>;
  readonly planetResourceOverride?: RegionalResourceLayerPatch;
  /**
   * Optional explicit order of sector IDs to iterate when populating sector buffers.
   * Global coordinate sampling guarantees identical tile outputs under any permutation.
   */
  readonly sectorOrder?: readonly SectorId[];
}

export interface CreateAtlasPlanetOptions extends GenerateSmallAtlasOptions {
  readonly gridRadius?: number;
  readonly atlas?: GeneratedSmallAtlas;
  readonly config?: AtlasConfigV1;
  readonly manifest?: AtlasManifestV1;
}

export interface SampledAtlasTileValues {
  readonly q: number;
  readonly r: number;
  readonly isLandSector: boolean;
  readonly distanceToOcean: number;
  readonly distanceToLand: number;
  readonly terrain: number;
  readonly prep: number;
  readonly height: number;
  readonly deposit: number;
  readonly depositTier: number;
  readonly richness: number;
  readonly subDeposit: number;
  readonly subRichness: number;
}

export interface GeneratedAtlasTile extends AtlasTileOwner {
  readonly continentId: ContinentId | null;
  readonly distanceToOcean: number;
  readonly distanceToLand: number;
  readonly terrain: number;
  readonly prep: number;
  readonly height: number;
  readonly deposit: number;
  readonly depositTier: number;
  readonly richness: number;
  readonly subDeposit: number;
  readonly subRichness: number;
}

export interface GeneratedAtlasSector {
  readonly sectorId: SectorId;
  readonly ordinal: number;
  readonly kind: SectorKind;
  readonly continentId: ContinentId | null;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly tileCount: number;
  readonly foundingCapacity: number;
  readonly validatedSafeSites: number;
  readonly safeLandingSlots: readonly SafeLandingSlotV1[];
  readonly archetype?: string;
  readonly resourceProfileId: string;
  readonly sectorResourceHash: string;
  readonly mainResource: ResourceKey;
  readonly scarceResources: readonly ResourceKey[];
  readonly resourceEndowment: RegionalResourceManifestHookV1;
  readonly resourceProfile: ResolvedSectorResourceProfile;
  readonly neighbors: readonly SectorNeighborV1[];
  readonly atlasNeighbors: readonly SectorNeighborV1[];
  readonly tiles: readonly SectorTileEntry[];
  readonly seamTiles: readonly AtlasSeamTile[];
  readonly terrain: Uint8Array;
  readonly prep: Uint8Array;
  readonly height: Float32Array;
  readonly deposit: Uint8Array;
  readonly depositTier: Uint8Array;
  readonly richness: Float32Array;
  readonly subDeposit: Uint8Array;
  readonly subRichness: Float32Array;
}

export interface SeamContinuityOptions {
  readonly maxLandStepM?: number;
  readonly maxCoastStepM?: number;
  readonly maxOceanStepM?: number;
}

export interface SeamContinuityViolation {
  readonly kind: 'land_height_step' | 'coast_height_step' | 'ocean_height_step' | 'ocean_not_water';
  readonly sectorA: SectorId;
  readonly sectorB: SectorId;
  readonly qA: number;
  readonly rA: number;
  readonly qB: number;
  readonly rB: number;
  readonly heightDeltaM: number;
  readonly message: string;
}

export interface SeamContinuityReport {
  readonly ok: boolean;
  readonly totalSeamPairs: number;
  readonly landToLandPairs: number;
  readonly landToOceanPairs: number;
  readonly oceanToOceanPairs: number;
  readonly maxHeightDeltaM: number;
  readonly maxLandToLandHeightDeltaM: number;
  readonly meanLandToLandHeightDeltaM: number;
  readonly maxLandToOceanHeightDeltaM: number;
  readonly maxOceanToOceanHeightDeltaM: number;
  readonly violations: readonly SeamContinuityViolation[];
}

export interface ConnectedContinentReport {
  readonly ok: boolean;
  readonly continentId: ContinentId;
  readonly landSectorCount: number;
  readonly reachedLandSectorIds: readonly SectorId[];
  readonly connectedLandTileCount: number;
  readonly totalLandTileCount: number;
  readonly connectedShare: number;
  readonly crossSectorLandEdges: number;
  readonly oceanHaloAllWater: boolean;
  readonly oceanHaloZeroCapacity: boolean;
  readonly reasons: readonly string[];
}

export interface AtlasSectorBlobSummary {
  readonly sectorId: SectorId;
  readonly ordinal: number;
  readonly kind: SectorKind;
  readonly continentId: ContinentId | null;
  readonly macroQ: number;
  readonly macroR: number;
  readonly centerQ: number;
  readonly centerR: number;
  readonly radius: number;
  readonly tileCount: number;
  readonly foundingCapacity: number;
  readonly validatedSafeSites?: number;
  readonly safeLandingSlots?: readonly SafeLandingSlotV1[];
  readonly archetype?: string;
  readonly resourceProfileId?: string;
  readonly sectorResourceHash?: string;
  readonly mainResource?: ResourceKey;
  readonly scarceResources?: readonly ResourceKey[];
  readonly resourceEndowment?: RegionalResourceManifestHookV1;
  readonly foundedSeats?: number;
  readonly freeSeats?: number;
  readonly livingColonies?: number;
  readonly presentColonies?: number;
}

export interface AtlasBlobValue {
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly seed: string;
  readonly genVersion: number;
  readonly atlasVersion?: number;
  readonly topologyVersion?: number;
  readonly configVersion?: number;
  readonly configHash?: string;
  readonly atlasHash?: string;
  readonly resourceProfileId?: string;
  readonly resourceProfileHash?: string;
  readonly manifest?: AtlasManifestV1;
  readonly sectorRadius: number;
  readonly tilesPerSector: number;
  readonly foundingSeatsPerSector: number;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly safeLandingSlots: readonly SafeLandingSlotV1[];
  readonly continentId: ContinentId;
  readonly landSectorIds: readonly SectorId[];
  readonly oceanSectorIds: readonly SectorId[];
  readonly bounds: AtlasPartition['bounds'];
  readonly sectors: readonly AtlasSectorBlobSummary[];
  readonly foundingSectorByColony?: Readonly<Record<number, SectorId>>;
  readonly presentSectorsByColony?: Readonly<Record<number, readonly SectorId[]>>;
}

export interface GeneratedSmallAtlas {
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly seed: string;
  readonly genVersion: number;
  readonly resourceProfileId: string;
  readonly resourceProfileHash: string;
  readonly regionalResources: ResolvedAtlasResourceProfile;
  readonly sectorRadius: number;
  readonly tilesPerSector: number;
  readonly foundingSeatsPerSector: number;
  readonly nominalCapacity: number;
  readonly validatedCapacity: number;
  readonly safeLandingSlots: readonly SafeLandingSlotV1[];
  readonly landingValidation: AtlasLandingValidationReport;
  readonly continentId: ContinentId;
  readonly generationOrder: readonly SectorId[];
  readonly partition: AtlasPartition;
  readonly sectors: readonly GeneratedAtlasSector[];
  readonly sectorById: ReadonlyMap<SectorId, GeneratedAtlasSector>;
  readonly landSectorIds: readonly SectorId[];
  readonly oceanSectorIds: readonly SectorId[];
  readonly terrain: Uint8Array;
  readonly prep: Uint8Array;
  readonly height: Float32Array;
  readonly deposit: Uint8Array;
  readonly depositTier: Uint8Array;
  readonly richness: Float32Array;
  readonly subDeposit: Uint8Array;
  readonly subRichness: Float32Array;
  getTile(q: number, r: number): GeneratedAtlasTile | null;
  sampleGlobalTile(q: number, r: number): SampledAtlasTileValues;
  verifySeamContinuity(opts?: SeamContinuityOptions): SeamContinuityReport;
  verifyConnectedContinent(): ConnectedContinentReport;
  validateLandingSites(opts?: ValidateAtlasLandingSitesOptions): AtlasLandingValidationReport;
}
