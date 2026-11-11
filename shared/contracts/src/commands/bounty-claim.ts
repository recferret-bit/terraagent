import { BountyClaimArgsSchema } from '../bounty';
import { defineCommand } from './define';

/** Registers the caller as a claimer. It does not pay; payout is `bounty.paid` after `bountyCompleted` (NEAR-111). */
export const command = defineCommand({
  kind: 'bounty.claim',
  wave: 'W22',
  origin: 'client',
  args: BountyClaimArgsSchema,
  summary: 'Registers this colony as a claimer of an open bounty.',
});
