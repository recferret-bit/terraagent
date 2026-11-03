import { z } from 'zod';

/** `GET /v1/near/relay`. `pending` is in flight; `failed` needs a retry; `none` means no deposit rows. */
export const RelayViewState = z.enum(['none', 'pending', 'settled', 'failed']);
export type RelayViewState = z.infer<typeof RelayViewState>;

export const RelayStatusResponse = z.object({
  state: RelayViewState,
  opId: z.string().min(1).max(200).optional(),
});
export type RelayStatusResponse = z.infer<typeof RelayStatusResponse>;

/** `POST /v1/near/relay/retry` puts FAILED deposit rows back in the queue. */
export const RelayRetryResponse = z.object({
  state: z.literal('pending'),
});
export type RelayRetryResponse = z.infer<typeof RelayRetryResponse>;
