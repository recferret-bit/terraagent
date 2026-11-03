import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineCommand } from './define';

export const command = defineCommand({
  kind: 'cargo.settled',
  wave: 'W10',
  origin: 'module',
  args: z.strictObject({
    colonyId: z.string().min(1).optional(),
    ref: z.string().min(1).max(160),
    direction: z.enum(['export', 'import']).optional(),
    resource: ResourceKey.optional(),
    amount: z.number().int().positive().optional(),
    ok: z.boolean(),
    txHash: z.string().min(1).max(128).optional(),
    error: z.string().max(200).optional(),
  }),
  summary: 'Module command from the NEAR outbox relay settling an export or import (`ok:true` finalises; `ok:false` refunds or releases reservation, W10-07 / W10-12).',
});
