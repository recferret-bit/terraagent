import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import type { ColonyGoalEntry, GoalKind } from './types';

export type GoalExecutor = (
  state: PlanetState, colonyIndex: number, goal: ColonyGoalEntry,
  goals: ColonyGoalEntry[], tick: number, ctx?: StepContext,
) => void;

const executors = new Map<GoalKind, GoalExecutor>();
/** Owning waves register real task breakdowns before exposing a goal to players. */
export function registerGoalExecutor(kind: GoalKind, executor: GoalExecutor): void {
  executors.set(kind, executor);
}
export function getGoalExecutor(kind: GoalKind): GoalExecutor | undefined {
  return executors.get(kind);
}
export function isGoalExecutable(kind: GoalKind): boolean {
  return executors.has(kind);
}
