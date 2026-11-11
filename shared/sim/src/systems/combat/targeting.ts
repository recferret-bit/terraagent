import { ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { HEX_DIRS, hexDistance, inHex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { hasActiveTruce } from '../diplomacy/store';
import { isColonyRaidProtected } from '../pvp/shield';
import { footprintAttackRange } from './approachBand';
import { canWeaponHitTarget } from './layers';
import { isTargetSpottedByColony } from './vision';
import {
  COMBAT_TARGETS_BLOB,
  COMBAT_WEAPONS_BLOB,
  ensureColonyVisionReady,
  getEntityAxialCoords,
  isFaunaTargetPassiveToAttacker,
  isPoweredTurretOffline,
  resolveAttackerWeaponRow,
  setEntityWeaponOverride,
  type CombatTargetsBlob,
  type CombatWeaponsBlob,
} from './parts/targetingParts';

export {
  COMBAT_TARGETS_BLOB,
  COMBAT_WEAPONS_BLOB,
  resolveAttackerWeaponRow,
  setEntityWeaponOverride,
  type CombatTargetsBlob,
  type CombatWeaponsBlob,
};

export interface HostileCheckOptions {
  includePassiveFauna?: boolean;
  data?: CompiledDataLike;
}

export interface AcquireTargetOptions extends HostileCheckOptions {
  weaponId?: string;
  weaponRow?: Record<string, unknown>;
  minRange?: number;
  maxRange?: number;
  requireSpotting?: boolean;
  stickyTargetRow?: number;
  stickyTargetId?: number;
  data?: CompiledDataLike;
}

/**
 * Checks whether `targetRow` is a valid hostile target for `attackerRow`:
 * - Target must be alive (`hp > 0`) and not `inert` or `descending`.
 * - Target must belong to a different owner (`cols.owner[targetRow] !== cols.owner[attackerRow]`).
 * - Respects the passive fauna contract (`fauna-hives-spec.md` §2): colony attackers skip fauna marked
 *   passive (and not aggressive toward `attackerOwner`) unless `opts?.includePassiveFauna === true`.
 */
export function isHostileTargetForAttacker(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  opts?: HostileCheckOptions,
): boolean {
  const count = state.entities.count;
  if (attackerRow < 0 || attackerRow >= count || targetRow < 0 || targetRow >= count) return false;
  if (attackerRow === targetRow) return false;

  const cols = state.entities.cols;
  if (cols.hp[targetRow]! <= 0) return false;

  const targetState = cols.state[targetRow]!;
  if (targetState === ENTITY_STATE.inert || targetState === ENTITY_STATE.descending) return false;

  const attackerOwner = cols.owner[attackerRow]!;
  const targetOwner = cols.owner[targetRow]!;
  if (targetOwner === attackerOwner) return false;
  if (attackerOwner >= 0 && targetOwner >= 0) {
    if (hasActiveTruce(state, attackerOwner, targetOwner)) return false;
    const pvpBlob = state.blobs.pvp?.value as { byColony?: Record<string, unknown> } | undefined;
    const targetCol = state.colonies[targetOwner];
    if (
      (pvpBlob?.byColony?.[String(targetOwner)] !== undefined ||
        (typeof targetCol?.raidProtectedUntil === 'number' && targetCol.raidProtectedUntil > 0)) &&
      isColonyRaidProtected(state, targetOwner, state.meta.tick, opts?.data)
    ) {
      return false;
    }
  }

  if (!opts?.includePassiveFauna && attackerOwner >= 0 && targetOwner < 0) {
    const targetId = cols.id[targetRow]!;
    if (isFaunaTargetPassiveToAttacker(state, targetId, attackerOwner)) {
      return false;
    }
  }
  if (!opts?.includePassiveFauna && attackerOwner < 0 && targetOwner >= 0) {
    const attackerId = cols.id[attackerRow]!;
    if (isFaunaTargetPassiveToAttacker(state, attackerId, targetOwner)) {
      return false;
    }
  }

  return true;
}

/**
 * Checks whether a specific candidate `targetRow` is valid, hostile, within `[minRange, maxRange]`,
 * hittable on its combat layer (`W07-07`), and spotted by the attacker's colony (`W07-08`).
 */
export function isTargetValidInRange(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  opts?: AcquireTargetOptions,
): boolean {
  if (attackerRow < 0 || attackerRow >= state.entities.count) return false;
  const cols = state.entities.cols;
  if (cols.hp[attackerRow]! <= 0) return false;
  if (isPoweredTurretOffline(cols.kind[attackerRow]!, cols.state[attackerRow]!)) return false;

  const weaponRow =
    opts?.weaponRow ?? resolveAttackerWeaponRow(state, attackerRow, opts?.data, opts?.weaponId);
  if (!weaponRow) return false;

  const minRange = Number(opts?.minRange ?? weaponRow.minRange ?? 0);
  const maxRange = Number(opts?.maxRange ?? weaponRow.range ?? 0);
  if (maxRange <= 0) return false;

  if (!isHostileTargetForAttacker(state, attackerRow, targetRow, opts)) return false;

  const [ax, ay] = getEntityAxialCoords(cols, attackerRow);
  const [tx, ty] = getEntityAxialCoords(cols, targetRow);
  const dist = hexDistance(ax, ay, tx, ty);
  const targetFootprintW = Math.max(
    1,
    cols.footprintW[targetRow] || cols.footprintD[targetRow] || 1,
  );
  const effectiveMaxRange = footprintAttackRange(maxRange, targetFootprintW);
  if (dist < minRange - 1e-5 || dist > effectiveMaxRange + 1e-5) return false;

  if (!canWeaponHitTarget(state, weaponRow, targetRow, opts?.data)) return false;

  const attackerOwner = cols.owner[attackerRow]!;
  if (opts?.requireSpotting !== false && attackerOwner >= 0) {
    ensureColonyVisionReady(state, attackerOwner, opts?.data);
    if (!isTargetSpottedByColony(state, attackerOwner, targetRow, opts?.data)) return false;
  }

  return true;
}

/**
 * Auto-acquires the closest valid hostile entity in `[minRange, maxRange]` (`UO-C-07`, `W07-09`).
 * - Strictly skips targets closer than `minRange` (`dist < minRange - 1e-5`).
 * - Respects weapon combat layer flags (`W07-07`) and colony shared spotting (`W07-08`).
 * - Keeps `stickyTargetRow` / `stickyTargetId` if provided and still valid in `[minRange, maxRange]`.
 * - Tie-breaks equidistant targets by lowest `cols.id[r]`.
 * Returns the target entity row, or `-1` if no valid target is in range.
 */
export function acquireClosestTargetInRange(
  state: PlanetState,
  attackerRow: number,
  opts?: AcquireTargetOptions,
): number {
  if (attackerRow < 0 || attackerRow >= state.entities.count) return -1;
  const cols = state.entities.cols;
  if (cols.hp[attackerRow]! <= 0) return -1;
  if (isPoweredTurretOffline(cols.kind[attackerRow]!, cols.state[attackerRow]!)) return -1;

  const weaponRow =
    opts?.weaponRow ?? resolveAttackerWeaponRow(state, attackerRow, opts?.data, opts?.weaponId);
  if (!weaponRow) return -1;

  const minRange = Number(opts?.minRange ?? weaponRow.minRange ?? 0);
  const maxRange = Number(opts?.maxRange ?? weaponRow.range ?? 0);
  if (maxRange <= 0) return -1;

  const resolvedOpts: AcquireTargetOptions = { ...opts, weaponRow, minRange, maxRange };

  if (opts?.stickyTargetRow !== undefined && opts.stickyTargetRow >= 0) {
    if (isTargetValidInRange(state, attackerRow, opts.stickyTargetRow, resolvedOpts)) {
      return opts.stickyTargetRow;
    }
  }
  if (opts?.stickyTargetId !== undefined && opts.stickyTargetId > 0) {
    const stickyRow = rowOf(state.entities, opts.stickyTargetId);
    if (stickyRow >= 0 && isTargetValidInRange(state, attackerRow, stickyRow, resolvedOpts)) {
      return stickyRow;
    }
  }

  const attackerOwner = cols.owner[attackerRow]!;
  if (opts?.requireSpotting !== false && attackerOwner >= 0) {
    ensureColonyVisionReady(state, attackerOwner, opts?.data);
  }

  const [ax, ay] = getEntityAxialCoords(cols, attackerRow);
  let bestRow = -1;
  let bestDist = Infinity;
  let bestId = Infinity;

  for (let r = 0; r < state.entities.count; r++) {
    if (r === attackerRow) continue;
    if (!isHostileTargetForAttacker(state, attackerRow, r, opts)) continue;

    const [tx, ty] = getEntityAxialCoords(cols, r);
    const dist = hexDistance(ax, ay, tx, ty);
    const targetFootprintW = Math.max(1, cols.footprintW[r] || cols.footprintD[r] || 1);
    const effectiveMaxRange = footprintAttackRange(maxRange, targetFootprintW);
    if (dist < minRange - 1e-5 || dist > effectiveMaxRange + 1e-5) continue;

    if (!canWeaponHitTarget(state, weaponRow, r, opts?.data)) continue;

    if (opts?.requireSpotting !== false && attackerOwner >= 0) {
      if (!isTargetSpottedByColony(state, attackerOwner, r, opts?.data)) continue;
    }

    const id = cols.id[r]!;
    if (dist < bestDist - 1e-5 || (Math.abs(dist - bestDist) <= 1e-5 && id < bestId)) {
      bestDist = dist;
      bestId = id;
      bestRow = r;
    }
  }

  return bestRow;
}

/**
 * Convenience wrapper around `acquireClosestTargetInRange` that returns the target's `entityId`
 * (or `null` when no valid target is in `[minRange, maxRange]`).
 */
export function acquireClosestTargetEntityId(
  state: PlanetState,
  attackerRow: number,
  opts?: AcquireTargetOptions,
): number | null {
  const row = acquireClosestTargetInRange(state, attackerRow, opts);
  if (row < 0) return null;
  return state.entities.cols.id[row]!;
}

/**
 * Returns `true` when `targetRow` is a living hostile hittable target that sits strictly inside
 * the attacker's `minRange` (`dist < minRange - 1e-5`), signaling a mobile unit to back off.
 */
export function isTargetInsideMinRange(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  opts?: AcquireTargetOptions,
): boolean {
  if (attackerRow < 0 || attackerRow >= state.entities.count) return false;
  const weaponRow =
    opts?.weaponRow ?? resolveAttackerWeaponRow(state, attackerRow, opts?.data, opts?.weaponId);
  if (!weaponRow) return false;

  const minRange = Number(opts?.minRange ?? weaponRow.minRange ?? 0);
  if (minRange <= 0) return false;

  if (!isHostileTargetForAttacker(state, attackerRow, targetRow, opts)) return false;
  if (!canWeaponHitTarget(state, weaponRow, targetRow, opts?.data)) return false;

  const cols = state.entities.cols;
  const [ax, ay] = getEntityAxialCoords(cols, attackerRow);
  const [tx, ty] = getEntityAxialCoords(cols, targetRow);
  return hexDistance(ax, ay, tx, ty) < minRange - 1e-5;
}

/**
 * Picks a neighbor hex `(q, r)` around `attackerRow` that increases distance from `threatRow`
 * when a unit with `minRange > 0` needs to back off (`W07-09`).
 */
export function pickMinRangeBackoffNeighbor(
  state: PlanetState,
  attackerRow: number,
  threatRow: number,
): [number, number] | null {
  const count = state.entities.count;
  if (attackerRow < 0 || attackerRow >= count || threatRow < 0 || threatRow >= count) return null;
  const cols = state.entities.cols;
  const aq = cols.q[attackerRow]!;
  const ar = cols.r[attackerRow]!;
  const [tx, ty] = getEntityAxialCoords(cols, threatRow);
  const currentDist = hexDistance(aq, ar, tx, ty);

  let bestNeighbor: [number, number] | null = null;
  let bestDist = currentDist;

  for (const [dq, dr] of HEX_DIRS) {
    const nq = aq + dq;
    const nr = ar + dr;
    if (!inHex(nq, nr, state.grid.radius)) continue;
    const d = hexDistance(nq, nr, tx, ty);
    if (d > bestDist + 1e-5) {
      bestDist = d;
      bestNeighbor = [nq, nr];
    }
  }

  return bestNeighbor;
}
