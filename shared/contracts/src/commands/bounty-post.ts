import { BountyPostArgsSchema } from '../bounty';
import { defineCommand } from './define';

/** Posts a bounty and escrows `reward` until `expiresAt` (NEAR-110, W22-02). */
export const command = defineCommand({
  kind: 'bounty.post',
  wave: 'W22',
  origin: 'client',
  args: BountyPostArgsSchema,
  summary: 'Posts a bounty (clear a nest, defend an area, or deliver Tier-1 cargo) with a reward held in escrow until `expiresAt`.',
});
