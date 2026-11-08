import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'meteorImpact',
  wave: 'W05',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    planetId: z.string().optional(),
    colonyId: z.string().optional(),
    q: z.number().int(),
    r: z.number().int(),
    radius: z.number().int().nonnegative().optional(),
    hexCount: z.number().int().nonnegative().optional(),
    shielded: z.boolean().optional(),
    tiles: z.array(z.strictObject({ q: z.number().int(), r: z.number().int() })).optional(),
    destroyedEntityIds: z.array(z.number().int().nonnegative()).optional(),
  }),
  summary: 'Emitted when a meteor impacts a tile or is blocked by a Hazard Shield (W05-01).',
});
