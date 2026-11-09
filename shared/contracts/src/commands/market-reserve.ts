import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

/** Whole resource units per key (the sim mirror never holds USDC/NEAR; those live only in the verifier). */
export const MarketResourceDeltas = z.partialRecord(ResourceKey, z.number().int());
export type MarketResourceDeltas = z.infer<typeof MarketResourceDeltas>;

export const MarketReserveArgs = z.strictObject({
  colonyId: z.string().min(1).optional(),
  colonyIndex: z.number().int().nonnegative().optional(),
  /** Sim order ref (`market-order:{colonyId}:{seq}`). */
  ref: z.string().min(1).max(160),
  orderId: z.string().min(1).max(160).optional(),
  /** In-orbit resource units now reserved by this order (non-negative). */
  deltas: MarketResourceDeltas,
});
export type MarketReserveArgs = z.infer<typeof MarketReserveArgs>;

export const command = defineCommand({
  kind: 'market.reserve',
  wave: 'W13',
  origin: 'module',
  args: MarketReserveArgs,
  summary: 'Module command from the market module: the order\'s reservation is held in the DB; the sim mirrors it in `reservedInOrbit` for the HUD (W13-10, SIMULATION market.*). No sim stock changes.',
});
