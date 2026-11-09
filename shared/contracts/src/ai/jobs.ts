import { z } from 'zod';
import { AiId, ScopedId } from './ids';
import { AI_SUMMARY_MAX_CHARS } from './limits';
import { DirectorTriggerSchema } from './triggers';

export const DIRECTOR_QUEUES = ['planning', 'narrative', 'guild'] as const;
export const DirectorQueueSchema = z.enum(DIRECTOR_QUEUES);
export type DirectorQueue = z.infer<typeof DirectorQueueSchema>;

export const DIRECTOR_PRINCIPALS = ['colony', 'guild'] as const;
export const DirectorPrincipalSchema = z.enum(DIRECTOR_PRINCIPALS);
export type DirectorPrincipal = z.infer<typeof DirectorPrincipalSchema>;

export const JOB_PRIORITIES = ['routine', 'critical'] as const;
export const JobPrioritySchema = z.enum(JOB_PRIORITIES);
export type JobPriority = z.infer<typeof JobPrioritySchema>;

/**
 * Immutable queue payload (AI §7). It carries references, not prompts, secrets or a world dump.
 * Unknown keys fail. The model never sees this object as a tool it can author.
 */
export const DirectorJobV1Schema = z.strictObject({
  version: z.literal(1),
  jobId: AiId,
  colonyId: ScopedId,
  planetId: ScopedId,
  worldId: ScopedId,
  fence: z.number().int().nonnegative(),
  trigger: DirectorTriggerSchema,
  triggerSummary: z.string().max(AI_SUMMARY_MAX_CHARS),
  enqueuedAtMs: z.number().int().nonnegative(),
  deadlineAtMs: z.number().int().nonnegative(),
  contextRef: AiId,
  intentRevision: z.number().int().nonnegative(),
  permissionRevision: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  priority: JobPrioritySchema,
  queue: DirectorQueueSchema,
  principal: DirectorPrincipalSchema,
});
export type DirectorJobV1 = z.infer<typeof DirectorJobV1Schema>;
