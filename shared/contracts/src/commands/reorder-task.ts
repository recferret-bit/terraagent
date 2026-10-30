import { z } from 'zod';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'reorderTask',
  wave: 'W02',
  origin: 'client',
  args: z.strictObject({
    taskId: z.string().min(1).max(64),
    toIndex: z.number().int().nonnegative(),
    lane: z.enum(['construction', 'units', 'terraform']).optional(),
  }),
  summary: 'Reorders a player-queued entry within its lane (UO-P §4.4, W02-13).',
});
