import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'marketCancelRequested',
  wave: 'W13',
  severity: 'info',
  audience: 'server',
  data: z.strictObject({
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative(),
    playerId: z.string().optional(),
    orderId: z.string().min(1).max(160),
  }),
  summary: 'The sim accepted `market.cancelOrder`; the market module cancels the order (owner only) and releases its reservations once (W13-15). Server-only input.',
});
