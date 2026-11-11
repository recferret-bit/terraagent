import { ensureColonyRecord } from '../../../kernel/colonies';
import type { CompiledDataLike } from '../../../kernel/config';
import type { StepContext } from '../../../kernel/context';
import type { PlanetState } from '../../../kernel/state';
import { hasActiveTruce, resolveColonyIndex } from '../../diplomacy/store';
import { canRaidTargetSector } from '../../pvp/sectorGuard';
import { isColonyRaidProtected } from '../../pvp/shield';
import { cancelQueueTask, getAllQueueEntries } from '../../queue';
import type { ReorderGoalOptions } from '../index';
import { getColonyGoalHistory } from '../store';
import {
  DEFAULT_GOAL_BUDGET_BP,
  type ColonyGoalEntry,
  type GoalParams,
  type QueueGoalArgs,
} from '../types';

export function validateRaidGoalTarget(
  state: PlanetState,
  colonyIndex: number,
  params: GoalParams,
  tick: number,
  data?: CompiledDataLike,
): 'invalid_args' | 'cross_sector_disabled' | 'truce_active' | 'raid_protected' | null {
  const rawRef = params.targetColonyId ?? params.target;
  if (rawRef === undefined) return null;
  const toColony = resolveColonyIndex(state, rawRef as string | number);
  if (toColony < 0 || toColony === colonyIndex) return 'invalid_args';
  if (!canRaidTargetSector(state, colonyIndex, toColony).ok) return 'cross_sector_disabled';
  if (hasActiveTruce(state, colonyIndex, toColony, tick)) return 'truce_active';
  if (isColonyRaidProtected(state, toColony, tick, data)) return 'raid_protected';
  return null;
}

export function normalizeGoalParams(args: Partial<QueueGoalArgs>): GoalParams {
  return {
    ...(args.params ?? {}),
    ...(args.resource !== undefined ? { resource: args.resource } : {}),
    ...(args.targetRatePerMin !== undefined ? { targetRatePerMin: args.targetRatePerMin } : {}),
    ...(args.targetNetEnergyPerS !== undefined ? { targetNetEnergyPerS: args.targetNetEnergyPerS } : {}),
    ...(args.target !== undefined ? { target: args.target } : {}),
  };
}

export function nextGoalSequence(state: PlanetState, colonyIndex: number, existing: ColonyGoalEntry[]): number {
  const colony = ensureColonyRecord(state, colonyIndex, state.meta.tick);
  let maxSeq = typeof colony.nextGoalSeq === 'number' ? colony.nextGoalSeq : 0;
  const all = [...existing, ...getColonyGoalHistory(state, colonyIndex)];
  const prefix = `goal_${colonyIndex}_`;
  for (const g of all) {
    if (g.id.startsWith(prefix)) {
      const parsed = Number(g.id.slice(prefix.length));
      if (Number.isInteger(parsed) && parsed > maxSeq) maxSeq = parsed;
    }
  }
  const next = maxSeq + 1;
  colony.nextGoalSeq = next;
  return next;
}

export function resolveQueueGoalCallArgs(
  state: PlanetState,
  colonyIndexOrOpts: number | ({ colonyIndex?: number; tick?: number } & QueueGoalArgs),
  maybeArgs?: QueueGoalArgs,
  maybeTick?: number,
  maybeCtx?: StepContext,
): { colonyIndex: number; args: QueueGoalArgs | undefined; tick: number } {
  const colonyIndex = typeof colonyIndexOrOpts === 'number' ? colonyIndexOrOpts : (colonyIndexOrOpts.colonyIndex ?? 0);
  const args = typeof colonyIndexOrOpts === 'number' ? maybeArgs : colonyIndexOrOpts;
  const tick =
    typeof colonyIndexOrOpts === 'number'
      ? (maybeTick ?? maybeCtx?.tick ?? state.meta.tick)
      : (colonyIndexOrOpts.tick ?? maybeTick ?? maybeCtx?.tick ?? state.meta.tick);
  return { colonyIndex, args, tick };
}

export function buildQueuedGoalEntry(
  colonyIndex: number,
  seq: number,
  args: QueueGoalArgs,
  normParams: GoalParams,
  defaultStepsTotal: number,
  openCount: number,
  tick: number,
): ColonyGoalEntry {
  const status = openCount === 0 ? 'active' : 'queued';
  return {
    id: `goal_${colonyIndex}_${seq}`,
    goal: args.goal,
    status,
    params: normParams,
    progress: 0,
    stepsCompleted: 0,
    stepsTotal: Math.max(1, defaultStepsTotal),
    budgetBp: args.budgetBp ?? DEFAULT_GOAL_BUDGET_BP,
    spent: {},
    childTaskIds: [],
    createdAtTick: tick,
    ...(status === 'active' ? { startedAtTick: tick } : {}),
    ...(args.goal === 'secure_power' ? { nightHeldTicks: 0 } : {}),
  };
}

export function cancelGoalWaitingOrders(
  state: PlanetState,
  colonyIndex: number,
  goal: ColonyGoalEntry,
  tick: number,
  data?: CompiledDataLike,
): void {
  const childSet = new Set(goal.childTaskIds);
  const queueEntries = getAllQueueEntries(state).filter(
    (e) =>
      e.colonyIndex === colonyIndex &&
      (e.state === 'queued' || e.state === 'waiting') &&
      (e.goalId === goal.id || childSet.has(e.taskId)),
  );
  for (const qEntry of queueEntries) {
    cancelQueueTask(state, qEntry.taskId, colonyIndex, tick, data);
  }
}

export function parseReorderGoalCallArgs(
  state: PlanetState,
  colonyIndexOrGoalId: number | string | ({ goalId: string } & ReorderGoalOptions),
  goalIdOrOpts?: string | ReorderGoalOptions,
  maybeOpts?: ReorderGoalOptions,
  maybeTick?: number,
): { colonyIndex: number; goalId: string; opts: ReorderGoalOptions; tick: number } {
  if (typeof colonyIndexOrGoalId === 'number') {
    const opts = maybeOpts ?? {};
    return {
      colonyIndex: colonyIndexOrGoalId,
      goalId: typeof goalIdOrOpts === 'string' ? goalIdOrOpts : '',
      opts,
      tick: maybeTick ?? opts.tick ?? state.meta.tick,
    };
  }
  if (typeof colonyIndexOrGoalId === 'string') {
    const opts = (typeof goalIdOrOpts === 'object' && goalIdOrOpts ? goalIdOrOpts : {}) as ReorderGoalOptions;
    return {
      colonyIndex: opts.colonyIndex ?? 0,
      goalId: colonyIndexOrGoalId,
      opts,
      tick: maybeTick ?? opts.tick ?? state.meta.tick,
    };
  }
  const opts: ReorderGoalOptions =
    colonyIndexOrGoalId && typeof colonyIndexOrGoalId === 'object' ? colonyIndexOrGoalId : {};
  return {
    colonyIndex: opts.colonyIndex ?? 0,
    goalId: (opts as { goalId?: string }).goalId ?? '',
    opts,
    tick: maybeTick ?? opts.tick ?? state.meta.tick,
  };
}

export function computeReorderedOpenGoalPos(
  posInOpen: number,
  openLength: number,
  opts: ReorderGoalOptions,
): number {
  if (typeof opts.toIndex === 'number') {
    return Math.max(0, Math.min(openLength - 1, opts.toIndex));
  }
  if (opts.direction === 'up') return Math.max(0, posInOpen - 1);
  if (opts.direction === 'down') return Math.min(openLength - 1, posInOpen + 1);
  if (opts.direction === 'top') return 0;
  if (opts.direction === 'bottom') return openLength - 1;
  return posInOpen;
}
