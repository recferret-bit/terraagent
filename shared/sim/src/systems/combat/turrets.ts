import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { firingRangeTargetRow, readFiringRangeMode } from './firingRange';
import { consumeWeaponShot, fireWeaponAtTarget } from './weaponFire';
export { fireWeaponAtTarget, weaponCooldownTicks } from './weaponFire';
import { acquireClosestTargetInRange, isTargetValidInRange, resolveAttackerWeaponRow } from './targeting';

export const COMBAT_TURRETS_BLOB = 'combatTurrets';

export interface TurretCombatRecord {
  entityId: number;
  targetId?: number | null;
  lastFiredTick?: number;
  nextShotTick?: number;
  shotIntervalTicks?: number;
}

export interface CombatTurretsBlob {
  byEntityId: Record<number, TurretCombatRecord>;
}

function readTurretsBlob(state: PlanetState): Record<number, TurretCombatRecord> {
  const raw = state.blobs[COMBAT_TURRETS_BLOB]?.value as Partial<CombatTurretsBlob> | undefined;
  if (!raw?.byEntityId) return {};
  const out: Record<number, TurretCombatRecord> = {};
  for (const [k, v] of Object.entries(raw.byEntityId)) {
    if (v && typeof v === 'object') out[Number(k)] = { ...v };
  }
  return out;
}

function writeTurretsBlob(
  state: PlanetState,
  byEntityId: Record<number, TurretCombatRecord>,
  tick: number,
): void {
  setBlob(state, COMBAT_TURRETS_BLOB, { byEntityId }, tick);
}

/**
 * Returns the turret/HQ firing state record for `entityId`.
 */
export function getTurretCombatRecord(state: PlanetState, entityId: number): TurretCombatRecord {
  const existing = readTurretsBlob(state)[entityId];
  return existing ?? { entityId, targetId: null };
}

function isTurretOrHqKind(kind: number): boolean {
  return (
    kind === ENTITY_KIND.autocannon ||
    kind === ENTITY_KIND.laserTower ||
    kind === ENTITY_KIND.hq
  );
}

/**
 * Steps stationary defense turrets (`autocannon`, `laserTower`) and HQ auto-turret (`hqAutoTurret`)
 * in the combat slot (`slot: 10`). HQ fires at ground hostiles in range 5 while moving or working
 * without interrupting HQ movement or work.
 */
/** Gallery defenses use their fixed pair; legacy fixtures without pairs use the first living bug. */
function stepFiringRangeTurrets(state: PlanetState, ctx: StepContext): void {
  const cols = state.entities.cols;
  const byEntityId = readTurretsBlob(state);
  let changed = false;

  for (let row = 0; row < state.entities.count; row++) {
    const kind = cols.kind[row]!;
    if (kind !== ENTITY_KIND.autocannon && kind !== ENTITY_KIND.laserTower) continue;
    if (cols.hp[row]! <= 0) continue;
    const entityState = cols.state[row]!;
    if (entityState === ENTITY_STATE.descending || entityState === ENTITY_STATE.inert) continue;

    const weaponRow = resolveAttackerWeaponRow(state, row, ctx.data);
    if (!weaponRow) continue;
    const entityId = cols.id[row]!;
    const bugRow = firingRangeTargetRow(state, entityId);
    const rec = byEntityId[entityId] ?? { entityId, targetId: null };
    const inRange =
      bugRow >= 0 &&
      isTargetValidInRange(state, row, bugRow, {
        weaponRow,
        requireSpotting: true,
        includePassiveFauna: true,
        data: ctx.data,
      });
    if (!inRange) {
      if (rec.targetId != null) {
        rec.targetId = null;
        byEntityId[entityId] = rec;
        changed = true;
      }
      continue;
    }
    const targetId = cols.id[bugRow]!;
    if (rec.targetId !== targetId) {
      rec.targetId = targetId;
      byEntityId[entityId] = rec;
      changed = true;
    }
    if (consumeWeaponShot(rec, weaponRow, ctx.tick)) {
      fireWeaponAtTarget(state, row, bugRow, weaponRow, ctx);
      rec.lastFiredTick = ctx.tick;
      byEntityId[entityId] = rec;
      changed = true;
    }
  }
  if (changed) writeTurretsBlob(state, byEntityId, ctx.tick);
}

export function stepCombatTurrets(state: PlanetState, ctx: StepContext): void {
  const mode = readFiringRangeMode(state);
  if (mode === 'units' || mode === 'bugs' || mode === 'robots') return;
  if (mode === 'gallery' || mode === 'turrets') {
    stepFiringRangeTurrets(state, ctx);
    return;
  }
  const cols = state.entities.cols;
  const byEntityId = readTurretsBlob(state);
  let changed = false;

  for (let row = 0; row < state.entities.count; row++) {
    const kind = cols.kind[row]!;
    if (!isTurretOrHqKind(kind)) continue;
    if (cols.hp[row]! <= 0) continue;

    const entityState = cols.state[row]!;
    if (entityState === ENTITY_STATE.descending || entityState === ENTITY_STATE.inert) continue;

    const weaponRow = resolveAttackerWeaponRow(state, row, ctx.data);
    if (!weaponRow) continue;

    const entityId = cols.id[row]!;
    const rec = byEntityId[entityId] ?? { entityId, targetId: null };

    const targetRow = acquireClosestTargetInRange(state, row, {
      weaponRow,
      requireSpotting: true,
      includePassiveFauna: false,
      stickyTargetId: rec.targetId ?? undefined,
      data: ctx.data,
    });

    if (targetRow < 0) {
      if (rec.targetId !== null && rec.targetId !== undefined) {
        rec.targetId = null;
        byEntityId[entityId] = rec;
        changed = true;
      }
      continue;
    }

    const targetId = cols.id[targetRow]!;
    if (rec.targetId !== targetId) {
      rec.targetId = targetId;
      byEntityId[entityId] = rec;
      changed = true;
    }

    if (consumeWeaponShot(rec, weaponRow, ctx.tick)) {
      fireWeaponAtTarget(state, row, targetRow, weaponRow, ctx);
      rec.lastFiredTick = ctx.tick;
      byEntityId[entityId] = rec;
      changed = true;
    }
  }

  for (const idStr of Object.keys(byEntityId)) {
    const id = Number(idStr);
    if (rowOf(state.entities, id) < 0) {
      delete byEntityId[id];
      changed = true;
    }
  }

  if (changed) {
    writeTurretsBlob(state, byEntityId, ctx.tick);
  }
}
