import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'resourceProduced',
  wave: 'W02',
  severity: 'info',
  audience: 'server',
  data: z.strictObject({
    colonyId: z.string(),
    playerId: z.string().optional(),
    res: ResourceKey,
    amount: z.number().nonnegative(),
  }),
  summary: 'Aggregated per-60 s resource production batch emitted onto the event bus for Stockpile progression (W02-28).',
});
