import { z } from 'zod';
import { defineCommand } from './define';

export const CancelGoalArgsSchema = z.strictObject({
  goalId: z.string().min(1).max(64),
});

export type CancelGoalArgs = z.infer<typeof CancelGoalArgsSchema>;

export const command = defineCommand({
  kind: 'cancelGoal',
  wave: 'W08',
  origin: 'client',
  args: CancelGoalArgsSchema,
  summary: 'Cancels an active or queued HQ goal and removes its waiting child orders from the order queue (UO-P §4.6).',
});
