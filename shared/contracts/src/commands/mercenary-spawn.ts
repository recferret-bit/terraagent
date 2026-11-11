import { MercenarySpawnArgsSchema } from '../bounty';
import { defineCommand } from './define';

/**
 * Spawns a Tier-1 mercenary recon squad for a defend contract (NEAR-112, W22-29).
 * Module-only: a client `cmd` is rejected `unknown_kind` by `precheckClientCommand`.
 */
export const command = defineCommand({
  kind: 'mercenary.spawn',
  wave: 'W22',
  origin: 'module',
  args: MercenarySpawnArgsSchema,
  summary: 'Spawns faction-mercenary recon at the poster hub edge until `endTick`. They cost the poster no supply.',
});
