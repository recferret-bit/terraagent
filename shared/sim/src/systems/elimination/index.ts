import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';
import { resolveColonyIndex } from '../diplomacy/store';
import { killColonyHq, killColonyHub } from './operations';
import { getEliminationStore, saveEliminationStore } from './store';

export * from './store';
export * from './operations';

export const devKillHqHandler = defineCommandHandler({
  kind: 'dev.killHq',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.killHq', cmd.args);
    if (!parsed) return 'invalid_args';
    let colIdx =
      parsed.colonyId !== undefined || parsed.colonyIndex !== undefined
        ? resolveColonyIndex(state, parsed.colonyIndex ?? parsed.colonyId)
        : -1;
    if (colIdx < 0) {
      const fromCmd = commandColony(cmd);
      colIdx = typeof fromCmd === 'number' ? fromCmd : 0;
    }
    if (!killColonyHq(state, colIdx, ctx)) return 'invalid_target';
  },
});

export const devKillHubHandler = defineCommandHandler({
  kind: 'dev.killHub',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('dev.killHub', cmd.args);
    if (!parsed) return 'invalid_args';
    let colIdx =
      parsed.colonyId !== undefined || parsed.colonyIndex !== undefined
        ? resolveColonyIndex(state, parsed.colonyIndex ?? parsed.colonyId)
        : -1;
    if (colIdx < 0) {
      const fromCmd = commandColony(cmd);
      colIdx = typeof fromCmd === 'number' ? fromCmd : 0;
    }
    if (!killColonyHub(state, colIdx, ctx)) return 'invalid_target';
  },
});

export const eliminationSystem = defineSystem({
  id: 'elimination.manager',
  slot: 11,
  wave: 'W18',
  run(state, ctx) {
    if (!state.blobs.elimination) {
      saveEliminationStore(state, getEliminationStore(state), ctx.tick);
    }
  },
});

export const elimination = defineSimModule({
  id: 'elimination',
  wave: 'W18',
  systems: [eliminationSystem],
  handlers: [devKillHqHandler, devKillHubHandler],
});

export default elimination;
