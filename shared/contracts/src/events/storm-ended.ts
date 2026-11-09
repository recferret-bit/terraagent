import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'stormEnded',
  wave: 'W05',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    planetId: z.string().optional(),
    kind: z.enum(['ion', 'meteor', 'dust', 'electrical']).optional(),
  }),
  summary: 'Emitted when a planetary storm hazard ends (W05-01).',
});
