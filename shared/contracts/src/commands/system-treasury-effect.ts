import { SystemTreasuryEffectArgsSchema } from '../treasury';
import { defineCommand } from './define';

/**
 * Applies a passed council project to the sim (NEAR-102, W22-01).
 * Module-only: a client `cmd` is rejected `unknown_kind` by `precheckClientCommand`.
 */
export const command = defineCommand({
  kind: 'system.treasuryEffect',
  wave: 'W22',
  origin: 'module',
  args: SystemTreasuryEffectArgsSchema,
  summary: 'Starts a planet treasury effect (meteor shield, terraform boost, or guild subsidy) until `untilTick`.',
});
