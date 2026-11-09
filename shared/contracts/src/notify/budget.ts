import { z } from 'zod';
import { ResourceFamily } from '../ws/sim';

/** One family slider. Integers only; 0 and 100 are legal, 101 is not (AW-20). */
export const AwayFamilyBudgetSchema = z.strictObject({
  perDirectivePct: z.number().int().min(0).max(100).optional(),
  perSessionPct: z.number().int().min(0).max(100).optional(),
}).refine((b) => b.perDirectivePct !== undefined || b.perSessionPct !== undefined, {
  message: 'empty family budget',
});
export type AwayFamilyBudget = z.infer<typeof AwayFamilyBudgetSchema>;

/**
 * Away budget patch, one entry per D-34 family (Metals, Minerals, Bio).
 * Oil is `bio.t2` (Petroleum) inside Bio, not a fourth family (owner default, BE-53).
 */
export const AwayBudgetSchema = z.strictObject({
  metals: AwayFamilyBudgetSchema.optional(),
  minerals: AwayFamilyBudgetSchema.optional(),
  bio: AwayFamilyBudgetSchema.optional(),
}).refine((b) => b.metals !== undefined || b.minerals !== undefined || b.bio !== undefined, {
  message: 'empty away budget',
});
export type AwayBudget = z.infer<typeof AwayBudgetSchema>;

export const AutopilotModeSchema = z.enum(['director', 'rules_only']);
export type AutopilotMode = z.infer<typeof AutopilotModeSchema>;

/** The family an `awayBudgetExhausted` event names. */
export const AwayBudgetResourceSchema = ResourceFamily;
