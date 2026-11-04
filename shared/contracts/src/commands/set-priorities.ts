import { z } from 'zod';
import { defineCommand } from './define';

export const PRIORITY_KEYS = ['economy', 'expansion', 'defense', 'power', 'terraform'] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];
export const PriorityKeySchema = z.enum(PRIORITY_KEYS);

const PriorityStep = z.number().int().min(0).max(100);

const DirectPrioritiesSchema = z.strictObject({
  economy: PriorityStep.optional(),
  expansion: PriorityStep.optional(),
  defense: PriorityStep.optional(),
  power: PriorityStep.optional(),
  terraform: PriorityStep.optional(),
});

const WrappedPrioritiesSchema = z.strictObject({
  priorities: z.strictObject({
    economy: PriorityStep.optional(),
    expansion: PriorityStep.optional(),
    defense: PriorityStep.optional(),
    power: PriorityStep.optional(),
    terraform: PriorityStep.optional(),
  }),
});

export const SetPrioritiesArgsSchema = z.union([DirectPrioritiesSchema, WrappedPrioritiesSchema]);
export type SetPrioritiesArgs = z.infer<typeof SetPrioritiesArgsSchema>;

export const command = defineCommand({
  kind: 'setPriorities',
  wave: 'W08',
  origin: 'client',
  args: SetPrioritiesArgsSchema,
  summary: 'Sets the 5 canonical colony priority sliders (economy, expansion, defense, power, terraform; 0..100 step 10, SIM-R-02).',
});
