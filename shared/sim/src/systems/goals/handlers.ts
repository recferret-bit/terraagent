import { defineCommandHandler } from '../../kernel/commands';
import { checkAiRaidAwayPolicy } from '../away/gate';
import { commandColony, parseArgs } from '../command';
import {
  acceptColonySuggestion,
  cancelColonyGoal,
  clearColonyGoals,
  getOpenColonyGoals,
  queueColonyGoal,
  reorderColonyGoal,
} from './index';

export const queueGoalHandler = defineCommandHandler({
  kind: 'queueGoal',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const awayGate = checkAiRaidAwayPolicy(state, colIdx, cmd, ctx);
    if (awayGate) return awayGate;
    const parsed = parseArgs('queueGoal', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = queueColonyGoal(state, colIdx, parsed, ctx.tick, ctx);
    return res.ok ? undefined : res.code;
  },
});

export const cancelGoalHandler = defineCommandHandler({
  kind: 'cancelGoal',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('cancelGoal', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = cancelColonyGoal(state, colIdx, parsed.goalId, ctx.tick, ctx.data, ctx);
    return res.ok ? undefined : res.code;
  },
});

export const reorderGoalHandler = defineCommandHandler({
  kind: 'reorderGoal',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('reorderGoal', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = reorderColonyGoal(state, colIdx, parsed.goalId, {
      toIndex: 'toIndex' in parsed ? parsed.toIndex : undefined,
      direction: parsed.direction,
      tick: ctx.tick,
    });
    return res.ok ? undefined : res.code;
  },
});

export const acceptSuggestionHandler = defineCommandHandler({
  kind: 'acceptSuggestion',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const colIdx = commandColony(cmd);
    if (typeof colIdx === 'string') return colIdx;
    const parsed = parseArgs('acceptSuggestion', cmd.args);
    if (!parsed) return 'invalid_args';
    const res = acceptColonySuggestion(state, colIdx, parsed, ctx.tick, ctx);
    return res.ok ? undefined : res.code;
  },
});

export const devGoalHandler = defineCommandHandler({
  kind: 'dev.goal',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.goal', cmd.args);
    if (!parsed) return 'invalid_args';
    const colIdx =
      parsed.colonyIndex ?? (typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0 ? cmd.colonyIndex : 0);
    const op = parsed.op ?? (parsed.goalId ? 'cancel' : 'add');
    if (op === 'clear') {
      clearColonyGoals(state, colIdx, ctx.tick, ctx.data);
      return;
    }
    if (op === 'cancel') {
      const targetId = parsed.goalId ?? getOpenColonyGoals(state, colIdx)[0]?.id;
      if (!targetId) return 'unknown_goal';
      const res = cancelColonyGoal(state, colIdx, targetId, ctx.tick, ctx.data, ctx);
      return res.ok ? undefined : res.code;
    }
    const goal = parsed.goal ?? 'establish_colony';
    const res = queueColonyGoal(
      state,
      colIdx,
      {
        goal,
        params: parsed.params,
        budgetBp: parsed.budgetBp,
        resource: parsed.resource,
        targetRatePerMin: parsed.targetRatePerMin,
        targetNetEnergyPerS: parsed.targetNetEnergyPerS,
        target: parsed.target,
      },
      ctx.tick,
      ctx,
    );
    return res.ok ? undefined : res.code;
  },
});
