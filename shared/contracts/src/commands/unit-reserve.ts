import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'unitReserve',
  wave: 'W13',
  origin: 'client',
  args: z.strictObject({
    entityIds: z.array(z.number().int().positive()).min(1).max(64),
    reserve: z.boolean(),
  }),
  summary: 'Puts owned units in reserve (stops attack and production, keeps control slots) or deploys them again (activation recipe and delay apply).',
});
