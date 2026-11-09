import { z } from 'zod';
import { AI_NOTE_MAX_CHARS } from '../ai/limits';
import { DirectorPresetSchema, DirectorRiskSchema, DirectorSkillIdSchema } from '../ai/policy';
import { defineCommand } from './define';

/** A partial priority patch. Each present slider is 0..100 and is not rescaled against the others. */
const PriorityPatchSchema = z.strictObject({
  economy: z.number().int().min(0).max(100).optional(),
  expansion: z.number().int().min(0).max(100).optional(),
  defense: z.number().int().min(0).max(100).optional(),
  power: z.number().int().min(0).max(100).optional(),
  terraform: z.number().int().min(0).max(100).optional(),
});

/**
 * Player patch of the director policy (AI §4). There is no `awayRaids` field.
 * The sim assigns the next `revision`; the client may send `expectedRevision` for a compare-and-swap.
 */
export const SetDirectorPolicyArgsSchema = z.strictObject({
  risk: DirectorRiskSchema.optional(),
  preset: DirectorPresetSchema.optional(),
  priorities: PriorityPatchSchema.optional(),
  skillAllow: z.array(DirectorSkillIdSchema).max(32).optional(),
  skillDeny: z.array(DirectorSkillIdSchema).max(32).optional(),
  note: z.string().max(AI_NOTE_MAX_CHARS).optional(),
  pause: z.boolean().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});
export type SetDirectorPolicyArgs = z.infer<typeof SetDirectorPolicyArgsSchema>;

export const command = defineCommand({
  kind: 'setDirectorPolicy',
  wave: 'W16',
  origin: 'client',
  args: SetDirectorPolicyArgsSchema,
  summary: 'Patches the colony director policy (risk, preset, independent priorities, skill lists, pause).',
});
