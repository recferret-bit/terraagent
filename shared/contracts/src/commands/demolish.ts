import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'demolish',
  wave: 'W02',
  origin: 'client',
  args: z.strictObject({
    entityId: z.number().int().positive(),
  }),
  summary: 'Demolishes an owned finished structure and refunds 50 % of its cost while keeping tiles Prepared (UO-Q-02, W02-09).',
});
