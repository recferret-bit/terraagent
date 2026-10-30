import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'energyCollapse',
  wave: 'W02',
  severity: 'critical',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    deficitSeconds: z.number(),
    supplyPerS: z.number(),
    demandPerS: z.number(),
  }),
  summary: 'Emitted when a colony remains in brownout for >= 30 s continuously (SIM §9, W02-06, W02-17).',
});
