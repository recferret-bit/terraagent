import { z } from 'zod';
import { defineCommand } from './define';

const ReorderGoalByIndexSchema = z.strictObject({
  goalId: z.string().min(1).max(64),
  toIndex: z.number().int().nonnegative(),
  direction: z.enum(['up', 'down', 'top', 'bottom']).optional(),
});

const ReorderGoalByDirectionSchema = z.strictObject({
  goalId: z.string().min(1).max(64),
  direction: z.enum(['up', 'down', 'top', 'bottom']),
});

export const ReorderGoalArgsSchema = z.union([ReorderGoalByIndexSchema, ReorderGoalByDirectionSchema]);

export type ReorderGoalArgs = z.infer<typeof ReorderGoalArgsSchema>;

export const command = defineCommand({
  kind: 'reorderGoal',
  wave: 'W08',
  origin: 'client',
  args: ReorderGoalArgsSchema,
  summary: 'Reorders a queued HQ goal within the colony goal queue (UO-P §4.6).',
});
