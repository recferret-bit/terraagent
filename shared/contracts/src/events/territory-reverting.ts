import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'territoryReverting',
  wave: 'W05',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    colonyIndex: z.number().int().nonnegative().optional(),
    playerId: z.string().optional(),
    beaconEntityId: z.number().int().nonnegative().optional(),
    tiles: z.number().int().nonnegative(),
    graceSeconds: z.number().int().nonnegative().optional(),
    reverted: z.boolean().optional(),
  }),
  summary: 'Emitted when territory tiles begin reverting after beacon loss (W05-01).',
});
