import { z } from 'zod';
import { AutoTradePartnerSchema } from '../notify/auto-trade';
import { MarketPrice, OrderSide } from '../market/orders';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const DirectorOrderRequestedDataSchema = z.strictObject({
  colonyId: z.string().min(1).max(64),
  colonyIndex: z.number().int().nonnegative(),
  resource: ResourceKey,
  side: OrderSide,
  amount: z.number().int().positive(),
  price: MarketPrice,
  partner: AutoTradePartnerSchema,
  stock: z.number().nonnegative(),
  sessionSpent: z.number().nonnegative(),
  commandId: z.string().min(1).max(40).optional(),
});
export type DirectorOrderRequestedData = z.infer<typeof DirectorOrderRequestedDataSchema>;

export const event = defineEvent({
  kind: 'directorOrderRequested',
  wave: 'W15',
  severity: 'info',
  audience: 'server',
  data: DirectorOrderRequestedDataSchema,
  summary:
    'The sim accepted a director autoTrade order after withinAutoTrade (NEAR-81). The market module re-checks, signs with the director key and places.',
});
