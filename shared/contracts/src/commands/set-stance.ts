import { z } from 'zod';
import { defineCommand } from './define';

export const STANCE_KINDS = ['hold', 'defend', 'hunt'] as const;
export const StanceKindSchema = z.enum(STANCE_KINDS);
export type StanceKind = z.infer<typeof StanceKindSchema>;

const SetSingleStanceSchema = z.strictObject({
  entityId: z.number().int().positive(),
  entityIds: z.array(z.number().int().positive()).min(1).max(256).optional(),
  stance: StanceKindSchema,
});

const SetBatchStanceSchema = z.strictObject({
  entityIds: z.array(z.number().int().positive()).min(1).max(256),
  stance: StanceKindSchema,
});

export const SetStanceArgsSchema = z.union([SetSingleStanceSchema, SetBatchStanceSchema]);
export type SetStanceArgs = z.infer<typeof SetStanceArgsSchema>;

export const command = defineCommand({
  kind: 'setStance',
  wave: 'W07',
  origin: 'client',
  args: SetStanceArgsSchema,
  summary: 'Sets the combat stance (hold, defend, hunt) for one or more owned combat units (UO-C-09, W07-12).',
});
