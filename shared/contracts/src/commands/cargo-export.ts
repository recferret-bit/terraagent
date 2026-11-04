import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'cargo.export',
  wave: 'W10',
  origin: 'client',
  args: z.strictObject({
    colonyId: z.string().min(1).optional(),
    resource: ResourceKey,
    amount: z.number().int().positive(),
  }),
  summary: 'Exports `amount` whole units of `resource` from colony stock to orbital NEP-245 custody via an online Trade Hub (W10-01, NEAR-50).',
});
