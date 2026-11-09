import type { WaveId } from '@terra/contracts';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import type { ColonyGoalEntry, GoalKind } from './types';

export type GoalExecutor = (
  state: PlanetState, colonyIndex: number, goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[], tick: number, ctx?: StepContext,
) => void;

export interface GoalExecutorOptions {
  wave?: WaveId | string;
}

const executors = new Map<GoalKind, { executor: GoalExecutor; wave?: string }>();

/** Owning waves register real task breakdowns before exposing a goal to players. */
export function registerGoalExecutor(
  kind: GoalKind,
  executor: GoalExecutor,
  opts?: GoalExecutorOptions,
): void {
  executors.set(kind, { executor, wave: opts?.wave });
}

export function getGoalExecutor(
  kind: GoalKind,
  flags?: { has(w: string): boolean },
): GoalExecutor | undefined {
  const entry = executors.get(kind);
  if (!entry) return undefined;
  if (flags && entry.wave && !flags.has(entry.wave)) return undefined;
  return entry.executor;
}

export function isGoalExecutable(
  kind: GoalKind,
  flags?: { has(w: string): boolean },
): boolean {
  const entry = executors.get(kind);
  if (!entry) return false;
  if (flags && entry.wave && !flags.has(entry.wave)) return false;
  return true;
}
