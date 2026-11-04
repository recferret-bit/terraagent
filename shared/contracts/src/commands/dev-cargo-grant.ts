import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'dev.cargoGrant',
  wave: 'W10',
  origin: 'client',
  dev: true,
  args: z.strictObject({
    colonyIndex: z.number().int().nonnegative().optional(),
    colony: z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).optional(),
    resource: ResourceKey,
    amount: z.number().int(),
  }),
  summary: 'Dev console (`cargo.grant <colony> <res> <amt>`): grants or adjusts in-orbit cargo balance for the colony (W10-26).',
});
