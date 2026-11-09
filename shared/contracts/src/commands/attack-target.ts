import { z } from 'zod';
import { defineCommand } from './define';

const AttackTargetSingleSchema = z.strictObject({
  entityId: z.number().int().positive(),
  entityIds: z.array(z.number().int().positive()).min(1).max(256).optional(),
  targetId: z.number().int().positive(),
});

const AttackTargetBatchSchema = z.strictObject({
  entityIds: z.array(z.number().int().positive()).min(1).max(256),
  targetId: z.number().int().positive(),
});

export const AttackTargetArgsSchema = z.union([AttackTargetSingleSchema, AttackTargetBatchSchema]);
export type AttackTargetArgs = z.infer<typeof AttackTargetArgsSchema>;

export const command = defineCommand({
  kind: 'attackTarget',
  wave: 'W07',
  origin: 'client',
  args: AttackTargetArgsSchema,
  summary: 'Orders one or more owned combat units to pursue and attack a specific target entity or hive (W07-12).',
});
