import { IntentsQuoteRequest } from '@terra/contracts';
import { z } from 'zod';
import { CoreException } from '../../../core/errors/index.js';
import type { OneClickDryQuoteRequest } from '../adapters/real/oneclick-quote.service.js';

/**
 * Body of `POST /v1/near/intents/quote`: `IntentsQuoteRequest` with optional assets (the chain-status modal and the
 * `near.quote` dev command send only `amount` and rely on the defaults). `amount` is ATOMIC; the server never scales it.
 */
const QuoteBody = IntentsQuoteRequest.partial({ originAsset: true, destinationAsset: true }).extend({
  recipient: z.string().min(1).max(128).optional(),
});

const flagOn = (v: string | undefined): boolean => v?.trim() === '1' || v?.trim().toLowerCase() === 'true';

/**
 * HACKATHON.md Q-007: the quote is `dry: true` unless the host runs `NEAR_MODE=mainnet` with `NEAR_ALLOW_MAINNET`,
 * the caller asked for `dry: false` AND confirmed (`confirmMainnet === true`). Anything else stays dry.
 */
export function resolveQuoteDry(
  body: { readonly dry?: boolean; readonly confirmMainnet?: boolean },
  env: Record<string, string | undefined>,
): boolean {
  const mainnet = env.NEAR_MODE?.trim().toLowerCase() === 'mainnet' && flagOn(env.NEAR_ALLOW_MAINNET);
  return !(mainnet && body.dry === false && body.confirmMainnet === true);
}

/** Validates the body (400 `validation_error` for a non-integer `amount`) and forces the effective `dry` flag. */
export function guardQuoteRequest(raw: unknown, env: Record<string, string | undefined>): OneClickDryQuoteRequest {
  const parsed = QuoteBody.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new CoreException('VALIDATION_ERROR', {
      status: 400,
      message: 'Invalid 1Click quote: amount must be an integer string in atomic units (scaled by the origin token decimals)',
    });
  }
  const { originAsset, destinationAsset, amount, recipient } = parsed.data;
  return { originAsset, destinationAsset, amount, recipient, dry: resolveQuoteDry(parsed.data, env) };
}
