import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'moveGroup',
  wave: 'W01',
  origin: 'client',
  args: z.strictObject({
    entityIds: z.array(z.number().int().positive()).min(1).max(64),
    q: TileCoord,
    r: TileCoord,
    pace: z.enum(['own', 'together']).optional(),
  }),
  summary: 'Orders owned units to distinct standable tiles around hex (q, r). pace "together" holds the group to its slowest member.',
});
