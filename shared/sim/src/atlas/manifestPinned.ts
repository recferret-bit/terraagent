import {
  AtlasManifestV1Schema,
  formatContinentId,
  planetLookForType,
  W11_MAX_SMALL_ATLAS_COLONIES,
  W11_MAX_SMALL_ATLAS_SECTORS,
  type AtlasConfigV1,
  type AtlasManifestV1,
  type SafeLandingSlotV1,
  type SectorId,
  type SectorManifestV1,
} from '@terra/contracts';
import { GEN_VERSION } from '../gen/generators';
import type { PlanetState } from '../kernel/state';
import { createAtlasPlanetState, getAtlasBlob } from './generateAtlas';
import {
  buildAtlasManifest,
  buildDefaultAtlasConfig,
  buildSectorResourceEndowment,
  defaultResourceProfileIdForType,
  defaultSectorArchetype,
  isAtlasManifestV1,
  isGeneratedSmallAtlas,
  normalizePlanetIdForManifest,
  W11_DEFAULT_ATLAS_VERSION,
  W11_DEFAULT_CONFIG_VERSION,
  W11_DEFAULT_TOPOLOGY_VERSION,
  type BuildAtlasManifestOptions,
  type PinnedAtlasManifestSource,
} from './manifest';
import {
  computeAtlasConfigHash,
  computeAtlasManifestHash,
  computeResourceProfileHash,
} from './manifestHash';
import {
  cloneAtlasManifest,
  createAtlasQueryViewFromManifest,
  type AtlasQueryInterface,
  type AtlasQuerySource,
} from './manifestQuery';
import { macroNeighbors } from './partition';
import type { AtlasBlobValue, CreateAtlasPlanetOptions } from './types';

function reconstructSectorsFromBlob(
  blob: AtlasBlobValue,
  resourceProfileId: string,
  topologyVersion: number,
  genVersion: number,
): SectorManifestV1[] {
  const knownSectorIds = new Set<SectorId>(blob.sectors.map((s) => s.sectorId));
  const slotsBySector = new Map<SectorId, SafeLandingSlotV1[]>();
  for (const s of blob.safeLandingSlots) {
    const list = slotsBySector.get(s.sectorId) ?? [];
    list.push({ ...s });
    slotsBySector.set(s.sectorId, list);
  }

  return blob.sectors.map((sec) => {
    const slots =
      sec.safeLandingSlots?.map((s) => ({ ...s })) ?? slotsBySector.get(sec.sectorId) ?? [];
    return {
      sectorId: sec.sectorId,
      continentId: sec.continentId,
      macroQ: sec.macroQ,
      macroR: sec.macroR,
      centerQ: sec.centerQ,
      centerR: sec.centerR,
      kind: sec.kind,
      radius: sec.radius,
      tileCount: sec.tileCount,
      foundingCapacity: sec.foundingCapacity,
      validatedSafeSites: sec.validatedSafeSites ?? slots.length,
      safeLandingSlots: slots,
      neighbours: macroNeighbors(sec.macroQ, sec.macroR, blob.sectorRadius, knownSectorIds),
      resourceEndowment: buildSectorResourceEndowment({
        planetType: blob.planetType,
        sectorId: sec.sectorId,
        kind: sec.kind,
        profileId: resourceProfileId,
        topologyVersion,
        genVersion,
        archetype: sec.kind === 'land' ? defaultSectorArchetype(sec.macroQ, sec.macroR) : undefined,
        planetResourceProfileId: resourceProfileId,
      }),
    };
  });
}

function reconstructManifestFromBlob(blob: AtlasBlobValue): AtlasManifestV1 {
  if (blob.manifest) {
    return cloneAtlasManifest(AtlasManifestV1Schema.parse(blob.manifest));
  }
  const planetId = normalizePlanetIdForManifest(blob.planetId, blob.planetType);
  const topologyVersion = blob.topologyVersion ?? W11_DEFAULT_TOPOLOGY_VERSION;
  const genVersion = blob.genVersion ?? GEN_VERSION;
  const configVersion = blob.configVersion ?? W11_DEFAULT_CONFIG_VERSION;
  const resourceProfileId =
    blob.resourceProfileId ?? defaultResourceProfileIdForType(blob.planetType);

  const config = buildDefaultAtlasConfig({
    planetId,
    planetType: blob.planetType,
    seed: blob.seed,
    topologyVersion,
    genVersion,
    configVersion,
    sectorRadius: blob.sectorRadius,
    foundingSeatsPerSector: blob.foundingSeatsPerSector,
    resourceProfileId,
    sectors: blob.sectors.map((sec) =>
      sec.kind === 'land'
        ? {
            sectorId: sec.sectorId,
            continentId: sec.continentId ?? blob.continentId,
            macroQ: sec.macroQ,
            macroR: sec.macroR,
            kind: 'land' as const,
            radius: sec.radius,
            foundingCapacity: sec.foundingCapacity,
            archetype: defaultSectorArchetype(sec.macroQ, sec.macroR),
            resourceProfileId,
          }
        : {
            sectorId: sec.sectorId,
            continentId: null,
            macroQ: sec.macroQ,
            macroR: sec.macroR,
            kind: 'ocean' as const,
            radius: sec.radius,
            foundingCapacity: 0,
          },
    ),
  });

  const sectors = reconstructSectorsFromBlob(
    blob,
    resourceProfileId,
    topologyVersion,
    genVersion,
  );
  const landSectors = sectors.filter((s) => s.kind === 'land').length;
  const oceanSectors = sectors.length - landSectors;
  const baseManifest: Omit<AtlasManifestV1, 'atlasHash'> = {
    planetId,
    planetType: blob.planetType,
    look: planetLookForType(blob.planetType),
    seed: blob.seed,
    atlasVersion: blob.atlasVersion ?? W11_DEFAULT_ATLAS_VERSION,
    topologyVersion,
    genVersion,
    configVersion,
    configHash: blob.configHash ?? computeAtlasConfigHash(config),
    resourceProfileId,
    resourceProfileHash:
      blob.resourceProfileHash ??
      computeResourceProfileHash({
        resourceProfileId,
        planetType: blob.planetType,
        topologyVersion,
        genVersion,
      }),
    sectorRadius: blob.sectorRadius,
    foundingSeatsPerSector: blob.foundingSeatsPerSector,
    totalSectors: sectors.length,
    landSectors,
    oceanSectors,
    nominalCapacity: sectors.reduce((sum, s) => sum + s.foundingCapacity, 0),
    validatedCapacity: sectors.reduce((sum, s) => sum + s.validatedSafeSites, 0),
    bounds: {
      ...blob.bounds,
      maxColonies: W11_MAX_SMALL_ATLAS_COLONIES,
      maxSectors: Math.max(W11_MAX_SMALL_ATLAS_SECTORS, sectors.length),
    },
    sectors,
  };
  const atlasHash = blob.atlasHash ?? computeAtlasManifestHash(baseManifest);
  return AtlasManifestV1Schema.parse({ ...baseManifest, atlasHash });
}

export function extractPinnedAtlasManifest(
  source: PinnedAtlasManifestSource | null | undefined,
): AtlasManifestV1 | null {
  if (!source || typeof source !== 'object') return null;
  if (isAtlasManifestV1(source)) {
    return cloneAtlasManifest(AtlasManifestV1Schema.parse(source));
  }
  if ('blobs' in source && source.blobs && typeof source.blobs === 'object') {
    const blob = getAtlasBlob(source as PlanetState);
    return blob ? reconstructManifestFromBlob(blob) : null;
  }
  if ('sectors' in source && 'safeLandingSlots' in source && 'planetType' in source) {
    return reconstructManifestFromBlob(source as AtlasBlobValue);
  }
  const wrapper = source as {
    readonly manifest?: AtlasManifestV1 | null;
    readonly pinnedManifest?: AtlasManifestV1 | null;
    readonly state?: PlanetState | null;
    readonly blob?: AtlasBlobValue | null;
  };
  if (wrapper.manifest) return cloneAtlasManifest(AtlasManifestV1Schema.parse(wrapper.manifest));
  if (wrapper.pinnedManifest) {
    return cloneAtlasManifest(AtlasManifestV1Schema.parse(wrapper.pinnedManifest));
  }
  if (wrapper.blob) return reconstructManifestFromBlob(wrapper.blob);
  if (wrapper.state) {
    const blob = getAtlasBlob(wrapper.state);
    return blob ? reconstructManifestFromBlob(blob) : null;
  }
  return null;
}

/**
 * Resolves the authoritative `AtlasManifestV1` for a world: if a pinned manifest/state/blob exists,
 * returns the exact pinned manifest unchanged even when runtime `defaultOpts` have changed on restart.
 */
export function resolvePinnedOrDefaultAtlasManifest(
  pinnedSource?: PinnedAtlasManifestSource | null,
  defaultOpts?: BuildAtlasManifestOptions,
): AtlasManifestV1 {
  const pinned = extractPinnedAtlasManifest(pinnedSource);
  if (pinned) return pinned;
  return buildAtlasManifest(undefined, defaultOpts);
}

/**
 * Restores or creates an atlas `PlanetState` strictly from its pinned `AtlasManifestV1`,
 * ignoring any changed default rollout parameters in `fallbackOpts`.
 */
export function createPlanetStateFromPinnedManifest(
  pinnedSource: PinnedAtlasManifestSource,
  fallbackOpts?: CreateAtlasPlanetOptions,
): PlanetState {
  const manifest = resolvePinnedOrDefaultAtlasManifest(pinnedSource, fallbackOpts);
  const landCoords = manifest.sectors
    .filter((s) => s.kind === 'land')
    .map((s) => [s.macroQ, s.macroR] as const);
  const oceanCoords = manifest.sectors
    .filter((s) => s.kind === 'ocean')
    .map((s) => [s.macroQ, s.macroR] as const);
  const continentId =
    manifest.sectors.find((s) => s.kind === 'land' && s.continentId !== null)?.continentId ??
    formatContinentId(0);

  return createAtlasPlanetState({
    planetId: manifest.planetId,
    planetType: manifest.planetType,
    seed: manifest.seed,
    sectorRadius: manifest.sectorRadius,
    foundingSeatsPerSector: manifest.foundingSeatsPerSector,
    landCoords,
    oceanCoords,
    includeOceanHalo: oceanCoords.length > 0,
    continentId,
    gridRadius: fallbackOpts?.gridRadius,
    worldSalt: fallbackOpts?.worldSalt,
    manifest,
  });
}

/**
 * Creates a read-only `AtlasQueryInterface` over an `AtlasManifestV1`, `GeneratedSmallAtlas`,
 * `AtlasConfigV1`, `PlanetState`, or `AtlasBlobValue`.
 */
export function createAtlasQueryView(input: AtlasQuerySource): AtlasQueryInterface {
  if (isAtlasManifestV1(input)) {
    return createAtlasQueryViewFromManifest(AtlasManifestV1Schema.parse(input));
  }
  if (isGeneratedSmallAtlas(input)) {
    return createAtlasQueryViewFromManifest(buildAtlasManifest(input));
  }
  const extracted = extractPinnedAtlasManifest(input as PinnedAtlasManifestSource);
  if (extracted) {
    return createAtlasQueryViewFromManifest(extracted);
  }
  return createAtlasQueryViewFromManifest(buildAtlasManifest(input as AtlasConfigV1));
}
