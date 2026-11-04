import type { PlanetState } from '../../kernel/state';
import { directorRecord, ensureDirectorRecord, saveDirectorRecord } from './store';

/** Holds an equivalent re-proposal of `goal` until `untilTick` (exclusive). */
export function suppressGoal(state: PlanetState, colonyIndex: number, goal: string, untilTick: number, tick: number): void {
  const record = ensureDirectorRecord(state, colonyIndex, tick);
  record.suppressUntil[goal] = untilTick;
  saveDirectorRecord(state, colonyIndex, record, tick);
}

/** True when `suppressUntil[goal]` is a number and `tick` is still before that deadline. */
export function goalSuppressed(state: PlanetState, colonyIndex: number, goal: string, tick: number): boolean {
  const until = directorRecord(state, colonyIndex)?.suppressUntil?.[goal];
  return typeof until === 'number' && tick < until;
}
