import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

export const SetRallyArgsSchema = z.strictObject({
  entityId: z.number().int().positive().optional(),
  producerId: z.number().int().positive().optional(),
  q: TileCoord,
  r: TileCoord,
});
export type SetRallyArgs = z.infer<typeof SetRallyArgsSchema>;

export const command = defineCommand({
  kind: 'setRally',
  wave: 'W07',
  origin: 'client',
  args: SetRallyArgsSchema,
  summary: 'Sets the rally hex (q, r) for a unit producer building or the colony (W07-10, W07-12).',
});
