import { ENTITY_KIND } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import type { PlanetState } from '../../kernel/state';
import { noteClearNestHit } from '../bounty/damage';
import { hasActiveTruce, recordHostilityBetween } from '../diplomacy/store';
import { emitUnderAttackIfDue } from './events';
import { isCombatDryFire } from './firingRange';
import {
  getLastDamagedTick,
  hqRetreatHpRatio,
  hqSelfRepairPctPerS,
  recordEntityDamaged,
  retreatHqToSafety,
  stepHqCombatSurvival,
  stepHqSelfRepair,
} from './hqSurvival';
import {
  applyHqDamageOrDestruction,
  getEntityKindName,
  getHiveSpeciesName,
  handleBuildingDestruction,
  handleUnitDestruction,
  isCombatOrWorkerUnitKind,
  isFaunaBugKind,
  isFaunaHiveKind,
  type ApplyDamageOptions,
  type DamageResult,
} from './parts/damageHelpers';

export * from './events';

export {
  getEntityKindName,
  getHiveSpeciesName,
  getLastDamagedTick,
  hqRetreatHpRatio,
  hqSelfRepairPctPerS,
  isFaunaBugKind,
  isFaunaHiveKind,
  retreatHqToSafety,
  stepHqCombatSurvival,
  stepHqSelfRepair,
  type ApplyDamageOptions,
  type DamageResult,
};

function isHostileDamage(state: PlanetState, targetOwner: number, opts?: ApplyDamageOptions): boolean {
  if (targetOwner < 0) return false;
  if (opts?.attackerOwner !== undefined) {
    return opts.attackerOwner !== targetOwner;
  }
  if (opts?.attackerId !== undefined) {
    const aRow = rowOf(state.entities, opts.attackerId);
    if (aRow < 0) return false;
    return state.entities.cols.owner[aRow] !== targetOwner;
  }
  return true;
}

/**
 * Returns `true` when `owner` is a colony index (`>= 0`) with `godMode` active
 * in `state.blobs.godMode.byColony[owner]` or `state.colonies[owner].godMode`.
 */
export function isColonyGodMode(state: PlanetState, owner: number): boolean {
  if (owner < 0) return false;
  if ((state.colonies[owner] as { godMode?: boolean } | undefined)?.godMode === true) {
    return true;
  }
  const rawBlob = (state.blobs.godMode?.value ?? state.blobs.godMode) as
    | { byColony?: Record<number, boolean> }
    | undefined;
  return rawBlob?.byColony?.[owner] === true;
}

/**
 * Applies plain battle v1 damage to `targetId` (`UO-C`, `UO-TF-04`, `UO-HQ-03`):
 * - Non-HQ units at `<= 0` HP are removed and emit `unitDestroyed` / `faunaKilled`.
 * - Buildings at `<= 0` HP are removed, leave all footprint tiles `PREP.prepared` (`UO-TF-04`), and emit `buildingDestroyed` / `nestDestroyed`.
 * - HQ never dies (`hp` clamped at `1`, `UO-HQ-03`); below 40% HP it drops work orders and retreats toward the nearest Hub/pod.
 */
export function applyDamage(
  state: PlanetState,
  targetId: number,
  amount: number,
  opts?: ApplyDamageOptions,
): DamageResult {
  const row = rowOf(state.entities, targetId);
  if (row < 0 || amount <= 0) {
    return { applied: 0, hpAfter: row >= 0 ? state.entities.cols.hp[row] : 0, destroyed: false, clampedHq: false, retreatedHq: false };
  }

  const cols = state.entities.cols;
  const owner = cols.owner[row];
  const tick = opts?.tick ?? opts?.ctx?.tick ?? state.meta.tick;
  const attackerOwner =
    opts?.attackerOwner !== undefined
      ? opts.attackerOwner
      : opts?.attackerId !== undefined && rowOf(state.entities, opts.attackerId) >= 0
        ? cols.owner[rowOf(state.entities, opts.attackerId)]
        : undefined;
  if (
    owner >= 0 &&
    typeof attackerOwner === 'number' &&
    attackerOwner >= 0 &&
    attackerOwner !== owner &&
    hasActiveTruce(state, attackerOwner, owner, tick)
  ) {
    return { applied: 0, hpAfter: cols.hp[row], destroyed: false, clampedHq: false, retreatedHq: false };
  }
  const rawDamage = isCombatDryFire(state) || (owner >= 0 && isColonyGodMode(state, owner)) ? 0 : amount;
  if (rawDamage <= 0) {
    return { applied: 0, hpAfter: cols.hp[row], destroyed: false, clampedHq: false, retreatedHq: false };
  }

  const data = opts?.data ?? opts?.ctx?.data;
  const kind = cols.kind[row];
  const q = cols.q[row];
  const r = cols.r[row];
  const prevHp = cols.hp[row];
  const rawHp = prevHp - amount;

  recordEntityDamaged(state, targetId, tick, opts?.attackerOwner, opts?.attackerId);

  let result: DamageResult;
  if (kind === ENTITY_KIND.hq) {
    result = applyHqDamageOrDestruction(state, row, targetId, owner, prevHp, rawHp, tick, data, opts);
  } else if (rawHp > 0) {
    const hpAfter = Math.fround(rawHp);
    setField(state.entities, row, 'hp', hpAfter, tick);
    result = { applied: prevHp - hpAfter, hpAfter, destroyed: false, clampedHq: false, retreatedHq: false };
  } else if (isCombatOrWorkerUnitKind(kind)) {
    result = handleUnitDestruction(state, row, targetId, prevHp, tick, opts);
  } else {
    result = handleBuildingDestruction(state, row, targetId, prevHp, tick, opts);
  }

  if (result.applied > 0 && owner >= 0 && isHostileDamage(state, owner, opts)) {
    if (typeof attackerOwner === 'number' && attackerOwner >= 0 && attackerOwner !== owner) {
      recordHostilityBetween(state, attackerOwner, owner, tick);
    }
    emitUnderAttackIfDue(state, owner, { targetId, attackerId: opts?.attackerId, q, r, tick }, opts?.ctx);
  }
  if (isFaunaHiveKind(kind)) {
    noteClearNestHit(state, targetId, result.applied, result.destroyed, tick, creditedColony(state, opts), opts?.ctx);
  }

  return result;
}

function creditedColony(state: PlanetState, opts?: ApplyDamageOptions): number {
  if (typeof opts?.attackerOwner === 'number') return opts.attackerOwner;
  if (opts?.attackerId === undefined) return -1;
  const row = rowOf(state.entities, opts.attackerId);
  return row < 0 ? -1 : state.entities.cols.owner[row];
}
