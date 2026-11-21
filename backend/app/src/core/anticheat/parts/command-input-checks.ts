import type {
  InputValidationVerdict,
  ValidateCommandInputContext,
} from '../anticheat.types';
import type { SectorHashIndex } from '../sector-hash-index';
import {
  extractUnitIdList,
  verifyCallerBinding,
  verifyPayloadIdentityFields,
  type ResolvedCallerState,
} from './caller-binding-checks';
import {
  checkAllTargetColonyFields,
  checkFootprintAgainstPlanetAndSector,
  checkOwnedEntityAgainstPlanetAndSector,
  checkTargetColonyAgainstPlanetAndSector,
  checkTileAgainstPlanetAndSector,
  isNearRivalAnchor,
  makeReject,
  normalizeExplicitSectorParam,
  resolveTargetColonyBinding,
} from './spatial-assertions';
import {
  checkCancelTaskPayload,
  checkEnqueueTaskPayload,
  checkRaidPayload,
  checkRepairPayload,
} from './task-payload-checks';

function checkAttackTargetEntity(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  targetId: unknown,
): InputValidationVerdict | null {
  if (typeof targetId !== 'number' || !Number.isSafeInteger(targetId) || targetId <= 0) {
    return makeReject('attack', 'invalid_args', 'invalid targetId', 400, 'INVALID_ARGS');
  }
  const planet = caller.planet;
  if (!planet || planet.entitiesById.size === 0) return null;

  const targetRec = planet.entitiesById.get(targetId);
  if (!targetRec) {
    if (targetId < planet.nextEntityId || targetId > planet.maxEntityId + 256) {
      return makeReject('attack', 'unknown_entity', `target entity ${targetId} does not exist on planet`, 404, 'UNKNOWN_ENTITY');
    }
    return null;
  }
  if (!targetRec.alive) {
    return makeReject('attack', 'unknown_entity', `target entity ${targetId} is destroyed`, 404, 'UNKNOWN_ENTITY');
  }
  if (targetRec.ownerColonyIndex === caller.colonyIndex) {
    return makeReject('attack', 'invalid_args', 'cannot attack own entity', 400, 'INVALID_ARGS');
  }
  if (!planet.crossSectorEnabled) {
    if (targetRec.ownerColonyIndex >= 0) {
      const colErr = checkTargetColonyAgainstPlanetAndSector({
        index,
        planet,
        planetId,
        callerColonyId: caller.colonyId,
        callerColonyIndex: caller.colonyIndex,
        baseSectorId: caller.baseSectorId,
        rawTarget: targetRec.ownerColonyIndex,
        category: 'attack',
        enforceSameSector: true,
      });
      if (colErr) return colErr;
    }
    if (
      planet.hasMultiSectorGrid &&
      targetRec.sectorId !== caller.baseSectorId &&
      !isNearRivalAnchor(planet, targetRec.q, targetRec.r)
    ) {
      return makeReject(
        'attack',
        'cross_sector_disabled',
        `target entity ${targetId} is in sector ${targetRec.sectorId}, outside ${caller.baseSectorId}`,
        403,
        'CROSS_SECTOR_DISABLED',
      );
    }
  }
  return null;
}

function checkCombatOrMovementKind(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  kind: string,
  args: Record<string, unknown>,
  rawArgs?: Record<string, unknown>,
): InputValidationVerdict | null {
  const category = kind === 'attackMove' || kind === 'attackTarget' ? 'attack' : 'units';
  for (const id of extractUnitIdList(args, rawArgs)) {
    const uErr = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: id,
      category,
    });
    if (uErr) return uErr;
  }

  if (kind === 'attackTarget') {
    return checkAttackTargetEntity(index, caller, planetId, args.targetId);
  }

  const toObj = args.to && typeof args.to === 'object' ? (args.to as Record<string, unknown>) : undefined;
  const rawToObj = rawArgs?.to && typeof rawArgs.to === 'object' ? (rawArgs.to as Record<string, unknown>) : undefined;
  for (const coordScope of [args, toObj, rawArgs, rawToObj]) {
    if (coordScope && typeof coordScope.q === 'number' && typeof coordScope.r === 'number') {
      const tErr = checkTileAgainstPlanetAndSector({
        index,
        planet: caller.planet,
        planetId,
        colonyIndex: caller.colonyIndex,
        baseSectorId: caller.baseSectorId,
        q: coordScope.q,
        r: coordScope.r,
        category,
        allowRivalProximity: kind === 'attackMove',
      });
      if (tErr) return tErr;
    }
  }
  return null;
}

function checkSetRallyPayload(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  for (const rawId of [args.producerId, args.entityId]) {
    if (rawId === undefined) continue;
    const pErr = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: typeof rawId === 'number' ? rawId : Number.NaN,
      category: 'units',
      requireSameSector: true,
    });
    if (pErr) return pErr;
  }
  if (typeof args.q === 'number' && typeof args.r === 'number') {
    return checkTileAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      q: args.q,
      r: args.r,
      category: 'units',
    });
  }
  return null;
}

function checkGoalKind(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  const scopes =
    args.params && typeof args.params === 'object'
      ? [args, args.params as Record<string, unknown>]
      : [args];
  for (const params of scopes) {
    if (params.sectorId !== undefined) {
      const sec = normalizeExplicitSectorParam(params.sectorId);
      if (sec === 'invalid') return makeReject('goal', 'invalid_args', 'invalid goal sectorId', 400, 'INVALID_SECTOR');
      if (sec && !(caller.planet?.crossSectorEnabled ?? false) && sec !== caller.baseSectorId) {
        return makeReject('goal', 'cross_sector_disabled', `goal sector ${sec} differs from base ${caller.baseSectorId}`, 403, 'CROSS_SECTOR_DISABLED');
      }
    }
    if (typeof params.q === 'number' && typeof params.r === 'number') {
      const tErr = checkTileAgainstPlanetAndSector({
        index,
        planet: caller.planet,
        planetId,
        colonyIndex: caller.colonyIndex,
        baseSectorId: caller.baseSectorId,
        q: params.q,
        r: params.r,
        category: 'goal',
      });
      if (tErr) return tErr;
    }
    const cErr = checkAllTargetColonyFields({
      index,
      planet: caller.planet,
      planetId,
      callerColonyId: caller.colonyId,
      callerColonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      args: params,
      category: 'goal',
      enforceSameSector: true,
    });
    if (cErr) return cErr;
  }
  return null;
}

function checkBountyTargetObject(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  t: Record<string, unknown>,
): InputValidationVerdict | null {
  if (t.kind === 'defend_area' && typeof t.q === 'number' && typeof t.r === 'number') {
    return checkTileAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      q: t.q,
      r: t.r,
      category: 'economy',
    });
  }
  if (t.kind === 'clear_nest' && typeof t.nestId === 'string' && /^\d+$/.test(t.nestId)) {
    const nestEntity = caller.planet?.entitiesById.get(Number(t.nestId));
    if (
      caller.planet &&
      nestEntity &&
      !caller.planet.crossSectorEnabled &&
      caller.planet.hasMultiSectorGrid &&
      nestEntity.sectorId !== caller.baseSectorId
    ) {
      return makeReject('economy', 'cross_sector_disabled', 'nest target is outside colony sector', 403, 'CROSS_SECTOR_DISABLED');
    }
  }
  return null;
}

function checkMarketOrBountyKind(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  kind: string,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  if (kind === 'market.setHubFee' && typeof args.hubId === 'number') {
    return checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: args.hubId,
      category: 'economy',
      requireSameSector: true,
    });
  }

  if (kind === 'market.cancelOrder' && typeof args.orderId === 'string') {
    const refMatch = /^market-order:([^:]+):\d+$/.exec(args.orderId.trim());
    if (refMatch) {
      const refCol = refMatch[1]!;
      if (refCol !== caller.colonyId && refCol !== `col_${caller.colonyIndex}` && refCol !== `col-${caller.colonyIndex}`) {
        return makeReject('economy', 'not_own_colony', 'order ref does not belong to caller colony', 403, 'NOT_OWN_COLONY');
      }
    }
    return null;
  }

  if (kind === 'market.placeOrder') {
    if (args.director === true) {
      return makeReject('economy', 'invalid_args', 'director flag is reserved for server autoTrade', 400, 'INVALID_ARGS');
    }
    if (args.stallId !== undefined) {
      const stallEntityId =
        typeof args.stallId === 'number'
          ? args.stallId
          : typeof args.stallId === 'string' && /^\d+$/.test(args.stallId.trim())
            ? Number(args.stallId.trim())
            : Number.NaN;
      return checkOwnedEntityAgainstPlanetAndSector({
        planet: caller.planet,
        colonyIndex: caller.colonyIndex,
        baseSectorId: caller.baseSectorId,
        entityId: stallEntityId,
        category: 'economy',
        requireSameSector: true,
      });
    }
    return null;
  }

  if (kind === 'bounty.post' && args.target && typeof args.target === 'object') {
    return checkBountyTargetObject(index, caller, planetId, args.target as Record<string, unknown>);
  }

  if (kind === 'bounty.claim' && typeof args.bountyId === 'string') {
    const targetObj = args.target && typeof args.target === 'object' ? (args.target as Record<string, unknown>) : undefined;
    if (targetObj) {
      const tErr = checkBountyTargetObject(index, caller, planetId, targetObj);
      if (tErr) return tErr;
    }
    const bountyRec = caller.planet?.bountiesById.get(args.bountyId);
    const targetKind = bountyRec?.targetKind ?? (typeof targetObj?.kind === 'string' ? targetObj.kind : undefined);
    const posterId = bountyRec?.posterColonyId ?? (typeof args.posterColonyId === 'string' ? args.posterColonyId : undefined);
    const match = /^bt:(\d+):\d+$/.exec(args.bountyId);
    const posterIdx =
      bountyRec && bountyRec.posterColonyIndex >= 0
        ? bountyRec.posterColonyIndex
        : typeof args.posterColonyIndex === 'number'
          ? args.posterColonyIndex
          : match
            ? Number(match[1])
            : -1;
    const poster =
      (posterId ? index.getColonyById(posterId) : undefined) ??
      (posterIdx >= 0 ? index.getColonyByPlanetIndex(planetId, posterIdx) : undefined);
    if (poster && poster.planetId !== planetId) {
      return makeReject('economy', 'not_own_colony', 'bounty belongs to another planet', 403, 'WRONG_PLANET');
    }
    if (!(caller.planet?.crossSectorEnabled ?? false) && targetKind !== 'deliver_units') {
      if (bountyRec?.sectorId && bountyRec.sectorId !== caller.baseSectorId) {
        return makeReject('economy', 'cross_sector_disabled', `bounty ${args.bountyId} is in sector ${bountyRec.sectorId}`, 403, 'CROSS_SECTOR_DISABLED');
      }
      if (poster && !poster.isRivalAi && poster.colonyIndex !== caller.colonyIndex && poster.baseSectorId !== caller.baseSectorId) {
        return makeReject('economy', 'cross_sector_disabled', 'bounty poster is in another sector', 403, 'CROSS_SECTOR_DISABLED');
      }
    }
  }
  return null;
}

function checkDiplomacyKind(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  kind: string,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  const baseOpts = {
    index,
    planet: caller.planet,
    planetId,
    callerColonyId: caller.colonyId,
    callerColonyIndex: caller.colonyIndex,
    baseSectorId: caller.baseSectorId,
    category: 'diplomacy' as const,
    enforceSameSector: true,
  };
  if (kind === 'diplomacy.declareWar' || kind === 'diplomacy.proposeTruce') {
    return checkAllTargetColonyFields({ ...baseOpts, args });
  }
  if (kind === 'diplomacy.respondTruce' && typeof args.offerId === 'string') {
    const id = args.offerId.trim();
    const offer = caller.planet?.diplomacyOffersById.get(id);
    if (offer) {
      if (offer.toColonyIndex !== caller.colonyIndex) {
        return makeReject('diplomacy', 'not_own_colony', 'truce offer does not belong to caller colony', 403, 'NOT_OWN_COLONY');
      }
      return checkTargetColonyAgainstPlanetAndSector({ ...baseOpts, rawTarget: offer.fromColonyIndex });
    }
    if (!/^of_\d+$/.test(id) || resolveTargetColonyBinding(index, planetId, id).binding) {
      return checkTargetColonyAgainstPlanetAndSector({ ...baseOpts, rawTarget: id });
    }
  }
  if (kind === 'diplomacy.cancelTruce' && typeof args.truceId === 'string') {
    const id = args.truceId.trim();
    const truce = caller.planet?.diplomacyTrucesById.get(id);
    if (truce) {
      if (truce.colonyAIndex !== caller.colonyIndex && truce.colonyBIndex !== caller.colonyIndex) {
        return makeReject('diplomacy', 'not_own_colony', 'truce does not belong to caller colony', 403, 'NOT_OWN_COLONY');
      }
      const partner = truce.colonyAIndex === caller.colonyIndex ? truce.colonyBIndex : truce.colonyAIndex;
      return checkTargetColonyAgainstPlanetAndSector({ ...baseOpts, rawTarget: partner });
    }
    if (!/^tr_\d+$/.test(id) || resolveTargetColonyBinding(index, planetId, id).binding) {
      return checkTargetColonyAgainstPlanetAndSector({ ...baseOpts, rawTarget: id });
    }
  }
  if (kind === 'diplomacy.cancelWar' && typeof args.warId === 'string') {
    const id = args.warId.trim();
    const war = caller.planet?.diplomacyWarsById.get(id);
    if (war) {
      if (war.attackerColonyIndex !== caller.colonyIndex) {
        return makeReject('diplomacy', 'not_own_colony', 'war was not declared by caller colony', 403, 'NOT_OWN_COLONY');
      }
      return checkTargetColonyAgainstPlanetAndSector({ ...baseOpts, rawTarget: war.defenderColonyIndex });
    }
    if (!/^war_\d+$/.test(id) || resolveTargetColonyBinding(index, planetId, id).binding) {
      return checkTargetColonyAgainstPlanetAndSector({ ...baseOpts, rawTarget: id });
    }
  }
  return null;
}

function dispatchKindCheck(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  ctx: ValidateCommandInputContext,
  args: Record<string, unknown>,
  rawArgs?: Record<string, unknown>,
): InputValidationVerdict | null {
  const { planetId, kind } = ctx;
  if (kind === 'setPlanetTime') {
    if (ctx.production || caller.planet?.hasMultiSectorGrid) {
      return makeReject('ownership', 'not_own_colony', 'setPlanetTime is disabled on shared multi-sector worlds', 403, 'FORBIDDEN');
    }
    return null;
  }
  if (kind === 'placeBuilding' && typeof args.q === 'number' && typeof args.r === 'number') {
    return checkFootprintAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      q: args.q,
      r: args.r,
      building: args.building,
      category: 'base',
    });
  }
  if (kind === 'demolish' && typeof args.entityId === 'number') {
    return checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: args.entityId,
      category: 'base',
      requireSameSector: true,
    });
  }
  if (kind === 'repair') return checkRepairPayload(index, caller, planetId, args);
  if (kind === 'enqueueTask') return checkEnqueueTaskPayload(index, caller, planetId, args);
  if (kind === 'cancelTask') return checkCancelTaskPayload(caller, args);
  if (kind === 'setRally') return checkSetRallyPayload(index, caller, planetId, args);
  if (
    kind === 'unitReserve' ||
    kind === 'moveUnit' ||
    kind === 'moveGroup' ||
    kind === 'stopUnit' ||
    kind === 'setStance' ||
    kind === 'attackMove' ||
    kind === 'attackTarget'
  ) {
    return checkCombatOrMovementKind(index, caller, planetId, kind, args, rawArgs);
  }
  if (kind === 'raid') return checkRaidPayload(index, caller, planetId, args);
  if (kind.startsWith('diplomacy.')) {
    return checkDiplomacyKind(index, caller, planetId, kind, args);
  }
  if (kind === 'queueGoal' || kind === 'acceptSuggestion') {
    return checkGoalKind(index, caller, planetId, args);
  }
  return checkMarketOrBountyKind(index, caller, planetId, kind, args);
}

/**
 * Validates any client/HTTP command input in O(1) hash time against the planet, sector, and colony base.
 */
export function validateInputAgainstPlanetAndSector(
  index: SectorHashIndex,
  ctx: ValidateCommandInputContext,
): InputValidationVerdict {
  if (ctx.dev) return { ok: true };

  const callerOrErr = verifyCallerBinding(index, ctx);
  if ('ok' in callerOrErr) return callerOrErr;

  const args = (ctx.args && typeof ctx.args === 'object' ? ctx.args : {}) as Record<string, unknown>;
  const rawArgs =
    ctx.rawArgs && typeof ctx.rawArgs === 'object' ? (ctx.rawArgs as Record<string, unknown>) : undefined;
  const idErr = verifyPayloadIdentityFields(callerOrErr, ctx.planetId, args, rawArgs);
  if (idErr) return idErr;

  const kindErr = dispatchKindCheck(index, callerOrErr, ctx, args, rawArgs);
  if (kindErr) return kindErr;

  return { ok: true, bindingHash: callerOrErr.bindingHash };
}
