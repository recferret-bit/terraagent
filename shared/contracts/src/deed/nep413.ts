import { z } from 'zod';

/** NEP-413 signed wallet message (wallet-signed staking / claim actions). */
export const Nep413Signature = z.strictObject({
  accountId: z.string().min(2).max(64),
  publicKey: z.string().min(1).max(160),
  signature: z.string().min(1).max(512),
  message: z.string().min(1).max(1024),
  nonce: z.string().min(8).max(128),
  recipient: z.string().min(1).max(128),
  callbackUrl: z.string().max(512).optional(),
});
export type Nep413Signature = z.infer<typeof Nep413Signature>;
