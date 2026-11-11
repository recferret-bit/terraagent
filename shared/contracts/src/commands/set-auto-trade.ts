import { z } from 'zod';
import { AutoTradeLimitsSchema } from '../notify/auto-trade';
import { defineCommand } from './define';

/** Player autoTrade limits (AW-13). Optional `sellAboveStoragePct` and `buyBelowStock` extend the W09 row (BE-72). An empty map clears every limit. */
export const SetAutoTradeArgs = z.strictObject({
  limits: AutoTradeLimitsSchema,
});
export type SetAutoTradeArgs = z.infer<typeof SetAutoTradeArgs>;

export const command = defineCommand({
  kind: 'setAutoTrade',
  wave: 'W15',
  origin: 'client',
  args: SetAutoTradeArgs,
  summary: 'Sets per-resource autoTrade limits used by the director while the player is away (AW-13, NEAR-81).',
});
