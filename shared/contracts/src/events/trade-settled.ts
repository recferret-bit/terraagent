import { z } from 'zod';
import { OrderSide } from '../market/orders';
import { AtomicAmount, QuoteToken } from '../market/tokens';
import { ResourceKey } from '../ws/sim';
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
    base: ResourceKey,
    amount: z.number().int().positive(),
    quote: QuoteToken,
    notional: AtomicAmount,
    platformFee: AtomicAmount,
    stallFee: AtomicAmount,
    stallFeeBp: z.number().int().min(0).max(10_000),
    makerSide: OrderSide,
    stallName: z.string().max(64).optional(),
    txHash: z.string().max(128).optional(),
  }),
  summary: 'A trade the colony took part in is FINAL: "Contract signed: X for Y at <Stall> (n % fee)" (W13-24); Merchant progress input (W13-27).',
});
