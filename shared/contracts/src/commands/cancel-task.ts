import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'cancelTask',
  wave: 'W01',
  origin: 'client',
  args: z.strictObject({
    taskId: z.string().min(1).max(64),
  }),
  summary: 'Cancels a queued or in-progress order (refunds 75 % if in progress and cancels linked prep, UO-Q-02 / UO-TF-03).',
});
