import { z } from 'zod';
import { defineEvent } from './define';
import { GoalKindSchema, GoalParamsSchema } from '../commands/queue-goal';

export const SuggestionOfferedDataSchema = z.strictObject({
  colonyIndex: z.number().int().nonnegative(),
  suggestionId: z.string().min(1).max(64),
  stage: z.number().int().min(0).max(10),
  kind: z.enum(['goal', 'order']).optional(),
  goal: GoalKindSchema.optional(),
  params: GoalParamsSchema.optional(),
  need: z.string().max(32).optional(),
  lane: z.string().max(32).optional(),
  target: z.string().max(64).optional(),
  title: z.string().max(96).optional(),
  reason: z.string().max(160).optional(),
});

export type SuggestionOfferedData = z.infer<typeof SuggestionOfferedDataSchema>;

export const event = defineEvent({
  kind: 'suggestionOffered',
  wave: 'W08',
  audience: 'player',
  severity: 'info',
  data: SuggestionOfferedDataSchema,
  summary: 'Emitted when the stage tutorial or rule engine offers a suggestion instead of auto-queuing (UO-LC-04 / UO-LC-05).',
});
