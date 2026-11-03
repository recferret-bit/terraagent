import {
  GOAL_KINDS,
  GoalKindSchema,
  GoalParamsSchema,
  PRIORITY_KEYS,
  PriorityKeySchema,
  type AcceptSuggestionArgs,
  type CancelGoalArgs,
  type GoalKind,
  type GoalParams,
  type PriorityKey,
  type QueueGoalArgs,
  type ReorderGoalArgs,
  type SetPrioritiesArgs,
} from '@terra/contracts';
import type { ArgsOf } from '../command';

export type DevGoalArgs = ArgsOf<'dev.goal'>;

export {
  GOAL_KINDS,
  GoalKindSchema,
  GoalParamsSchema,
  PRIORITY_KEYS,
  PriorityKeySchema,
  type AcceptSuggestionArgs,
  type CancelGoalArgs,
  type GoalKind,
  type GoalParams,
  type PriorityKey,
  type QueueGoalArgs,
  type ReorderGoalArgs,
  type SetPrioritiesArgs,
};

export type GoalStatus = 'queued' | 'active' | 'done' | 'cancelled';

/** Default budget share in basis points (`5000` = 50% of free income / stock, UO-G-01). */
export const DEFAULT_GOAL_BUDGET_BP = 5000;

/** Open HQ goal queue limits by HQ tier (`UO-HQ` §3.2, `UO-P` §4.4): T1 = 2, T2 = 3, T3 = 5. */
export const HQ_GOAL_LIMIT_BY_TIER: Readonly<Record<1 | 2 | 3, number>> = {
  1: 2,
  2: 3,
  3: 5,
};

/** Default colony priority slider values (`0..100` step 10, `SIM-R-02`). */
export const DEFAULT_COLONY_PRIORITIES: Readonly<ColonyPriorities> = {
  economy: 50,
  expansion: 50,
  defense: 50,
  power: 50,
  terraform: 50,
};

export interface ColonyPriorities {
  economy: number;
  expansion: number;
  defense: number;
  power: number;
  terraform: number;
}

export interface ColonyGoalEntry {
  id: string;
  goal: GoalKind;
  status: GoalStatus;
  params: GoalParams;
  progress: number;
  stepsCompleted: number;
  stepsTotal: number;
  budgetBp: number;
  spent: Record<string, number>;
  childTaskIds: string[];
  createdAtTick: number;
  startedAtTick?: number;
  completedAtTick?: number;
  nightHeldTicks?: number;
}

export interface ColonySuggestion {
  suggestionId: string;
  stage: number;
  goal: GoalKind;
  params?: GoalParams;
  offeredAtTick?: number;
  dismissedAtTick?: number;
}
