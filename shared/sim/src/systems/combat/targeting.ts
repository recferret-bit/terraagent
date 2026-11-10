import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, type Columns } from '../../ecs/store';
import { HEX_DIRS, hexDistance, inHex } from '../../grid/hex';
import type { CompiledDataLike } from '../../kernel/config';
import { setBlob, type PlanetState } from '../../kernel/state';
import { mercenariesKeepPeace } from '../mercenary/blob';
import { canWeaponHitTarget } from './layers';
import { lookupWeaponById, resolveKindWeaponRow } from './weaponRows';
import { isTargetSpottedByColony, updateColonyVisionCache } from './vision';

export const COMBAT_WEAPONS_BLOB = 'combatWeapons';
export const COMBAT_TARGETS_BLOB = 'combatTargets';

export interface CombatWeaponsBlob {
  byEntityId: Record<number, string>;
}

export interface CombatTargetsBlob {
  byEntityId: Record<number, number>;
}

export interface HostileCheckOptions {
  includePassiveFauna?: boolean;
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

function readWeaponOverrides(state: PlanetState): Record<number, string> {
  const raw = state.blobs[COMBAT_WEAPONS_BLOB]?.value as Partial<CombatWeaponsBlob> | undefined;
  return raw?.byEntityId ?? {};
}

/** Assigns an explicit weapon ID override for `entityId` in `state.blobs.combatWeapons`. */
export function setEntityWeaponOverride(
  state: PlanetState,
  entityId: number,
  weaponId: string,
  tick = state.meta.tick,
): void {
  const prev = readWeaponOverrides(state);
  setBlob(state, COMBAT_WEAPONS_BLOB, { byEntityId: { ...prev, [entityId]: weaponId } }, tick);
}

/**
 * Resolves the weapon row from `data?.tables?.weapons` (or compiled W07 defaults) for `attackerRow`
 * based on `weaponIdOverride`, per-entity weapon blob overrides, or `cols.kind[attackerRow]`.
 */
export function resolveAttackerWeaponRow(
  state: PlanetState,
  attackerRow: number,
  data?: CompiledDataLike,
  weaponIdOverride?: string,
): Record<string, unknown> | undefined {
  if (weaponIdOverride) {
    return lookupWeaponById(data, weaponIdOverride);
  }
  if (attackerRow < 0 || attackerRow >= state.entities.count) return undefined;

  const cols = state.entities.cols;
  const entityId = cols.id[attackerRow]!;
  const entityOverride = readWeaponOverrides(state)[entityId];
  if (entityOverride) {
    return lookupWeaponById(data, entityOverride);
  }

  return resolveKindWeaponRow(cols.kind[attackerRow]!, data);
}

interface FaunaRecordLike {
  mode?: string;
  targetColony?: number;
  aggressiveColonies?: number[];
  aggressionByColony?: Record<number, unknown>;
  hiveId?: number;
}

function isFaunaAggressiveToColony(rec: FaunaRecordLike, attackerOwner: number): boolean {
  if (Array.isArray(rec.aggressiveColonies)) {
    return rec.aggressiveColonies.includes(attackerOwner);
  }
  if (rec.aggressionByColony && typeof rec.aggressionByColony === 'object') {
    return Boolean(rec.aggressionByColony[attackerOwner]);
  }
  if (typeof rec.targetColony === 'number') {
    return rec.targetColony === attackerOwner;
  }
  return rec.mode === 'aggressive';
}

function isFaunaTargetPassiveToAttacker(
  state: PlanetState,
  targetEntityId: number,
  attackerOwner: number,
): boolean {
  const modeBlob = state.blobs.faunaMode?.value as
    | { byEntityId?: Record<number, string | FaunaRecordLike> }
    | undefined;
  const modeEntry = modeBlob?.byEntityId?.[targetEntityId];
  if (typeof modeEntry === 'string') {
    if (modeEntry === 'passive') return true;
    const hasScopedRecord =
      Boolean((state.blobs.faunaAggression?.value as { byEntityId?: Record<number, unknown> } | undefined)?.byEntityId?.[targetEntityId]) ||
      Boolean((state.blobs.faunaHives?.value as { byEntityId?: Record<number, unknown>; hivesById?: Record<number, unknown>; bugsById?: Record<number, unknown> } | undefined)?.byEntityId?.[targetEntityId]) ||
      Boolean((state.blobs.faunaHives?.value as { hivesById?: Record<number, unknown>; bugsById?: Record<number, unknown> } | undefined)?.hivesById?.[targetEntityId]) ||
      Boolean((state.blobs.faunaHives?.value as { bugsById?: Record<number, unknown> } | undefined)?.bugsById?.[targetEntityId]);
    if (!hasScopedRecord) return false;
  }
  if (modeEntry && typeof modeEntry === 'object') {
    return !isFaunaAggressiveToColony(modeEntry, attackerOwner);
  }

  const aggroBlob = state.blobs.faunaAggression?.value as
    | { byEntityId?: Record<number, FaunaRecordLike>; byHiveId?: Record<number, FaunaRecordLike> }
    | undefined;
  const aggroEntry = aggroBlob?.byEntityId?.[targetEntityId];
  if (aggroEntry) {
    return !isFaunaAggressiveToColony(aggroEntry, attackerOwner);
  }

  const hivesBlob = state.blobs.faunaHives?.value as
    | {
        byEntityId?: Record<number, FaunaRecordLike>;
        hives?: Record<number, FaunaRecordLike>;
        hivesById?: Record<number, FaunaRecordLike>;
        bugsById?: Record<number, FaunaRecordLike & { homeHiveId?: number }>;
        residentHiveByEntityId?: Record<number, number>;
      }
    | undefined;
  const directHiveRec =
    hivesBlob?.byEntityId?.[targetEntityId] ??
    hivesBlob?.hivesById?.[targetEntityId] ??
    hivesBlob?.bugsById?.[targetEntityId] ??
    hivesBlob?.hives?.[targetEntityId];
  if (directHiveRec) {
    return !isFaunaAggressiveToColony(directHiveRec, attackerOwner);
  }
  const homeHiveId =
    hivesBlob?.residentHiveByEntityId?.[targetEntityId] ??
    hivesBlob?.bugsById?.[targetEntityId]?.homeHiveId;
  if (typeof homeHiveId === 'number') {
    const homeRec =
      hivesBlob?.hivesById?.[homeHiveId] ??
      hivesBlob?.hives?.[homeHiveId] ??
      hivesBlob?.byEntityId?.[homeHiveId] ??
      aggroBlob?.byHiveId?.[homeHiveId];
    if (homeRec) {
      return !isFaunaAggressiveToColony(homeRec, attackerOwner);
    }
  }

  return false;
}

/**
 * Checks whether `targetRow` is a valid hostile target for `attackerRow`:
 * - Target must be alive (`hp > 0`) and not `inert` or `descending`.
 * - Target must belong to a different owner (`cols.owner[targetRow] !== cols.owner[attackerRow]`).
 * - A mercenary recon allied to a colony does not fight that colony (W22-29).
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
  if (mercenariesKeepPeace(state, cols.id[attackerRow]!, attackerOwner, cols.id[targetRow]!, targetOwner)) return false;

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

function getEntityAxialCoords(cols: Columns, row: number): [number, number] {
  const x = cols.x[row]!;
  const y = cols.y[row]!;
  const q = cols.q[row]!;
  const r = cols.r[row]!;
  if (x === 0 && y === 0 && (q !== 0 || r !== 0)) {
    return [q, r];
  }
  return [x, y];
}

function isPoweredTurretOffline(kind: number, entityState: number): boolean {
  if (kind !== ENTITY_KIND.autocannon && kind !== ENTITY_KIND.laserTower) return false;
  return (
    entityState === ENTITY_STATE.constructing ||
    entityState === ENTITY_STATE.inert ||
    entityState === ENTITY_STATE.descending ||
    entityState === ENTITY_STATE.offlineBrownout ||
    entityState === ENTITY_STATE.offlineUnpowered ||
    entityState === ENTITY_STATE.offlineOverload ||
    entityState === ENTITY_STATE.offlineNoFuel ||
    entityState === ENTITY_STATE.offlineNoGrid
  );
}

function ensureColonyVisionReady(state: PlanetState, owner: number, data?: CompiledDataLike): void {
  if (owner < 0) return;
  const visionBlob = state.blobs.combatVision?.value as
    | { updatedAtTick?: number; byColony?: Record<number, number[]> }
    | undefined;
  if (!visionBlob) {
    updateColonyVisionCache(state, state.meta.tick, data, true);
    return;
  }
  const existingArr = visionBlob.byColony?.[owner];
  if (
    visionBlob.updatedAtTick === state.meta.tick &&
    (!existingArr || existingArr.length === 0)
  ) {
    updateColonyVisionCache(state, state.meta.tick, data, true);
  }
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
  if (dist < minRange - 1e-5 || dist > maxRange + 1e-5) return false;

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
    if (dist < minRange - 1e-5 || dist > maxRange + 1e-5) continue;

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
