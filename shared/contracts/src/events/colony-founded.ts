import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'colonyFounded',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    hubId: z.number().int().optional(),
    q: z.number().int().optional(),
    r: z.number().int().optional(),
  }),
  summary: 'Emitted when a colony completes its Command Hub T1 and claims its initial territory (W01-17, W01-31).',
});
