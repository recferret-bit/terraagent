import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.spawnhive',
  wave: 'W07',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    species: z.enum(['blackAnt', 'blueBeetle', 'greenSpitter']).optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    mode: z.enum(['passive', 'aggressive']).optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
    entranceQ: TileCoord.optional(),
    entranceR: TileCoord.optional(),
    initialResidents: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console (`spawnHive`): spawns a 3x3 species hive and its initial resident bugs at (q, r) (W07-29).',
});
