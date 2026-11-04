import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.spawnunit',
  wave: 'W07',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    unit: z.string().min(1),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    count: z.number().int().positive().optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
    owner: z.number().int().min(-1).optional(),
  }),
  summary: 'Dev console (`spawnUnit`): spawns colony combat/worker units or neutral fauna bugs at (q, r) (W07-29).',
});
