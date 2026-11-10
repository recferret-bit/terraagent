import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const DirectorAllowanceExhaustedDataSchema = z.strictObject({
  colonyId: z.string().min(1).max(64),
  colonyIndex: z.number().int().nonnegative().optional(),
  resource: ResourceKey,
  spent: z.number().nonnegative(),
  allowance: z.number().nonnegative(),
  /** Why the loop stopped. W09 notifies `allowance_exhausted` as `away_budget_exhausted` (CT-36). */
  reason: z.enum(['allowance_exhausted', 'director_key_revoked']),
});
export type DirectorAllowanceExhaustedData = z.infer<typeof DirectorAllowanceExhaustedDataSchema>;

export const event = defineEvent({
  kind: 'directorAllowanceExhausted',
  wave: 'W15',
  severity: 'warn',
  audience: 'player',
  data: DirectorAllowanceExhaustedDataSchema,
  summary:
    'Director autoTrade stopped for one resource because the key allowance is spent or the key was revoked (CT-36, AW-20). Distinct from W09 awayBudgetExhausted.',
});
