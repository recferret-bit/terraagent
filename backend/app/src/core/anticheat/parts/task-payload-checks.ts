import { isValidSectorIdFormat } from '../anticheat.hash';
import type { InputValidationVerdict } from '../anticheat.types';
import type { SectorHashIndex } from '../sector-hash-index';
import {
  extractUnitIdList,
  type ResolvedCallerState,
} from './caller-binding-checks';
import {
  checkAllTargetColonyFields,
  checkFootprintAgainstPlanetAndSector,
  checkOwnedEntityAgainstPlanetAndSector,
  checkTargetColonyAgainstPlanetAndSector,
  checkTileAgainstPlanetAndSector,
  makeReject,
} from './spatial-assertions';

const PRIVILEGED_CLIENT_PRECEDENCES: ReadonlySet<string> = new Set(['system', 'hq', 'autoSitePrep']);

function isPrivilegedPrecedence(raw: unknown): boolean {
  return typeof raw === 'string' && PRIVILEGED_CLIENT_PRECEDENCES.has(raw.trim());
}

function asEntityNumber(raw: unknown): number {
  return typeof raw === 'number' ? raw : Number.NaN;
}

export function checkTerraformSubPayload(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  tf: Record<string, unknown>,
): InputValidationVerdict | null {
  if (tf.workerId !== undefined) {
    const wErr = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: asEntityNumber(tf.workerId),
      category: 'terraform',
    });
    if (wErr) return wErr;
  }
  if (tf.entityId !== undefined) {
    const eErr = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: asEntityNumber(tf.entityId),
      category: 'terraform',
    });
    if (eErr) return eErr;
  }
  if (typeof tf.q === 'number' && typeof tf.r === 'number') {
    const qErr = checkTileAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      q: tf.q,
      r: tf.r,
      category: 'terraform',
    });
    if (qErr) return qErr;
  }
  const tiles = Array.isArray(tf.tiles) ? tf.tiles : [];
  for (const t of tiles) {
    if (
      t &&
      typeof t === 'object' &&
      typeof (t as { q?: unknown }).q === 'number' &&
      typeof (t as { r?: unknown }).r === 'number'
    ) {
      const tileErr = checkTileAgainstPlanetAndSector({
        index,
        planet: caller.planet,
        planetId,
        colonyIndex: caller.colonyIndex,
        baseSectorId: caller.baseSectorId,
        q: (t as { q: number }).q,
        r: (t as { r: number }).r,
        category: 'terraform',
      });
      if (tileErr) return tileErr;
    }
  }
  return null;
}

export function checkBuildUnitSubPayload(
  caller: ResolvedCallerState,
  bu: Record<string, unknown>,
): InputValidationVerdict | null {
  for (const rawId of [bu.producerId, bu.hubEntityId]) {
    if (rawId === undefined) continue;
    const err = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: asEntityNumber(rawId),
      category: 'units',
      requireSameSector: true,
    });
    if (err) return err;
  }
  return null;
}

export function checkRepairPayload(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  if (isPrivilegedPrecedence(args.precedence)) {
    return makeReject('ownership', 'invalid_args', 'privileged precedence is not permitted on client commands', 400, 'INVALID_ARGS');
  }
  if (args.entityId !== undefined) {
    const eErr = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: asEntityNumber(args.entityId),
      category: 'base',
      requireSameSector: true,
    });
    if (eErr) return eErr;
  }
  if (args.workerId !== undefined) {
    const wErr = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: asEntityNumber(args.workerId),
      category: 'units',
    });
    if (wErr) return wErr;
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
      category: 'base',
    });
  }
  return null;
}

export function checkRaidPayload(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  for (const id of extractUnitIdList(args)) {
    const uErr = checkOwnedEntityAgainstPlanetAndSector({
      planet: caller.planet,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      entityId: id,
      category: 'attack',
    });
    if (uErr) return uErr;
  }
  const colErr = checkAllTargetColonyFields({
    index,
    planet: caller.planet,
    planetId,
    callerColonyId: caller.colonyId,
    callerColonyIndex: caller.colonyIndex,
    baseSectorId: caller.baseSectorId,
    args,
    category: 'attack',
    enforceSameSector: true,
  });
  if (colErr) return colErr;

  if (typeof args.q === 'number' && typeof args.r === 'number') {
    return checkTileAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      q: args.q,
      r: args.r,
      category: 'attack',
      allowRivalProximity: true,
    });
  }
  return null;
}

function checkHqGoalSubPayload(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  g: Record<string, unknown>,
): InputValidationVerdict | null {
  if (typeof g.q === 'number' && typeof g.r === 'number') {
    const tErr = checkTileAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      q: g.q,
      r: g.r,
      category: 'goal',
    });
    if (tErr) return tErr;
  }
  if (typeof g.target === 'string' && g.target.trim()) {
    const trimmed = g.target.trim();
    if (isValidSectorIdFormat(trimmed)) {
      if (!(caller.planet?.crossSectorEnabled ?? false) && trimmed !== caller.baseSectorId) {
        return makeReject(
          'goal',
          'cross_sector_disabled',
          `hqGoal target sector ${trimmed} differs from base ${caller.baseSectorId}`,
          403,
          'CROSS_SECTOR_DISABLED',
        );
      }
      return null;
    }
    return checkTargetColonyAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      callerColonyId: caller.colonyId,
      callerColonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      rawTarget: trimmed,
      category: 'goal',
      enforceSameSector: true,
    });
  }
  return null;
}

function checkDirectTaskPayload(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  task: Record<string, unknown>,
): InputValidationVerdict | null {
  const kind = task.kind;
  if (kind === 'build' && typeof task.q === 'number' && typeof task.r === 'number') {
    return checkFootprintAgainstPlanetAndSector({
      index,
      planet: caller.planet,
      planetId,
      colonyIndex: caller.colonyIndex,
      baseSectorId: caller.baseSectorId,
      q: task.q,
      r: task.r,
      building: task.building,
      category: 'base',
    });
  }
  if (kind === 'buildUnit') return checkBuildUnitSubPayload(caller, task);
  if (kind === 'terraform') {
    if (typeof task.q === 'number' && typeof task.r === 'number') {
      const tErr = checkTileAgainstPlanetAndSector({
        index,
        planet: caller.planet,
        planetId,
        colonyIndex: caller.colonyIndex,
        baseSectorId: caller.baseSectorId,
        q: task.q,
        r: task.r,
        category: 'terraform',
      });
      if (tErr) return tErr;
    }
    return checkTerraformSubPayload(index, caller, planetId, task);
  }
  if (kind === 'repair' || kind === 'dismantle') return checkRepairPayload(index, caller, planetId, task);
  if (kind === 'hqGoal') return checkHqGoalSubPayload(index, caller, planetId, task);
  if (kind === 'raid') return checkRaidPayload(index, caller, planetId, task);
  return null;
}

export function checkCancelTaskPayload(
  caller: ResolvedCallerState,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  if (typeof args.taskId !== 'string') return null;
  const trimmed = args.taskId.trim();
  const prefixMatch = /^(building|worker|unit):(.*)$/.exec(trimmed);
  if (!prefixMatch) return null;
  const kind = prefixMatch[1]!;
  const suffix = prefixMatch[2]!;
  if (!/^[1-9]\d*$/.test(suffix)) {
    return makeReject(kind === 'building' ? 'base' : 'units', 'invalid_args', `invalid cancelTask entity target "${trimmed}"`, 400, 'INVALID_ARGS');
  }
  return checkOwnedEntityAgainstPlanetAndSector({
    planet: caller.planet,
    colonyIndex: caller.colonyIndex,
    baseSectorId: caller.baseSectorId,
    entityId: Number(suffix),
    category: kind === 'building' ? 'base' : 'units',
    requireSameSector: kind === 'building',
  });
}

export function checkEnqueueTaskPayload(
  index: SectorHashIndex,
  caller: ResolvedCallerState,
  planetId: string,
  args: Record<string, unknown>,
): InputValidationVerdict | null {
  const innerTask = args.task && typeof args.task === 'object' ? (args.task as Record<string, unknown>) : undefined;
  if (args.costOverride !== undefined || innerTask?.costOverride !== undefined) {
    return makeReject('economy', 'invalid_args', 'costOverride is not permitted on client commands', 400, 'INVALID_ARGS');
  }
  if (isPrivilegedPrecedence(args.precedence) || isPrivilegedPrecedence(innerTask?.precedence)) {
    return makeReject('ownership', 'invalid_args', 'privileged precedence is not permitted on client commands', 400, 'INVALID_ARGS');
  }
  if (args.build && typeof args.build === 'object') {
    const b = args.build as Record<string, unknown>;
    if (typeof b.q === 'number' && typeof b.r === 'number') {
      const err = checkFootprintAgainstPlanetAndSector({
        index,
        planet: caller.planet,
        planetId,
        colonyIndex: caller.colonyIndex,
        baseSectorId: caller.baseSectorId,
        q: b.q,
        r: b.r,
        building: b.building,
        category: 'base',
      });
      if (err) return err;
    }
  }
  if (args.terraform && typeof args.terraform === 'object') {
    const err = checkTerraformSubPayload(index, caller, planetId, args.terraform as Record<string, unknown>);
    if (err) return err;
  }
  if (typeof args.buildUnit === 'string') {
    const err = checkBuildUnitSubPayload(caller, args);
    if (err) return err;
  } else if (args.buildUnit && typeof args.buildUnit === 'object') {
    const err = checkBuildUnitSubPayload(caller, args.buildUnit as Record<string, unknown>);
    if (err) return err;
  }
  if (args.repair && typeof args.repair === 'object') {
    const err = checkRepairPayload(index, caller, planetId, args.repair as Record<string, unknown>);
    if (err) return err;
  }
  if (args.hqGoal && typeof args.hqGoal === 'object') {
    const err = checkHqGoalSubPayload(index, caller, planetId, args.hqGoal as Record<string, unknown>);
    if (err) return err;
  }
  if (args.raid && typeof args.raid === 'object') {
    const err = checkRaidPayload(index, caller, planetId, args.raid as Record<string, unknown>);
    if (err) return err;
  }
  if (innerTask) {
    return checkDirectTaskPayload(index, caller, planetId, innerTask);
  }
  return null;
}
