import { z } from 'zod';
import { defineCommand } from './define';

export const MarketSetHubFeeArgs = z.strictObject({
  colonyId: z.string().min(1).optional(),
  /** Stall fee in basis points; must lie in the policy range (0–100 bp by default, else `fee_out_of_range`). */
  bp: z.number().int().min(0).max(10_000),
  /** Trade Hub entity; default: the colony's Trade Hub. */
  hubId: z.number().int().nonnegative().optional(),
});
export type MarketSetHubFeeArgs = z.infer<typeof MarketSetHubFeeArgs>;

export const command = defineCommand({
  kind: 'market.setHubFee',
  wave: 'W13',
  origin: 'client',
  args: MarketSetHubFeeArgs,
  summary: 'Sets the stall fee the colony\'s Trade Hub charges buyers on fills where it is the maker\'s stall (D-44). Orders already open keep their pinned fee.',
});
