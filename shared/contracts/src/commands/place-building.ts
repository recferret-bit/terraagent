import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'placeBuilding',
  wave: 'W01',
  origin: 'client',
  args: z.strictObject({
    building: z.string().min(1).max(64),
    q: TileCoord,
    r: TileCoord,
    tier: z.number().int().min(1).max(3).optional(),
  }),
  summary: 'Queues construction of a structure at (q, r) and auto-links any missing site preparation ops (UO-TF-03).',
});
