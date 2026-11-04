import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'brownoutShed',
  wave: 'W03',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    playerId: z.string().optional(),
    componentId: z.number().int().nonnegative().optional(),
    groups: z.array(z.number().int()).optional(),
    shedEntityIds: z.array(z.number().int()),
    deficitPerS: z.number().optional(),
  }),
  summary: 'Emitted when per-component brownout shedding updates the list of shed entities on a grid component (W03-07, W03-15).',
});
