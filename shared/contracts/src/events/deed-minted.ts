import { z } from 'zod';
import { defineEvent } from './define';

export const DeedMintedDataSchema = z.strictObject({
  colonyId: z.string().min(1),
  planetId: z.string().min(1),
  tokenId: z.string().min(1),
  ownerAccountId: z.string().min(1),
  txHash: z.string().min(1).optional(),
  version: z.number().int().positive(),
});

export type DeedMintedData = z.infer<typeof DeedMintedDataSchema>;

export const event = defineEvent({
  kind: 'deedMinted',
  wave: 'W20',
  severity: 'info',
  audience: 'player',
  data: DeedMintedDataSchema,
  summary: 'Emitted when a Colony Deed NFT is minted on colonyFounded (W20-01, W20-05).',
});
