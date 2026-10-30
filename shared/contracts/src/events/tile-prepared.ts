import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'tilePrepared',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    count: z.number().int().positive(),
    q: z.number().int().optional(),
    r: z.number().int().optional(),
  }),
  summary: 'Emitted when one or more tiles reach the Prepared state via Grade (Groundbreaker progression, W01-13, W01-31).',
});
