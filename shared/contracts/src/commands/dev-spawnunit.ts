import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.spawnunit',
  wave: 'W13',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    unit: z.enum(['builder', 'harvester']),
    q: TileCoord,
    r: TileCoord,
    count: z.number().int().min(1).max(32).optional(),
  }),
  summary: 'Dev console: inserts `count` (default 1) idle units of a kind with a logistics row for the caller colony around tile (q, r), to grow the logistics load (W13-57).',
});
