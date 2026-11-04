import { z } from 'zod';
import { AI_NOTE_MAX_CHARS } from './limits';

/**
 * The five W08 sliders. Each is an integer 0..100. Nothing in this schema rescales them so they sum to 100
 * (AI_ORCHESTRATOR §4). A policy with every slider at 100 is valid.
 */
export const IndependentPrioritiesSchema = z.strictObject({
  economy: z.number().int().min(0).max(100),
  expansion: z.number().int().min(0).max(100),
  defense: z.number().int().min(0).max(100),
  power: z.number().int().min(0).max(100),
  terraform: z.number().int().min(0).max(100),
});
export type IndependentPriorities = z.infer<typeof IndependentPrioritiesSchema>;

export const DIRECTOR_RISKS = ['conservative', 'risky'] as const;
export const DirectorRiskSchema = z.enum(DIRECTOR_RISKS);
export type DirectorRisk = z.infer<typeof DirectorRiskSchema>;

/** Preset ids. `defence` is the spec's Defence preset; the label is not a permission grant. */
export const DIRECTOR_PRESETS = [
  'defence',
  'resources',
  'terraforming',
  'expansion',
  'aggressive',
  'balanced',
] as const;
export const DirectorPresetSchema = z.enum(DIRECTOR_PRESETS);
export type DirectorPreset = z.infer<typeof DirectorPresetSchema>;

export const DirectorSkillIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'expected a skill id');
export type DirectorSkillId = z.infer<typeof DirectorSkillIdSchema>;

export const ProtectedAreaSchema = z.strictObject({
  sectorId: z.string().min(1).max(64),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  radius: z.number().int().min(0).max(64).optional(),
});
export type ProtectedArea = z.infer<typeof ProtectedAreaSchema>;

/**
 * Persisted player director policy (AI §4). `awayRaids` is not a field: a risk change cannot enable raids (AI-12).
 * An unknown key, including `awayRaids`, fails closed.
 */
export const DirectorPolicyV1Schema = z.strictObject({
  version: z.literal(1),
  risk: DirectorRiskSchema,
  preset: DirectorPresetSchema,
  priorities: IndependentPrioritiesSchema,
  skillAllow: z.array(DirectorSkillIdSchema).max(32),
  skillDeny: z.array(DirectorSkillIdSchema).max(32),
  protectedGoalIds: z.array(z.string().min(1).max(64)).max(16),
  protectedEntityIds: z.array(z.string().min(1).max(64)).max(32),
  protectedAreas: z.array(ProtectedAreaSchema).max(16),
  note: z.string().max(AI_NOTE_MAX_CHARS).optional(),
  revision: z.number().int().nonnegative(),
  permissionRevision: z.number().int().nonnegative(),
  pause: z.boolean(),
});
export type DirectorPolicyV1 = z.infer<typeof DirectorPolicyV1Schema>;

/** Copies the five sliders. Callers must not divide them by their sum. */
export function independentPriorities(policy: DirectorPolicyV1): IndependentPriorities {
  const { economy, expansion, defense, power, terraform } = policy.priorities;
  return { economy, expansion, defense, power, terraform };
}

export const DEFAULT_DIRECTOR_PRIORITIES: IndependentPriorities = {
  economy: 50,
  expansion: 50,
  defense: 50,
  power: 50,
  terraform: 50,
};

export const DEFAULT_DIRECTOR_POLICY: DirectorPolicyV1 = {
  version: 1,
  risk: 'conservative',
  preset: 'balanced',
  priorities: DEFAULT_DIRECTOR_PRIORITIES,
  skillAllow: [],
  skillDeny: [],
  protectedGoalIds: [],
  protectedEntityIds: [],
  protectedAreas: [],
  revision: 0,
  permissionRevision: 0,
  pause: false,
};
