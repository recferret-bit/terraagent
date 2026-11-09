import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'stormStarted',
  wave: 'W05',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    planetId: z.string().optional(),
    kind: z.enum(['ion', 'meteor', 'dust', 'electrical']).optional(),
    durationS: z.number().positive().optional(),
  }),
  summary: 'Emitted when a planetary storm hazard starts (W05-01).',
});
