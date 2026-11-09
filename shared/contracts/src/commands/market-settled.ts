import { z } from 'zod';
import { SettledTradeFields } from '../market/orders';
import { defineCommand } from './define';
import { MarketResourceDeltas } from './market-reserve';

export const MarketSettledArgs = z.strictObject({
  colonyId: z.string().min(1).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  tradeId: z.string().min(1).max(160),
  /** The colony's order in this trade (absent for a stall that only earned the fee). */
  ref: z.string().min(1).max(160).optional(),
  role: z.enum(['buyer', 'seller', 'stall']),
  /** Signed change of the colony's in-orbit resource units (buyer +base, seller −base, barter quote legs). */
  deltas: MarketResourceDeltas,
  /** Reserved in-orbit units consumed by this fill (lowers `reservedInOrbit`). */
  released: MarketResourceDeltas.optional(),
  /** What the toast and history row show; quote amounts are market atomic decimal strings. */
  trade: z.strictObject(SettledTradeFields),
});
export type MarketSettledArgs = z.infer<typeof MarketSettledArgs>;

export const command = defineCommand({
  kind: 'market.settled',
  wave: 'W13',
  origin: 'module',
  args: MarketSettledArgs,
  summary: 'Module command after a trade batch is FINAL: updates the colony\'s in-orbit mirror and emits `tradeSettled` (and `feeEarned` for the stall) (W13-10, W13-13). No sim stock changes.',
});
