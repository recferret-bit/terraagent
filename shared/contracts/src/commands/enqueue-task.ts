import { z } from 'zod';
import { TerraformOp, TilePos } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'enqueueTask',
  wave: 'W01',
  origin: 'client',
  args: z.strictObject({
    terraform: z.strictObject({
      op: TerraformOp,
      tiles: z.array(TilePos).min(1).max(256),
    }),
  }),
  summary: 'Enqueues a terraform order (grade | clear | break) over one or more tiles in the colony queue.',
});
