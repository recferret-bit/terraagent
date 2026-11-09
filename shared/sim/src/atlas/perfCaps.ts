import {
  CANONICAL_PLANET_IDS,
  W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR,
  W11_DEFAULT_LAND_SECTORS,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_MAX_SMALL_ATLAS_COLONIES,
  W11_MAX_SMALL_ATLAS_SECTORS,
  W11_MAX_SMALL_ATLAS_TILES,
  W11_SUPPORTED_FOUNDING_SEATS,
  type AtlasConfigV1,
  type AtlasManifestV1,
  type SectorConfigV1,
  type SectorManifestV1,
} from '@terra/contracts';
import { hexCount, hexDistance } from '../grid/hex';
import { MAX_DIFF_PAYLOAD_BYTES, MAX_TILE_DIFF_PER_DELTA } from '../host/diff';
import type { PlanetState } from '../kernel/state';
import type {
  CreateAtlasPlanetOptions,
  GeneratedSmallAtlas,
  GenerateSmallAtlasOptions,
} from './types';

export const W11_SUPPORTED_SCALE_ID = 'w11_small_atlas_7_land_19_total' as const;

export interface SmallAtlasPerfCaps {
  readonly supportedScale: typeof W11_SUPPORTED_SCALE_ID;
  readonly w27ScaleClaimed: false;
  readonly maxTotalSectors: number;
  readonly maxLandSectors: number;
  readonly maxOceanSectors: number;
  readonly maxContinents: number;
  readonly maxContinentCount: number;
  readonly maxSectorRadius: number;
  readonly maxTilesPerSector: number;
  readonly maxTotalTiles: number;
  readonly maxTotalTilesHardCeiling: number;
  readonly maxPlanetGridRadius: number;
  readonly maxFoundingSeatsPerSector: number;
  readonly defaultFoundingSeatsPerSector: number;
  readonly supportedFoundingSeatsPerSector: readonly [3, 4, 5];
  readonly maxTotalFoundingSeatsPerWorld: number;
  readonly defaultTotalFoundingSeatsPerWorld: number;
  readonly maxColoniesPerWorld: number;
  readonly maxCanonicalWorlds: number;
  readonly maxSnapshotRawBytes: number;
  readonly maxDeltaWireBytesPerChunk: number;
  readonly maxDeltaTilesPerChunk: number;
  readonly maxSimStepP95Ms: number;
  readonly maxMapRasterScanPaintMs: number;
  readonly maxGenTimeMs: number;
  readonly maxHeapDeltaBytesPerWorld: number;
  readonly maxEstimatedAllocationBytes: number;
}

/**
 * Enforced W11 small-atlas configuration & performance budget caps (`W11-43`, `MATCHMAKING.md` §0).
 * Explicitly pins `w27ScaleClaimed: false` — W11 small-atlas benchmarks never claim W27's 150/450-sector scale.
 */
export const W11_SMALL_ATLAS_PERF_CAPS: SmallAtlasPerfCaps = {
  supportedScale: W11_SUPPORTED_SCALE_ID,
  w27ScaleClaimed: false,
  maxTotalSectors: W11_MAX_SMALL_ATLAS_SECTORS, // 19 (1 center + 6 inner + 12 outer)
  maxLandSectors: W11_DEFAULT_LAND_SECTORS, // 7
  maxOceanSectors: 12,
  maxContinents: 1,
  maxContinentCount: 1,
  maxSectorRadius: W11_DEFAULT_SECTOR_RADIUS, // 48 (7,057 tiles/sector)
  maxTilesPerSector: 7_057,
  maxTotalTiles: 134_083, // 19 * 7,057
  maxTotalTilesHardCeiling: W11_MAX_SMALL_ATLAS_TILES, // 140,000
  maxPlanetGridRadius: 64, // single-sector in-game PlanetState.grid radius is 48 (7,057 grid tiles)
  maxFoundingSeatsPerSector: 5, // default X=4, validated for X=3|4|5
  defaultFoundingSeatsPerSector: W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR, // 4
  supportedFoundingSeatsPerSector: W11_SUPPORTED_FOUNDING_SEATS, // [3, 4, 5]
  maxTotalFoundingSeatsPerWorld: 35, // 7 * 5 (default 28 at X=4)
  defaultTotalFoundingSeatsPerWorld: 28,
  maxColoniesPerWorld: W11_MAX_SMALL_ATLAS_COLONIES, // 64
  maxCanonicalWorlds: 3, // desert, ocean, temperate
  maxSnapshotRawBytes: 8 * 1024 * 1024, // 8 MB uncompressed ceiling (typical < 1.5 MB)
  maxDeltaWireBytesPerChunk: MAX_DIFF_PAYLOAD_BYTES, // 8,192 bytes
  maxDeltaTilesPerChunk: MAX_TILE_DIFF_PER_DELTA, // 100 tiles
  maxSimStepP95Ms: 50, // 20 Hz / 50 ms step budget (typical < 10 ms)
  maxMapRasterScanPaintMs: 16, // 16 ms browser frame budget for 7-sector 256x256 raster scan/paint
  maxGenTimeMs: 1_500, // 1,500 ms generation budget for 134,083-tile small atlas
  maxHeapDeltaBytesPerWorld: 64 * 1024 * 1024, // 64 MB per small-atlas world
  maxEstimatedAllocationBytes: 32 * 1024 * 1024, // 32 MB pre-allocation TypedArray ceiling
} as const;

export const W11_PUBLISHED_SMALL_ATLAS_FIXTURE = {
  fixtureId: 'w11-canonical-small-atlas-7land-19total-r48-x4',
  supportedScale: W11_SUPPORTED_SCALE_ID,
  w27ScaleClaimed: false as const,
  canonicalPlanetIds: CANONICAL_PLANET_IDS,
  canonicalWorldCount: 3,
  totalSectors: 19,
  landSectors: 7,
  oceanSectors: 12,
  continentCount: 1,
  sectorRadius: 48,
  tilesPerSector: 7_057,
  totalAtlasTiles: 134_083,
  planetGridRadius: 48,
  planetGridTiles: 7_057,
  defaultFoundingSeatsPerSector: 4,
  supportedFoundingSeatsPerSector: W11_SUPPORTED_FOUNDING_SEATS,
  nominalSeatsAtDefaultX4: 28,
  maxSeatsAtX5: 35,
  mapRasterResolution: 256,
  caps: W11_SMALL_ATLAS_PERF_CAPS,
  deferredToW27: [
    '150_sector_medium_atlas',
    '450_sector_large_atlas',
    'multi_continent_quotas',
    'sparse_sector_streaming',
    'partial_interest_replicas',
  ] as const,
} as const;

export type SmallAtlasBudgetViolationField =
  | 'totalSectors'
  | 'landSectors'
  | 'oceanSectors'
  | 'sectorRadius'
  | 'totalTiles'
  | 'foundingSeatsPerSector'
  | 'totalFoundingSeats'
  | 'continentCount'
  | 'planetRadius'
  | 'canonicalWorlds'
  | 'colonies'
  | 'estimatedAllocationBytes'
  | 'snapshotRawBytes'
  | 'deltaWireBytesPerChunk'
  | 'simStepP95Ms'
  | 'mapRasterScanPaintMs'
  | 'heapDeltaBytes';

export interface SmallAtlasBudgetViolation {
  readonly field: SmallAtlasBudgetViolationField;
  readonly actual: number;
  readonly limit: number;
  readonly message: string;
}

export interface SmallAtlasObservedBudgetMetrics {
  readonly totalSectors: number;
  readonly landSectors: number;
  readonly oceanSectors: number;
  readonly sectorRadius: number;
  readonly tilesPerSector: number;
  readonly totalTiles: number;
  readonly foundingSeatsPerSector: number;
  readonly totalFoundingSeats: number;
  readonly continentCount: number;
  readonly planetRadius: number;
  readonly canonicalWorlds: number;
  readonly maxColonies: number;
  readonly estimatedAllocationBytes: number;
  readonly snapshotRawBytes?: number;
  readonly deltaWireBytesPerChunk?: number;
  readonly simStepP95Ms?: number;
  readonly mapRasterScanPaintMs?: number;
  readonly heapDeltaBytes?: number;
}

export type SectorLikeInput =
  | SectorConfigV1
  | SectorManifestV1
  | {
      readonly sectorId?: string;
      readonly kind?: 'land' | 'ocean';
      readonly continentId?: string | null;
      readonly radius?: number;
      readonly tileCount?: number;
      readonly foundingCapacity?: number;
    };

export interface SmallAtlasBudgetCapInput
  extends Partial<CreateAtlasPlanetOptions>,
    Partial<GenerateSmallAtlasOptions> {
  readonly totalSectors?: number;
  readonly landSectors?: number;
  readonly oceanSectors?: number;
  readonly sectorRadius?: number;
  readonly totalTiles?: number;
  readonly foundingSeatsPerSector?: number;
  readonly totalFoundingSeats?: number;
  readonly nominalCapacity?: number;
  readonly continentCount?: number;
  readonly continents?: readonly string[];
  readonly planetRadius?: number;
  readonly gridRadius?: number;
  readonly canonicalWorlds?: number;
  readonly worldCount?: number;
  readonly maxColonies?: number;
  readonly sectors?: readonly SectorLikeInput[];
  readonly bounds?: { readonly totalTiles?: number; readonly maxColonies?: number; readonly maxSectors?: number };
  readonly estimatedAllocationBytes?: number;
  readonly snapshotRawBytes?: number;
  readonly deltaWireBytesPerChunk?: number;
  readonly simStepP95Ms?: number;
  readonly mapRasterScanPaintMs?: number;
  readonly heapDeltaBytes?: number;
}

export interface SmallAtlasBudgetValidationResult {
  readonly ok: boolean;
  readonly code?: 'atlas_budget_exceeded';
  readonly supportedScale: typeof W11_SUPPORTED_SCALE_ID;
  readonly w27ScaleClaimed: false;
  readonly w27ScaleRejected: boolean;
  readonly caps: SmallAtlasPerfCaps;
  readonly observed: SmallAtlasObservedBudgetMetrics;
  readonly violations: readonly SmallAtlasBudgetViolation[];
}

export class SmallAtlasCapExceededError extends RangeError {
  readonly ok = false as const;
  readonly code = 'atlas_budget_exceeded' as const;
  readonly supportedScale = W11_SUPPORTED_SCALE_ID;
  readonly w27ScaleClaimed = false as const;
  readonly w27ScaleRejected: boolean;
  readonly caps: SmallAtlasPerfCaps;
  readonly observed: SmallAtlasObservedBudgetMetrics;
  readonly violations: readonly SmallAtlasBudgetViolation[];

  constructor(result: SmallAtlasBudgetValidationResult) {
    const details = result.violations.map((v) => `${v.field}: actual ${v.actual} > limit ${v.limit}`).join('; ');
    super(`atlas_budget_exceeded: W11 small-atlas configuration rejected before allocation (${details})`);
    this.name = 'SmallAtlasCapExceededError';
    this.w27ScaleRejected = result.w27ScaleRejected;
    this.caps = result.caps;
    this.observed = result.observed;
    this.violations = result.violations;
  }
}

function resolveCaps(custom?: Partial<SmallAtlasPerfCaps>): SmallAtlasPerfCaps {
  if (!custom) return W11_SMALL_ATLAS_PERF_CAPS;
  const maxContinents = custom.maxContinents ?? custom.maxContinentCount ?? W11_SMALL_ATLAS_PERF_CAPS.maxContinents;
  return {
    ...W11_SMALL_ATLAS_PERF_CAPS,
    ...custom,
    supportedScale: W11_SUPPORTED_SCALE_ID,
    w27ScaleClaimed: false,
    maxContinents,
    maxContinentCount: maxContinents,
  };
}

function normalizeBudgetInput(
  raw?: SmallAtlasBudgetCapInput | AtlasConfigV1 | AtlasManifestV1 | GeneratedSmallAtlas | null,
): SmallAtlasBudgetCapInput {
  if (!raw || typeof raw !== 'object') return {};
  const candidate = raw as SmallAtlasBudgetCapInput;
  const baseSource = candidate.manifest ?? candidate.config ?? (candidate.atlas as SmallAtlasBudgetCapInput | undefined);
  if (!baseSource) return candidate;
  const base = baseSource as unknown as SmallAtlasBudgetCapInput;
  return { ...base, ...candidate, sectors: candidate.sectors ?? base.sectors, bounds: candidate.bounds ?? base.bounds };
}

function resolveSectorCounts(input: SmallAtlasBudgetCapInput): {
  landSectors: number;
  oceanSectors: number;
  totalSectors: number;
  continentCount: number;
} {
  const sectors = input.sectors;
  const landFromSectors = Array.isArray(sectors) ? sectors.filter((s) => s.kind === 'land').length : undefined;
  const oceanFromSectors = Array.isArray(sectors) ? sectors.filter((s) => s.kind === 'ocean').length : undefined;
  const landSectors =
    input.landSectors ??
    (Array.isArray(input.landCoords) ? input.landCoords.length : undefined) ??
    landFromSectors ??
    W11_DEFAULT_LAND_SECTORS;
  const defaultOcean =
    input.includeOceanHalo === false
      ? 0
      : typeof input.totalSectors === 'number'
        ? Math.max(0, input.totalSectors - landSectors)
        : 12;
  const oceanSectors =
    input.oceanSectors ??
    (Array.isArray(input.oceanCoords) ? input.oceanCoords.length : undefined) ??
    oceanFromSectors ??
    defaultOcean;
  const impliedTotal = Math.max(0, landSectors) + Math.max(0, oceanSectors);
  const totalSectors =
    input.totalSectors !== undefined
      ? Math.max(input.totalSectors, Array.isArray(sectors) ? sectors.length : 0)
      : Array.isArray(sectors)
        ? Math.max(sectors.length, impliedTotal)
        : impliedTotal;

  let continentCount = input.continentCount ?? (Array.isArray(input.continents) ? input.continents.length : undefined);
  if (continentCount === undefined) {
    if (Array.isArray(sectors) && sectors.length > 0) {
      const ids = new Set(
        sectors
          .filter((s) => s.kind === 'land' && typeof s.continentId === 'string' && s.continentId.length > 0)
          .map((s) => s.continentId as string),
      );
      continentCount = ids.size > 0 ? ids.size : 1;
    } else {
      continentCount = 1;
    }
  }
  return { landSectors, oceanSectors, totalSectors, continentCount };
}

function estimatePlanetGridRadius(input: SmallAtlasBudgetCapInput, sectorRadius: number, landSectors: number): number {
  if (typeof input.planetRadius === 'number') return input.planetRadius;
  if (typeof input.gridRadius === 'number') return input.gridRadius;
  if (typeof input.radius === 'number') return input.radius;
  if (sectorRadius <= 0 || !Number.isFinite(sectorRadius)) return 0;
  if (landSectors > W11_DEFAULT_LAND_SECTORS) {
    const maxMacroDist = Math.max(1, Math.ceil(Math.sqrt(landSectors / 3)));
    return (2 * sectorRadius + 1) * maxMacroDist + sectorRadius + 3;
  }
  if (
    Array.isArray(input.landCoords) &&
    input.landCoords.some(([mq, mr]) => Number.isSafeInteger(mq) && Number.isSafeInteger(mr) && hexDistance(0, 0, mq, mr) > 1)
  ) {
    const maxMacroDist = Math.max(
      1,
      ...input.landCoords.map(([mq, mr]) => (Number.isSafeInteger(mq) && Number.isSafeInteger(mr) ? hexDistance(0, 0, mq, mr) : 1)),
    );
    return (2 * sectorRadius + 1) * maxMacroDist + sectorRadius + 3;
  }
  return sectorRadius;
}

/**
 * Computes the deterministic pre-allocation TypedArray + partition byte footprint for a requested atlas config.
 */
export function estimateSmallAtlasAllocationBytes(
  rawInput?: SmallAtlasBudgetCapInput | AtlasConfigV1 | AtlasManifestV1 | GeneratedSmallAtlas | null,
): number {
  const input = normalizeBudgetInput(rawInput);
  if (typeof input.estimatedAllocationBytes === 'number') return input.estimatedAllocationBytes;
  const { landSectors, totalSectors } = resolveSectorCounts(input);
  const sectorRadius = input.sectorRadius ?? W11_DEFAULT_SECTOR_RADIUS;
  const safeRadius = Number.isSafeInteger(sectorRadius) && sectorRadius > 0 ? Math.min(sectorRadius, 512) : 0;
  const tilesPerSector = safeRadius > 0 ? hexCount(safeRadius) : 0;
  const totalTiles = Math.max(0, input.totalTiles ?? input.bounds?.totalTiles ?? totalSectors * tilesPerSector);
  const planetRadius = estimatePlanetGridRadius(input, safeRadius, landSectors);
  const safeGridRadius = Number.isSafeInteger(planetRadius) && planetRadius > 0 ? Math.min(planetRadius, 2_000) : 0;
  const gridTiles = safeGridRadius > 0 ? hexCount(safeGridRadius) : 0;
  return totalTiles * 130 + gridTiles * 64;
}

function buildObservedMetrics(input: SmallAtlasBudgetCapInput): SmallAtlasObservedBudgetMetrics {
  const { landSectors, oceanSectors, totalSectors, continentCount } = resolveSectorCounts(input);
  const sectors = input.sectors;
  const maxSecRadius =
    Array.isArray(sectors) && sectors.length > 0 ? Math.max(...sectors.map((s) => (typeof s.radius === 'number' ? s.radius : 0))) : 0;
  const sectorRadius =
    input.sectorRadius !== undefined ? Math.max(input.sectorRadius, maxSecRadius) : maxSecRadius > 0 ? maxSecRadius : W11_DEFAULT_SECTOR_RADIUS;
  const tilesPerSector = Number.isSafeInteger(sectorRadius) && sectorRadius > 0 && sectorRadius <= 1_024 ? hexCount(sectorRadius) : 0;
  const summedSectorTiles = Array.isArray(sectors)
    ? sectors.reduce(
        (sum, s) =>
          sum + (typeof s.tileCount === 'number' ? s.tileCount : typeof s.radius === 'number' && s.radius > 0 ? hexCount(Math.min(s.radius, 1_024)) : tilesPerSector),
        0,
      )
    : 0;
  const totalTiles = Math.max(input.totalTiles ?? 0, input.bounds?.totalTiles ?? 0, summedSectorTiles, Math.max(0, totalSectors) * tilesPerSector);
  const maxSecSeats =
    Array.isArray(sectors) && sectors.length > 0 ? Math.max(...sectors.map((s) => (typeof s.foundingCapacity === 'number' ? s.foundingCapacity : 0))) : 0;
  const foundingSeatsPerSector =
    input.foundingSeatsPerSector !== undefined
      ? Math.max(input.foundingSeatsPerSector, maxSecSeats)
      : maxSecSeats > 0
        ? maxSecSeats
        : W11_DEFAULT_FOUNDING_SEATS_PER_SECTOR;
  const summedSeats = Array.isArray(sectors) ? sectors.reduce((sum, s) => sum + (s.foundingCapacity ?? 0), 0) : 0;
  const totalFoundingSeats =
    input.totalFoundingSeats ?? input.nominalCapacity ?? (summedSeats > 0 ? summedSeats : Math.max(0, landSectors) * Math.max(0, foundingSeatsPerSector));
  const planetRadius = estimatePlanetGridRadius(input, sectorRadius, landSectors);
  const canonicalWorlds = input.canonicalWorlds ?? input.worldCount ?? 3;
  const maxColonies = Math.max(input.maxColonies ?? 0, input.bounds?.maxColonies ?? 0, totalFoundingSeats);
  const estimatedAllocationBytes = estimateSmallAtlasAllocationBytes({
    ...input,
    totalSectors,
    landSectors,
    sectorRadius,
    totalTiles,
    planetRadius,
  });

  return {
    totalSectors,
    landSectors,
    oceanSectors,
    sectorRadius,
    tilesPerSector,
    totalTiles,
    foundingSeatsPerSector,
    totalFoundingSeats,
    continentCount,
    planetRadius,
    canonicalWorlds,
    maxColonies,
    estimatedAllocationBytes,
    ...(input.snapshotRawBytes !== undefined ? { snapshotRawBytes: input.snapshotRawBytes } : {}),
    ...(input.deltaWireBytesPerChunk !== undefined ? { deltaWireBytesPerChunk: input.deltaWireBytesPerChunk } : {}),
    ...(input.simStepP95Ms !== undefined ? { simStepP95Ms: input.simStepP95Ms } : {}),
    ...(input.mapRasterScanPaintMs !== undefined ? { mapRasterScanPaintMs: input.mapRasterScanPaintMs } : {}),
    ...(input.heapDeltaBytes !== undefined ? { heapDeltaBytes: input.heapDeltaBytes } : {}),
  };
}

function collectBudgetViolations(obs: SmallAtlasObservedBudgetMetrics, caps: SmallAtlasPerfCaps): SmallAtlasBudgetViolation[] {
  const violations: SmallAtlasBudgetViolation[] = [];
  const check = (field: SmallAtlasBudgetViolationField, actual: number, limit: number, min = 1): void => {
    if (!Number.isFinite(actual) || actual < min) {
      violations.push({ field, actual, limit, message: `${field} (${actual}) must be >= ${min} (max ${limit})` });
    } else if (actual > limit) {
      violations.push({ field, actual, limit, message: `${field} (${actual}) exceeds W11 small-atlas cap (${limit})` });
    }
  };
  check('totalSectors', obs.totalSectors, caps.maxTotalSectors, 1);
  check('landSectors', obs.landSectors, caps.maxLandSectors, 1);
  check('oceanSectors', obs.oceanSectors, caps.maxOceanSectors, 0);
  check('sectorRadius', obs.sectorRadius, caps.maxSectorRadius, 1);
  check('totalTiles', obs.totalTiles, caps.maxTotalTiles, 1);
  check('foundingSeatsPerSector', obs.foundingSeatsPerSector, caps.maxFoundingSeatsPerSector, 1);
  check('totalFoundingSeats', obs.totalFoundingSeats, caps.maxTotalFoundingSeatsPerWorld, 1);
  check('continentCount', obs.continentCount, caps.maxContinents, 1);
  check('planetRadius', obs.planetRadius, caps.maxPlanetGridRadius, 1);
  check('canonicalWorlds', obs.canonicalWorlds, caps.maxCanonicalWorlds, 1);
  check('colonies', obs.maxColonies, caps.maxColoniesPerWorld, 0);
  check('estimatedAllocationBytes', obs.estimatedAllocationBytes, caps.maxEstimatedAllocationBytes, 1);
  if (obs.snapshotRawBytes !== undefined) check('snapshotRawBytes', obs.snapshotRawBytes, caps.maxSnapshotRawBytes, 0);
  if (obs.deltaWireBytesPerChunk !== undefined) check('deltaWireBytesPerChunk', obs.deltaWireBytesPerChunk, caps.maxDeltaWireBytesPerChunk, 0);
  if (obs.simStepP95Ms !== undefined) check('simStepP95Ms', obs.simStepP95Ms, caps.maxSimStepP95Ms, 0);
  if (obs.mapRasterScanPaintMs !== undefined) check('mapRasterScanPaintMs', obs.mapRasterScanPaintMs, caps.maxMapRasterScanPaintMs, 0);
  if (obs.heapDeltaBytes !== undefined) check('heapDeltaBytes', obs.heapDeltaBytes, caps.maxHeapDeltaBytesPerWorld, 0);
  return violations;
}

export function validateSmallAtlasBudgetCaps(
  rawInput?: SmallAtlasBudgetCapInput | AtlasConfigV1 | AtlasManifestV1 | GeneratedSmallAtlas | null,
  customCaps?: Partial<SmallAtlasPerfCaps>,
): SmallAtlasBudgetValidationResult {
  const caps = resolveCaps(customCaps);
  const observed = buildObservedMetrics(normalizeBudgetInput(rawInput));
  const violations = collectBudgetViolations(observed, caps);
  const w27ScaleRejected =
    observed.totalSectors >= 100 || observed.landSectors > caps.maxLandSectors || observed.continentCount > caps.maxContinents;
  return violations.length > 0
    ? { ok: false, code: 'atlas_budget_exceeded', supportedScale: W11_SUPPORTED_SCALE_ID, w27ScaleClaimed: false, w27ScaleRejected, caps, observed, violations }
    : { ok: true, supportedScale: W11_SUPPORTED_SCALE_ID, w27ScaleClaimed: false, w27ScaleRejected: false, caps, observed, violations: [] };
}

export function enforceSmallAtlasPreAllocationCaps(
  rawInput?: SmallAtlasBudgetCapInput | AtlasConfigV1 | AtlasManifestV1 | GeneratedSmallAtlas | null,
  customCaps?: Partial<SmallAtlasPerfCaps>,
): SmallAtlasBudgetValidationResult {
  const res = validateSmallAtlasBudgetCaps(rawInput, customCaps);
  if (!res.ok) throw new SmallAtlasCapExceededError(res);
  return res;
}

export function measurePlanetStateMemoryBytes(
  state: PlanetState,
  atlas?: GeneratedSmallAtlas | null,
): { readonly atlasTypedArrayBytes: number; readonly planetStateTypedArrayBytes: number; readonly estimatedStateBytes: number } {
  let atlasTypedArrayBytes = 0;
  if (atlas) {
    const sumBufs = (b: {
      terrain: ArrayBufferView;
      prep: ArrayBufferView;
      height: ArrayBufferView;
      deposit: ArrayBufferView;
      depositTier: ArrayBufferView;
      richness: ArrayBufferView;
      subDeposit: ArrayBufferView;
      subRichness: ArrayBufferView;
    }): number =>
      b.terrain.byteLength +
      b.prep.byteLength +
      b.height.byteLength +
      b.deposit.byteLength +
      b.depositTier.byteLength +
      b.richness.byteLength +
      b.subDeposit.byteLength +
      b.subRichness.byteLength;
    atlasTypedArrayBytes += sumBufs(atlas);
    for (const sec of atlas.sectors) atlasTypedArrayBytes += sumBufs(sec);
  }
  let planetStateTypedArrayBytes = 0;
  for (const arr of Object.values(state.grid.layers)) if (ArrayBuffer.isView(arr)) planetStateTypedArrayBytes += arr.byteLength;
  for (const arr of Object.values(state.entities.cols)) if (ArrayBuffer.isView(arr)) planetStateTypedArrayBytes += arr.byteLength;
  return { atlasTypedArrayBytes, planetStateTypedArrayBytes, estimatedStateBytes: atlasTypedArrayBytes + planetStateTypedArrayBytes };
}
