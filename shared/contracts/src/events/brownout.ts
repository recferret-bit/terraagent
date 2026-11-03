import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'brownout',
  wave: 'W02',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    group: z.number().int().min(1).max(4),
    shedCount: z.number().int().nonnegative().optional(),
    shedEntityIds: z.array(z.number().int()).optional(),
    deficitPerS: z.number().optional(),
  }),
  summary: 'Emitted (debounced) when a colony power deficit causes brownout load shedding in `group` (W02-06, W02-17).',
});
