import { z } from 'zod';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'powerSevered',
  wave: 'W03',
  severity: 'warn',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().optional(),
    playerId: z.string().optional(),
    entityId: z.number().int().optional(),
    pylonId: z.number().int().optional(),
    severedCount: z.number().int().nonnegative().optional(),
    severedEntityIds: z.array(z.number().int()).optional(),
    componentCount: z.number().int().nonnegative().optional(),
  }),
  summary: 'Emitted when destroying or demolishing a pylon/generator splits the colony power graph or disconnects buildings (W03-05).',
});
