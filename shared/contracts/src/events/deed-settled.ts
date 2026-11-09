import { z } from 'zod';
import { defineEvent } from './define';

export const DeedSettledDataSchema = z.strictObject({
  colonyId: z.string().min(1),
  planetId: z.string().min(1),
  tokenId: z.string().min(1),
  version: z.number().int().positive(),
  txHash: z.string().min(1).optional(),
  imageUrl: z.string().min(1).optional(),
});

export type DeedSettledData = z.infer<typeof DeedSettledDataSchema>;

export const event = defineEvent({
  kind: 'deedSettled',
  wave: 'W20',
  severity: 'info',
  audience: 'player',
  data: DeedSettledDataSchema,
  summary: 'Emitted when a Colony Deed NFT is permanently sealed as Settled (W20-01, W20-15).',
});
