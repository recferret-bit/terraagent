import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.land',
  wave: 'W01',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    q: TileCoord.optional(),
    r: TileCoord.optional(),
  }),
  summary: 'Dev console: respawns or lands the caller colony drop pod and HQ at a spawn slot.',
});
