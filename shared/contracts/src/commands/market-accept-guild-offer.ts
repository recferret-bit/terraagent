import { z } from 'zod';
import { defineCommand } from './define';

export const MarketAcceptGuildOfferArgs = z.strictObject({
  offerId: z.string().min(1).max(160),
});
export type MarketAcceptGuildOfferArgs = z.infer<typeof MarketAcceptGuildOfferArgs>;

export const command = defineCommand({
  kind: 'market.acceptGuildOffer',
  wave: 'W15',
  origin: 'client',
  args: MarketAcceptGuildOfferArgs,
  summary:
    'Crosses a docked Guild offer immediately through the W13 settlement path (NEAR-70, PROTOCOL market.acceptGuildOffer). A stale offerId is offer_expired.',
});
