import { z } from 'zod';
import { SettledTradeFields } from '../market/orders';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'tradeSettled',
  wave: 'W13',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    tradeId: z.string().min(1).max(160),
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative().optional(),
    role: z.enum(['buyer', 'seller']),
    ref: z.string().min(1).max(160).optional(),
    ...SettledTradeFields,
  }),
  summary: 'A trade the colony took part in is FINAL: "Contract signed: X for Y at <Stall> (n % fee)" (W13-24); Merchant progress input (W13-27).',
});
