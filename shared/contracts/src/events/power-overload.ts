import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'powerOverload',
  wave: 'W03',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    playerId: z.string().optional(),
    pylonId: z.number().int(),
    flowPerS: z.number().nonnegative(),
    maxLoadPerS: z.number().positive(),
    shedEntityIds: z.array(z.number().int()).optional(),
  }),
  summary: 'Emitted (debounced 600 ticks per pylon) when a pylon or Hub subtree demand exceeds its max load and sheds downstream consumers (W03-06).',
});
