import { z } from 'zod';
import { defineCommand } from './define';
import { GoalKindSchema, GoalParamsSchema } from './queue-goal';

export const DevGoalArgsSchema = z.strictObject({
  op: z.enum(['add', 'cancel', 'clear']).optional(),
  goal: GoalKindSchema.optional(),
  goalId: z.string().min(1).max(64).optional(),
  params: GoalParamsSchema.optional(),
  budgetBp: z.number().int().min(0).max(10_000).optional(),
  resource: z.string().min(1).max(32).optional(),
  targetRatePerMin: z.number().positive().max(100_000).optional(),
  targetNetEnergyPerS: z.number().min(-10_000).max(100_000).optional(),
  target: z.number().min(-10_000).max(100_000).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
});

export type DevGoalArgs = z.infer<typeof DevGoalArgsSchema>;

export const command = defineCommand({
  kind: 'dev.goal',
  wave: 'W08',
  origin: 'client',
  dev: true,
  args: DevGoalArgsSchema,
  summary: 'Dev command to add, cancel, or clear HQ goals (`goal add <type>`).',
});
