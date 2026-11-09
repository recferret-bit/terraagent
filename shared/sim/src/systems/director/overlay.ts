import { parseWaves, type IndependentPriorities } from '@terra/contracts';
import { compileData, dataRow, type CompiledData } from '../../data';
import type { PlanetState } from '../../kernel/state';
import { setColonyPriorities } from '../goals/priorities';
import { ensureDirectorRecord, priorityKey, saveDirectorRecord } from './store';

/** `awayGuardBp` is basis points of a slider. 1000 bp is 10 points on the 0..100 scale. */
export function awayGuardPoints(data: CompiledData = compileData(parseWaves('..16'))): number {
  return Math.round((dataRow(data, 'director', 'budget').awayGuardBp as number) / 100);
}

function withinBand(baseline: IndependentPriorities, updates: Partial<IndependentPriorities>, guard: number): boolean {
  for (const key of Object.keys(updates) as (keyof IndependentPriorities)[]) {
    const value = updates[key];
    if (value === undefined) continue;
    if (Math.abs(value - baseline[key]) > guard) return false;
  }
  return true;
}

function restore(state: PlanetState, colonyIndex: number, tick: number): void {
  const record = ensureDirectorRecord(state, colonyIndex, tick);
  if (record.overlayUntilTick === null || tick < record.overlayUntilTick) return;
  record.policy.priorities = { ...record.baselinePriorities };
  record.overlayUntilTick = null;
  record.seenPriorities = priorityKey(record.baselinePriorities);
  setColonyPriorities(state, colonyIndex, record.baselinePriorities, tick);
  saveDirectorRecord(state, colonyIndex, record, tick);
}

/** Restores every expired overlay to the player baseline. Does not bump intent. */
export function expirePriorityOverlays(state: PlanetState, tick: number): void {
  for (const colony of state.colonies) {
    if (!colony) continue;
    restore(state, colony.index, tick);
  }
}

/**
 * Temporary sliders. Each one must stay within `guardPoints` of the last explicit player values.
 * A second call is judged against that same baseline, so repeats cannot ratchet.
 */
export function applyPriorityOverlay(
  state: PlanetState,
  colonyIndex: number,
  updates: Partial<IndependentPriorities>,
  untilTick: number,
  tick: number,
  guardPoints: number,
): { ok: true } | { ok: false; code: 'guard_band' } {
  const record = ensureDirectorRecord(state, colonyIndex, tick);
  if (!record.baselinePriorities) record.baselinePriorities = { ...record.policy.priorities };
  if (!withinBand(record.baselinePriorities, updates, guardPoints)) return { ok: false, code: 'guard_band' };
  const next = { ...record.baselinePriorities, ...strip(updates) };
  record.policy.priorities = next;
  record.overlayUntilTick = untilTick;
  record.seenPriorities = priorityKey(next);
  setColonyPriorities(state, colonyIndex, next, tick);
  saveDirectorRecord(state, colonyIndex, record, tick);
  return { ok: true };
}

function strip(updates: Partial<IndependentPriorities>): Partial<IndependentPriorities> {
  const out: Partial<IndependentPriorities> = {};
  for (const key of Object.keys(updates) as (keyof IndependentPriorities)[]) {
    if (updates[key] !== undefined) out[key] = updates[key];
  }
  return out;
}
