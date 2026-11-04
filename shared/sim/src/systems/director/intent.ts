import type { PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { getOpenColonyGoals } from '../goals/store';
import { getColonyPriorities } from '../goals/priorities';
import { expirePriorityOverlays } from './overlay';
import { ensureDirectorRecord, priorityKey, saveDirectorRecord, supersedeOpenPlans } from './store';

export function goalKey(state: PlanetState, colonyIndex: number): string {
  return getOpenColonyGoals(state, colonyIndex).map((goal) => goal.id).join(',');
}

/**
 * Watches W08 priorities and open goals. A drift is a player-intent change: bump the revision and
 * supersede open director plans. The first observation only records the baseline.
 */
export function syncDirectorIntent(state: PlanetState, tick: number): void {
  expirePriorityOverlays(state, tick);
  for (const colony of state.colonies) {
    if (!colony) continue;
    const record = ensureDirectorRecord(state, colony.index, tick);
    const priorities = priorityKey(getColonyPriorities(state, colony.index));
    const goals = goalKey(state, colony.index);
    if (!record.baselined) {
      record.baselined = true;
      record.seenPriorities = priorities;
      record.seenGoals = goals;
      record.policy.priorities = { ...getColonyPriorities(state, colony.index) };
      record.baselinePriorities = { ...record.policy.priorities };
      saveDirectorRecord(state, colony.index, record, tick);
      continue;
    }
    let dirty = false;
    if (record.seenPriorities !== priorities) {
      record.policy.priorities = { ...getColonyPriorities(state, colony.index) };
      record.baselinePriorities = { ...record.policy.priorities };
      record.overlayUntilTick = null;
      record.policy.revision += 1;
      record.seenPriorities = priorities;
      supersedeOpenPlans(record);
      dirty = true;
    }
    if (record.seenGoals !== goals) {
      record.seenGoals = goals;
      supersedeOpenPlans(record);
      dirty = true;
    }
    if (dirty) saveDirectorRecord(state, colony.index, record, tick);
  }
}

export const directorIntentSystem = defineSystem({
  id: 'director.intent',
  slot: 13,
  wave: 'W16',
  run(state, ctx) {
    syncDirectorIntent(state, ctx.tick);
  },
});
