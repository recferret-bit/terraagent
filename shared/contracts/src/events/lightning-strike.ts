import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'lightningStrike',
  wave: 'W05',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    planetId: z.string().optional(),
    colonyId: z.string().optional(),
    q: z.number().int(),
    r: z.number().int(),
    absorbed: z.boolean().optional(),
    entityId: z.number().int().nonnegative().optional(),
    damage: z.number().nonnegative().optional(),
  }),
  summary: 'Emitted when a lightning bolt strikes a tile or is absorbed by a Lightning Rod (W05-01).',
});
