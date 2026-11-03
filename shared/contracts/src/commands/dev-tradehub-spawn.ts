import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.tradehubSpawn',
  wave: 'W10',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    colonyIndex: z.number().int().nonnegative().optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    tier: z.number().int().min(1).max(3).optional(),
  }),
  summary: 'Dev console (`tradehub.spawn`): spawns an instant completed online Trade Hub for the caller colony (W10-26).',
});
