import { ensureColonyRecord } from '../../kernel/colonies';
import type { CompiledDataLike } from '../../kernel/config';
import type { StepContext } from '../../kernel/context';
import { setBlob, type PlanetState } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { stepRaidTargetGoal } from '../pvp/raidTask';
import { getGoalExecutor, isGoalExecutable, registerGoalExecutor } from './executors';
import { GOAL_CATALOG, getSuggestedGoalForStage } from './catalog';
import { stepColonyGoalsBreakdown } from './breakdown';
import {
  acceptSuggestionHandler,
  cancelGoalHandler,
  devGoalHandler,
  queueGoalHandler,
  reorderGoalHandler,
} from './handlers';
import { isColonyAiEnabled, setAiEnabledHandler } from './ai';
import {
  buildQueuedGoalEntry,
  cancelGoalWaitingOrders,
  computeReorderedOpenGoalPos,
  nextGoalSequence,
  normalizeGoalParams,
  parseReorderGoalCallArgs,
  resolveQueueGoalCallArgs,
  validateRaidGoalTarget,
} from './parts/goalIndexParts';
import { setPrioritiesHandler } from './priorities';
import {
  cloneGoalEntry,
  emitGoalProgress,
  getColonyGoalHistory,
  getColonyGoals,
  getHqGoalLimit,
  getOpenColonyGoals,
  promoteOpenGoals,
  saveColonyGoals,
} from './store';
import type {
  AcceptSuggestionArgs,
  ColonyGoalEntry,
  ColonySuggestion,
  GoalKind,
  GoalParams,
  QueueGoalArgs,
} from './types';

export * from './types';
export * from './executors';
export * from './catalog';
export * from './store';
export * from './priorities';
export * from './ai';
export * from './handlers';
export * from './sites';
export * from './defendAndClear';
export * from './breakdown';
export { normalizeGoalParams };

registerGoalExecutor('raid_target', stepRaidTargetGoal, { wave: 'W18' });

export function queueColonyGoal(
  state: PlanetState,
  colonyIndexOrOpts: number | ({ colonyIndex?: number; tick?: number } & QueueGoalArgs),
  maybeArgs?: QueueGoalArgs,
  maybeTick?: number,
  maybeCtx?: StepContext,
):
  | { ok: true; goal: ColonyGoalEntry; entry: ColonyGoalEntry }
  | {
      ok: false;
      code:
        | 'goal_limit'
        | 'invalid_args'
        | 'wave_disabled'
        | 'cross_sector_disabled'
        | 'truce_active'
        | 'raid_protected';
    } {
  const { colonyIndex, args, tick } = resolveQueueGoalCallArgs(
    state,
    colonyIndexOrOpts,
    maybeArgs,
    maybeTick,
    maybeCtx,
  );
  const ctx = maybeCtx;

  if (!args || !args.goal || !(args.goal in GOAL_CATALOG)) {
    return { ok: false, code: 'invalid_args' };
  }
  const cat = GOAL_CATALOG[args.goal];
  if (ctx && cat.wave !== 'W08' && !ctx.flags.has(cat.wave)) {
    return { ok: false, code: 'wave_disabled' };
  }

  const goals = getColonyGoals(state, colonyIndex);
  const openCount = goals.filter((g) => g.status === 'queued' || g.status === 'active').length;
  if (openCount >= getHqGoalLimit(state, colonyIndex)) {
    return { ok: false, code: 'goal_limit' };
  }
  if (!isGoalExecutable(args.goal, ctx?.flags)) return { ok: false, code: 'wave_disabled' };

  const normParams = normalizeGoalParams(args);
  if (args.goal === 'grow_economy' && ['water', 'bio.water'].includes(String(normParams.resource))) {
    return { ok: false, code: 'wave_disabled' };
  }
  if (args.goal === 'raid_target') {
    const raidErr = validateRaidGoalTarget(state, colonyIndex, normParams, tick, ctx?.data);
    if (raidErr) return { ok: false, code: raidErr };
  }

  const seq = nextGoalSequence(state, colonyIndex, goals);
  const entry = buildQueuedGoalEntry(colonyIndex, seq, args, normParams, cat.defaultStepsTotal, openCount, tick);

  goals.push(entry);
  promoteOpenGoals(goals, tick);
  saveColonyGoals(state, colonyIndex, goals, tick);
  if (entry.status === 'active' && args.goal === 'raid_target') {
    getGoalExecutor('raid_target', ctx?.flags)?.(state, colonyIndex, entry, goals, tick, ctx);
  } else {
    emitGoalProgress(ctx, colonyIndex, entry);
  }
  const saved = cloneGoalEntry(entry);
  return { ok: true, goal: saved, entry: saved };
}

export function cancelColonyGoal(
  state: PlanetState,
  colonyIndexOrGoalId: number | string | { colonyIndex?: number; goalId: string },
  goalIdOrColonyIndex?: string | number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
  ctx?: StepContext,
): { ok: true; goal: ColonyGoalEntry } | { ok: false; code: 'unknown_goal' | 'invalid_args' } {
  let colonyIndex = 0;
  let goalId = '';
  if (typeof colonyIndexOrGoalId === 'number') {
    colonyIndex = colonyIndexOrGoalId;
    goalId = typeof goalIdOrColonyIndex === 'string' ? goalIdOrColonyIndex : '';
  } else if (typeof colonyIndexOrGoalId === 'string') {
    goalId = colonyIndexOrGoalId;
    colonyIndex = typeof goalIdOrColonyIndex === 'number' ? goalIdOrColonyIndex : 0;
  } else if (colonyIndexOrGoalId && typeof colonyIndexOrGoalId === 'object') {
    colonyIndex = colonyIndexOrGoalId.colonyIndex ?? 0;
    goalId = colonyIndexOrGoalId.goalId;
  }
  if (!goalId) return { ok: false, code: 'invalid_args' };

  const goals = getColonyGoals(state, colonyIndex);
  const idx = goals.findIndex((g) => g.id === goalId && (g.status === 'queued' || g.status === 'active'));
  if (idx < 0) return { ok: false, code: 'unknown_goal' };

  const [cancelled] = goals.splice(idx, 1);
  cancelled.status = 'cancelled';
  cancelGoalWaitingOrders(state, colonyIndex, cancelled, tick, data ?? ctx?.data);

  const colony = ensureColonyRecord(state, colonyIndex, tick);
  const history = getColonyGoalHistory(state, colonyIndex);
  history.push(cloneGoalEntry(cancelled));
  colony.goalHistory = history;

  const promoted = promoteOpenGoals(goals, tick);
  saveColonyGoals(state, colonyIndex, goals, tick);
  emitGoalProgress(ctx, colonyIndex, cancelled);
  if (promoted) emitGoalProgress(ctx, colonyIndex, promoted);
  return { ok: true, goal: cloneGoalEntry(cancelled) };
}

export interface ReorderGoalOptions {
  toIndex?: number;
  direction?: 'up' | 'down' | 'top' | 'bottom';
  colonyIndex?: number;
  tick?: number;
}

export function reorderColonyGoal(
  state: PlanetState,
  colonyIndexOrGoalId: number | string | ({ goalId: string } & ReorderGoalOptions),
  goalIdOrOpts?: string | ReorderGoalOptions,
  maybeOpts?: ReorderGoalOptions,
  maybeTick?: number,
): { ok: true; goals: ColonyGoalEntry[] } | { ok: false; code: 'unknown_goal' | 'invalid_args' } {
  const { colonyIndex, goalId, opts, tick } = parseReorderGoalCallArgs(
    state,
    colonyIndexOrGoalId,
    goalIdOrOpts,
    maybeOpts,
    maybeTick,
  );
  if (!goalId) return { ok: false, code: 'invalid_args' };

  const goals = getColonyGoals(state, colonyIndex);
  const openIndices = goals
    .map((g, i) => (g.status === 'queued' || g.status === 'active' ? i : -1))
    .filter((i) => i >= 0);
  const posInOpen = openIndices.findIndex((i) => goals[i].id === goalId);
  if (posInOpen < 0) return { ok: false, code: 'unknown_goal' };

  const nextPos = computeReorderedOpenGoalPos(posInOpen, openIndices.length, opts);
  if (nextPos !== posInOpen) {
    const openItems = openIndices.map((i) => goals[i]);
    const [moved] = openItems.splice(posInOpen, 1);
    openItems.splice(nextPos, 0, moved);
    for (let k = 0; k < openIndices.length; k++) {
      goals[openIndices[k]] = openItems[k];
    }
  }
  promoteOpenGoals(goals, tick);
  saveColonyGoals(state, colonyIndex, goals, tick);
  return { ok: true, goals: getColonyGoals(state, colonyIndex) };
}

export function acceptColonySuggestion(
  state: PlanetState,
  colonyIndex: number,
  args: AcceptSuggestionArgs = {},
  tick: number = state.meta.tick,
  ctx?: StepContext,
): ReturnType<typeof queueColonyGoal> {
  const colony = ensureColonyRecord(state, colonyIndex, tick);
  const activeSuggestion = colony.suggestion as ColonySuggestion | null | undefined;
  const stage = args.stage ?? (typeof colony.stage === 'number' ? colony.stage : 0);
  const goal: GoalKind = args.goal ?? activeSuggestion?.goal ?? getSuggestedGoalForStage(stage);
  const params: GoalParams = {
    ...(activeSuggestion?.params ?? {}),
    ...(args.params ?? {}),
  };

  const res = queueColonyGoal(state, colonyIndex, { goal, params }, tick, ctx);
  if (!res.ok) return res;

  colony.suggestion = null;
  colony.changedAt = tick;
  const rawSug = (state.blobs.suggestions?.value as Record<string, unknown> | undefined) ?? undefined;
  if (rawSug && typeof rawSug === 'object') {
    const nextSug = { ...rawSug };
    delete nextSug[String(colonyIndex)];
    setBlob(state, 'suggestions', nextSug, tick);
  }
  return res;
}

export function clearColonyGoals(
  state: PlanetState,
  colonyIndex: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): void {
  const open = getOpenColonyGoals(state, colonyIndex);
  for (const g of open) {
    cancelColonyGoal(state, colonyIndex, g.id, tick, data);
  }
  saveColonyGoals(state, colonyIndex, [], tick);
}

export function updateColonyGoalProgress(
  state: PlanetState,
  colonyIndex: number,
  goalId: string,
  patch: { progress?: number; stepsCompleted?: number; stepsTotal?: number; nightHeldTicks?: number; detail?: string },
  tick: number = state.meta.tick,
  ctx?: StepContext,
): ColonyGoalEntry | null {
  const goals = getColonyGoals(state, colonyIndex);
  const entry = goals.find((g) => g.id === goalId);
  if (!entry) return null;
  if (patch.stepsTotal !== undefined) entry.stepsTotal = Math.max(1, patch.stepsTotal);
  if (patch.stepsCompleted !== undefined) entry.stepsCompleted = Math.max(0, patch.stepsCompleted);
  if (patch.progress !== undefined) entry.progress = Math.max(0, Math.min(1, patch.progress));
  if (patch.nightHeldTicks !== undefined) entry.nightHeldTicks = patch.nightHeldTicks;
  saveColonyGoals(state, colonyIndex, goals, tick);
  emitGoalProgress(ctx, colonyIndex, entry, patch.detail);
  return cloneGoalEntry(entry);
}

export function completeColonyGoal(
  state: PlanetState,
  colonyIndex: number,
  goalId: string,
  tick: number = state.meta.tick,
  ctx?: StepContext,
): ColonyGoalEntry | null {
  const goals = getColonyGoals(state, colonyIndex);
  const entry = goals.find((g) => g.id === goalId && (g.status === 'queued' || g.status === 'active'));
  if (!entry) return null;
  entry.status = 'done';
  entry.progress = 1;
  entry.stepsCompleted = entry.stepsTotal;
  entry.completedAtTick = tick;

  const promoted = promoteOpenGoals(goals, tick);
  saveColonyGoals(state, colonyIndex, goals, tick);
  emitGoalProgress(ctx, colonyIndex, entry);
  if (ctx) {
    ctx.emit({
      kind: 'goalDone',
      colonyIds: [colonyIndex],
      data: { colonyIndex, goalId: entry.id, goal: entry.goal },
    });
  }
  if (promoted) emitGoalProgress(ctx, colonyIndex, promoted);
  return cloneGoalEntry(entry);
}

export const queueGoal = queueColonyGoal;
export const cancelGoal = cancelColonyGoal;
export const reorderGoal = reorderColonyGoal;
export const acceptSuggestion = acceptColonySuggestion;

export const goalsSystem = defineSystem({
  id: 'goals.manager',
  slot: 4,
  wave: 'W08',
  run(state, ctx) {
    for (const col of state.colonies) {
      if (!col) continue;
      const goals = getColonyGoals(state, col.index);
      if (goals.length === 0) continue;
      const promoted = promoteOpenGoals(goals, ctx.tick);
      const limit = getHqGoalLimit(state, col.index);
      if (promoted || col.goalLimit !== limit) {
        saveColonyGoals(state, col.index, goals, ctx.tick);
        if (promoted) emitGoalProgress(ctx, col.index, promoted);
      }
      const activeGoal = goals.find((g) => g.status === 'active');
      const hqDown = (col as Record<string, unknown>).hqDown === true;
      const goalPaused = (activeGoal as unknown as { paused?: boolean } | undefined)?.paused === true;
      if (isColonyAiEnabled(state, col.index) && !hqDown && !goalPaused) {
        stepColonyGoalsBreakdown(state, col.index, ctx);
      }
    }
  },
});

export default defineSimModule({
  id: 'goals',
  wave: 'W08',
  systems: [goalsSystem],
  handlers: [
    queueGoalHandler,
    cancelGoalHandler,
    reorderGoalHandler,
    acceptSuggestionHandler,
    setPrioritiesHandler,
    setAiEnabledHandler,
    devGoalHandler,
  ],
});
