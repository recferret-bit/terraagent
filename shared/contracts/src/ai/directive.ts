import { z } from 'zod';
import { DirectiveActionSchema } from './actions';
import { AiId, ScopedId } from './ids';
import { AI_CONTEXT_MAX_AGE_S, AI_MAX_ACTIONS, AI_MAX_SKILLS, AI_RATIONALE_MAX_CHARS } from './limits';
import { DirectorSkillRefSchema } from './skills';

/** What the model may return. Identity, fence and revisions are not fields here, so a model cannot set them. */
export function proposalShape() {
  return {
    version: z.literal(2),
    skills: z.array(DirectorSkillRefSchema).max(AI_MAX_SKILLS),
    rationale: z.string().max(AI_RATIONALE_MAX_CHARS),
    observedDependencies: z.array(z.string().min(1).max(80)).max(32),
    actions: z.array(DirectiveActionSchema).max(AI_MAX_ACTIONS),
  };
}

export const DirectiveProposalSchema = z.strictObject(proposalShape());
export type DirectiveProposal = z.infer<typeof DirectiveProposalSchema>;

/**
 * Host-bound directive (AI §6). The worker fills identity after the proposal parses.
 * `maxContextAgeS` cannot exceed the 60s contract ceiling.
 */
export const DirectiveV2Schema = z.strictObject({
  ...proposalShape(),
  requestId: AiId,
  jobId: AiId,
  fence: z.number().int().nonnegative(),
  colonyId: ScopedId,
  worldId: ScopedId,
  planetId: ScopedId,
  epoch: z.number().int().nonnegative(),
  intentRevision: z.number().int().nonnegative(),
  permissionRevision: z.number().int().nonnegative(),
  contextRevision: z.number().int().nonnegative(),
  policyVersion: z.number().int().positive(),
  deadlineAtMs: z.number().int().nonnegative(),
  maxContextAgeS: z.number().int().min(0).max(AI_CONTEXT_MAX_AGE_S),
});
export type DirectiveV2 = z.infer<typeof DirectiveV2Schema>;
