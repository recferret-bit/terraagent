import {
  canonicalPlanetForType,
  HomePlanetId,
  W11_SEVEN_SECTOR_COORDS,
  formatSectorId,
  type PlanetType,
  type RegionalResourceManifestHookV1,
  type ResourceInheritanceSource,
  type ResourceKey,
  type SectorId,
  type SectorKind,
} from '@terra/contracts';
import { GEN_VERSION } from '../gen/generators';
import { hashAtlasCanonicalJson } from './manifestHash';
import {
  BOOTSTRAP_NAMED_RESOURCE_PROFILES,
  CANONICAL_RESOURCE_KEYS,
  GLOBAL_DEFAULT_RESOURCE_MAP,
  GLOBAL_DEFAULT_RESOURCE_PATCH,
  PLANET_TYPE_RESOURCE_PRESETS,
  SECTOR_ARCHETYPE_RESOURCE_OVERRIDES,
  W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000,
  normalizeRegionalResourceKey,
  toContractSourceLayer,
} from './regionalResourcePresets';
import {
  REGIONAL_RESOURCE_FIELDS,
  RegionalResourceValidationError,
  type RegionalResourceEntry,
  type RegionalResourceFieldName,
  type RegionalResourceLayerPatch,
  type RegionalResourceResolutionConfig,
  type RegionalResourceSourceLayer,
  type ResolveSectorResourceProfileOptions,
  type ResolvedAtlasResourceProfile,
  type ResolvedResourceEntry,
  type ResolvedSectorResourceProfile,
} from './regionalResourceTypes';
import {
  computeExpectedRecoverableOutput,
  computeSectorResourceHash,
  deriveMainResourceFromEntries,
  deriveScarceResourcesFromEntries,
  validateSectorResourceProfile,
} from './regionalResourceValidation';
import { W11_OCEAN_HALO_SECTOR_COORDS } from './types';

export * from './regionalResourceTypes';
export * from './regionalResourcePresets';
export * from './regionalResourceValidation';
export * from './regionalResourceAttribution';

interface MutableResolutionState {
  entries: Record<ResourceKey, RegionalResourceEntry>;
  fieldSources: Record<ResourceKey, Record<RegionalResourceFieldName, RegionalResourceSourceLayer>>;
  resourceSources: Record<ResourceKey, RegionalResourceSourceLayer>;
  depositDensityPer1000Tiles: number;
  depositDensitySourceLayer: RegionalResourceSourceLayer;
  explicitMainResource?: ResourceKey;
  mainResourceSourceLayer: RegionalResourceSourceLayer;
  explicitScarceResources?: readonly ResourceKey[];
  highestLayer: RegionalResourceSourceLayer;
}

function createInitialResolutionState(kind: SectorKind): MutableResolutionState {
  const entries = {} as Record<ResourceKey, RegionalResourceEntry>;
  const fieldSources = {} as Record<ResourceKey, Record<RegionalResourceFieldName, RegionalResourceSourceLayer>>;
  const resourceSources = {} as Record<ResourceKey, RegionalResourceSourceLayer>;

  for (const key of CANONICAL_RESOURCE_KEYS) {
    entries[key] = { ...GLOBAL_DEFAULT_RESOURCE_MAP[key] };
    fieldSources[key] = {
      occurrenceWeightBp: 'global_default',
      reserveUnitsMin: 'global_default',
      reserveUnitsMax: 'global_default',
      extractionYieldBp: 'global_default',
      renewableUnitsPerSimHour: 'global_default',
      terraformFindWeightBp: 'global_default',
      starterGuarantee: 'global_default',
    };
    resourceSources[key] = 'global_default';
  }

  return {
    entries,
    fieldSources,
    resourceSources,
    depositDensityPer1000Tiles: kind === 'land' ? W11_DEFAULT_LAND_DEPOSIT_DENSITY_PER_1000 : 0,
    depositDensitySourceLayer: 'global_default',
    mainResourceSourceLayer: 'global_default',
    highestLayer: 'global_default',
  };
}

function applyLayerPatchToState(
  state: MutableResolutionState,
  patch: RegionalResourceLayerPatch | undefined,
  layer: RegionalResourceSourceLayer,
  kind: SectorKind,
): void {
  if (!patch) return;
  let layerTouched = false;

  if (patch.depositDensityPer1000Tiles !== undefined) {
    state.depositDensityPer1000Tiles =
      kind === 'ocean' && layer !== 'sector_id' && layer !== 'sector_archetype'
        ? 0
        : patch.depositDensityPer1000Tiles;
    state.depositDensitySourceLayer = layer;
    layerTouched = true;
  }
  if (patch.mainResource !== undefined) {
    state.explicitMainResource = normalizeRegionalResourceKey(patch.mainResource) ?? patch.mainResource;
    state.mainResourceSourceLayer = layer;
    layerTouched = true;
  }
  if (patch.scarceResources !== undefined) {
    state.explicitScarceResources = patch.scarceResources.map(
      (k) => normalizeRegionalResourceKey(k) ?? k,
    );
    layerTouched = true;
  }
  if (patch.resources) {
    for (const [rawKey, partialEntry] of Object.entries(patch.resources)) {
      const key = partialEntry ? normalizeRegionalResourceKey(rawKey) : null;
      if (!key || !partialEntry) continue;
      let resourceTouched = false;
      const current = { ...state.entries[key] };
      const fSources = { ...state.fieldSources[key] };
      for (const field of REGIONAL_RESOURCE_FIELDS) {
        const val = partialEntry[field];
        if (val !== undefined) {
          (current as Record<string, unknown>)[field] = val;
          fSources[field] = layer;
          resourceTouched = true;
        }
      }
      if (resourceTouched) {
        state.entries[key] = current;
        state.fieldSources[key] = fSources;
        state.resourceSources[key] = layer;
        layerTouched = true;
      }
    }
  }
  if (layerTouched || patch.profileId !== undefined) {
    state.highestLayer = layer;
  }
}

function buildResolvedResourceEntries(state: MutableResolutionState): Record<ResourceKey, ResolvedResourceEntry> {
  const totalOccurrence = CANONICAL_RESOURCE_KEYS.reduce((s, k) => s + Math.max(0, state.entries[k].occurrenceWeightBp), 0);
  const totalTerraform = CANONICAL_RESOURCE_KEYS.reduce((s, k) => s + Math.max(0, state.entries[k].terraformFindWeightBp), 0);
  const resolved = {} as Record<ResourceKey, ResolvedResourceEntry>;
  for (const key of CANONICAL_RESOURCE_KEYS) {
    const raw = state.entries[key];
    const sLayer = state.resourceSources[key];
    resolved[key] = {
      ...raw,
      resourceKey: key,
      sourceLayer: sLayer,
      contractSourceLayer: toContractSourceLayer(sLayer),
      fieldSources: { ...state.fieldSources[key] },
      expectedRecoverableOutput: computeExpectedRecoverableOutput(raw),
      normalizedOccurrenceShareBp: totalOccurrence > 0 ? Math.round((raw.occurrenceWeightBp * 10000) / totalOccurrence) : 0,
      normalizedTerraformFindShareBp: totalTerraform > 0 ? Math.round((raw.terraformFindWeightBp * 10000) / totalTerraform) : 0,
    };
  }
  return resolved;
}

function applyFiveLayerHierarchy(
  state: MutableResolutionState,
  opts: ResolveSectorResourceProfileOptions,
  params: {
    planetId: string;
    planetType: PlanetType;
    sectorId: SectorId;
    kind: SectorKind;
    archetype?: string;
    profileId: string;
    planetResourceProfileId: string;
    defaultPlanetProfileId: string;
  },
): void {
  const { planetId, planetType, sectorId, kind, archetype, profileId, planetResourceProfileId, defaultPlanetProfileId } = params;
  const lookupNamed = (id?: string) => (id ? (opts.config?.namedProfiles?.[id] ?? BOOTSTRAP_NAMED_RESOURCE_PROFILES[id]) : undefined);

  applyLayerPatchToState(state, GLOBAL_DEFAULT_RESOURCE_PATCH, 'global_default', kind);
  applyLayerPatchToState(state, opts.config?.globalDefault, 'global_default', kind);
  applyLayerPatchToState(state, opts.layers?.global_default, 'global_default', kind);
  applyLayerPatchToState(state, opts.globalDefault, 'global_default', kind);

  applyLayerPatchToState(state, PLANET_TYPE_RESOURCE_PRESETS[planetType], 'planet_type', kind);
  applyLayerPatchToState(state, opts.config?.planetTypePresets?.[planetType], 'planet_type', kind);
  applyLayerPatchToState(state, opts.layers?.planet_type, 'planet_type', kind);
  applyLayerPatchToState(state, opts.planetTypePreset, 'planet_type', kind);

  if (planetResourceProfileId !== defaultPlanetProfileId) {
    applyLayerPatchToState(state, lookupNamed(planetResourceProfileId), 'planet_id', kind);
  }
  applyLayerPatchToState(state, opts.config?.planetIdOverrides?.[planetId], 'planet_id', kind);
  applyLayerPatchToState(state, opts.layers?.planet_id, 'planet_id', kind);
  applyLayerPatchToState(state, opts.planetIdOverride, 'planet_id', kind);

  if (archetype) {
    applyLayerPatchToState(state, SECTOR_ARCHETYPE_RESOURCE_OVERRIDES[archetype], 'sector_archetype', kind);
    applyLayerPatchToState(state, opts.config?.sectorArchetypeOverrides?.[archetype], 'sector_archetype', kind);
  }
  applyLayerPatchToState(state, opts.layers?.sector_archetype, 'sector_archetype', kind);
  applyLayerPatchToState(state, opts.sectorArchetypeOverride, 'sector_archetype', kind);

  if (profileId !== planetResourceProfileId) {
    applyLayerPatchToState(state, lookupNamed(profileId) ?? { profileId }, 'sector_id', kind);
  }
  applyLayerPatchToState(state, opts.config?.sectorIdOverrides?.[sectorId], 'sector_id', kind);
  applyLayerPatchToState(state, opts.layers?.sector_id, 'sector_id', kind);
  applyLayerPatchToState(state, opts.sectorIdOverride, 'sector_id', kind);
}

const SECTOR_PROFILE_CACHE = new Map<string, ResolvedSectorResourceProfile>();

function normalizeRegionalPlanetId(planetId: string | undefined, planetType: PlanetType): string {
  if (!planetId) return canonicalPlanetForType(planetType).id;
  if (planetId.startsWith('pl_')) return planetId;
  if (/^p_[A-Za-z0-9_-]{1,60}$/.test(planetId)) return `pl_${planetId.slice(2)}`;
  if (HomePlanetId.safeParse(planetId).success) return planetId;
  return planetId;
}

export function resolveSectorResourceProfile(opts: ResolveSectorResourceProfileOptions): ResolvedSectorResourceProfile {
  const planetType = opts.planetType;
  const planetId = normalizeRegionalPlanetId(opts.planetId, planetType);
  const sectorId: SectorId = opts.sectorId ?? 'sec_0_0';
  const kind: SectorKind = opts.kind ?? 'land';
  const archetype = opts.archetype;
  const topologyVersion = opts.topologyVersion ?? 1;
  const genVersion = opts.genVersion ?? GEN_VERSION;
  const defaultPlanetProfileId = `w11-bootstrap-${planetType}-v1`;
  const planetResourceProfileId = opts.planetResourceProfileId ?? opts.config?.profileId ?? defaultPlanetProfileId;
  const profileId = opts.profileId ?? planetResourceProfileId;
  const shouldValidate = opts.validate ?? opts.config?.validate ?? true;
  const isCacheable =
    shouldValidate &&
    !opts.globalDefault &&
    !opts.planetTypePreset &&
    !opts.planetIdOverride &&
    !opts.sectorArchetypeOverride &&
    !opts.sectorIdOverride &&
    !opts.layers &&
    !opts.config;
  const cacheKey = isCacheable
    ? `${planetId}|${planetType}|${sectorId}|${kind}|${archetype ?? ''}|${profileId}|${planetResourceProfileId}|${topologyVersion}|${genVersion}`
    : '';
  if (isCacheable) {
    const hit = SECTOR_PROFILE_CACHE.get(cacheKey);
    if (hit) return hit;
  }

  const state = createInitialResolutionState(kind);
  applyFiveLayerHierarchy(state, opts, {
    planetId, planetType, sectorId, kind, archetype, profileId, planetResourceProfileId, defaultPlanetProfileId,
  });

  const resources = buildResolvedResourceEntries(state);
  const mainResource = state.explicitMainResource ?? deriveMainResourceFromEntries(resources);
  const mainResourceSourceLayer =
    state.explicitMainResource !== undefined ? state.mainResourceSourceLayer : resources[mainResource].sourceLayer;
  const scarceResources =
    state.explicitScarceResources !== undefined
      ? [...state.explicitScarceResources]
      : deriveScarceResourcesFromEntries(resources, mainResource);
  const starterGuaranteedResources = CANONICAL_RESOURCE_KEYS.filter((k) => resources[k].starterGuarantee);

  const sourceAttribution = {} as Record<ResourceKey, RegionalResourceSourceLayer>;
  const contractSourceAttribution = {} as Record<ResourceKey, ResourceInheritanceSource>;
  for (const key of CANONICAL_RESOURCE_KEYS) {
    sourceAttribution[key] = resources[key].sourceLayer;
    contractSourceAttribution[key] = resources[key].contractSourceLayer;
  }

  const sectorResourceHash = computeSectorResourceHash({
    profileId, planetId, planetType, topologyVersion, genVersion, sectorId, kind, archetype,
    sourceLayer: state.highestLayer, depositDensityPer1000Tiles: state.depositDensityPer1000Tiles,
    mainResource, scarceResources, resources, sourceAttribution,
  });

  const contractSourceLayer = toContractSourceLayer(state.highestLayer);
  const manifestHook: RegionalResourceManifestHookV1 = {
    profileId, endowmentHash: sectorResourceHash, sourceLayer: contractSourceLayer,
    depositDensityPer1000Tiles: state.depositDensityPer1000Tiles, mainResource,
    scarceResources: [...scarceResources], sourceAttribution: contractSourceAttribution,
  };

  const resolved: ResolvedSectorResourceProfile = {
    planetId, planetType, sectorId, kind, ...(archetype ? { archetype } : {}),
    profileId, planetResourceProfileId, topologyVersion, genVersion,
    resourceProfileHash: sectorResourceHash, sectorResourceHash, endowmentHash: sectorResourceHash,
    sourceLayer: state.highestLayer, contractSourceLayer,
    depositDensityPer1000Tiles: state.depositDensityPer1000Tiles,
    depositDensitySourceLayer: state.depositDensitySourceLayer,
    mainResource, mainResourceSourceLayer,
    ...(state.explicitMainResource ? { explicitMainResource: state.explicitMainResource } : {}),
    scarceResources,
    ...(state.explicitScarceResources ? { explicitScarceResources: state.explicitScarceResources } : {}),
    starterGuaranteedResources, resources, sourceAttribution, contractSourceAttribution, manifestHook,
  };

  if (shouldValidate) {
    const report = validateSectorResourceProfile(resolved);
    if (!report.ok) throw new RegionalResourceValidationError(report.issues);
  }
  if (isCacheable && SECTOR_PROFILE_CACHE.size < 512) {
    SECTOR_PROFILE_CACHE.set(cacheKey, resolved);
  }
  return resolved;
}

export interface ResolveAtlasRegionalResourcesOptions {
  readonly planetId?: string;
  readonly planetType: PlanetType;
  readonly resourceProfileId?: string;
  readonly topologyVersion?: number;
  readonly genVersion?: number;
  readonly sectors?: ReadonlyArray<{
    readonly sectorId: SectorId;
    readonly macroQ: number;
    readonly macroR: number;
    readonly kind: SectorKind;
    readonly archetype?: string;
    readonly resourceProfileId?: string;
  }>;
  readonly sectorArchetypes?: Readonly<Record<SectorId, string>>;
  readonly sectorResourceOverrides?: Readonly<Record<SectorId, RegionalResourceLayerPatch>>;
  readonly planetResourceOverride?: RegionalResourceLayerPatch;
  readonly config?: RegionalResourceResolutionConfig;
  readonly validate?: boolean;
}

export function resolveAtlasRegionalResources(opts: ResolveAtlasRegionalResourcesOptions): ResolvedAtlasResourceProfile {
  const planetType = opts.planetType;
  const planetId = normalizeRegionalPlanetId(opts.planetId, planetType);
  const topologyVersion = opts.topologyVersion ?? 1;
  const genVersion = opts.genVersion ?? GEN_VERSION;
  const defaultProfileId = `w11-bootstrap-${planetType}-v1`;
  const resourceProfileId = opts.resourceProfileId ?? opts.config?.profileId ?? defaultProfileId;

  const rawSectors: NonNullable<ResolveAtlasRegionalResourcesOptions['sectors']> = opts.sectors ?? [
    ...W11_SEVEN_SECTOR_COORDS.map(([mq, mr]) => ({
      sectorId: formatSectorId(mq, mr), macroQ: mq, macroR: mr, kind: 'land' as const,
      archetype: mq === 0 && mr === 0 ? 'heartland' : 'frontier', resourceProfileId,
    })),
    ...W11_OCEAN_HALO_SECTOR_COORDS.map(([mq, mr]) => ({
      sectorId: formatSectorId(mq, mr), macroQ: mq, macroR: mr, kind: 'ocean' as const,
    })),
  ];

  const planetEndowment = resolveSectorResourceProfile({
    planetId, planetType, sectorId: 'sec_0_0', kind: 'land',
    profileId: resourceProfileId, planetResourceProfileId: resourceProfileId,
    topologyVersion, genVersion, planetIdOverride: opts.planetResourceOverride,
    config: opts.config, validate: opts.validate,
  });

  const sectorById = new Map<SectorId, ResolvedSectorResourceProfile>();
  for (const sec of rawSectors) {
    const archetype =
      opts.sectorArchetypes?.[sec.sectorId] ??
      sec.archetype ??
      (sec.kind === 'land' ? (sec.macroQ === 0 && sec.macroR === 0 ? 'heartland' : 'frontier') : undefined);
    sectorById.set(
      sec.sectorId,
      resolveSectorResourceProfile({
        planetId, planetType, sectorId: sec.sectorId, kind: sec.kind, archetype,
        profileId: sec.resourceProfileId ?? resourceProfileId, planetResourceProfileId: resourceProfileId,
        topologyVersion, genVersion, planetIdOverride: opts.planetResourceOverride,
        sectorIdOverride: opts.sectorResourceOverrides?.[sec.sectorId],
        config: opts.config, validate: opts.validate,
      }),
    );
  }

  const canonicalSortedSpecs = [...rawSectors].sort((a, b) => a.macroQ - b.macroQ || a.macroR - b.macroR);
  const resourceProfileHash = hashAtlasCanonicalJson({
    resourceProfileId, planetId, planetType, topologyVersion, genVersion,
    planetEndowmentHash: planetEndowment.sectorResourceHash,
    sectors: canonicalSortedSpecs.map((s) => ({
      sectorId: s.sectorId, endowmentHash: sectorById.get(s.sectorId)!.sectorResourceHash,
    })),
  });

  const hasCustomOverrides = Boolean(
    resourceProfileId !== defaultProfileId ||
      opts.planetResourceOverride ||
      opts.sectorArchetypes ||
      opts.sectorResourceOverrides ||
      opts.config ||
      rawSectors.some(
        (s) =>
          (s.resourceProfileId && s.resourceProfileId !== defaultProfileId) ||
          (s.archetype && Boolean(SECTOR_ARCHETYPE_RESOURCE_OVERRIDES[s.archetype])),
      ),
  );

  return {
    planetId, planetType, resourceProfileId, resourceProfileHash, topologyVersion, genVersion,
    hasCustomOverrides, planetEndowment, sectors: rawSectors.map((s) => sectorById.get(s.sectorId)!), sectorById,
  };
}
