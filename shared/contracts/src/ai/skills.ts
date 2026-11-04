import { z } from 'zod';
import { WaveId } from '../flags';
import { DirectiveActionKindSchema } from './actions';
import { DirectorSkillIdSchema } from './policy';

/** Skill families from AI_ORCHESTRATOR §6. A family is a strategy, not an executable script. */
export const DIRECTOR_SKILL_FAMILIES = [
  'recovery',
  'resources',
  'defence',
  'scouting',
  'expansion',
  'terraforming',
  'logistics',
  'technology',
  'diplomacy',
  'settlement',
  'away',
  'guild',
] as const;
export const DirectorSkillFamilySchema = z.enum(DIRECTOR_SKILL_FAMILIES);
export type DirectorSkillFamily = z.infer<typeof DirectorSkillFamilySchema>;

/** Skill selected for one planning request. The full catalogue stays off the wire. */
export const DirectorSkillRefSchema = z.strictObject({
  id: DirectorSkillIdSchema,
  version: z.number().int().positive().max(999),
});
export type DirectorSkillRef = z.infer<typeof DirectorSkillRefSchema>;

/** Registry entry shape. Instances are registered in the director worker, not downloaded by the model. */
export const DirectorSkillSpecSchema = z.strictObject({
  id: DirectorSkillIdSchema,
  version: z.number().int().positive().max(999),
  family: DirectorSkillFamilySchema,
  purpose: z.string().min(1).max(200),
  requiredWaves: z.array(WaveId).max(8),
  minStage: z.number().int().min(0).max(20),
  tools: z.array(z.string().min(1).max(64)).max(8),
  actions: z.array(DirectiveActionKindSchema).max(8),
  fixtures: z.array(z.string().min(1).max(64)).max(16),
});
export type DirectorSkillSpec = z.infer<typeof DirectorSkillSpecSchema>;
