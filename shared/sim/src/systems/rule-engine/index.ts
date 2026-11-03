import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { parseArgs } from '../command';
import { defineSimModule } from '../define';
import {
  applyAutopilotStep,
  resolveColonyStage,
  RULE_ENGINE_STEP_TICKS,
} from './automate';

export * from './automate';
export * from './needs';
export * from './site';
export * from './weight';

export const devAutopilotHandler = defineCommandHandler({
  kind: 'dev.autopilot',
  wave: 'W08',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.autopilot', cmd.args ?? {});
    if (!parsed) return 'invalid_args';
    const colIdx =
      parsed.colonyIndex ??
      (typeof cmd.colonyIndex === 'number' && cmd.colonyIndex >= 0 ? cmd.colonyIndex : 0);
    applyAutopilotStep(state, colIdx, ctx);
  },
});

export const ruleEngineSystem = defineSystem({
  id: 'rule-engine.autopilot',
  slot: 14,
  wave: 'W08',
  run(state, ctx) {
    const prevTick = state.meta.tick;
    const nextTick = ctx.tick;
    const isPeriodicTick =
      nextTick <= 0 ||
      nextTick % RULE_ENGINE_STEP_TICKS === 0 ||
      (prevTick < nextTick &&
        Math.floor(nextTick / RULE_ENGINE_STEP_TICKS) > Math.floor(prevTick / RULE_ENGINE_STEP_TICKS)) ||
      prevTick === nextTick;

    for (const col of state.colonies) {
      if (!col || col.status === 'eliminated' || col.status === 'settled') continue;
      if (col.lastAutopilotEvalTick === nextTick && nextTick > 0 && prevTick !== nextTick) continue;
      const stage = resolveColonyStage(state, col.index);
      const stageChanged = stage >= 1 && col.lastAutopilotEvalStage !== stage;
      if (!isPeriodicTick && !stageChanged) continue;
      applyAutopilotStep(state, col.index, ctx);
    }
  },
});

export const ruleEngine = defineSimModule({
  id: 'rule-engine',
  wave: 'W08',
  systems: [ruleEngineSystem],
  handlers: [devAutopilotHandler],
});

export default ruleEngine;
