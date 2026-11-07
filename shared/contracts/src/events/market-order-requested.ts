import { z } from 'zod';
import { ActorKind, MarketPrice, OrderSide } from '../market/orders';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'marketOrderRequested',
  wave: 'W13',
  severity: 'info',
  audience: 'server',
  data: z.strictObject({
    ref: z.string().min(1).max(160),
    orderSeq: z.number().int().positive(),
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative(),
    playerId: z.string().optional(),
    side: OrderSide,
    resource: ResourceKey,
    amount: z.number().int().positive(),
    price: MarketPrice,
    ttlS: z.number().int().positive(),
    /** The placing colony's own stall fee at this tick (it is the maker's stall if this order rests). */
    stallFeeBp: z.number().int().min(0).max(10_000),
    maxStallFeeBp: z.number().int().min(0).max(10_000).optional(),
    hubEntityId: z.number().int().nonnegative(),
    stallName: z.string().max(64).optional(),
    /** Who the command came from: the sim sets `bot` for `source: 'bot'` commands (API keys); absent = a player. */
    actorKind: ActorKind.optional(),
  }),
  summary: 'The sim accepted `market.placeOrder` (Hub online, size, TTL, fee range); the market module creates the order, reserves funds and matches (W13-09). Server-only input.',
});
