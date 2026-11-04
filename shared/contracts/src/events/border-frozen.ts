import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'borderFrozen',
  wave: 'W05',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    beaconEntityId: z.number().int().nonnegative().optional(),
    reason: z.string().optional(),
  }),
  summary: 'Emitted when territory border expansion freezes (e.g. beacon unpowered; W05-01).',
});
