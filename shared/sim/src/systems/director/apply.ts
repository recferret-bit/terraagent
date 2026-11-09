import type { DirectiveAction } from '@terra/contracts';
import type { PlanetState } from '../../kernel/state';
import { cancelColonyGoal, queueColonyGoal } from '../goals';
import { getOpenColonyGoals } from '../goals/store';
import { previewBatch, type PreviewLimits, type PreviewStock } from './preview';

export interface ActionAck {
  readonly actionId: string;
  readonly state: 'applied' | 'rejected';
  readonly reason?: string;
}

function protectManualGoals(state: PlanetState, colonyIndex: number, limits: PreviewLimits): PreviewLimits {
  const manual = getOpenColonyGoals(state, colonyIndex).map((goal) => goal.id);
  const ids = [...new Set([...(limits.protectedGoalIds ?? []), ...manual])];
  return { ...limits, protectedGoalIds: ids };
}

function applyOne(state: PlanetState, colonyIndex: number, action: DirectiveAction, tick: number): ActionAck {
  if (action.kind === 'setPriorities') return { actionId: action.actionId, state: 'rejected', reason: 'player_baseline' };
  if (action.kind === 'queueGoal') {
    const queued = queueColonyGoal(state, colonyIndex, action.args, tick);
    return queued.ok
      ? { actionId: action.actionId, state: 'applied' }
      : { actionId: action.actionId, state: 'rejected', reason: queued.code };
  }
  if (action.kind === 'cancelGoal') {
    const cancelled = cancelColonyGoal(state, colonyIndex, action.args.goalId, tick);
    return cancelled.ok
      ? { actionId: action.actionId, state: 'applied' }
      : { actionId: action.actionId, state: 'rejected', reason: cancelled.code };
  }
  return { actionId: action.actionId, state: 'rejected', reason: 'unsupported' };
}

/**
 * Applies a reviewed batch through the ordinary goal handlers (AI §6).
 * Open goals are protected, so a director cancel cannot drop manual work.
 * `setPriorities` is refused: the player's sliders stay the baseline.
 */
export function applyDirectiveBatch(
  state: PlanetState,
  colonyIndex: number,
  actions: readonly DirectiveAction[],
  stocks: readonly PreviewStock[],
  limits: PreviewLimits,
  tick: number = state.meta.tick,
): ActionAck[] {
  const preview = previewBatch(actions, stocks, protectManualGoals(state, colonyIndex, limits));
  const rejected = new Map(preview.rejected.map((row) => [row.actionId, row.reason]));
  return actions.map((action) => {
    const reason = rejected.get(action.actionId);
    if (reason) return { actionId: action.actionId, state: 'rejected' as const, reason };
    return applyOne(state, colonyIndex, action, tick);
  });
}
