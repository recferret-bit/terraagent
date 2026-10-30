import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'obstacleRemoved',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    op: z.enum(['clear', 'break']),
    count: z.number().int().positive(),
    q: z.number().int().optional(),
    r: z.number().int().optional(),
  }),
  summary: 'Emitted when a Forest or Rock obstacle is removed via Clear or Break (Stone Mason progression, W01-13, W01-31).',
});
