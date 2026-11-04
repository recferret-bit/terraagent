import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { defineEvent } from './define';

export const event = defineEvent({
  kind: 'cargoImported',
  wave: 'W10',
  severity: 'info',
  audience: 'player',
  data: z.strictObject({
    colonyId: z.string().min(1),
    colonyIndex: z.number().int().nonnegative().optional(),
    playerId: z.string().optional(),
    ref: z.string().min(1).max(160),
    importSeq: z.number().int().positive(),
    resource: ResourceKey,
    amount: z.number().int().positive(),
    phase: z.enum(['requested', 'settled']).optional(),
    txHash: z.string().optional(),
  }),
  summary: 'Orbital cargo import requested or settled into colony stock (W10-01, W10-12).',
});
