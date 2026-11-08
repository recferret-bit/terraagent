import {
  AtlasManifestV1Schema,
  canonicalPlanetById,
  canonicalPlanetForType,
  formatContinentId,
  formatSectorId,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_SEVEN_SECTOR_COORDS,
  type AtlasManifestV1,
  type SectorId,
} from '@terra/contracts';
import { GEN_VERSION } from '../gen/generators';
import type { SpawnSlot } from '../gen/spawnSlots';
import { hexDistance, hexIndex } from '../grid/hex';
import { createState, setBlob, type Blob, type PlanetState, type PlanetType } from '../kernel/state';
import { validateAtlasLandingSites } from './landingSites';
import { buildAtlasManifest, cloneAtlasManifest } from './manifest';
import {
  createAtlasSamplerContext,
  sampleAtlasTile,
  sampleBaseAtlasTile,
  type AtlasSamplerContext,
} from './sampler';
import { buildSmallAtlasPartition } from './smallAtlas';
import {
  W11_OCEAN_HALO_SECTOR_COORDS,
  type AtlasBlobValue,
  type AtlasPartition,
  type AtlasSectorPartition,
  type BuildSmallAtlasPartitionOptions,
  type CreateAtlasPlanetOptions,
  type GeneratedAtlasSector,
  type GeneratedAtlasTile,
  type GeneratedSmallAtlas,
  type GenerateSmallAtlasOptions,
} from './types';
import { verifyAtlasConnectedContinent, verifyAtlasSeamContinuity } from './verifiers';

function isSameCoordSet(
  coords: readonly (readonly [number, number])[],
  canonical: readonly (readonly [number, number])[],
): boolean {
  if (coords.length !== canonical.length) return false;
  const setA = new Set(coords.map(([q, r]) => formatSectorId(q, r)));
  if (setA.size !== canonical.length) return false;
  return canonical.every(([q, r]) => setA.has(formatSectorId(q, r)));
}

function buildCanonicalPartitionOptions(opts?: GenerateSmallAtlasOptions): BuildSmallAtlasPartitionOptions {
  const rawLand = opts?.landCoords ?? W11_SEVEN_SECTOR_COORDS;
  const landCoords = isSameCoordSet(rawLand, W11_SEVEN_SECTOR_COORDS)
    ? W11_SEVEN_SECTOR_COORDS
    : [...rawLand].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let oceanCoords = opts?.oceanCoords;
  if (oceanCoords) {
    oceanCoords = isSameCoordSet(oceanCoords, W11_OCEAN_HALO_SECTOR_COORDS)
      ? W11_OCEAN_HALO_SECTOR_COORDS
      : [...oceanCoords].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  return {
    sectorRadius: opts?.sectorRadius,
    landCoords,
    ...(oceanCoords ? { oceanCoords } : {}),
    includeOceanHalo: opts?.includeOceanHalo,
    continentId: opts?.continentId,
  };
}

function resolveGenerationOrder(
  partition: AtlasPartition,
  opts?: GenerateSmallAtlasOptions,
): SectorId[] {
  if (opts?.sectorOrder) {
    if (opts.sectorOrder.length !== partition.sectors.length) {
      throw new RangeError(
        `sectorOrder length (${opts.sectorOrder.length}) must equal partition sector count (${partition.sectors.length})`,
      );
    }
    const seen = new Set<SectorId>();
    const out: SectorId[] = [];
    for (const id of opts.sectorOrder) {
      if (!partition.sectorById.has(id)) {
        throw new RangeError(`sectorOrder contains unknown sectorId "${id}"`);
      }
      if (seen.has(id)) {
        throw new RangeError(`sectorOrder contains duplicate sectorId "${id}"`);
      }
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  if (opts?.landCoords || opts?.oceanCoords) {
    const requested: SectorId[] = [];
    const seen = new Set<SectorId>();
    for (const [mq, mr] of opts.landCoords ?? W11_SEVEN_SECTOR_COORDS) {
      const id = formatSectorId(mq, mr);
      if (partition.sectorById.has(id) && !seen.has(id)) {
        seen.add(id);
        requested.push(id);
      }
    }
    for (const [mq, mr] of opts.oceanCoords ?? []) {
      const id = formatSectorId(mq, mr);
      if (partition.sectorById.has(id) && !seen.has(id)) {
        seen.add(id);
        requested.push(id);
      }
    }
    for (const sec of partition.sectors) {
      if (!seen.has(sec.sectorId)) {
        seen.add(sec.sectorId);
        requested.push(sec.sectorId);
      }
    }
    return requested;
  }

  return partition.sectors.map((s) => s.sectorId);
}

interface AtlasLayerBuffers {
  terrain: Uint8Array;
  prep: Uint8Array;
  height: Float32Array;
  deposit: Uint8Array;
  depositTier: Uint8Array;
  richness: Float32Array;
  subDeposit: Uint8Array;
  subRichness: Float32Array;
}

function createAtlasLayerBuffers(count: number): AtlasLayerBuffers {
  return {
    terrain: new Uint8Array(count),
    prep: new Uint8Array(count),
    height: new Float32Array(count),
    deposit: new Uint8Array(count),
    depositTier: new Uint8Array(count),
    richness: new Float32Array(count),
    subDeposit: new Uint8Array(count),
    subRichness: new Float32Array(count),
  };
}

function generateSectorBuffers(
  secPart: AtlasSectorPartition,
  foundingSeatsPerSector: number,
  samplerCtx: AtlasSamplerContext,
  atlasLayers: AtlasLayerBuffers,
): GeneratedAtlasSector {
  const secLayers = createAtlasLayerBuffers(secPart.tileCount);
  const atlasOffset = secPart.ordinal * secPart.tileCount;

  for (const st of secPart.tiles) {
    const idx = st.localIndex;
    const sampled = sampleAtlasTile(st.q, st.r, samplerCtx);
    secLayers.terrain[idx] = sampled.terrain;
    secLayers.prep[idx] = sampled.prep;
    secLayers.height[idx] = sampled.height;
    secLayers.deposit[idx] = sampled.deposit;
    secLayers.depositTier[idx] = sampled.depositTier;
    secLayers.richness[idx] = sampled.richness;
    secLayers.subDeposit[idx] = sampled.subDeposit;
    secLayers.subRichness[idx] = sampled.subRichness;

    const aIdx = atlasOffset + idx;
    atlasLayers.terrain[aIdx] = sampled.terrain;
    atlasLayers.prep[aIdx] = sampled.prep;
    atlasLayers.height[aIdx] = sampled.height;
    atlasLayers.deposit[aIdx] = sampled.deposit;
    atlasLayers.depositTier[aIdx] = sampled.depositTier;
    atlasLayers.richness[aIdx] = sampled.richness;
    atlasLayers.subDeposit[aIdx] = sampled.subDeposit;
    atlasLayers.subRichness[aIdx] = sampled.subRichness;
  }

  const sectorSlots =
    secPart.kind === 'land' ? [...(samplerCtx.landingPlan.slotsBySectorId.get(secPart.sectorId) ?? [])] : [];
  const resourceProfile =
    samplerCtx.regionalResources.sectorById.get(secPart.sectorId) ?? samplerCtx.regionalResources.planetEndowment;

  return {
    sectorId: secPart.sectorId, ordinal: secPart.ordinal, kind: secPart.kind, continentId: secPart.continentId,
    macroQ: secPart.macroQ, macroR: secPart.macroR, centerQ: secPart.centerQ, centerR: secPart.centerR,
    radius: secPart.radius, tileCount: secPart.tileCount,
    foundingCapacity: secPart.kind === 'land' ? foundingSeatsPerSector : 0,
    validatedSafeSites: sectorSlots.length, safeLandingSlots: sectorSlots,
    ...(resourceProfile.archetype ? { archetype: resourceProfile.archetype } : {}),
    resourceProfileId: resourceProfile.profileId, sectorResourceHash: resourceProfile.sectorResourceHash,
    mainResource: resourceProfile.mainResource, scarceResources: resourceProfile.scarceResources,
    resourceEndowment: resourceProfile.manifestHook, resourceProfile,
    neighbors: secPart.neighbors, atlasNeighbors: secPart.atlasNeighbors,
    tiles: secPart.tiles, seamTiles: secPart.seamTiles, ...secLayers,
  };
}

function createLiveTileReader(
  partition: AtlasPartition,
  samplerCtx: AtlasSamplerContext,
  sectorById: Map<SectorId, GeneratedAtlasSector>,
  atlasLayers: AtlasLayerBuffers,
): (q: number, r: number) => GeneratedAtlasTile | null {
  return (q: number, r: number): GeneratedAtlasTile | null => {
    const owner = partition.getTile(q, r);
    if (!owner) return null;
    const sec = sectorById.get(owner.sectorId);
    const base = sampleBaseAtlasTile(q, r, samplerCtx);
    const aIdx = owner.atlasIndex;
    const lIdx = owner.localIndex;
    return {
      ...owner,
      continentId: sec ? sec.continentId : null,
      distanceToOcean: base.distanceToOcean,
      distanceToLand: base.distanceToLand,
      terrain: sec ? sec.terrain[lIdx]! : atlasLayers.terrain[aIdx]!,
      prep: sec ? sec.prep[lIdx]! : atlasLayers.prep[aIdx]!,
      height: sec ? sec.height[lIdx]! : atlasLayers.height[aIdx]!,
      deposit: sec ? sec.deposit[lIdx]! : atlasLayers.deposit[aIdx]!,
      depositTier: sec ? sec.depositTier[lIdx]! : atlasLayers.depositTier[aIdx]!,
      richness: sec ? sec.richness[lIdx]! : atlasLayers.richness[aIdx]!,
      subDeposit: sec ? sec.subDeposit[lIdx]! : atlasLayers.subDeposit[aIdx]!,
      subRichness: sec ? sec.subRichness[lIdx]! : atlasLayers.subRichness[aIdx]!,
    };
  };
}

export function generateSmallAtlas(opts?: GenerateSmallAtlasOptions): GeneratedSmallAtlas {
  const byId = opts?.planetId ? canonicalPlanetById(opts.planetId) : null;
  const planetType: PlanetType = opts?.planetType ?? byId?.type ?? 'temperate';
  const canonical = canonicalPlanetForType(planetType);
  const planetId = opts?.planetId ?? canonical.id;
  const seed = opts?.seed ?? canonical.seed;
  const sectorRadius = opts?.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const foundingSeatsPerSector = opts?.foundingSeatsPerSector ?? W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  if (!Number.isSafeInteger(foundingSeatsPerSector) || foundingSeatsPerSector <= 0) {
    throw new RangeError(`foundingSeatsPerSector must be a positive integer, got ${foundingSeatsPerSector}`);
  }
  const continentId = opts?.continentId ?? formatContinentId(0);

  const partition = buildSmallAtlasPartition(buildCanonicalPartitionOptions({ ...opts, sectorRadius, continentId }));
  const generationOrder = resolveGenerationOrder(partition, opts);
  const samplerCtx = createAtlasSamplerContext({ ...opts, planetId, planetType, seed, sectorRadius, continentId });

  const atlasLayers = createAtlasLayerBuffers(partition.bounds.totalTiles);
  const sectorById = new Map<SectorId, GeneratedAtlasSector>();

  for (const sectorId of generationOrder) {
    const secPart = partition.sectorById.get(sectorId)!;
    sectorById.set(
      sectorId,
      generateSectorBuffers(secPart, foundingSeatsPerSector, samplerCtx, atlasLayers),
    );
  }

  const sectors = partition.sectors.map((s) => sectorById.get(s.sectorId)!);
  const nominalCapacity = sectors.reduce((sum, s) => sum + s.foundingCapacity, 0);
  const safeLandingSlots = sectors.flatMap((s) => s.safeLandingSlots);
  const readTileLive = createLiveTileReader(partition, samplerCtx, sectorById, atlasLayers);

  let cachedValidation: GeneratedSmallAtlas['landingValidation'] | null = null;
  const atlas: GeneratedSmallAtlas = {
    planetId,
    planetType,
    seed,
    genVersion: GEN_VERSION,
    resourceProfileId: samplerCtx.regionalResources.resourceProfileId,
    resourceProfileHash: samplerCtx.regionalResources.resourceProfileHash,
    regionalResources: samplerCtx.regionalResources,
    sectorRadius,
    tilesPerSector: partition.tilesPerSector,
    foundingSeatsPerSector,
    nominalCapacity,
    validatedCapacity: safeLandingSlots.length,
    safeLandingSlots,
    get landingValidation() {
      return (cachedValidation ??= validateAtlasLandingSites(atlas));
    },
    continentId,
    generationOrder,
    partition,
    sectors,
    sectorById,
    landSectorIds: partition.landSectorIds,
    oceanSectorIds: partition.oceanSectorIds,
    ...atlasLayers,
    getTile: readTileLive,
    sampleGlobalTile: (q: number, r: number) => sampleAtlasTile(q, r, samplerCtx),
    verifySeamContinuity: (seamOpts) => verifyAtlasSeamContinuity(atlas, seamOpts),
    verifyConnectedContinent: () => verifyAtlasConnectedContinent(atlas),
    validateLandingSites: (vOpts) => validateAtlasLandingSites(atlas, vOpts),
  };
  return atlas;
}

function defaultGridRadiusForAtlas(atlas: GeneratedSmallAtlas): number {
  let maxLandDist = atlas.sectorRadius;
  for (const sectorId of atlas.landSectorIds) {
    const sec = atlas.sectorById.get(sectorId);
    if (!sec) continue;
    for (const t of sec.tiles) {
      const d = hexDistance(0, 0, t.q, t.r);
      if (d > maxLandDist) maxLandDist = d;
    }
  }
  return maxLandDist + 3;
}

function resolveAtlasForPlanetState(opts?: CreateAtlasPlanetOptions): GeneratedSmallAtlas {
  if (opts?.atlas) return opts.atlas;
  if (opts?.manifest) {
    const m = AtlasManifestV1Schema.parse(opts.manifest);
    const landCoords = m.sectors.filter((s) => s.kind === 'land').map((s) => [s.macroQ, s.macroR] as const);
    const oceanCoords = m.sectors.filter((s) => s.kind === 'ocean').map((s) => [s.macroQ, s.macroR] as const);
    const continentId =
      m.sectors.find((s) => s.kind === 'land' && s.continentId !== null)?.continentId ?? formatContinentId(0);
    return generateSmallAtlas({
      planetId: m.planetId,
      planetType: m.planetType,
      seed: m.seed,
      resourceProfileId: m.resourceProfileId,
      sectorRadius: m.sectorRadius,
      foundingSeatsPerSector: m.foundingSeatsPerSector,
      landCoords,
      oceanCoords,
      includeOceanHalo: oceanCoords.length > 0,
      continentId,
      worldSalt: opts.worldSalt,
      regionalResourceConfig: opts.regionalResourceConfig,
      sectorArchetypes: opts.sectorArchetypes,
      sectorResourceOverrides: opts.sectorResourceOverrides,
      planetResourceOverride: opts.planetResourceOverride,
    });
  }
  return generateSmallAtlas(opts);
}

function buildAtlasBlobForState(atlas: GeneratedSmallAtlas, manifest: AtlasManifestV1): AtlasBlobValue {
  const manifestSectorById = new Map(manifest.sectors.map((s) => [s.sectorId, s]));
  return {
    planetId: atlas.planetId,
    planetType: atlas.planetType,
    seed: atlas.seed,
    genVersion: atlas.genVersion,
    atlasVersion: manifest.atlasVersion,
    topologyVersion: manifest.topologyVersion,
    configVersion: manifest.configVersion,
    configHash: manifest.configHash,
    atlasHash: manifest.atlasHash,
    resourceProfileId: manifest.resourceProfileId,
    resourceProfileHash: manifest.resourceProfileHash,
    manifest,
    sectorRadius: atlas.sectorRadius,
    tilesPerSector: atlas.tilesPerSector,
    foundingSeatsPerSector: manifest.foundingSeatsPerSector,
    nominalCapacity: manifest.nominalCapacity,
    validatedCapacity: manifest.validatedCapacity,
    safeLandingSlots: manifest.sectors.flatMap((s) => s.safeLandingSlots.map((sl) => ({ ...sl }))),
    continentId: atlas.continentId,
    landSectorIds: [...atlas.landSectorIds],
    oceanSectorIds: [...atlas.oceanSectorIds],
    bounds: { ...atlas.partition.bounds },
    sectors: atlas.sectors.map((s) => {
      const mSec = manifestSectorById.get(s.sectorId);
      const slots = (mSec?.safeLandingSlots ?? s.safeLandingSlots).map((sl) => ({ ...sl }));
      const validated = mSec?.validatedSafeSites ?? s.validatedSafeSites;
      const endow = mSec?.resourceEndowment ?? s.resourceEndowment;
      return {
        sectorId: s.sectorId, ordinal: s.ordinal, kind: s.kind, continentId: s.continentId,
        macroQ: s.macroQ, macroR: s.macroR, centerQ: s.centerQ, centerR: s.centerR,
        radius: s.radius, tileCount: s.tileCount,
        foundingCapacity: mSec?.foundingCapacity ?? s.foundingCapacity,
        validatedSafeSites: validated, safeLandingSlots: slots,
        ...(s.archetype ? { archetype: s.archetype } : {}),
        resourceProfileId: endow.profileId,
        sectorResourceHash: endow.endowmentHash,
        mainResource: endow.mainResource ?? s.mainResource,
        scarceResources: [...(endow.scarceResources ?? s.scarceResources)],
        resourceEndowment: endow,
        foundedSeats: 0, freeSeats: validated, livingColonies: 0, presentColonies: 0,
      };
    }),
    foundingSectorByColony: {},
    presentSectorsByColony: {},
  };
}

export function createAtlasPlanetState(opts?: CreateAtlasPlanetOptions): PlanetState {
  const atlas = resolveAtlasForPlanetState(opts);
  const manifest = opts?.manifest
    ? cloneAtlasManifest(AtlasManifestV1Schema.parse(opts.manifest))
    : buildAtlasManifest(atlas, {
        config: opts?.config,
        resourceProfileId: opts?.resourceProfileId,
        regionalResourceConfig: opts?.regionalResourceConfig,
        sectorArchetypes: opts?.sectorArchetypes,
        sectorResourceOverrides: opts?.sectorResourceOverrides,
        planetResourceOverride: opts?.planetResourceOverride,
      });
  const gridRadius = opts?.gridRadius ?? defaultGridRadiusForAtlas(atlas);
  if (!Number.isSafeInteger(gridRadius) || gridRadius <= 0) {
    throw new RangeError(`gridRadius must be a positive integer, got ${gridRadius}`);
  }

  const state = createState({
    planetId: atlas.planetId,
    planetType: atlas.planetType,
    seed: atlas.seed,
    radius: gridRadius,
  });
  state.meta.genVersion = GEN_VERSION;
  if (opts?.worldSalt) state.meta.worldSalt = opts.worldSalt;

  const hex = hexIndex(gridRadius);
  const L = state.grid.layers;
  const terrain = L.terrain as Uint8Array;
  const prep = L.prep as Uint8Array;
  const height = L.height as Float32Array;
  const deposit = L.deposit as Uint8Array;
  const depositTier = L.depositTier as Uint8Array | undefined;
  const richness = L.richness as Float32Array;
  const subDeposit = L.subDeposit as Uint8Array | undefined;
  const subRichness = L.subRichness as Float32Array | undefined;

  for (let i = 0; i < hex.count; i++) {
    const q = hex.q[i]!;
    const r = hex.r[i]!;
    const owner = atlas.partition.getTile(q, r);
    if (owner) {
      const aIdx = owner.atlasIndex;
      terrain[i] = atlas.terrain[aIdx]!;
      prep[i] = atlas.prep[aIdx]!;
      height[i] = atlas.height[aIdx]!;
      deposit[i] = atlas.deposit[aIdx]!;
      if (depositTier) depositTier[i] = atlas.depositTier[aIdx]!;
      richness[i] = atlas.richness[aIdx]!;
      if (subDeposit) subDeposit[i] = atlas.subDeposit[aIdx]!;
      if (subRichness) subRichness[i] = atlas.subRichness[aIdx]!;
    } else {
      const tile = atlas.sampleGlobalTile(q, r);
      terrain[i] = tile.terrain;
      prep[i] = tile.prep;
      height[i] = tile.height;
      deposit[i] = tile.deposit;
      if (depositTier) depositTier[i] = tile.depositTier;
      richness[i] = tile.richness;
      if (subDeposit) subDeposit[i] = tile.subDeposit;
      if (subRichness) subRichness[i] = tile.subRichness;
    }
  }

  const blobValue = buildAtlasBlobForState(atlas, manifest);
  setBlob(state, 'atlas', blobValue, state.meta.tick);
  const spawnSlots: SpawnSlot[] = blobValue.safeLandingSlots.map((slot, index) => ({
    index,
    q: slot.q,
    r: slot.r,
    sectorId: slot.sectorId,
    slotId: slot.slotId,
    landingSlotId: slot.slotId,
    sectorSlotIndex: slot.slotIndex,
  }));
  setBlob(state, 'spawnSlots', spawnSlots, state.meta.tick);
  return state;
}

export function getAtlasBlob(state: PlanetState): AtlasBlobValue | null {
  const raw = state.blobs.atlas as Blob | AtlasBlobValue | undefined;
  if (!raw) return null;
  if ('value' in raw && raw.value && typeof raw.value === 'object') {
    return raw.value as AtlasBlobValue;
  }
  return raw as AtlasBlobValue;
}
