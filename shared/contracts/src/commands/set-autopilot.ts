import { z } from 'zod';
import { AutopilotModeSchema, AwayBudgetSchema } from '../notify/budget';
import { defineCommand } from './define';

/**
 * Player away settings (AW-11, AW-20). `autoTrade` limits are W09-13's checker and W15-01's
 * `setAutoTrade` command, not this payload (owner default BE-68: one command, not PROTOCOL's split).
 * Every field is a patch. An empty object is rejected.
 */
export const SetAutopilotArgsSchema = z.strictObject({
  mode: AutopilotModeSchema.optional(),
  awayRaids: z.boolean().optional(),
  awayBudget: AwayBudgetSchema.optional(),
  /** "Hire mercenaries when attacked while away" (W22-31). Omitted leaves the stored value. */
  hireMercenaries: z.boolean().optional(),
  /** Whole metals the away hire may spend. 0 hires nothing. Omitted leaves the stored value. */
  mercenaryMaxSpend: z.number().int().min(0).max(1_000_000).optional(),
}).refine((a) => a.mode !== undefined || a.awayRaids !== undefined || a.awayBudget !== undefined
  || a.hireMercenaries !== undefined || a.mercenaryMaxSpend !== undefined, {
  message: 'empty setAutopilot',
});
export type SetAutopilotArgs = z.infer<typeof SetAutopilotArgsSchema>;

export const command = defineCommand({
  kind: 'setAutopilot',
  wave: 'W09',
  origin: 'client',
  args: SetAutopilotArgsSchema,
  summary: 'Sets autopilot mode, away raids, the per-family away budget, and away mercenary hire.',
});
