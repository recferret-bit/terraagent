import { z } from 'zod';

/** One 1Click / NEAR Intents token (`GET /v1/near/intents/tokens`). `decimals` scales human input (W28-13). */
export const IntentsTokenInfo = z.object({
  assetId: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().nonnegative().max(36),
  blockchain: z.string().min(1),
  price: z.number().nonnegative().optional(),
});
export type IntentsTokenInfo = z.infer<typeof IntentsTokenInfo>;

export const IntentsTokensResponse = z.object({
  tokens: z.array(IntentsTokenInfo),
  presets: z.array(IntentsTokenInfo),
});
export type IntentsTokensResponse = z.infer<typeof IntentsTokensResponse>;

/**
 * `POST /v1/near/intents/quote` body. `amount` is ATOMIC units (scaled by the origin token's `decimals`). `dry` must
 * stay `true` unless `NEAR_MODE=mainnet` and the human confirmed (HACKATHON.md Q-007); the server enforces it.
 */
export const IntentsQuoteRequest = z.object({
  originAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  dry: z.boolean().optional(),
  confirmMainnet: z.boolean().optional(),
});
export type IntentsQuoteRequest = z.infer<typeof IntentsQuoteRequest>;
