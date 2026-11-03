import { z } from 'zod';
import { TilePos } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'placePowerLine',
  wave: 'W03',
  origin: 'client',
  args: z.strictObject({
    tiles: z.array(TilePos).min(1).max(64).optional(),
    anchors: z.array(TilePos).min(1).max(64).optional(),
    from: TilePos.optional(),
    to: TilePos.optional(),
    tier: z.number().int().min(1).max(2).optional(),
    taskId: z.string().min(1).max(64).optional(),
  }),
  summary: 'Enqueues a multi-pylon power line construction order along a hex path (auto-spaced up to span 6, W03-01, W03-17).',
});
