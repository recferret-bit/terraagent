import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'unitProduced',
  wave: 'W02',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    playerId: z.string().optional(),
    entityId: z.number().int(),
    unit: z.string(),
    producerId: z.number().int().optional(),
    q: z.number().int(),
    r: z.number().int(),
  }),
  summary: 'Emitted when a worker or combat unit completes production and spawns at its producer edge (W02-10, W02-17).',
});
