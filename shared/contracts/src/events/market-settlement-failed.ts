import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'marketSettlementFailed',
  wave: 'W13',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative().optional(),
    ref: z.string().min(1).max(160),
  }),
  summary: 'A trade the colony\'s order was part of definitely failed on settlement and the order ended with its reservation released; nothing changed hands: "Contract failed" toast (W13-24).',
});
