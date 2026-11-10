import { defineCommandHandler } from '../../kernel/commands';
import { parseArgs } from '../command';
import { authorizeMarketActor } from './command-source';
import { colonyIdOf, resolvePlayerColony } from './colony';

/**
 * Acks `market.acceptGuildOffer` and tells the market module. W15 off is `wave_disabled` before this runs.
 * The offer book is server state, so a stale id is rejected by the module (`offer_expired`), not here.
 */
export const marketAcceptGuildOfferHandler = defineCommandHandler({
  kind: 'market.acceptGuildOffer',
  wave: 'W15',
  handle(state, cmd, ctx) {
    const denied = authorizeMarketActor(cmd, false);
    if (denied) return denied;
    const args = parseArgs('market.acceptGuildOffer', cmd.args);
    if (!args) return 'invalid_args';
    const resolved = resolvePlayerColony(state, cmd, undefined);
    if ('code' in resolved) return resolved;
    const colonyId = colonyIdOf(resolved.colony, resolved.index);
    const playerId = (resolved.colony.playerId as string | undefined) ?? (cmd as { playerId?: string }).playerId;
    ctx.emit({
      kind: 'guildOfferAcceptRequested',
      severity: 'info',
      colonyIds: [colonyId],
      data: {
        offerId: args.offerId,
        colonyId,
        colonyIndex: resolved.index,
        ...(playerId ? { playerId } : {}),
        ...(typeof cmd.commandId === 'string' && cmd.commandId ? { commandId: cmd.commandId } : {}),
      },
    });
    return undefined;
  },
});
