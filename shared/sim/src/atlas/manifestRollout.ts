import {
  W11_DEFAULT_LAND_SECTORS,
  W11_DEFAULT_SECTOR_RADIUS,
  W11_MAX_SMALL_ATLAS_COLONIES,
  W11_MAX_SMALL_ATLAS_SECTORS,
  W11_MAX_SMALL_ATLAS_TILES,
  type AtlasConfigV1,
  type AtlasManifestV1,
} from '@terra/contracts';
import { hexCount } from '../grid/hex';
import type { GeneratedSmallAtlas } from './types';

export const W11_DEFAULT_MAX_FOUNDING_SEATS_PER_SECTOR = 5;

export interface AtlasRolloutLimits {
  readonly maxSectors?: number;
  readonly maxLandSectors?: number;
  readonly maxSectorRadius?: number;
  readonly maxTotalTiles?: number;
  readonly maxFoundingSeatsPerSector?: number;
  readonly maxColonies?: number;
}

export const W11_DEFAULT_ROLLOUT_LIMITS: Required<AtlasRolloutLimits> = {
  maxSectors: W11_MAX_SMALL_ATLAS_SECTORS,
  maxLandSectors: W11_DEFAULT_LAND_SECTORS,
  maxSectorRadius: W11_DEFAULT_SECTOR_RADIUS,
  maxTotalTiles: W11_MAX_SMALL_ATLAS_TILES,
  maxFoundingSeatsPerSector: W11_DEFAULT_MAX_FOUNDING_SEATS_PER_SECTOR,
  maxColonies: W11_MAX_SMALL_ATLAS_COLONIES,
};

export type AtlasRolloutViolationField =
  | 'maxSectors'
  | 'maxLandSectors'
  | 'maxSectorRadius'
  | 'maxTotalTiles'
  | 'maxFoundingSeatsPerSector'
  | 'maxColonies';

export interface AtlasRolloutViolation {
  readonly field: AtlasRolloutViolationField;
  readonly actual: number;
  readonly limit: number;
  readonly message: string;
}

export interface AtlasRolloutValidationResult {
  readonly ok: boolean;
  readonly code?: 'rollout_limit_exceeded';
  readonly limits: Required<AtlasRolloutLimits>;
  readonly observed: {
    readonly totalSectors: number;
    readonly landSectors: number;
    readonly oceanSectors: number;
    readonly sectorRadius: number;
    readonly totalTiles: number;
    readonly foundingSeatsPerSector: number;
    readonly nominalCapacity: number;
    readonly validatedCapacity: number;
    readonly maxColonies: number;
  };
  readonly violations: readonly AtlasRolloutViolation[];
}

export function isGeneratedSmallAtlas(input: unknown): input is GeneratedSmallAtlas {
  return (
    typeof input === 'object' &&
    input !== null &&
    'partition' in input &&
    'sectorById' in input &&
    'safeLandingSlots' in input
  );
}

export function isAtlasManifestV1(input: unknown): input is AtlasManifestV1 {
  return (
    typeof input === 'object' &&
    input !== null &&
    'atlasVersion' in input &&
    'atlasHash' in input &&
    'configHash' in input &&
    'look' in input &&
    'totalSectors' in input &&
    !('tilesPerSector' in input)
  );
}

/**
 * Validates small-atlas rollout caps (`maxSectors`, `maxLandSectors`, `maxSectorRadius`,
 * `maxTotalTiles`, `maxFoundingSeatsPerSector`, `maxColonies`).
 */
export function validateAtlasRolloutLimits(
  configOrManifest: AtlasConfigV1 | AtlasManifestV1 | GeneratedSmallAtlas,
  limits?: AtlasRolloutLimits,
): AtlasRolloutValidationResult {
  const resolved: Required<AtlasRolloutLimits> = {
    maxSectors: limits?.maxSectors ?? W11_DEFAULT_ROLLOUT_LIMITS.maxSectors,
    maxLandSectors: limits?.maxLandSectors ?? W11_DEFAULT_ROLLOUT_LIMITS.maxLandSectors,
    maxSectorRadius: limits?.maxSectorRadius ?? W11_DEFAULT_ROLLOUT_LIMITS.maxSectorRadius,
    maxTotalTiles: limits?.maxTotalTiles ?? W11_DEFAULT_ROLLOUT_LIMITS.maxTotalTiles,
    maxFoundingSeatsPerSector:
      limits?.maxFoundingSeatsPerSector ?? W11_DEFAULT_ROLLOUT_LIMITS.maxFoundingSeatsPerSector,
    maxColonies: limits?.maxColonies ?? W11_DEFAULT_ROLLOUT_LIMITS.maxColonies,
  };

  const sectors = configOrManifest.sectors;
  const landCount = sectors.filter((s) => s.kind === 'land').length;
  const oceanCount = sectors.filter((s) => s.kind === 'ocean').length;
  const totalSectors = Math.max(
    sectors.length,
    isAtlasManifestV1(configOrManifest) ? configOrManifest.totalSectors : 0,
  );
  const landSectors = Math.max(
    landCount,
    isAtlasManifestV1(configOrManifest) ? configOrManifest.landSectors : 0,
  );
  const sectorRadius = Math.max(configOrManifest.sectorRadius, ...sectors.map((s) => s.radius));
  const summedTiles = sectors.reduce(
    (sum, s) => sum + ('tileCount' in s ? s.tileCount : hexCount(s.radius)),
    0,
  );
  const totalTiles = isGeneratedSmallAtlas(configOrManifest)
    ? Math.max(configOrManifest.partition.bounds.totalTiles, summedTiles)
    : isAtlasManifestV1(configOrManifest)
      ? Math.max(configOrManifest.bounds.totalTiles, summedTiles)
      : summedTiles;

  const foundingSeatsPerSector = Math.max(
    configOrManifest.foundingSeatsPerSector,
    ...sectors.map((s) => s.foundingCapacity),
  );
  const nominalCapacity = sectors.reduce((sum, s) => sum + s.foundingCapacity, 0);
  const validatedCapacity =
    'validatedCapacity' in configOrManifest ? configOrManifest.validatedCapacity : nominalCapacity;
  const boundsMaxColonies = isAtlasManifestV1(configOrManifest)
    ? configOrManifest.bounds.maxColonies
    : nominalCapacity;
  const maxColonies = Math.max(nominalCapacity, validatedCapacity, boundsMaxColonies);

  const violations: AtlasRolloutViolation[] = [];
  const check = (field: AtlasRolloutViolationField, actual: number, limit: number, label: string): void => {
    if (actual > limit) {
      violations.push({
        field,
        actual,
        limit,
        message: `${label} (${actual}) exceeds small-atlas rollout limit (${limit})`,
      });
    }
  };

  check('maxSectors', totalSectors, resolved.maxSectors, 'totalSectors');
  check('maxLandSectors', landSectors, resolved.maxLandSectors, 'landSectors');
  check('maxSectorRadius', sectorRadius, resolved.maxSectorRadius, 'sectorRadius');
  check('maxTotalTiles', totalTiles, resolved.maxTotalTiles, 'totalTiles');
  check(
    'maxFoundingSeatsPerSector',
    foundingSeatsPerSector,
    resolved.maxFoundingSeatsPerSector,
    'foundingSeatsPerSector',
  );
  check('maxColonies', maxColonies, resolved.maxColonies, 'maxColonies');

  const observed = {
    totalSectors,
    landSectors,
    oceanSectors: oceanCount,
    sectorRadius,
    totalTiles,
    foundingSeatsPerSector,
    nominalCapacity,
    validatedCapacity,
    maxColonies,
  };

  return violations.length > 0
    ? { ok: false, code: 'rollout_limit_exceeded', limits: resolved, observed, violations }
    : { ok: true, limits: resolved, observed, violations: [] };
}
