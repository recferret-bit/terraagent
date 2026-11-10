import { z } from 'zod';
import { MarketPrice, OrderSide } from '../market/orders';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const MarketPlaceOrderArgs = z
  .strictObject({
    colonyId: z.string().min(1).optional(),
    side: OrderSide,
    /** Base resource of the pair (`bio.water`). */
    resource: ResourceKey,
    /** Whole base units (lot 1); the pair's lot / minimum notional come from the market policy (W13-03). */
    amount: z.number().int().positive().max(1_000_000_000),
    /** Total quote for the full `amount` (see `MarketPrice`); `price.token` is the pair's quote. */
    price: MarketPrice,
    /** One of the policy's TTL options (15 min / 1 h / 6 h / 24 h by default). */
    ttlS: z.number().int().positive().max(7 * 86_400),
    /** Trade Hub entity the order is placed at; default: the colony's online Trade Hub. */
    stallId: z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).optional(),
    /** Buyer's explicit maximum maker-stall fee (bp); default: the policy's stall maximum. Reserved in full (ECONOMY §3). */
    maxStallFeeBp: z.number().int().min(0).max(10_000).optional(),
    /**
     * Director autoTrade order (W15-20). The market module calls `withinAutoTrade` again before matching.
     * Player and bot orders omit it and are not subject to autoTrade limits.
     */
    director: z.boolean().optional(),
  })
  .refine((a) => (a.resource as string) !== a.price.token, { message: 'base and quote must differ', path: ['price', 'token'] });
export type MarketPlaceOrderArgs = z.infer<typeof MarketPlaceOrderArgs>;

export const command = defineCommand({
  kind: 'market.placeOrder',
  wave: 'W13',
  origin: 'client',
  args: MarketPlaceOrderArgs,
  summary:
    'Places a limit order on the planet book `resource/price.token` at the colony\'s online Trade Hub (NEAR-60, NEAR-63). The sim checks the Hub, size, TTL and fee range and emits `marketOrderRequested`; the market module reserves funds and matches (W13-09).',
});
