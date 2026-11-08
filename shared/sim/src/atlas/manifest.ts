import {
  AtlasConfigV1Schema,
  AtlasManifestV1Schema,
  canonicalPlanetById,
  canonicalPlanetForType,
  formatContinentId,
  HomePlanetId,
  planetLookForType,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_MAX_SMALL_ATLAS_COLONIES,
  W11_MAX_SMALL_ATLAS_SECTORS,
  type AtlasConfigV1,
  type AtlasManifestV1,
  type ContinentId,
  type RegionalResourceManifestHookV1,
  type ResourceKey,
  type SafeLandingSlotV1,
  type SectorConfigV1,
  type SectorId,
  type SectorManifestV1,
} from '@terra/contracts';
import { GEN_VERSION } from '../gen/generators';
import type { PlanetState, PlanetType } from '../kernel/state';
import { planSectorLandingSites } from './landingPlan';
import {
  computeAtlasConfigHash,
  computeAtlasManifestHash,
  hashAtlasCanonicalJson,
} from './manifestHash';
import { isGeneratedSmallAtlas } from './manifestRollout';
import {
  resolveSectorResourceProfile,
  type RegionalResourceLayerPatch,
  type RegionalResourceResolutionConfig,
} from './regionalResources';
import { buildSmallAtlasPartition } from './smallAtlas';
import type {
  AtlasBlobValue,
  AtlasPartition,
  BuildSmallAtlasPartitionOptions,
  GeneratedSmallAtlas,
} from './types';

export * from './manifestHash';
export * from './manifestRollout';
export * from './manifestQuery';
export * from './manifestPinned';

export const W11_DEFAULT_ATLAS_VERSION = 1;
export const W11_DEFAULT_TOPOLOGY_VERSION = 1;
export const W11_DEFAULT_CONFIG_VERSION = 1;

export interface BuildAtlasConfigOptions extends BuildSmallAtlasPartitionOptions {
  readonly planetId?: string;
  readonly planetType?: PlanetType;
  readonly seed?: string;
  readonly topologyVersion?: number;
  readonly genVersion?: number;
  readonly configVersion?: number;
  readonly sectorRadius?: number;
  readonly foundingSeatsPerSector?: number;
  readonly sectors?: readonly SectorConfigV1[];
  readonly resourceProfileId?: string;
  readonly regionalResourceConfig?: RegionalResourceResolutionConfig;
  readonly sectorArchetypes?: Readonly<Record<SectorId, string>>;
  readonly sectorResourceOverrides?: Readonly<Record<SectorId, RegionalResourceLayerPatch>>;
  readonly planetResourceOverride?: RegionalResourceLayerPatch;
}

export interface BuildAtlasManifestOptions extends BuildAtlasConfigOptions {
  readonly atlasVersion?: number;
  readonly config?: AtlasConfigV1;
  readonly configHash?: string;
  readonly atlasHash?: string;
  readonly resourceProfileHash?: string;
  readonly maxColonies?: number;
  readonly maxSectors?: number;
}

export type PinnedAtlasManifestSource =
  | AtlasManifestV1
  | PlanetState
  | AtlasBlobValue
  | {
      readonly manifest?: AtlasManifestV1 | null;
      readonly pinnedManifest?: AtlasManifestV1 | null;
      readonly state?: PlanetState | null;
      readonly blob?: AtlasBlobValue | null;
    };

export function defaultResourceProfileIdForType(planetType: PlanetType): string {
  return `w11-bootstrap-${planetType}-v1`;
}

export function normalizePlanetIdForManifest(planetId: string | undefined, planetType: PlanetType): string {
  if (!planetId) return canonicalPlanetForType(planetType).id;
  if (HomePlanetId.safeParse(planetId).success) return planetId;
  if (/^p_[A-Za-z0-9_-]{1,60}$/.test(planetId)) {
    return `pl_${planetId.slice(2)}`;
  }
  return planetId;
}

export function defaultSectorArchetype(macroQ: number, macroR: number): string {
  return macroQ === 0 && macroR === 0 ? 'heartland' : 'frontier';
}

export function buildSectorResourceEndowment(params: {
  readonly planetId?: string;
  readonly planetType: PlanetType;
  readonly sectorId: SectorId;
  readonly kind: 'land' | 'ocean';
  readonly profileId: string;
  readonly topologyVersion: number;
  readonly genVersion: number;
  readonly archetype?: string;
  readonly planetResourceProfileId: string;
  readonly planetIdOverride?: RegionalResourceLayerPatch;
  readonly sectorIdOverride?: RegionalResourceLayerPatch;
  readonly config?: RegionalResourceResolutionConfig;
}): RegionalResourceManifestHookV1 {
  return resolveSectorResourceProfile({
    planetId: params.planetId,
    planetType: params.planetType,
    sectorId: params.sectorId,
    kind: params.kind,
    archetype: params.archetype,
    profileId: params.profileId,
    planetResourceProfileId: params.planetResourceProfileId,
    topologyVersion: params.topologyVersion,
    genVersion: params.genVersion,
    planetIdOverride: params.planetIdOverride,
    sectorIdOverride: params.sectorIdOverride,
    config: params.config,
  }).manifestHook;
}

/**
 * Builds a validated `AtlasConfigV1` for a canonical world (`desert`, `ocean`, `temperate`) or explicit options.
 */
export function buildDefaultAtlasConfig(opts?: BuildAtlasConfigOptions | PlanetType): AtlasConfigV1 {
  const resolvedOpts: BuildAtlasConfigOptions =
    typeof opts === 'string' ? { planetType: opts } : (opts ?? {});
  const byId = resolvedOpts.planetId ? canonicalPlanetById(resolvedOpts.planetId) : null;
  const planetType: PlanetType = resolvedOpts.planetType ?? byId?.type ?? 'temperate';
  const canonical = canonicalPlanetForType(planetType);
  const planetId = normalizePlanetIdForManifest(resolvedOpts.planetId ?? canonical.id, planetType);
  const seed = resolvedOpts.seed ?? byId?.seed ?? canonical.seed;
  const topologyVersion = resolvedOpts.topologyVersion ?? W11_DEFAULT_TOPOLOGY_VERSION;
  const genVersion = resolvedOpts.genVersion ?? GEN_VERSION;
  const configVersion = resolvedOpts.configVersion ?? W11_DEFAULT_CONFIG_VERSION;
  const sectorRadius = resolvedOpts.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const foundingSeatsPerSector =
    resolvedOpts.foundingSeatsPerSector ?? W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  const resourceProfileId =
    resolvedOpts.resourceProfileId ?? defaultResourceProfileIdForType(planetType);
  const continentId: ContinentId = resolvedOpts.continentId ?? formatContinentId(0);

  let sectors: SectorConfigV1[];
  if (resolvedOpts.sectors) {
    sectors = resolvedOpts.sectors.map((s) => ({ ...s }));
  } else {
    const partition = buildSmallAtlasPartition({
      sectorRadius,
      landCoords: resolvedOpts.landCoords,
      oceanCoords: resolvedOpts.oceanCoords,
      includeOceanHalo: resolvedOpts.includeOceanHalo,
      continentId,
    });
    sectors = partition.sectors.map((sec) =>
      sec.kind === 'land'
        ? {
            sectorId: sec.sectorId,
            continentId: sec.continentId ?? continentId,
            macroQ: sec.macroQ,
            macroR: sec.macroR,
            kind: 'land' as const,
            radius: sectorRadius,
            foundingCapacity: foundingSeatsPerSector,
            archetype:
              resolvedOpts.sectorArchetypes?.[sec.sectorId] ??
              defaultSectorArchetype(sec.macroQ, sec.macroR),
            resourceProfileId:
              resolvedOpts.sectorResourceOverrides?.[sec.sectorId]?.profileId ??
              resourceProfileId,
          }
        : {
            sectorId: sec.sectorId,
            continentId: null,
            macroQ: sec.macroQ,
            macroR: sec.macroR,
            kind: 'ocean' as const,
            radius: sectorRadius,
            foundingCapacity: 0,
            ...(resolvedOpts.sectorArchetypes?.[sec.sectorId]
              ? { archetype: resolvedOpts.sectorArchetypes[sec.sectorId] }
              : {}),
          },
    );
  }

  return AtlasConfigV1Schema.parse({
    planetId,
    planetType,
    seed,
    topologyVersion,
    genVersion,
    configVersion,
    sectorRadius,
    foundingSeatsPerSector,
    sectors,
    resourceProfileId,
  });
}

function finalizeAtlasManifest(params: {
  readonly config: AtlasConfigV1;
  readonly sectors: readonly SectorManifestV1[];
  readonly bounds: AtlasPartition['bounds'];
  readonly opts?: BuildAtlasManifestOptions;
}): AtlasManifestV1 {
  const { config, sectors, bounds, opts } = params;
  const atlasVersion = opts?.atlasVersion ?? W11_DEFAULT_ATLAS_VERSION;
  const resourceProfileId =
    opts?.resourceProfileId ??
    config.resourceProfileId ??
    defaultResourceProfileIdForType(config.planetType);
  const configHash = opts?.configHash ?? computeAtlasConfigHash(config);
  const planetEndowment = resolveSectorResourceProfile({
    planetId: config.planetId,
    planetType: config.planetType,
    sectorId: 'sec_0_0',
    kind: 'land',
    profileId: resourceProfileId,
    planetResourceProfileId: resourceProfileId,
    topologyVersion: config.topologyVersion,
    genVersion: config.genVersion,
    planetIdOverride: opts?.planetResourceOverride,
    config: opts?.regionalResourceConfig,
  });
  const canonicalSortedSectors = [...sectors].sort(
    (a, b) => a.macroQ - b.macroQ || a.macroR - b.macroR,
  );
  const resourceProfileHash =
    opts?.resourceProfileHash ??
    hashAtlasCanonicalJson({
      resourceProfileId,
      planetId: config.planetId,
      planetType: config.planetType,
      topologyVersion: config.topologyVersion,
      genVersion: config.genVersion,
      planetEndowmentHash: planetEndowment.sectorResourceHash,
      sectors: canonicalSortedSectors.map((s) => ({
        sectorId: s.sectorId,
        endowmentHash: s.resourceEndowment?.endowmentHash ?? planetEndowment.sectorResourceHash,
      })),
    });
  const landSectors = sectors.filter((s) => s.kind === 'land').length;
  const oceanSectors = sectors.length - landSectors;
  const nominalCapacity = sectors.reduce((sum, s) => sum + s.foundingCapacity, 0);
  const validatedCapacity = sectors.reduce((sum, s) => sum + s.validatedSafeSites, 0);

  const baseManifest: Omit<AtlasManifestV1, 'atlasHash'> = {
    planetId: config.planetId,
    planetType: config.planetType,
    look: planetLookForType(config.planetType),
    seed: config.seed,
    atlasVersion,
    topologyVersion: config.topologyVersion,
    genVersion: config.genVersion,
    configVersion: config.configVersion,
    configHash,
    resourceProfileId,
    resourceProfileHash,
    sectorRadius: config.sectorRadius,
    foundingSeatsPerSector: config.foundingSeatsPerSector,
    totalSectors: sectors.length,
    landSectors,
    oceanSectors,
    nominalCapacity,
    validatedCapacity,
    bounds: {
      minQ: bounds.minQ,
      maxQ: bounds.maxQ,
      minR: bounds.minR,
      maxR: bounds.maxR,
      totalTiles: bounds.totalTiles,
      maxColonies: opts?.maxColonies ?? W11_MAX_SMALL_ATLAS_COLONIES,
      maxSectors: opts?.maxSectors ?? Math.max(W11_MAX_SMALL_ATLAS_SECTORS, sectors.length),
    },
    sectors: [...sectors],
  };
  const atlasHash = opts?.atlasHash ?? computeAtlasManifestHash(baseManifest);
  return AtlasManifestV1Schema.parse({ ...baseManifest, atlasHash });
}

function buildManifestFromGeneratedAtlas(
  atlas: GeneratedSmallAtlas,
  opts?: BuildAtlasManifestOptions,
): AtlasManifestV1 {
  const planetType = atlas.planetType;
  const planetId = normalizePlanetIdForManifest(
    opts?.planetId ?? opts?.config?.planetId ?? atlas.planetId,
    planetType,
  );
  const seed = opts?.seed ?? opts?.config?.seed ?? atlas.seed;
  const topologyVersion =
    opts?.topologyVersion ?? opts?.config?.topologyVersion ?? W11_DEFAULT_TOPOLOGY_VERSION;
  const genVersion = opts?.genVersion ?? opts?.config?.genVersion ?? atlas.genVersion ?? GEN_VERSION;
  const configVersion =
    opts?.configVersion ?? opts?.config?.configVersion ?? W11_DEFAULT_CONFIG_VERSION;
  const resourceProfileId =
    opts?.resourceProfileId ??
    opts?.config?.resourceProfileId ??
    atlas.resourceProfileId ??
    defaultResourceProfileIdForType(planetType);
  const secCfgById = new Map<SectorId, SectorConfigV1>(
    (opts?.config?.sectors ?? []).map((s) => [s.sectorId, s]),
  );

  const config: AtlasConfigV1 =
    opts?.config ??
    buildDefaultAtlasConfig({
      planetId,
      planetType,
      seed,
      topologyVersion,
      genVersion,
      configVersion,
      sectorRadius: atlas.sectorRadius,
      foundingSeatsPerSector: atlas.foundingSeatsPerSector,
      resourceProfileId,
      sectors: atlas.sectors.map((sec) => {
        const arch = opts?.sectorArchetypes?.[sec.sectorId] ?? sec.archetype;
        if (sec.kind === 'land') {
          return {
            sectorId: sec.sectorId,
            continentId: sec.continentId ?? atlas.continentId,
            macroQ: sec.macroQ,
            macroR: sec.macroR,
            kind: 'land' as const,
            radius: sec.radius,
            foundingCapacity: sec.foundingCapacity,
            archetype: arch ?? defaultSectorArchetype(sec.macroQ, sec.macroR),
            resourceProfileId:
              opts?.sectorResourceOverrides?.[sec.sectorId]?.profileId ??
              (opts?.resourceProfileId ? resourceProfileId : sec.resourceProfileId ?? resourceProfileId),
          };
        }
        return {
          sectorId: sec.sectorId,
          continentId: null,
          macroQ: sec.macroQ,
          macroR: sec.macroR,
          kind: 'ocean' as const,
          radius: sec.radius,
          foundingCapacity: 0,
          ...(arch ? { archetype: arch } : {}),
        };
      }),
    });

  const sectors: SectorManifestV1[] = atlas.sectors.map((sec) => {
    const secCfg = secCfgById.get(sec.sectorId);
    const secProfileId =
      secCfg?.resourceProfileId ??
      opts?.sectorResourceOverrides?.[sec.sectorId]?.profileId ??
      (opts?.resourceProfileId ? resourceProfileId : sec.resourceProfileId ?? resourceProfileId);
    const archetype =
      secCfg?.archetype ??
      opts?.sectorArchetypes?.[sec.sectorId] ??
      sec.archetype ??
      (sec.kind === 'land' ? defaultSectorArchetype(sec.macroQ, sec.macroR) : undefined);
    return {
      sectorId: sec.sectorId, continentId: sec.continentId, macroQ: sec.macroQ, macroR: sec.macroR,
      centerQ: sec.centerQ, centerR: sec.centerR, kind: sec.kind, radius: sec.radius,
      tileCount: sec.tileCount, foundingCapacity: sec.foundingCapacity, validatedSafeSites: sec.validatedSafeSites,
      safeLandingSlots: sec.safeLandingSlots.map((slot) => ({ ...slot })),
      neighbours: sec.atlasNeighbors.map((nb) => ({ ...nb })),
      resourceEndowment: buildSectorResourceEndowment({
        planetId, planetType, sectorId: sec.sectorId, kind: sec.kind, profileId: secProfileId,
        topologyVersion, genVersion, archetype, planetResourceProfileId: resourceProfileId,
        planetIdOverride: opts?.planetResourceOverride,
        sectorIdOverride: opts?.sectorResourceOverrides?.[sec.sectorId],
        config: opts?.regionalResourceConfig,
      }),
    };
  });

  return finalizeAtlasManifest({ config, sectors, bounds: atlas.partition.bounds, opts });
}

function buildManifestFromConfig(
  config: AtlasConfigV1,
  opts?: BuildAtlasManifestOptions,
): AtlasManifestV1 {
  const landSpecs = config.sectors.filter((s) => s.kind === 'land');
  const oceanSpecs = config.sectors.filter((s) => s.kind === 'ocean');
  const continentId =
    landSpecs.find((s) => s.continentId !== null)?.continentId ?? formatContinentId(0);
  const partition = buildSmallAtlasPartition({
    sectorRadius: config.sectorRadius,
    landCoords: landSpecs.map((s) => [s.macroQ, s.macroR] as const),
    oceanCoords: oceanSpecs.map((s) => [s.macroQ, s.macroR] as const),
    includeOceanHalo: oceanSpecs.length > 0,
    continentId,
  });

  const sortedLandSpecs = [...landSpecs].sort((a, b) => a.macroQ - b.macroQ || a.macroR - b.macroR);
  const hasLandNeighborSec10 = landSpecs.some((s) => s.sectorId === 'sec_1_0');
  const slotsBySectorId = new Map<SectorId, readonly SafeLandingSlotV1[]>();
  const allSlots: SafeLandingSlotV1[] = [];
  for (const spec of sortedLandSpecs) {
    const planned = planSectorLandingSites({
      sectorId: spec.sectorId,
      kind: 'land',
      macroQ: spec.macroQ,
      macroR: spec.macroR,
      sectorRadius: spec.radius,
      foundingCapacity: spec.foundingCapacity,
      seed: config.seed,
      existingSlots: allSlots,
      hasLandNeighborSec10,
    });
    slotsBySectorId.set(spec.sectorId, planned.safeLandingSlots);
    allSlots.push(...planned.safeLandingSlots);
  }

  const resourceProfileId =
    opts?.resourceProfileId ??
    config.resourceProfileId ??
    defaultResourceProfileIdForType(config.planetType);

  const sectors: SectorManifestV1[] = config.sectors.map((spec) => {
    const secPart = partition.sectorById.get(spec.sectorId)!;
    const slots = spec.kind === 'land' ? [...(slotsBySectorId.get(spec.sectorId) ?? [])] : [];
    const secProfileId =
      spec.resourceProfileId ??
      opts?.sectorResourceOverrides?.[spec.sectorId]?.profileId ??
      resourceProfileId;
    const archetype =
      opts?.sectorArchetypes?.[spec.sectorId] ??
      spec.archetype ??
      (spec.kind === 'land' ? defaultSectorArchetype(spec.macroQ, spec.macroR) : undefined);
    return {
      sectorId: spec.sectorId, continentId: spec.continentId, macroQ: spec.macroQ, macroR: spec.macroR,
      centerQ: secPart.centerQ, centerR: secPart.centerR, kind: spec.kind, radius: spec.radius,
      tileCount: secPart.tileCount, foundingCapacity: spec.foundingCapacity, validatedSafeSites: slots.length,
      safeLandingSlots: slots, neighbours: secPart.atlasNeighbors.map((nb) => ({ ...nb })),
      resourceEndowment: buildSectorResourceEndowment({
        planetId: config.planetId, planetType: config.planetType, sectorId: spec.sectorId, kind: spec.kind,
        profileId: secProfileId, topologyVersion: config.topologyVersion, genVersion: config.genVersion,
        archetype, planetResourceProfileId: resourceProfileId,
        planetIdOverride: opts?.planetResourceOverride,
        sectorIdOverride: opts?.sectorResourceOverrides?.[spec.sectorId],
        config: opts?.regionalResourceConfig,
      }),
    };
  });

  return finalizeAtlasManifest({ config, sectors, bounds: partition.bounds, opts });
}

/**
 * Constructs a validated `AtlasManifestV1` from a `GeneratedSmallAtlas` or `AtlasConfigV1`.
 */
export function buildAtlasManifest(
  atlasOrConfig?: GeneratedSmallAtlas | AtlasConfigV1,
  opts?: BuildAtlasManifestOptions,
): AtlasManifestV1 {
  if (atlasOrConfig && isGeneratedSmallAtlas(atlasOrConfig)) {
    return buildManifestFromGeneratedAtlas(atlasOrConfig, opts);
  }
  const config = atlasOrConfig
    ? AtlasConfigV1Schema.parse(atlasOrConfig)
    : opts?.config
      ? AtlasConfigV1Schema.parse(opts.config)
      : buildDefaultAtlasConfig(opts);
  return buildManifestFromConfig(config, opts);
}
