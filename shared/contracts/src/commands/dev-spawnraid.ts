import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.spawnraid',
  wave: 'W07',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    hiveId: z.number().int().positive().optional(),
    species: z.enum(['blackAnt', 'blueBeetle', 'greenSpitter']).optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    count: z.number().int().positive().optional(),
    budget: z.number().int().positive().optional(),
  }),
  summary: 'Dev console (`spawnRaid`): provokes a species hive and dispatches a bounded raid wave against the colony (W07-29).',
});
