import { REMOVAL_WINDOW_TICKS } from '../../ecs/store';
import { setBlob, type PlanetState } from '../../kernel/state';
import type { UnitStanceRecord } from './stances';

export const STANCE_CHANGES_BLOB = 'combatStanceChanges';
export const STANCE_FIELD_BITS = {
  entityId: 1, stance: 2, anchorQ: 4, anchorR: 8, targetId: 16, attackMoveGoal: 32,
  explicitTargetId: 64, lastFiredTick: 128, nextShotTick: 256, shotIntervalTicks: 512, returningToAnchor: 1024,
} satisfies Record<keyof UnitStanceRecord, number>;
export const STANCE_FIELDS = Object.entries(STANCE_FIELD_BITS) as [keyof UnitStanceRecord, number][];
export const ALL_STANCE_FIELDS = STANCE_FIELDS.reduce((mask, [, bit]) => mask | bit, 0);
export interface StanceChanges {
  sinceTick: number;
  stanceTick: number;
  fieldsById: Record<string, Record<number, number>>;
  removedAt: Record<string, number>;
}

function equalField(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return (a as { q: number; r: number }).q === (b as { q: number; r: number }).q &&
    (a as { q: number; r: number }).r === (b as { q: number; r: number }).r;
}

/** One semantic comparison feeds both canonical blob stamps and bounded sparse transport history. */
export function recordStanceChanges(state: PlanetState, prev: Record<number, UnitStanceRecord> | undefined, next: Record<number, UnitStanceRecord>, tick: number): boolean {
  const old = state.blobs[STANCE_CHANGES_BLOB]?.value as StanceChanges | undefined;
  // The first tracked frame may contain an unjournaled legacy write, so earlier clients need a full baseline.
  const journal = old ?? { sinceTick: tick, stanceTick: tick, fieldsById: {}, removedAt: {} };
  let changed = !prev;
  let pruned = false;
  for (const [id, record] of Object.entries(next)) {
    for (const [field, bit] of STANCE_FIELDS) {
      if (prev?.[Number(id)] && equalField(prev[Number(id)][field], record[field])) continue;
      (journal.fieldsById[id] ??= {})[bit] = tick;
      changed = true;
    }
    delete journal.removedAt[id];
  }
  for (const id of Object.keys(prev ?? {})) {
    if (next[Number(id)]) continue;
    journal.removedAt[id] = tick;
    delete journal.fieldsById[id];
    changed = true;
  }
  for (const [id, removedAt] of Object.entries(journal.removedAt)) {
    if (removedAt >= tick - REMOVAL_WINDOW_TICKS) continue;
    delete journal.removedAt[id];
    journal.sinceTick = Math.max(journal.sinceTick, tick - REMOVAL_WINDOW_TICKS);
    pruned = true;
  }
  if (changed) journal.stanceTick = tick;
  if (changed || pruned || !old) setBlob(state, STANCE_CHANGES_BLOB, journal, tick);
  return changed;
}
