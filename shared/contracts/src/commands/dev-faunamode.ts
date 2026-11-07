import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.faunamode',
  wave: 'W07',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    id: z.number().int().positive().optional(),
    entityId: z.number().int().positive().optional(),
    hiveId: z.number().int().positive().optional(),
    mode: z.enum(['passive', 'aggressive']).optional(),
    targetId: z.number().int().positive().optional(),
    targetQ: TileCoord.optional(),
    targetR: TileCoord.optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
  }),
  summary: 'Dev console (`faunaMode` / `faunaTarget`): switches a hive or bug between passive and aggressive mode and/or retargets it (W07-29).',
});
