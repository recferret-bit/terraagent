import { z } from 'zod';
import { AtomicAmount, QuoteToken } from '../market/tokens';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'feeEarned',
  wave: 'W13',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    tradeId: z.string().min(1).max(160),
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative().optional(),
    token: QuoteToken,
    amount: AtomicAmount,
    bp: z.number().int().min(0).max(10_000),
  }),
  summary: 'The colony\'s Trade Hub earned a stall fee on a FINAL trade (realized, in the quote token); Port Authority progress input (W13-22, W13-27).',
});
