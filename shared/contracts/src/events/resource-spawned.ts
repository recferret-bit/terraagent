import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'resourceSpawned',
  wave: 'W02',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    q: z.number().int(),
    r: z.number().int(),
    deposit: z.enum(['metals', 'minerals', 'oil']),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    richnessBp: z.number().int().nonnegative(),
  }),
  summary:
    'Emitted when a completed terraform `work` job spawns a new resource deposit on its hex (1 % roll, `TERRAFORM_RESOURCE_SPAWN`; tier in the `depositTier` tile layer).',
});
