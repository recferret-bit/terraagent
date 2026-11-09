import { z } from 'zod';

/** Authoritative job outcomes (AI_ORCHESTRATOR §7). `proposed` is not `applied` (AI-10). */
export const DIRECTOR_OUTCOMES = [
  'disabled',
  'rate_limited',
  'budget_exhausted',
  'coalesced',
  'overloaded',
  'expired',
  'superseded',
  'unauthorized',
  'context_unavailable',
  'context_too_large',
  'invalid',
  'proposed',
  'applied',
  'partially_applied',
  'rejected',
  'timeout',
  'provider_error',
] as const;
export const DirectorOutcomeSchema = z.enum(DIRECTOR_OUTCOMES);
export type DirectorOutcome = z.infer<typeof DirectorOutcomeSchema>;

/** Per-action states the HUD may show. Only `applied` means the sim accepted the action. */
export const DIRECTOR_ACTION_STATES = ['proposed', 'applied', 'rejected', 'superseded'] as const;
export const DirectorActionStateSchema = z.enum(DIRECTOR_ACTION_STATES);
export type DirectorActionState = z.infer<typeof DirectorActionStateSchema>;
