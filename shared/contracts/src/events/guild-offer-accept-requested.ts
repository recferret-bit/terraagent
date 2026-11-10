import { z } from 'zod';
import { defineEvent } from './define';

/**
 * The sim accepted `market.acceptGuildOffer`. Settlement stays in the market module (W15-11):
 * the book and the NPC quote are server state, so the handler does not change the planet.
 */
export const event = defineEvent({
  kind: 'guildOfferAcceptRequested',
  wave: 'W15',
  severity: 'info',
  audience: 'server',
  data: z.strictObject({
    offerId: z.string().min(1).max(160),
    colonyId: z.string().min(1).max(64),
    colonyIndex: z.number().int().nonnegative(),
    playerId: z.string().min(1).max(64).optional(),
    commandId: z.string().min(1).max(40).optional(),
  }),
  summary:
    'The sim accepted market.acceptGuildOffer. The market module crosses that id against the NPC quote (W15-11). Server-only.',
});
