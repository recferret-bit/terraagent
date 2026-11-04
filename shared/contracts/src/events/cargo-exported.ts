import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'cargoExported',
  wave: 'W10',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative().optional(),
    playerId: z.string().optional(),
    ref: z.string().min(1).max(160),
    exportSeq: z.number().int().positive(),
    resource: ResourceKey,
    amount: z.number().int().positive(),
    txHash: z.string().optional(),
  }),
  summary: 'Colony stock was debited for export into orbital NEP-245 custody; triggers outbox mint on the server (W10-01, W10-05).',
});
