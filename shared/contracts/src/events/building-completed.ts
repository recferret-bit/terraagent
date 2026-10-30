import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'buildingCompleted',
  wave: 'W01',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    playerId: z.string().optional(),
    entityId: z.number().int(),
    building: z.string(),
    kind: z.string().optional(),
    tier: z.number().int().optional(),
    q: z.number().int(),
    r: z.number().int(),
  }),
  summary: 'Emitted when construction of a structure reaches 100 % completion (W01-16, W02-17, W02-28).',
});
