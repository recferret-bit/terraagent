import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { applyDamage } from './damage';
import { fireLaserOrMelee, isLaserWeapon } from './lasers';
import { fireProjectile } from './projectiles';
import { acquireClosestTargetInRange, resolveAttackerWeaponRow } from './targeting';

export const COMBAT_TURRETS_BLOB = 'combatTurrets';

export interface TurretCombatRecord {
  entityId: number;
  targetId?: number | null;
  lastFiredTick?: number;
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

/**
 * Computes weapon cooldown in ticks (`Math.max(1, Math.round(TICKS_PER_SECOND / ratePerS))`).
 */
export function weaponCooldownTicks(weaponRow: Record<string, unknown>): number {
  const ratePerS = Number(weaponRow.ratePerS ?? 0);
  if (Number.isFinite(ratePerS) && ratePerS > 0) {
    return Math.max(1, Math.round(TICKS_PER_SECOND / ratePerS));
  }
  const intervalS = Number(weaponRow.intervalS ?? 0);
  if (Number.isFinite(intervalS) && intervalS > 0) {
    return Math.max(1, Math.round(intervalS * TICKS_PER_SECOND));
  }
  return Math.max(1, Math.round(TICKS_PER_SECOND / 2));
}

/**
 * Fires `weaponRow` from `attackerRow` at `targetRow` (instant laser/melee via `fireLaserOrMelee`
 * or scheduled projectile via `fireProjectile`).
 */
export function fireWeaponAtTarget(
  state: PlanetState,
  attackerRow: number,
  targetRow: number,
  weaponRow: Record<string, unknown>,
  ctx: StepContext,
): void {
  const cols = state.entities.cols;
  const attackerId = cols.id[attackerRow]!;
  const attackerOwner = cols.owner[attackerRow]!;
  const targetId = cols.id[targetRow]!;
  const weaponId = typeof weaponRow.id === 'string' ? weaponRow.id : 'reconGun';
  const damage = Math.max(0, Number(weaponRow.damage ?? 0));
  const range = Math.max(0, Number(weaponRow.range ?? 4));
  const minRange = Math.max(0, Number(weaponRow.minRange ?? 0));

  if (isLaserWeapon(weaponRow)) {
    fireLaserOrMelee(
      state,
      {
        attackerId,
        targetId,
        weaponId,
        weaponRow,
        damage,
        range,
        minRange,
        tick: ctx.tick,
        applyDmg: (s, tId, amount, aId, aOwner, c) => {
          applyDamage(s, tId, amount, {
            attackerId: aId,
            attackerOwner: aOwner,
            tick: c?.tick ?? s.meta.tick,
            ctx: c,
            data: c?.data,
          });
        },
      },
      ctx,
    );
    return;
  }

  const projSpeed = Math.max(1, Number(weaponRow.projSpeed ?? 20));
  const aoe = Math.max(0, Number(weaponRow.aoe ?? 0));
  const arc = weaponRow.arc === 'indirect' ? 'indirect' : 'direct';

  fireProjectile(
    state,
    {
      attackerId,
      attackerOwner,
      targetId,
      weaponId,
      damage,
      speed: projSpeed,
      aoe,
      arc,
      tick: ctx.tick,
    },
    ctx,
  );
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
export function stepCombatTurrets(state: PlanetState, ctx: StepContext): void {
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

    const cooldown = weaponCooldownTicks(weaponRow);
    if (rec.lastFiredTick === undefined || ctx.tick - rec.lastFiredTick >= cooldown) {
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
