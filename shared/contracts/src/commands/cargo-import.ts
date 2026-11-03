import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'cargo.import',
  wave: 'W10',
  origin: 'client',
  args: z.strictObject({
    colonyId: z.string().min(1).optional(),
    resource: ResourceKey,
    amount: z.number().int().positive(),
  }),
  summary: 'Imports `amount` whole units of `resource` from orbital NEP-245 custody into colony stock via an online Trade Hub (W10-01, NEAR-51).',
});
