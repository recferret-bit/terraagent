import { ENTITY_KIND } from '../../ecs/columns';
import { ensureColonyRecord } from '../../kernel/colonies';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { HQ_GOAL_LIMIT_BY_TIER, type ColonyGoalEntry } from './types';

export function cloneGoalEntry(g: ColonyGoalEntry): ColonyGoalEntry {
  return {
    ...g,
    params: { ...(g.params ?? {}) },
    spent: { ...(g.spent ?? {}) },
    childTaskIds: [...(g.childTaskIds ?? [])],
  };
}

/**
 * Resolves the effective HQ tier (`1 | 2 | 3`) for `colonyIndex` from `colony.hqTier`, `colony.hubTier`, `colony.hq.tier`,
 * or the highest tier of any alive `hq` / `commandHub` entity owned by `colonyIndex`.
 */
export function getColonyHqTier(state: PlanetState, colonyIndex = 0): 1 | 2 | 3 {
  const col = state.colonies[colonyIndex] as
    | { hqTier?: number; hubTier?: number; hq?: { tier?: number } }
    | undefined;
  let maxTier = 1;
  if (typeof col?.hqTier === 'number' && col.hqTier > maxTier) maxTier = col.hqTier;
  if (typeof col?.hubTier === 'number' && col.hubTier > maxTier) maxTier = col.hubTier;
  if (typeof col?.hq?.tier === 'number' && col.hq.tier > maxTier) maxTier = col.hq.tier;

  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colonyIndex) continue;
    if (cols.hp[r] <= 0 && cols.hpMax[r] > 0) continue;
    const kind = cols.kind[r];
    if (kind === ENTITY_KIND.hq || kind === ENTITY_KIND.commandHub) {
      const t = cols.tier[r] || 1;
      if (t > maxTier) maxTier = t;
    }
  }
  return maxTier >= 3 ? 3 : maxTier === 2 ? 2 : 1;
}

/**
 * Returns the maximum number of open HQ goals (`queued` + `active`) for `colonyIndex`:
 * `2` for HQ Tier 1 (default), `3` for HQ Tier 2, `5` for HQ Tier 3 (`UO-HQ` §3.2).
 */
export function getHqGoalLimit(state: PlanetState, colonyIndex = 0): number {
  return HQ_GOAL_LIMIT_BY_TIER[getColonyHqTier(state, colonyIndex)];
}

function readGoalsBlobMap(state: PlanetState): Record<string, ColonyGoalEntry[]> {
  const raw = state.blobs.goals?.value;
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const mapSource =
    obj.byColony && typeof obj.byColony === 'object' ? (obj.byColony as Record<string, unknown>) : obj;
  const out: Record<string, ColonyGoalEntry[]> = {};
  for (const [k, v] of Object.entries(mapSource)) {
    if (Array.isArray(v)) {
      out[k] = (v as ColonyGoalEntry[]).map(cloneGoalEntry);
    }
  }
  return out;
}

export function getColonyGoals(state: PlanetState, colonyIndex = 0): ColonyGoalEntry[] {
  const map = readGoalsBlobMap(state);
  const fromBlob = map[String(colonyIndex)];
  if (fromBlob) return fromBlob;
  const fromColony = state.colonies[colonyIndex]?.goals;
  if (Array.isArray(fromColony)) return (fromColony as ColonyGoalEntry[]).map(cloneGoalEntry);
  return [];
}

export function getOpenColonyGoals(state: PlanetState, colonyIndex = 0): ColonyGoalEntry[] {
  return getColonyGoals(state, colonyIndex).filter((g) => g.status === 'queued' || g.status === 'active');
}

export function getActiveColonyGoal(state: PlanetState, colonyIndex = 0): ColonyGoalEntry | null {
  return getColonyGoals(state, colonyIndex).find((g) => g.status === 'active') ?? null;
}

export function getColonyGoalHistory(state: PlanetState, colonyIndex = 0): ColonyGoalEntry[] {
  const raw = state.colonies[colonyIndex]?.goalHistory;
  return Array.isArray(raw) ? (raw as ColonyGoalEntry[]).map(cloneGoalEntry) : [];
}

export function saveColonyGoals(
  state: PlanetState,
  colonyIndex: number,
  goals: ColonyGoalEntry[],
  tick: number = state.meta.tick,
): void {
  const cloned = goals.map(cloneGoalEntry);
  const map = readGoalsBlobMap(state);
  map[String(colonyIndex)] = cloned;
  setBlob(state, 'goals', map, tick);

  const colony = ensureColonyRecord(state, colonyIndex, tick);
  colony.goals = cloned.map(cloneGoalEntry);
  colony.goalLimit = getHqGoalLimit(state, colonyIndex);
  colony.changedAt = tick;
}

/** Ensures the first open goal is `'active'` and subsequent open goals are `'queued'`. Returns any newly activated goal. */
export function promoteOpenGoals(goals: ColonyGoalEntry[], tick: number): ColonyGoalEntry | null {
  let seenOpen = false;
  let newlyActivated: ColonyGoalEntry | null = null;
  for (const g of goals) {
    if (g.status !== 'queued' && g.status !== 'active') continue;
    if (!seenOpen) {
      seenOpen = true;
      if (g.status !== 'active') {
        g.status = 'active';
        g.startedAtTick ??= tick;
        newlyActivated = g;
      } else {
        g.startedAtTick ??= tick;
      }
    } else if (g.status === 'active') {
      g.status = 'queued';
    }
  }
  return newlyActivated;
}

export function emitGoalProgress(
  ctx: StepContext | undefined,
  colonyIndex: number,
  entry: ColonyGoalEntry,
  detail?: string,
): void {
  if (!ctx) return;
  ctx.emit({
    kind: 'goalProgress',
    colonyIds: [colonyIndex],
    data: {
      colonyIndex,
      goalId: entry.id,
      goal: entry.goal,
      status: entry.status,
      progress: entry.progress,
      stepsCompleted: entry.stepsCompleted,
      stepsTotal: entry.stepsTotal,
      ...(detail ? { detail } : {}),
    },
  });
}
