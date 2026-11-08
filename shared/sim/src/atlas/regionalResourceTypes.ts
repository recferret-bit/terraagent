import type {
  PlanetType,
  RegionalResourceManifestHookV1,
  ResourceInheritanceSource,
  ResourceKey,
  SectorId,
  SectorKind,
} from '@terra/contracts';

/**
 * 5-layer regional resource resolution hierarchy (`ECON-GEO-01`, `ECONOMY.md` §2.2):
 * `global_default -> planet_type -> planet_id -> sector_archetype -> sector_id`.
 */
export const REGIONAL_RESOURCE_SOURCE_LAYERS = [
  'global_default',
  'planet_type',
  'planet_id',
  'sector_archetype',
  'sector_id',
] as const;

export type RegionalResourceSourceLayer = (typeof REGIONAL_RESOURCE_SOURCE_LAYERS)[number];

export const REGIONAL_RESOURCE_FIELDS = [
  'occurrenceWeightBp',
  'reserveUnitsMin',
  'reserveUnitsMax',
  'extractionYieldBp',
  'renewableUnitsPerSimHour',
  'terraformFindWeightBp',
  'starterGuarantee',
] as const;

export type RegionalResourceFieldName = (typeof REGIONAL_RESOURCE_FIELDS)[number];

/**
 * Per-resource endowment specification (`ECON-GEO-01`, `ECONOMY.md` §2.2).
 */
export interface RegionalResourceEntry {
  readonly occurrenceWeightBp: number;
  readonly reserveUnitsMin: number;
  readonly reserveUnitsMax: number;
  readonly extractionYieldBp: number;
  readonly renewableUnitsPerSimHour: number;
  readonly terraformFindWeightBp: number;
  readonly starterGuarantee: boolean;
}

export type PartialRegionalResourceEntry = Partial<RegionalResourceEntry>;

export type RegionalResourceMap = Readonly<Record<ResourceKey, RegionalResourceEntry>>;

export type PartialRegionalResourceMap = Partial<
  Readonly<Record< string, PartialRegionalResourceEntry >>
>;

/**
 * Partial override supplied at any single layer of the 5-layer hierarchy.
 * Omitted fields inherit from lower-precedence layers; explicit `0` or `false` overrides.
 */
export interface RegionalResourceLayerPatch {
  readonly profileId?: string;
  readonly depositDensityPer1000Tiles?: number;
  readonly mainResource?: ResourceKey;
  readonly scarceResources?: readonly ResourceKey[];
  readonly resources?: PartialRegionalResourceMap;
}

export interface ResolvedResourceEntry extends RegionalResourceEntry {
  readonly resourceKey: ResourceKey;
  readonly sourceLayer: RegionalResourceSourceLayer;
  readonly contractSourceLayer: ResourceInheritanceSource;
  readonly fieldSources: Readonly<Record<RegionalResourceFieldName, RegionalResourceSourceLayer>>;
  readonly expectedRecoverableOutput: number;
  readonly normalizedOccurrenceShareBp: number;
  readonly normalizedTerraformFindShareBp: number;
}

export type RegionalResourceValidationIssueCode =
  | 'invalid_resource_field'
  | 'invalid_reserve_range'
  | 'invalid_deposit_density'
  | 't3_starter_guarantee_forbidden'
  | 'non_t1_starter_guarantee_forbidden'
  | 'contradictory_starter_guarantee'
  | 'missing_essential_starter_guarantee'
  | 'contradictory_main_resource'
  | 'main_resource_mismatch'
  | 'contradictory_scarce_resource';

export interface RegionalResourceValidationIssue {
  readonly code: RegionalResourceValidationIssueCode;
  readonly message: string;
  readonly sectorId?: SectorId;
  readonly resourceKey?: ResourceKey;
  readonly field?: string;
}

export interface RegionalResourceValidationReport {
  readonly ok: boolean;
  readonly code?: RegionalResourceValidationIssueCode;
  readonly issues: readonly RegionalResourceValidationIssue[];
}

export class RegionalResourceValidationError extends Error {
  readonly code: RegionalResourceValidationIssueCode;
  readonly issues: readonly RegionalResourceValidationIssue[];

  constructor(issues: readonly RegionalResourceValidationIssue[]) {
    const first = issues[0];
    super(first ? first.message : 'invalid regional resource profile');
    this.name = 'RegionalResourceValidationError';
    this.code = first?.code ?? 'invalid_resource_field';
    this.issues = issues;
  }
}

export interface ResolvedSectorResourceProfile {
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly sectorId: SectorId;
  readonly kind: SectorKind;
  readonly archetype?: string;
  readonly profileId: string;
  readonly planetResourceProfileId: string;
  readonly topologyVersion: number;
  readonly genVersion: number;
  readonly resourceProfileHash: string;
  readonly sectorResourceHash: string;
  readonly endowmentHash: string;
  readonly sourceLayer: RegionalResourceSourceLayer;
  readonly contractSourceLayer: ResourceInheritanceSource;
  readonly depositDensityPer1000Tiles: number;
  readonly depositDensitySourceLayer: RegionalResourceSourceLayer;
  readonly mainResource: ResourceKey;
  readonly mainResourceSourceLayer: RegionalResourceSourceLayer;
  readonly explicitMainResource?: ResourceKey;
  readonly scarceResources: readonly ResourceKey[];
  readonly explicitScarceResources?: readonly ResourceKey[];
  readonly starterGuaranteedResources: readonly ResourceKey[];
  readonly resources: Readonly<Record<ResourceKey, ResolvedResourceEntry>>;
  readonly sourceAttribution: Readonly<Record<ResourceKey, RegionalResourceSourceLayer>>;
  readonly contractSourceAttribution: Readonly<Record<ResourceKey, ResourceInheritanceSource>>;
  readonly manifestHook: RegionalResourceManifestHookV1;
}

export interface ResolvedAtlasResourceProfile {
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly resourceProfileId: string;
  readonly resourceProfileHash: string;
  readonly topologyVersion: number;
  readonly genVersion: number;
  readonly hasCustomOverrides: boolean;
  readonly planetEndowment: ResolvedSectorResourceProfile;
  readonly sectors: readonly ResolvedSectorResourceProfile[];
  readonly sectorById: ReadonlyMap<SectorId, ResolvedSectorResourceProfile>;
}

export interface RegionalResourceResolutionConfig {
  readonly profileId?: string;
  readonly globalDefault?: RegionalResourceLayerPatch;
  readonly planetTypePresets?: Partial<Readonly<Record<PlanetType, RegionalResourceLayerPatch>>>;
  readonly planetIdOverrides?: Readonly<Record<string, RegionalResourceLayerPatch>>;
  readonly sectorArchetypeOverrides?: Readonly<Record<string, RegionalResourceLayerPatch>>;
  readonly sectorIdOverrides?: Readonly<Record<SectorId, RegionalResourceLayerPatch>>;
  readonly namedProfiles?: Readonly<Record<string, RegionalResourceLayerPatch>>;
  readonly validate?: boolean;
}

export interface ResolveSectorResourceProfileOptions {
  readonly planetId?: string;
  readonly planetType: PlanetType;
  readonly sectorId?: SectorId;
  readonly kind?: SectorKind;
  readonly archetype?: string;
  readonly profileId?: string;
  readonly planetResourceProfileId?: string;
  readonly topologyVersion?: number;
  readonly genVersion?: number;
  readonly globalDefault?: RegionalResourceLayerPatch;
  readonly planetTypePreset?: RegionalResourceLayerPatch;
  readonly planetIdOverride?: RegionalResourceLayerPatch;
  readonly sectorArchetypeOverride?: RegionalResourceLayerPatch;
  readonly sectorIdOverride?: RegionalResourceLayerPatch;
  readonly layers?: Partial<Readonly<Record<RegionalResourceSourceLayer, RegionalResourceLayerPatch>>>;
  readonly config?: RegionalResourceResolutionConfig;
  readonly validate?: boolean;
}

export interface RegionalScopeBindingInput {
  readonly scopeKind: RegionalResourceSourceLayer;
  readonly planetType?: PlanetType;
  readonly planetId?: string;
  readonly sectorArchetype?: string;
  readonly sectorId?: SectorId;
  readonly regionProfileId: string;
  readonly priority?: number;
}

export interface W13RegionResourceRowInput extends RegionalResourceEntry {
  readonly regionProfileId: string;
  readonly resourceKey: ResourceKey;
  readonly sourceLayer: RegionalResourceSourceLayer;
}

export interface W13RegionProfileSnapshotInput {
  readonly regionProfileId: string;
  readonly planetId: string;
  readonly planetType: PlanetType;
  readonly sectorId: SectorId;
  readonly kind: SectorKind;
  readonly sectorArchetype?: string;
  readonly depositDensityPer1000Tiles: number;
  readonly resourceMapHash: string;
  readonly endowmentHash: string;
  readonly mainResource: ResourceKey;
  readonly scarceResources: readonly ResourceKey[];
  readonly sourceLayer: RegionalResourceSourceLayer;
  readonly sourceAttribution: Readonly<Record<ResourceKey, RegionalResourceSourceLayer>>;
  readonly rows: readonly W13RegionResourceRowInput[];
}

export interface DepositTileAttribution {
  readonly q: number;
  readonly r: number;
  readonly sectorId: SectorId;
  readonly depositKind: number;
  readonly depositTier: number;
  readonly richness: number;
  readonly resourceKey: ResourceKey | null;
  readonly sectorProfileId: string;
  readonly sectorResourceHash: string;
  readonly extractionYieldBp: number;
  readonly reserveUnitsMin: number;
  readonly reserveUnitsMax: number;
  readonly sourceLayer: RegionalResourceSourceLayer;
  readonly contractSourceLayer: ResourceInheritanceSource;
}

export interface FootprintSectorAttributionSummary {
  readonly sectorId: SectorId;
  readonly sectorResourceHash: string;
  readonly depositTileCount: number;
  readonly resourceKeys: readonly ResourceKey[];
  readonly totalWeightedRichnessBp: number;
}

export interface FootprintDepositAttributionReport {
  readonly anchorQ: number;
  readonly anchorR: number;
  readonly anchorSectorId: SectorId;
  readonly centroidSectorId: SectorId;
  readonly ownerColonyIndex?: number;
  readonly ownerFoundingSectorId?: SectorId;
  readonly depotSectorId?: SectorId;
  readonly footprintSectorIds: readonly SectorId[];
  readonly straddlesSectorBoundary: boolean;
  readonly depositTiles: readonly DepositTileAttribution[];
  readonly attributedSectorIds: readonly SectorId[];
  readonly primaryAttributedSectorId: SectorId | null;
  readonly productionBySector: Readonly<Record<SectorId, FootprintSectorAttributionSummary>>;
}
