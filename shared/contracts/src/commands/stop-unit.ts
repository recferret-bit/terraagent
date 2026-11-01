import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'stopUnit',
  wave: 'W01',
  origin: 'client',
  args: z.strictObject({
    entityId: z.number().int().positive(),
  }),
  summary: 'Stops an owned unit: drops its current and queued commands and its route; queued auto work resumes after a short hold.',
});
