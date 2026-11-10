import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { commandColony, parseArgs } from '../command';
import { defineSimModule } from '../define';
import { resolveColonyIndex } from '../diplomacy/store';
import { clearColonyCriticalOnHubRebuilt } from './critical';
import { killColonyHq, killColonyHub } from './operations';
import { colonyHasAliveHub, getEliminationStore, saveEliminationStore } from './store';

export * from './store';
export * from './operations';
export * from './critical';

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
    const store = getEliminationStore(state);
    if (!state.blobs.elimination) {
      saveEliminationStore(state, store, ctx.tick);
    }
    for (const rec of Object.values(store.byColony)) {
      if (rec.criticalDeadlineTick !== undefined && colonyHasAliveHub(state, rec.colonyIndex)) {
        clearColonyCriticalOnHubRebuilt(state, rec.colonyIndex, ctx.tick, ctx);
      }
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
