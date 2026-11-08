import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'twisterStarted',
  wave: 'W05',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    planetId: z.string().optional(),
    colonyId: z.string().optional(),
    twisterId: z.number().int().nonnegative(),
    q: z.number().int(),
    r: z.number().int(),
    dirRad: z.number(),
    durationTicks: z.number().int().positive(),
  }),
  summary: 'Emitted when a twister rises and begins moving in a random direction (W05).',
});
