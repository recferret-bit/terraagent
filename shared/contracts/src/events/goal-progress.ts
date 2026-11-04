import { z } from 'zod';
import { defineEvent } from './define';
import { GoalKindSchema } from '../commands/queue-goal';

export const GoalProgressDataSchema = z.strictObject({
  colonyIndex: z.number().int().nonnegative(),
  goalId: z.string().min(1).max(64),
  goal: GoalKindSchema,
  status: z.enum(['queued', 'active', 'done', 'cancelled']),
  progress: z.number().min(0).max(1),
  stepsCompleted: z.number().int().nonnegative().optional(),
  stepsTotal: z.number().int().positive().optional(),
  detail: z.string().max(120).optional(),
});

export type GoalProgressData = z.infer<typeof GoalProgressDataSchema>;

export const event = defineEvent({
  kind: 'goalProgress',
  wave: 'W08',
  audience: 'player',
  severity: 'info',
  data: GoalProgressDataSchema,
  summary: 'Emitted when an active HQ goal advances its completion progress (UO-P §4.6).',
});
