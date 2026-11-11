import { BountyPaidArgsSchema } from '../bounty';
import { defineCommand } from './define';

/**
 * Tells the sim the escrow paid the claimer (NEAR-111, W22-23).
 * Module-only: a client `cmd` is rejected `unknown_kind` by `precheckClientCommand`.
 */
export const command = defineCommand({
  kind: 'bounty.paid',
  wave: 'W22',
  origin: 'module',
  args: BountyPaidArgsSchema,
  summary: 'Credits the claimer after `EscrowPort.claim` pays the bounty reward.',
});
