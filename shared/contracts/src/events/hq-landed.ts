import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'hqLanded',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    entityId: z.number().int(),
    podEntityId: z.number().int().optional(),
    q: z.number().int(),
    r: z.number().int(),
  }),
  summary: 'Emitted when the drop pod finishes its descent and deploys the HQ Commander drone (W01-09).',
});
