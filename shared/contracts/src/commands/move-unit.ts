import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'moveUnit',
  wave: 'W01',
  origin: 'client',
  args: z.strictObject({
    entityId: z.number().int().positive(),
    q: TileCoord,
    r: TileCoord,
  }),
  summary: 'Orders an owned unit (such as the HQ drone) to move to target hex (q, r).',
});
