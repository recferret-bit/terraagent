import { z } from 'zod';
import { defineCommand } from './define';

export const MarketCancelOrderArgs = z.strictObject({
  colonyId: z.string().min(1).optional(),
  /** Server order id or the sim order ref (`market-order:{colonyId}:{seq}`). */
  orderId: z.string().min(1).max(160),
});
export type MarketCancelOrderArgs = z.infer<typeof MarketCancelOrderArgs>;

export const command = defineCommand({
  kind: 'market.cancelOrder',
  wave: 'W13',
  origin: 'client',
  args: MarketCancelOrderArgs,
  summary: 'Cancels one of the colony\'s open orders (owner only); its principal and fee reservations are released exactly once (W13-15).',
});
