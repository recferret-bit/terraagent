import { z } from 'zod';
import { TileCoord } from '../ws/sim';
import { defineCommand } from './define';

const AttackMoveSingleSchema = z.strictObject({
  entityId: z.number().int().positive(),
  entityIds: z.array(z.number().int().positive()).min(1).max(256).optional(),
  q: TileCoord,
  r: TileCoord,
});

const AttackMoveBatchSchema = z.strictObject({
  entityIds: z.array(z.number().int().positive()).min(1).max(256),
  q: TileCoord,
  r: TileCoord,
});

export const AttackMoveArgsSchema = z.union([AttackMoveSingleSchema, AttackMoveBatchSchema]);
export type AttackMoveArgs = z.infer<typeof AttackMoveArgsSchema>;

export const command = defineCommand({
  kind: 'attackMove',
  wave: 'W07',
  origin: 'client',
  args: AttackMoveArgsSchema,
  summary: 'Orders one or more owned combat units to advance to (q, r), engaging hostile targets along the way (W07-12).',
});
