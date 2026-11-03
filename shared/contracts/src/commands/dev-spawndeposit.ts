import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.spawndeposit',
  wave: 'W02',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    q: TileCoord,
    r: TileCoord,
    family: z.enum(['metals', 'minerals', 'oil']),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  summary: 'Dev console: places a full resource deposit of `family` and `tier` on tile `(q, r)`, like a terraform find (`terraformFinds.deposit.richnessBp`).',
});
