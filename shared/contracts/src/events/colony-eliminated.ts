import { z } from 'zod';
import { defineEvent } from './define';

export const ColonyEliminatedCauseSchema = z.enum(['timer', 'hq_lost', 'both_lost', 'raid', 'fauna', 'environment', 'other']);
export type ColonyEliminatedCause = z.infer<typeof ColonyEliminatedCauseSchema>;

/** Declared here so W09-19 and W11-16 can consume it; W18-01 reuses this kind. */
export const ColonyEliminatedDataSchema = z.strictObject({
  colonyId: z.string().min(1).max(64).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  playerId: z.string().optional(),
  cause: ColonyEliminatedCauseSchema.optional(),
  reason: z.string().optional(),
  byColony: z.string().optional(),
  killerColonyId: z.string().optional(),
  atTick: z.number().int().nonnegative().optional(),
});
export type ColonyEliminatedData = z.infer<typeof ColonyEliminatedDataSchema>;

export const event = defineEvent({
  kind: 'colonyEliminated',
  wave: 'W09',
  severity: 'critical',
  audience: 'player',
  data: ColonyEliminatedDataSchema,
  summary: 'The colony is eliminated. Hard mode applies while the player is away (D-17, UO-HQ-04).',
});
