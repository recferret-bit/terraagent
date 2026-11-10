import { z } from 'zod';
import { HomeColonyId } from '../rest/home';
import { defineEvent } from './define';

export const ColonyEliminatedCauseSchema = z.enum(['timer', 'hq_lost', 'raid', 'fauna', 'environment', 'other']);
export type ColonyEliminatedCause = z.infer<typeof ColonyEliminatedCauseSchema>;

/** Declared here so W09-19 and W11-16 can consume it; W18-01 reuses this kind. */
export const ColonyEliminatedDataSchema = z.strictObject({
  colonyId: HomeColonyId,
  colonyIndex: z.number().int().nonnegative().optional(),
  cause: ColonyEliminatedCauseSchema,
  atTick: z.number().int().nonnegative(),
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
