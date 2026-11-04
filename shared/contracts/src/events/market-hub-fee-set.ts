import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'marketHubFeeSet',
  wave: 'W13',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative(),
    hubEntityId: z.number().int().nonnegative(),
    bp: z.number().int().min(0).max(10_000),
    previousBp: z.number().int().min(0).max(10_000).optional(),
  }),
  summary: 'The colony\'s Trade Hub stall fee changed (applies to new orders only); the market module records it for new maker orders (W13-22).',
});
