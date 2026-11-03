import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'cargoRefunded',
  wave: 'W10',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative().optional(),
    playerId: z.string().optional(),
    ref: z.string().min(1).max(160),
    direction: z.enum(['export', 'import']).optional(),
    resource: ResourceKey,
    amount: z.number().int().positive(),
    reason: z.string().optional(),
  }),
  summary: 'A failed orbital cargo export was refunded to colony stock (even above cap) or a failed import reservation was released (W10-01, W10-07).',
});
