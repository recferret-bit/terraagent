import { z } from 'zod';
import { ResourceFamily, ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'resourceShortage',
  wave: 'W02',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    resource: ResourceKey.optional(),
    family: ResourceFamily,
    stock: z.number(),
    cap: z.number(),
    netPerS: z.number(),
  }),
  summary: 'Emitted when a resource drops below 5 % of its family cap with negative net flow over 60 s (SIM §9, W02-17).',
});
