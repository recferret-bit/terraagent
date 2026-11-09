import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { hexDistance } from '../../grid/hex';
import type { PlanetState } from '../../kernel/state';
import { footprintAttackRange } from './approachBand';

/** `state.blobs.combatDryFire` — weapons still fire; `applyDamage` deals 0. */
export const COMBAT_DRY_FIRE_BLOB = 'combatDryFire';
/** `state.blobs.firingRange` — `{ mode: 'gallery' | 'turrets' | 'units' | 'bugs' | 'robots' }`. Absent = normal combat. */
export const FIRING_RANGE_BLOB = 'firingRange';

export type FiringRangeMode = 'gallery' | 'turrets' | 'units' | 'bugs' | 'robots';

export const FIRING_RANGE_BUG_KINDS: readonly number[] = [
  ENTITY_KIND.blackAnt,
  ENTITY_KIND.blueBeetle,
  ENTITY_KIND.greenSpitter,
];

export const FIRING_RANGE_UNIT_KINDS: readonly number[] = [
  ENTITY_KIND.recon,
  ENTITY_KIND.demoTank,
  ENTITY_KIND.demoArtillery,
];

/**
 * True when dry fire is on. Reads `blob.value` first (same shape as `godMode`), and treats a
 * truthy blob with no value as on.
 */
export function isCombatDryFire(state: PlanetState): boolean {
  const slot = state.blobs[COMBAT_DRY_FIRE_BLOB] as { value?: unknown } | undefined;
  const raw = slot?.value ?? slot;
  return Boolean(raw);
}

/** Active firing-range mode, or `null` when the blob is absent (combat stays as it is today). */
export function readFiringRangeMode(state: PlanetState): FiringRangeMode | null {
  const slot = state.blobs[FIRING_RANGE_BLOB] as { value?: unknown } | undefined;
  const raw = slot?.value ?? slot;
  if (!raw || typeof raw !== 'object') return null;
  const mode = (raw as { mode?: unknown }).mode;
  if (mode === 'gallery' || mode === 'turrets' || mode === 'units' || mode === 'bugs' || mode === 'robots') return mode;
  return null;
}

/** Lowest living entity id of `kinds`. `colonyOwned` keeps only `owner >= 0`. */
export function pickLowestLivingRow(state: PlanetState, kinds: readonly number[], colonyOwned = false): number {
  const cols = state.entities.cols;
  let best = -1;
  let bestId = Infinity;
  for (let row = 0; row < state.entities.count; row++) {
    if (!kinds.includes(cols.kind[row]!)) continue;
    if (cols.hp[row]! <= 0) continue;
    const st = cols.state[row]!;
    if (st === ENTITY_STATE.inert || st === ENTITY_STATE.descending) continue;
    if (colonyOwned && cols.owner[row]! < 0) continue;
    const id = cols.id[row]!;
    if (id < bestId) {
      bestId = id;
      best = row;
    }
  }
  return best;
}

/** Lowest-id colony combat unit, or `-1` when it is outside `range` tiles of `bugRow`. */
export function firingRangeUnitRowInRange(state: PlanetState, bugRow: number, range: number): number {
  if (bugRow < 0) return -1;
  const target = firingRangeBugTargetRow(state, state.entities.cols.id[bugRow]!);
  if (target < 0) return -1;
  const cols = state.entities.cols;
  const cont = hexDistance(cols.x[bugRow]!, cols.y[bugRow]!, cols.x[target]!, cols.y[target]!);
  if (cont > footprintAttackRange(range, cols.footprintW[target]) + 1e-4) return -1;
  return target;
}

/** Gallery pairs are explicit: losing a target never redirects fire into another lane. */
export function firingRangeTargetRow(state: PlanetState, attackerId: number): number {
  const raw = state.blobs[FIRING_RANGE_BLOB]?.value as { pairs?: Record<number, number> } | undefined;
  if (!raw?.pairs) return pickLowestLivingRow(state, FIRING_RANGE_BUG_KINDS);
  const id = raw.pairs[attackerId];
  const row = id === undefined ? -1 : rowOf(state.entities, id);
  return row >= 0 && state.entities.cols.hp[row]! > 0 ? row : -1;
}

/** Paired insects keep their own robot; a dead counterpart never redirects a lane. */
export function firingRangeBugTargetRow(state: PlanetState, bugId: number): number {
  const raw = state.blobs[FIRING_RANGE_BLOB]?.value as { pairs?: Record<number, number> } | undefined;
  if (!raw?.pairs) return pickLowestLivingRow(state, FIRING_RANGE_UNIT_KINDS, true);
  const target = raw.pairs[bugId];
  const row = target === undefined ? -1 : rowOf(state.entities, target);
  return row >= 0 && state.entities.cols.hp[row]! > 0 && state.entities.cols.owner[row]! >= 0 ? row : -1;
}
