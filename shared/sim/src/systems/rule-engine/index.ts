import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { parseArgs } from '../command';
import { defineSimModule } from '../define';
import { isColonyAiEnabled } from '../goals/ai';
import { checkItemUnlockStage } from '../progression/validate';
import { isRivalAiColony } from '../rival-ai/store';
import {
  findTerritoryObstacleToClear,
  findTerritoryTileToCultivate,
  hasAvailableTerraformBuilder,
} from '../terraform-basic/aiTerritory';
import { enqueueWorkAtTile } from '../terraform-basic/dismantleAndWork';
import { enqueueTerraformOrder } from '../terraform-basic/queue';
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
    if (ctx.hostRole === 'replica') return;
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
      if (ctx.hostRole === 'authority_external_bots' && (col.isBot === true || isRivalAiColony(state, col.index))) continue;
      if (!isColonyAiEnabled(state, col.index)) continue;
      if (col.lastAutopilotEvalTick === nextTick && nextTick > 0 && prevTick !== nextTick) continue;
      const stage = resolveColonyStage(state, col.index);
      const stageChanged = stage >= 1 && col.lastAutopilotEvalStage !== stage;
      if (!isPeriodicTick && !stageChanged) continue;
      applyAutopilotStep(state, col.index, ctx);
      if (!isPeriodicTick) continue;
      const tfBuilder = hasAvailableTerraformBuilder(state, col.index);
      if (!tfBuilder.ok || tfBuilder.workerId === null) continue;
      const obs = findTerritoryObstacleToClear(state, col.index, { data: ctx.data, workerId: tfBuilder.workerId });
      if (obs) {
        enqueueWorkAtTile(state, col.index, obs.q, obs.r, {
          workerId: tfBuilder.workerId,
          taskId: `auto-tf-${col.index}-${nextTick}-${obs.q},${obs.r}`,
          tick: nextTick,
          data: ctx.data,
          intent: 'terraform',
          chain: false,
        });
        continue;
      }
      if (ctx.flags.has('W05')) {
        const cult = findTerritoryTileToCultivate(state, col.index, { data: ctx.data });
        if (cult && checkItemUnlockStage(state, col.index, cult.op, ctx.flags, ctx.data).ok) {
          enqueueTerraformOrder(state, {
            colonyId: col.index,
            op: cult.op,
            tiles: [{ q: cult.q, r: cult.r }],
            taskId: `auto-cult-${col.index}-${nextTick}`,
            tick: nextTick,
            data: ctx.data,
          });
        }
      }
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
