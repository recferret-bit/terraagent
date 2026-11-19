import type { SectorId } from '@terra/contracts';
import {
  computeColonyBindingHash,
  inferAuthoritativeBaseSector,
} from '../anticheat.hash';
import type {
  ColonyBaseBinding,
  InputValidationVerdict,
  PlanetSpatialState,
  ValidateCommandInputContext,
} from '../anticheat.types';
import type { SectorHashIndex } from '../sector-hash-index';
import { makeReject, normalizeExplicitSectorParam } from './spatial-assertions';

export interface ResolvedCallerState {
  readonly planet: PlanetSpatialState | undefined;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly baseSectorId: SectorId;
  readonly bindingHash: string;
}

const INACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'ELIMINATED',
  'ENDED',
  'SETTLED',
  'PLANET_ENDED',
  'TRANSFERRED',
  'ABANDONED',
]);

export function extractUnitIdList(
  obj: Record<string, unknown>,
  rawObj?: Record<string, unknown>,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const pushVal = (v: unknown) => {
    if (typeof v !== 'number') {
      out.push(Number.NaN);
      return;
    }
    if (Number.isNaN(v)) {
      out.push(v);
      return;
    }
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  for (const src of rawObj && rawObj !== obj ? [obj, rawObj] : [obj]) {
    if (src.entityIds !== undefined) {
      if (!Array.isArray(src.entityIds)) pushVal(src.entityIds);
      else for (const x of src.entityIds) pushVal(x);
    }
    if (src.unitIds !== undefined) {
      if (!Array.isArray(src.unitIds)) pushVal(src.unitIds);
      else for (const x of src.unitIds) pushVal(x);
    }
    if (src.entityId !== undefined) pushVal(src.entityId);
    if (src.unitId !== undefined) pushVal(src.unitId);
  }
  return out;
}

function checkIndexedColonyOwnership(
  index: SectorHashIndex,
  ctx: ValidateCommandInputContext,
  indexedColony: ColonyBaseBinding | undefined,
): InputValidationVerdict | null {
  if (indexedColony && indexedColony.planetId !== ctx.planetId) {
    return makeReject('ownership', 'not_own_colony', 'colony belongs to another planet', 403, 'WRONG_PLANET');
  }
  if (
    indexedColony &&
    indexedColony.playerId &&
    indexedColony.playerId !== ctx.playerId &&
    !ctx.dev &&
    !ctx.isScenarioPlanet
  ) {
    return makeReject('ownership', 'not_own_colony', 'colony belongs to another player', 403, 'NOT_OWN_COLONY');
  }
  const activePlayerBase = index.getActiveBaseByPlayer(ctx.playerId);
  const ownsActiveHere =
    index.hasActiveColonyForPlayerOnPlanet(ctx.playerId, ctx.planetId) ||
    Boolean(
      indexedColony &&
        indexedColony.playerId === ctx.playerId &&
        indexedColony.planetId === ctx.planetId &&
        indexedColony.status === 'ACTIVE',
    );
  if (activePlayerBase && activePlayerBase.planetId !== ctx.planetId && !ownsActiveHere && !ctx.isScenarioPlanet) {
    return makeReject(
      'ownership',
      'not_own_colony',
      `player active base is on ${activePlayerBase.planetId}, not ${ctx.planetId}`,
      403,
      'WRONG_PLANET',
    );
  }
  const effectiveStatus = indexedColony?.status ?? String(ctx.colony?.status ?? ctx.colony?.state ?? 'ACTIVE').toUpperCase();
  if (INACTIVE_STATUSES.has(effectiveStatus)) {
    return makeReject('ownership', 'colony_inactive', 'colony is no longer active', 409, 'COLONY_INACTIVE');
  }
  return null;
}

export function verifyCallerBinding(
  index: SectorHashIndex,
  ctx: ValidateCommandInputContext,
): ResolvedCallerState | InputValidationVerdict {
  const planet = index.getPlanet(ctx.planetId);
  if (planet && (planet.status === 'ENDED' || planet.status === 'ARCHIVED')) {
    return makeReject('ownership', 'planet_ended', `planet ${ctx.planetId} has ended`, 409, 'PLANET_ENDED');
  }
  if (!ctx.colony) {
    return makeReject('ownership', 'not_own_colony', 'caller has no active colony on this planet', 403, 'NOT_OWN_COLONY');
  }
  if (ctx.colony.planetId && ctx.colony.planetId !== ctx.planetId) {
    return makeReject('ownership', 'not_own_colony', 'colony belongs to a different planet', 403, 'WRONG_PLANET');
  }

  const indexedColony =
    index.getColonyById(ctx.colony.id) ??
    index.getColonyByPlanetIndex(ctx.planetId, ctx.colony.colonyIndex);
  const ownerErr = checkIndexedColonyOwnership(index, ctx, indexedColony);
  if (ownerErr) return ownerErr;

  const baseSectorId =
    indexedColony?.baseSectorId ??
    inferAuthoritativeBaseSector({
      foundingSectorId: ctx.colony.foundingSectorId,
      spawnQ: ctx.colony.spawnQ,
      spawnR: ctx.colony.spawnR,
      sectorRadius: planet?.sectorRadius,
      hasMultiSectorGrid: planet?.hasMultiSectorGrid,
    });

  if (ctx.sectorId) {
    const reqSec = normalizeExplicitSectorParam(ctx.sectorId);
    if (reqSec === 'invalid') {
      return makeReject('ownership', 'invalid_args', `invalid sectorId "${ctx.sectorId}"`, 400, 'INVALID_SECTOR');
    }
    if (
      reqSec &&
      planet &&
      !planet.hasMultiSectorGrid &&
      planet.knownSectorIds.size <= 1 &&
      reqSec !== 'sec_0_0' &&
      baseSectorId === 'sec_0_0'
    ) {
      return makeReject('ownership', 'invalid_args', `sector ${reqSec} does not exist on single-sector planet`, 400, 'INVALID_SECTOR');
    }
    if (reqSec && reqSec !== baseSectorId) {
      return makeReject(
        'ownership',
        'cross_sector_disabled',
        `input sector ${reqSec} does not match colony base sector ${baseSectorId}`,
        403,
        'NOT_YOUR_SECTOR',
      );
    }
  }

  const bindingHash =
    indexedColony?.bindingHash ??
    computeColonyBindingHash({
      playerId: ctx.playerId,
      planetId: ctx.planetId,
      colonyId: ctx.colony.id,
      colonyIndex: ctx.colony.colonyIndex,
      baseSectorId,
      status: 'ACTIVE',
    });

  if (ctx.bindingHash && indexedColony && ctx.bindingHash !== indexedColony.bindingHash) {
    return makeReject(
      'ownership',
      indexedColony.status !== 'ACTIVE' ? 'colony_inactive' : 'not_own_colony',
      'session colony/sector hash no longer matches live base state',
      403,
      'BINDING_HASH_MISMATCH',
    );
  }

  return { planet, colonyId: ctx.colony.id, colonyIndex: ctx.colony.colonyIndex, baseSectorId, bindingHash };
}

export function verifyPayloadIdentityFields(
  caller: ResolvedCallerState,
  planetId: string,
  args: Record<string, unknown>,
  rawArgs?: Record<string, unknown>,
): InputValidationVerdict | null {
  for (const scope of rawArgs && rawArgs !== args ? [args, rawArgs] : [args]) {
    if (typeof scope.colonyId === 'string' && scope.colonyId.trim() && scope.colonyId !== caller.colonyId) {
      return makeReject('ownership', 'not_own_colony', 'payload colonyId does not match caller colony', 403, 'NOT_OWN_COLONY');
    }
    if (typeof scope.planetId === 'string' && scope.planetId.trim() && scope.planetId !== planetId) {
      return makeReject('ownership', 'not_own_colony', 'payload planetId does not match joined planet', 403, 'WRONG_PLANET');
    }
    if (typeof scope.colonyIndex === 'number' && scope.colonyIndex !== caller.colonyIndex) {
      return makeReject('ownership', 'not_own_colony', 'payload colonyIndex does not match caller colony', 403, 'NOT_OWN_COLONY');
    }
  }
  return null;
}
