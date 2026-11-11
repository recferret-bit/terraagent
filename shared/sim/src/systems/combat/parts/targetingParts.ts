import { ENTITY_KIND, ENTITY_STATE } from '../../../ecs/columns';
import type { Columns } from '../../../ecs/store';
import type { CompiledDataLike } from '../../../kernel/config';
import { setBlob, type PlanetState } from '../../../kernel/state';
import { updateColonyVisionCache } from '../vision';
import { lookupWeaponById, resolveKindWeaponRow } from '../weaponRows';

export const COMBAT_WEAPONS_BLOB = 'combatWeapons';
export const COMBAT_TARGETS_BLOB = 'combatTargets';

export interface CombatWeaponsBlob {
  byEntityId: Record<number, string>;
}

export interface CombatTargetsBlob {
  byEntityId: Record<number, number>;
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

export function isFaunaTargetPassiveToAttacker(
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

export function getEntityAxialCoords(cols: Columns, row: number): [number, number] {
  const x = cols.x[row]!;
  const y = cols.y[row]!;
  const q = cols.q[row]!;
  const r = cols.r[row]!;
  if (x === 0 && y === 0 && (q !== 0 || r !== 0)) {
    return [q, r];
  }
  return [x, y];
}

export function isPoweredTurretOffline(kind: number, entityState: number): boolean {
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

export function ensureColonyVisionReady(state: PlanetState, owner: number, data?: CompiledDataLike): void {
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
