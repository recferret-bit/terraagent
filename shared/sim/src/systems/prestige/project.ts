import { ensureColonyRecord } from '../../kernel/colonies';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { colonyWho } from '../find';

/** A colony's prestige facts: non-tradable, no cash, no production multiplier. Stored as `colony.prestige`. */
export interface ColonyPrestige {
  /** Completed projects in all. */
  completed: number;
  /** Completions per project id. */
  byProject: Record<string, number>;
  lastCompletedAt: number;
}

/** The colony's prestige facts (zeroes when it has none yet). Read-only. */
export function getColonyPrestige(state: PlanetState, colonyIndex: number): ColonyPrestige {
  const raw = state.colonies[colonyIndex]?.prestige as Partial<ColonyPrestige> | undefined;
  return { completed: raw?.completed ?? 0, byProject: { ...(raw?.byProject ?? {}) }, lastCompletedAt: raw?.lastCompletedAt ?? 0 };
}

/**
 * A project finished: one more on the colony's counter and a `prestigeCompleted` event. Nothing else changes: no stock,
 * no cash, no multiplier. Repeating the project is a new queue entry that pays its inputs again.
 */
export function completePrestigeProject(state: PlanetState, colonyIndex: number, project: string, ctx: StepContext): void {
  const col = ensureColonyRecord(state, colonyIndex, ctx.tick);
  const cur = getColonyPrestige(state, colonyIndex);
  const count = (cur.byProject[project] ?? 0) + 1;
  col.prestige = { completed: cur.completed + 1, byProject: { ...cur.byProject, [project]: count }, lastCompletedAt: ctx.tick } satisfies ColonyPrestige;
  col.changedAt = ctx.tick;
  const { colonyIdStr, who } = colonyWho(state, colonyIndex);
  ctx.emit({ kind: 'prestigeCompleted', colonyIds: [colonyIdStr], data: { ...who, project, count } });
}
