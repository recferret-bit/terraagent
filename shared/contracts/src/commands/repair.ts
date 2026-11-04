import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'repair',
  wave: 'W03',
  origin: 'client',
  args: z.strictObject({
    entityId: z.number().int().positive().optional(),
    q: TileCoord.optional(),
    r: TileCoord.optional(),
    workerId: z.number().int().positive().optional(),
    precedence: z.enum(['system', 'player', 'hq', 'ai', 'auto']).optional(),
    taskId: z.string().min(1).max(64).optional(),
  }),
  summary: 'Enqueues or dispatches a repair job on a damaged player-owned structure or unit (UO-P §3.2, W03-03).',
});
