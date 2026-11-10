import { z } from 'zod';
import { defineEvent } from './define';

export const DeedUpdatedDataSchema = z.strictObject({
  colonyId: z.string().min(1),
  planetId: z.string().min(1),
  tokenId: z.string().min(1),
  version: z.number().int().positive(),
  change: z.string().min(1).max(200).optional(),
  terraformBp: z.number().int().min(0).max(10_000).optional(),
  stage: z.number().int().min(0).max(10).optional(),
  status: z.enum(['active', 'settled', 'eliminated', 'abandoned']),
  settled: z.boolean(),
  txHash: z.string().min(1).optional(),
});

export type DeedUpdatedData = z.infer<typeof DeedUpdatedDataSchema>;

export const event = defineEvent({
  kind: 'deedUpdated',
  wave: 'W20',
  severity: 'info',
  audience: 'player',
  data: DeedUpdatedDataSchema,
  summary: 'Emitted when a Colony Deed NFT metadata is updated after a milestone (W20-01, W20-07).',
});
