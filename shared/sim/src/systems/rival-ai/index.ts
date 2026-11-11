import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { parseArgs } from '../command';
import { defineSimModule } from '../define';
import { runPlanetGovernorTick } from './governor';
import { seedRivalAiColonies } from './seed';

export * from './store';
export * from './seed';
export * from './governor';
export { colonyIsAway, resolveColonyAwayRaids } from '../away/gate';

export const rivalAiSystem = defineSystem({
  id: 'rivalAi.governor',
  slot: 4,
  wave: 'W18',
  run(state, ctx) {
    runPlanetGovernorTick(state, ctx);
  },
});

export const seedRivalAiHandler = defineCommandHandler({
  kind: 'system.seedRivalAi',
  wave: 'W18',
  handle(state, cmd, ctx) {
    const parsed = parseArgs('system.seedRivalAi', cmd.args ?? {});
    if (!parsed) return 'invalid_args';
    seedRivalAiColonies(state, {
      count: parsed.count,
      capacity: parsed.capacity,
      tick: ctx.tick,
      data: ctx.data,
      ctx,
    });
  },
});

export default defineSimModule({
  id: 'rival-ai',
  wave: 'W18',
  systems: [rivalAiSystem],
  handlers: [seedRivalAiHandler],
});
