import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import type { StepContext } from '../../kernel/context';
import type { PlanetState } from '../../kernel/state';
import { parseArgs } from '../command';
import { presenceAway, writePresence } from './blob';
import { resolvePresenceIndex } from './resolve';

/** Module sources only. Clients are already refused (`origin: 'module'`); this is the sim-side gate. */
const MODULE_SOURCES: ReadonlySet<string> = new Set(['system', 'near', 'admin', 'dev']);

export const presenceHandler = defineCommandHandler({
  kind: 'system.presence',
  wave: 'W09',
  handle(state, cmd, ctx) {
    return applyPresence(state, cmd, ctx);
  },
});

function applyPresence(state: PlanetState, cmd: SimCommand, ctx: StepContext): string | void {
  const args = parseArgs('system.presence', cmd.args);
  if (!args) return 'invalid_args';
  if (!MODULE_SOURCES.has(cmd.source)) return 'not_authorized';
  const index = resolvePresenceIndex(state, cmd, args.colonyId);
  if (index === 'not_own_colony') return index;
  if (presenceAway(state, index) === args.away) return;
  writePresence(state, index, args.away, ctx.tick);
  ctx.emit({
    kind: args.away ? 'colonyAway' : 'colonyBack',
    colonyIds: [args.colonyId],
    data: { colonyId: args.colonyId, colonyIndex: index, atTick: ctx.tick },
  });
}
