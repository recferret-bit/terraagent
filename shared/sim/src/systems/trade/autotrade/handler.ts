import type { AutoTradeLimits } from '@terra/contracts';
import { defineCommandHandler } from '../../../kernel/commands';
import { commandColony, parseArgs } from '../../command';
import { writeAutoTradeLimits } from './store';

function usesTruce(limits: AutoTradeLimits): boolean {
  return Object.values(limits).some((row) => row?.partners === 'truce');
}

/** Stores the player's limits. W15 off is `wave_disabled` before this runs. Truce rows are refused whole, not dropped. */
export const setAutoTradeHandler = defineCommandHandler({
  kind: 'setAutoTrade',
  wave: 'W15',
  handle(state, cmd, ctx) {
    const colonyIndex = commandColony(cmd);
    if (typeof colonyIndex === 'string') return colonyIndex;
    const args = parseArgs('setAutoTrade', cmd.args);
    if (!args) return 'invalid_args';
    if (!ctx.flags.has('W18') && usesTruce(args.limits)) {
      return { code: 'invalid_args', detail: 'truce partners are unavailable' };
    }
    writeAutoTradeLimits(state, colonyIndex, args.limits, ctx.tick);
  },
});
