import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { parseArgs } from '../command';
import { defineSimModule } from '../define';

export const devKillHqHandler = defineCommandHandler({
  kind: 'dev.killHq',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const parsed = parseArgs('dev.killHq', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const devKillHubHandler = defineCommandHandler({
  kind: 'dev.killHub',
  wave: 'W18',
  handle(_state, cmd, _ctx) {
    const parsed = parseArgs('dev.killHub', cmd.args);
    if (!parsed) return 'invalid_args';
  },
});

export const eliminationSystem = defineSystem({
  id: 'elimination.manager',
  slot: 11,
  wave: 'W18',
  run() {},
});

export const elimination = defineSimModule({
  id: 'elimination',
  wave: 'W18',
  systems: [eliminationSystem],
  handlers: [devKillHqHandler, devKillHubHandler],
});

export default elimination;
