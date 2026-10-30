import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'buildingCompleted',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    entityId: z.number().int(),
    building: z.string(),
    tier: z.number().int(),
    q: z.number().int(),
    r: z.number().int(),
  }),
  summary: 'Emitted when construction of a structure reaches 100 % completion (W01-16).',
});
