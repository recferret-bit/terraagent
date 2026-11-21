import type { RejectCode, SectorId } from '@terra/contracts';
import { getBuildingFootprintTiles, hexDistance, inHex, resolvePlacementRule } from '@terra/sim';
import {
  isValidSectorIdFormat,
  packAxialCoord,
  resolveTileSectorFast,
  sectorOrdinalToSectorId,
} from '../anticheat.hash';
import type {
  AntiCheatCategory,
  ColonyBaseBinding,
  InputValidationVerdict,
  PlanetSpatialState,
} from '../anticheat.types';
import type { SectorHashIndex } from '../sector-hash-index';

export function makeReject(
  category: AntiCheatCategory,
  rejectCode: RejectCode,
  detail: string,
  httpStatus = 403,
  errorCode = 'ANTICHEAT_REJECTED',
): InputValidationVerdict {
  return { ok: false, category, rejectCode, httpStatus, errorCode, detail };
}

export function isNearRivalAnchor(planet: PlanetSpatialState, q: number, r: number): boolean {
  for (const rv of planet.rivalAnchors) {
    if (hexDistance(rv.anchorQ, rv.anchorR, q, r) <= 12) return true;
  }
  return false;
}

export function resolveBuildingFootprintSize(building: unknown): number {
  if (typeof building === 'string') {
    const trimmed = building.trim();
    const rule = trimmed ? resolvePlacementRule(trimmed) : resolvePlacementRule(undefined);
    if (rule) return Math.max(1, Math.trunc(rule.footprint));
    const lower = trimmed.toLowerCase();
    if (lower === 'commandhub' || lower === 'hub' || lower === 'building.hub' || lower === 'command_hub') {
      return 3;
    }
    return 1;
  }
  const defaultRule = resolvePlacementRule(undefined);
  return defaultRule ? Math.max(1, Math.trunc(defaultRule.footprint)) : 3;
}

/**
 * O(1) planet-bounds and sector-isolation check for a single coordinate `(q, r)`.
 */
export function checkTileAgainstPlanetAndSector(opts: {
  readonly index: SectorHashIndex;
  readonly planet: PlanetSpatialState | undefined;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly baseSectorId: SectorId;
  readonly q: number;
  readonly r: number;
  readonly category: AntiCheatCategory;
  readonly allowRivalProximity?: boolean;
}): InputValidationVerdict | null {
  const { index, planet, planetId, colonyIndex, baseSectorId, q, r, category } = opts;
  if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
    return makeReject(category, 'invalid_args', 'tile coordinates must be safe integers', 400, 'INVALID_ARGS');
  }
  if (!planet) return null;

  if (!inHex(q, r, planet.planetRadius)) {
    const outerSec = resolveTileSectorFast(q, r, planet.sectorRadius);
    if (!planet.crossSectorEnabled && outerSec !== baseSectorId) {
      return makeReject(
        category,
        'cross_sector_disabled',
        `tile (${q}, ${r}) lies in sector ${outerSec}, outside colony sector ${baseSectorId}`,
        403,
        'CROSS_SECTOR_DISABLED',
      );
    }
    return makeReject(
      category,
      'invalid_args',
      `tile (${q}, ${r}) is outside planet radius ${planet.planetRadius}`,
      400,
      'OUT_OF_PLANET_BOUNDS',
    );
  }

  if (planet.crossSectorEnabled || planet.rivalColonyIndices.has(colonyIndex)) {
    return null;
  }
  if (opts.allowRivalProximity && isNearRivalAnchor(planet, q, r)) {
    return null;
  }

  if (planet.hasMultiSectorGrid) {
    const tileSector = resolveTileSectorFast(q, r, planet.sectorRadius);
    if (planet.knownSectorIds.size > 0 && !planet.knownSectorIds.has(tileSector)) {
      return makeReject(category, 'invalid_args', `tile (${q}, ${r}) is not in a valid planet sector`, 400, 'INVALID_SECTOR');
    }
    if (tileSector !== baseSectorId) {
      return makeReject(
        category,
        'cross_sector_disabled',
        `tile (${q}, ${r}) belongs to ${tileSector}, but colony base is in ${baseSectorId}`,
        403,
        'CROSS_SECTOR_DISABLED',
      );
    }
  }

  const owner = planet.tileOwnerByPackedCoord.get(packAxialCoord(q, r));
  if (owner !== undefined && owner >= 0 && owner !== colonyIndex && !planet.rivalColonyIndices.has(owner)) {
    const ownerCol = index.getColonyByPlanetIndex(planetId, owner);
    if (ownerCol && ownerCol.baseSectorId !== baseSectorId) {
      return makeReject(
        category,
        'cross_sector_disabled',
        `tile (${q}, ${r}) belongs to colony in foreign sector ${ownerCol.baseSectorId}`,
        403,
        'CROSS_SECTOR_DISABLED',
      );
    }
  }

  return null;
}

/**
 * Checks an authoritative `N × N` building footprint (`getBuildingFootprintTiles` from `@terra/sim`)
 * so 1×1, 2×2, and 3×3 buildings can never be placed in another sector or straddle a sector/planet boundary.
 */
export function checkFootprintAgainstPlanetAndSector(opts: {
  readonly index: SectorHashIndex;
  readonly planet: PlanetSpatialState | undefined;
  readonly planetId: string;
  readonly colonyIndex: number;
  readonly baseSectorId: SectorId;
  readonly q: number;
  readonly r: number;
  readonly building?: unknown;
  readonly category: AntiCheatCategory;
}): InputValidationVerdict | null {
  const centerErr = checkTileAgainstPlanetAndSector({ ...opts });
  const footprint = resolveBuildingFootprintSize(opts.building);
  if (centerErr || footprint <= 1 || !opts.planet) return centerErr;

  for (const tile of getBuildingFootprintTiles(opts.q, opts.r, footprint)) {
    if (tile.q === opts.q && tile.r === opts.r) continue;
    const tileErr = checkTileAgainstPlanetAndSector({ ...opts, q: tile.q, r: tile.r });
    if (tileErr) return tileErr;
  }
  return null;
}

/**
 * O(1) hash lookup verifying that `entityId` is alive, belongs to `colonyIndex` on `planetId`,
 * and (for stationary producers/structures) sits in `baseSectorId`.
 */
export function checkOwnedEntityAgainstPlanetAndSector(opts: {
  readonly planet: PlanetSpatialState | undefined;
  readonly colonyIndex: number;
  readonly baseSectorId: SectorId;
  readonly entityId: number;
  readonly category: AntiCheatCategory;
  readonly requireSameSector?: boolean;
}): InputValidationVerdict | null {
  const { planet, colonyIndex, baseSectorId, entityId, category, requireSameSector } = opts;
  if (!Number.isSafeInteger(entityId) || entityId <= 0) {
    return makeReject(category, 'invalid_args', `invalid entityId ${entityId}`, 400, 'INVALID_ARGS');
  }
  if (!planet || planet.entitiesById.size === 0) return null;

  const rec = planet.entitiesById.get(entityId);
  if (!rec) {
    if (entityId < planet.nextEntityId || entityId > planet.maxEntityId + 256) {
      return makeReject(category, 'unknown_entity', `entity ${entityId} does not exist on planet`, 404, 'UNKNOWN_ENTITY');
    }
    return null;
  }
  if (!rec.alive) {
    return makeReject(category, 'unknown_entity', `entity ${entityId} is destroyed`, 404, 'UNKNOWN_ENTITY');
  }
  if (rec.ownerColonyIndex !== colonyIndex) {
    return makeReject(
      category,
      'not_own_colony',
      `entity ${entityId} does not belong to caller colony`,
      403,
      'NOT_OWN_COLONY',
    );
  }
  if (
    requireSameSector &&
    !planet.crossSectorEnabled &&
    planet.hasMultiSectorGrid &&
    rec.sectorId !== baseSectorId
  ) {
    return makeReject(
      category,
      'cross_sector_disabled',
      `entity ${entityId} in ${rec.sectorId} is outside colony sector ${baseSectorId}`,
      403,
      'CROSS_SECTOR_DISABLED',
    );
  }
  return null;
}

const TARGET_COLONY_KEYS = ['targetColonyId', 'targetColonyIndex', 'targetColony', 'toColony'] as const;

export function resolveTargetColonyBinding(
  index: SectorHashIndex,
  planetId: string,
  rawTarget: unknown,
): { readonly binding?: ColonyBaseBinding; readonly parsedIndex?: number; readonly invalid?: boolean } {
  if (typeof rawTarget === 'number') {
    if (!Number.isSafeInteger(rawTarget) || rawTarget < 0) return { invalid: true };
    return { binding: index.getColonyByPlanetIndex(planetId, rawTarget), parsedIndex: rawTarget };
  }
  if (typeof rawTarget !== 'string') return { invalid: true };
  const trimmed = rawTarget.trim();
  if (!trimmed) return { invalid: true };

  const direct = index.getColonyById(trimmed);
  if (direct) return { binding: direct, parsedIndex: direct.planetId === planetId ? direct.colonyIndex : undefined };

  if (/^\d+$/.test(trimmed)) {
    const idx = Number(trimmed);
    return { binding: index.getColonyByPlanetIndex(planetId, idx), parsedIndex: idx };
  }
  const matchCol = /^col[-_](\d+)$/i.exec(trimmed);
  if (matchCol) {
    const idx = Number(matchCol[1]);
    const byName = index.getColonyByPlanetName(planetId, trimmed.toLowerCase());
    if (byName) return { binding: byName, parsedIndex: byName.colonyIndex };
    return { binding: index.getColonyByPlanetIndex(planetId, idx), parsedIndex: idx };
  }
  const lower = trimmed.toLowerCase();
  const byName =
    index.getColonyByPlanetName(planetId, lower) ??
    index.getColonyByPlanetName(planetId, `colony ${lower}`);
  if (byName) return { binding: byName, parsedIndex: byName.colonyIndex };

  if (/^[a-e]$/i.test(trimmed)) {
    const letterIdx = lower.charCodeAt(0) - 97;
    return { binding: index.getColonyByPlanetIndex(planetId, letterIdx), parsedIndex: letterIdx };
  }
  return {};
}

/**
 * Resolves a target colony reference (`targetColonyId`, `targetColonyIndex`, `targetColony`, `toColony`)
 * and enforces same-planet & sector-isolation invariants in O(1).
 */
export function checkTargetColonyAgainstPlanetAndSector(opts: {
  readonly index: SectorHashIndex;
  readonly planet: PlanetSpatialState | undefined;
  readonly planetId: string;
  readonly callerColonyId: string;
  readonly callerColonyIndex: number;
  readonly baseSectorId: SectorId;
  readonly rawTarget: unknown;
  readonly category: AntiCheatCategory;
  readonly enforceSameSector: boolean;
}): InputValidationVerdict | null {
  const { index, planet, planetId, callerColonyId, callerColonyIndex, baseSectorId, rawTarget, category } = opts;
  if (rawTarget === undefined || rawTarget === null) return null;

  if (typeof rawTarget === 'string' && rawTarget.trim() === callerColonyId) {
    return makeReject(category, 'invalid_args', 'cannot target own colony', 400, 'INVALID_ARGS');
  }
  const resolved = resolveTargetColonyBinding(index, planetId, rawTarget);
  if (resolved.invalid) {
    return makeReject(category, 'invalid_args', 'invalid target colony reference', 400, 'INVALID_ARGS');
  }
  if (resolved.parsedIndex !== undefined && resolved.parsedIndex === callerColonyIndex) {
    return makeReject(category, 'invalid_args', 'cannot target own colony', 400, 'INVALID_ARGS');
  }
  const targetBinding = resolved.binding;
  if (!targetBinding) return null;

  if (targetBinding.planetId !== planetId) {
    return makeReject(
      category,
      'invalid_args',
      `target colony ${targetBinding.colonyId} is on another planet`,
      403,
      'WRONG_PLANET',
    );
  }
  if (targetBinding.colonyIndex === callerColonyIndex || targetBinding.colonyId === callerColonyId) {
    return makeReject(category, 'invalid_args', 'cannot target own colony', 400, 'INVALID_ARGS');
  }

  const crossEnabled = planet?.crossSectorEnabled ?? false;
  const isRival =
    Boolean(targetBinding.isRivalAi) ||
    Boolean(planet?.rivalColonyIndices.has(targetBinding.colonyIndex)) ||
    Boolean(planet?.rivalColonyIndices.has(callerColonyIndex));

  if (opts.enforceSameSector && !crossEnabled && !isRival && targetBinding.baseSectorId !== baseSectorId) {
    return makeReject(
      category,
      'cross_sector_disabled',
      `target colony is in ${targetBinding.baseSectorId}, outside caller sector ${baseSectorId}`,
      403,
      'CROSS_SECTOR_DISABLED',
    );
  }
  return null;
}

export function checkAllTargetColonyFields(opts: {
  readonly index: SectorHashIndex;
  readonly planet: PlanetSpatialState | undefined;
  readonly planetId: string;
  readonly callerColonyId: string;
  readonly callerColonyIndex: number;
  readonly baseSectorId: SectorId;
  readonly args: Record<string, unknown>;
  readonly category: AntiCheatCategory;
  readonly enforceSameSector: boolean;
}): InputValidationVerdict | null {
  let seenColonyIndex: number | undefined;
  for (const key of TARGET_COLONY_KEYS) {
    const val = opts.args[key];
    if (val === undefined || val === null) continue;
    const err = checkTargetColonyAgainstPlanetAndSector({ ...opts, rawTarget: val });
    if (err) return err;
    const resolved = resolveTargetColonyBinding(opts.index, opts.planetId, val);
    const idx = resolved.binding?.colonyIndex ?? resolved.parsedIndex;
    if (idx !== undefined) {
      if (seenColonyIndex !== undefined && seenColonyIndex !== idx) {
        return makeReject(opts.category, 'invalid_args', 'conflicting target colony fields', 400, 'INVALID_ARGS');
      }
      seenColonyIndex = idx;
    }
  }
  return null;
}

export function normalizeExplicitSectorParam(raw: unknown): SectorId | 'invalid' | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    const mapped = sectorOrdinalToSectorId(raw);
    return mapped ?? 'invalid';
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return isValidSectorIdFormat(trimmed) ? trimmed : 'invalid';
  }
  return 'invalid';
}
