import type { DirectiveAction } from '@terra/contracts';

export interface PreviewStock {
  readonly id: string;
  readonly unearmarked: number;
}

/** Basis points from the director data row for the selected risk. Risky does not raise these past the row. */
export interface PreviewLimits {
  readonly reserveFloorBp: number;
  readonly commitBp: number;
  readonly openGoalSlots: number;
  readonly awayRaids: boolean;
  readonly protectedGoalIds?: readonly string[];
}

export type PreviewReason = 'commit_cap' | 'reserve' | 'goal_slot' | 'away_raids' | 'locked_goal';

export interface PreviewRejection {
  readonly actionId: string;
  readonly reason: PreviewReason;
}

export interface BatchPreview {
  readonly accepted: DirectiveAction[];
  readonly rejected: PreviewRejection[];
  readonly remainingSlots: number;
}

interface SpendState {
  committed: Map<string, number>;
  slots: number;
}

function resourceOf(action: DirectiveAction): string {
  if (action.kind !== 'queueGoal') return 'metals.t1';
  return action.args.params?.resource ?? action.args.resource ?? 'metals.t1';
}

function budgetBpOf(action: DirectiveAction): number {
  if (action.kind !== 'queueGoal') return 0;
  return action.args.budgetBp ?? 0;
}

function units(amount: number, bp: number): number {
  return Math.floor((amount * bp) / 10_000);
}

function stockOf(stocks: readonly PreviewStock[], id: string): number {
  return stocks.find((row) => row.id === id)?.unearmarked ?? 0;
}

function spendReason(action: DirectiveAction, stocks: readonly PreviewStock[], limits: PreviewLimits, spend: SpendState): PreviewReason | null {
  const bp = budgetBpOf(action);
  if (bp <= 0) return null;
  const id = resourceOf(action);
  const free = stockOf(stocks, id);
  const already = spend.committed.get(id) ?? 0;
  const next = already + units(free, bp);
  if (next > units(free, limits.commitBp)) return 'commit_cap';
  const keep = units(free, limits.reserveFloorBp);
  if (free - next < keep) return 'reserve';
  return null;
}

function rejectOf(action: DirectiveAction, stocks: readonly PreviewStock[], limits: PreviewLimits, spend: SpendState): PreviewReason | null {
  if (action.kind === 'cancelGoal' && limits.protectedGoalIds?.includes(action.args.goalId)) return 'locked_goal';
  if (action.kind === 'queueGoal' && action.args.goal === 'raid_target' && !limits.awayRaids) return 'away_raids';
  if (action.kind === 'queueGoal' && spend.slots <= 0) return 'goal_slot';
  return spendReason(action, stocks, limits, spend);
}

function commit(action: DirectiveAction, stocks: readonly PreviewStock[], spend: SpendState): void {
  if (action.kind === 'queueGoal') spend.slots -= 1;
  const bp = budgetBpOf(action);
  if (bp <= 0) return;
  const id = resourceOf(action);
  const already = spend.committed.get(id) ?? 0;
  spend.committed.set(id, already + units(stockOf(stocks, id), bp));
}

/** Cumulative preview (AI §4, §6). Each later action sees stock and goal slots the earlier ones already took. */
export function previewBatch(actions: readonly DirectiveAction[], stocks: readonly PreviewStock[], limits: PreviewLimits): BatchPreview {
  const spend: SpendState = { committed: new Map(), slots: limits.openGoalSlots };
  const accepted: DirectiveAction[] = [];
  const rejected: PreviewRejection[] = [];
  for (const action of actions) {
    const reason = rejectOf(action, stocks, limits, spend);
    if (reason) rejected.push({ actionId: action.actionId, reason });
    else {
      accepted.push(action);
      commit(action, stocks, spend);
    }
  }
  return { accepted, rejected, remainingSlots: spend.slots };
}
