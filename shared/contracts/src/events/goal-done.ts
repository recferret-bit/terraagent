import { z } from 'zod';
import { defineEvent } from './define';
import { GoalKindSchema } from '../commands/queue-goal';

export const GoalDoneDataSchema = z.strictObject({
  colonyIndex: z.number().int().nonnegative(),
  goalId: z.string().min(1).max(64),
  goal: GoalKindSchema,
});

export type GoalDoneData = z.infer<typeof GoalDoneDataSchema>;

export const event = defineEvent({
  kind: 'goalDone',
  wave: 'W08',
  audience: 'player',
  severity: 'info',
  data: GoalDoneDataSchema,
  summary: 'Emitted when an HQ goal reaches completion (UO-P §4.6).',
});
