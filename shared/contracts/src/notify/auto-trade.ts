import { z } from 'zod';
import { ResourceKey } from '../ws/sim';

/** Who an automated trade may deal with (AW-13). `truce` includes guild partners. */
export const AUTO_TRADE_PARTNERS = ['guild', 'truce', 'anyone'] as const;
export const AutoTradePartnerSchema = z.enum(AUTO_TRADE_PARTNERS);
export type AutoTradePartner = z.infer<typeof AutoTradePartnerSchema>;

/** Per-resource autoTrade limits. The command that sets them is W15-01 `setAutoTrade`. */
export const AutoTradeLimitSchema = z.strictObject({
  maxPerTrade: z.number().nonnegative(),
  maxPerSession: z.number().nonnegative(),
  minStock: z.number().nonnegative(),
  partners: AutoTradePartnerSchema,
});
export type AutoTradeLimit = z.infer<typeof AutoTradeLimitSchema>;

/** A missing key means that resource has no autoTrade limit (the checker is not called). */
export const AutoTradeLimitsSchema = z.partialRecord(ResourceKey, AutoTradeLimitSchema);
export type AutoTradeLimits = z.infer<typeof AutoTradeLimitsSchema>;

export const AutoTradeOrderSchema = z.strictObject({
  resource: ResourceKey,
  give: z.number().nonnegative(),
  stock: z.number().nonnegative(),
  sessionSpent: z.number().nonnegative(),
  partner: AutoTradePartnerSchema,
});
export type AutoTradeOrder = z.infer<typeof AutoTradeOrderSchema>;
