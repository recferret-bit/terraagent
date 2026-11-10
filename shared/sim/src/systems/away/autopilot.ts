import { commandColony, parseArgs } from '../command';
import { defineCommandHandler } from '../../kernel/commands';
import { mirrorAutopilotOnDirector } from '../director/store';
import { applyAutopilot } from './store';

export const setAutopilotHandler = defineCommandHandler({
  kind: 'setAutopilot',
  wave: 'W09',
  handle(state, cmd, ctx) {
    const colonyIndex = commandColony(cmd);
    if (typeof colonyIndex === 'string') return colonyIndex;
    const patch = parseArgs('setAutopilot', cmd.args);
    if (!patch) return 'invalid_args';
    applyAutopilot(state, colonyIndex, patch, ctx.data, ctx.tick);
    mirrorAutopilotOnDirector(state, colonyIndex, patch, ctx.tick);
  },
});
