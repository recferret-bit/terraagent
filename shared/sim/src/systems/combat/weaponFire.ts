import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { applyDamage } from './damage';
import { fireLaserOrMelee, isLaserWeapon } from './lasers';
import { fireProjectile } from './projectiles';
/**
 * Fractional tick interval; deadlines carry the remainder instead of rounding every shot.
 */
export function weaponCooldownTicks(weaponRow: Record<string, unknown>): number {
  const ratePerS = Number(weaponRow.ratePerS ?? 0);
  if (Number.isFinite(ratePerS) && ratePerS > 0) {
    return Math.max(1, TICKS_PER_SECOND / ratePerS);
  }
  const intervalS = Number(weaponRow.intervalS ?? 0);
  if (Number.isFinite(intervalS) && intervalS > 0) {
    return Math.max(1, intervalS * TICKS_PER_SECOND);
  }
  return TICKS_PER_SECOND / 2;
}

export interface WeaponCadence {
  lastFiredTick?: number;
  nextShotTick?: number;
  shotIntervalTicks?: number;
}

/** One shot per simulation tick, preserving fractional cadence and dropping idle catch-up bursts. */
export function consumeWeaponShot(rec: WeaponCadence, weaponRow: Record<string, unknown>, tick: number): boolean {
  if (weaponRow.ratePerS === 0) return false;
  const interval = weaponCooldownTicks(weaponRow);
  const unchanged = rec.shotIntervalTicks === interval;
  const due = unchanged && rec.nextShotTick !== undefined
    ? rec.nextShotTick : rec.lastFiredTick === undefined ? tick : rec.lastFiredTick + interval;
  if (tick + 1e-9 < due) return false;
  rec.nextShotTick = (due > tick - 1 ? due : tick) + interval;
  rec.shotIntervalTicks = interval;
  rec.lastFiredTick = tick;
  return true;
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

  const projSpeed = Math.max(1e-6, Number(weaponRow.projSpeed ?? 20));
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

