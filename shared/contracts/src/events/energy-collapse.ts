import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'energyCollapse',
  wave: 'W02',
  severity: 'critical',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    deficitSeconds: z.number().optional(),
    durationS: z.number().optional(),
    supplyPerS: z.number().optional(),
    demandPerS: z.number().optional(),
    deficitPerS: z.number().optional(),
    shedGroups: z.array(z.number().int()).optional(),
  }),
  summary: 'Emitted when a colony remains in brownout for >= 30 s continuously (SIM §9, W02-06, W02-17).',
});
