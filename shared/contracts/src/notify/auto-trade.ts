import { z } from 'zod';
import { ResourceKey } from '../ws/sim';

/** Who an automated trade may deal with (AW-13). `truce` includes guild partners. */
export const AUTO_TRADE_PARTNERS = ['guild', 'truce', 'anyone'] as const;
export const AutoTradePartnerSchema = z.enum(AUTO_TRADE_PARTNERS);
export type AutoTradePartner = z.infer<typeof AutoTradePartnerSchema>;

/**
 * Per-resource autoTrade limits. The command that sets them is W15-01 `setAutoTrade`.
 * `sellAboveStoragePct` and `buyBelowStock` are optional so a W09 row (the four fields below) still parses.
 * Absent means the checker ignores that rule (BE-72).
 */
export const AutoTradeLimitSchema = z.strictObject({
  maxPerTrade: z.number().nonnegative(),
  maxPerSession: z.number().nonnegative(),
  minStock: z.number().nonnegative(),
  partners: AutoTradePartnerSchema,
  /** Sell only when storage fill is at or above this percent (inclusive). Demo: 80. */
  sellAboveStoragePct: z.number().min(0).max(100).optional(),
  /** Buy only when stock is at or below this floor (inclusive). */
  buyBelowStock: z.number().nonnegative().optional(),
});
export type AutoTradeLimit = z.infer<typeof AutoTradeLimitSchema>;

/** A missing key means that resource has no autoTrade limit (the checker is not called). */
export const AutoTradeLimitsSchema = z.partialRecord(ResourceKey, AutoTradeLimitSchema);
export type AutoTradeLimits = z.infer<typeof AutoTradeLimitsSchema>;

export const AutoTradeSideSchema = z.enum(['sell', 'buy']);
export type AutoTradeSide = z.infer<typeof AutoTradeSideSchema>;

export const AutoTradeOrderSchema = z.strictObject({
  resource: ResourceKey,
  give: z.number().nonnegative(),
  stock: z.number().nonnegative(),
  sessionSpent: z.number().nonnegative(),
  partner: AutoTradePartnerSchema,
  /** Omitted means sell, which is the W09 give. */
  side: AutoTradeSideSchema.optional(),
  /** Storage fill 0..100. Needed to enforce `sellAboveStoragePct` when `storageCap` is omitted. */
  storagePct: z.number().min(0).max(100).optional(),
  /** Warehouse cap. Fill percent is `stock / storageCap * 100` when `storagePct` is omitted. */
  storageCap: z.number().nonnegative().optional(),
});
export type AutoTradeOrder = z.infer<typeof AutoTradeOrderSchema>;
