import { z } from 'zod';
import { HomeColonyId } from '../rest/home';
import { ResourceFamily } from '../ws/sim';
import { defineEvent } from './define';

export const AwayBudgetExhaustedDataSchema = z.strictObject({
  colonyId: HomeColonyId,
  colonyIndex: z.number().int().nonnegative().optional(),
  resource: ResourceFamily,
  atTick: z.number().int().nonnegative(),
});
export type AwayBudgetExhaustedData = z.infer<typeof AwayBudgetExhaustedDataSchema>;

export const event = defineEvent({
  kind: 'awayBudgetExhausted',
  wave: 'W09',
  severity: 'warn',
  audience: 'player',
  data: AwayBudgetExhaustedDataSchema,
  summary: 'Automated spend hit the away-session cap for one resource family (AW-20). Notified as away_budget_exhausted.',
});
