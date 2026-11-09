import { z } from 'zod';
import { RejectCode } from '../errors';
import { defineCommand } from './define';
import { MarketResourceDeltas } from './market-reserve';

export const MarketReleaseReason = z.enum(['cancelled', 'expired', 'rejected', 'settlement_failed', 'filled']);
export type MarketReleaseReason = z.infer<typeof MarketReleaseReason>;

export const MarketReleaseArgs = z.strictObject({
  colonyId: z.string().min(1).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  ref: z.string().min(1).max(160),
  orderId: z.string().min(1).max(160).optional(),
  /** In-orbit resource units released from the reservation (non-negative). */
  deltas: MarketResourceDeltas,
  reason: MarketReleaseReason,
  /** For `rejected`: the reject code the player sees (`insufficient_cargo`, `order_limit`, …). */
  code: RejectCode.optional(),
  detail: z.string().max(200).optional(),
});
export type MarketReleaseArgs = z.infer<typeof MarketReleaseArgs>;

export const command = defineCommand({
  kind: 'market.release',
  wave: 'W13',
  origin: 'module',
  args: MarketReleaseArgs,
  summary: 'Module command: an order\'s reservation was released (cancel, TTL expiry, server-side reject or final settlement failure); the sim lowers `reservedInOrbit` and, on `rejected`, emits `marketOrderRejected` (W13-10).',
});
