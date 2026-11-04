import { z } from 'zod';
import { defineCommand } from './define';
import { GoalKindSchema, GoalParamsSchema } from './queue-goal';

export const AcceptSuggestionArgsSchema = z.strictObject({
  suggestionId: z.string().min(1).max(64).optional(),
  stage: z.number().int().min(0).max(10).optional(),
  goal: GoalKindSchema.optional(),
  params: GoalParamsSchema.optional(),
});

export type AcceptSuggestionArgs = z.infer<typeof AcceptSuggestionArgsSchema>;

export const command = defineCommand({
  kind: 'acceptSuggestion',
  wave: 'W08',
  origin: 'client',
  args: AcceptSuggestionArgsSchema,
  summary: 'Accepts an offered HQ suggestion (such as S0 Establish Colony or an early-stage rule suggestion, UO-LC-04 / UO-LC-05).',
});
