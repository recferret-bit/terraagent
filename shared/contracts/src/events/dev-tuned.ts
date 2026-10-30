import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'dev.tuned',
  wave: 'W00',
  severity: 'info',
  audience: 'server',
  data: z.strictObject({
    op: z.enum(['set', 'reset']),
    path: z.string().max(200).optional(),
    value: z.unknown().optional(),
    dataHash: z.string(),
  }),
  summary: 'A balance override was tuned live (dev console `tune`); dataHash is the planet data hash after the change (D-35).',
});
