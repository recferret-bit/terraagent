import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.spawnbuilding',
  wave: 'W07',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    building: z.string().min(1).max(64),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    rot: z.number().int().min(0).max(5).optional(),
    tier: z.number().int().min(1).max(3).optional(),
    colonyIndex: z.number().int().nonnegative().optional(),
    owner: z.number().int().nonnegative().optional(),
    fallbackNear: z.boolean().optional(),
  }),
  summary:
    'Dev combat sandbox: spawns a completed active building (turrets, factories, arrays, generators) at (q, r) without requiring an HQ or worker.',
});
