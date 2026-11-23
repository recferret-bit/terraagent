/** Catalog `reason` on `trade_order_failed`. Anything else is `unknown`. */
export const TRADE_FAIL_REASONS = ['validation', 'rejected', 'network', 'insufficient', 'expired', 'timeout', 'unknown'] as const;
export type TradeFailReason = (typeof TRADE_FAIL_REASONS)[number];

const BY_CODE: Readonly<Record<string, TradeFailReason>> = {
  invalid_request: 'validation',
  validation_error: 'validation',
  validation: 'validation',
  invalid_args: 'validation',
  idempotency_key_required: 'validation',
  idempotency_key_reuse: 'validation',
  rejected: 'rejected',
  pair_not_allowed: 'rejected',
  order_not_open: 'rejected',
  fill_policy_not_allowed: 'rejected',
  price_out_of_band: 'rejected',
  fee_out_of_range: 'rejected',
  kill_switch: 'rejected',
  no_colony: 'rejected',
  wrong_planet: 'rejected',
  order_limit: 'rejected',
  order_too_small: 'rejected',
  max_open_orders: 'rejected',
  max_order_notional: 'rejected',
  wave_disabled: 'rejected',
  forbidden_scope: 'rejected',
  unauthorized: 'rejected',
  rate_limited: 'rejected',
  network: 'network',
  host_unavailable: 'network',
  server_busy: 'network',
  market_unavailable: 'network',
  econnrefused: 'network',
  econnreset: 'network',
  timeout: 'timeout',
  etimedout: 'timeout',
  insufficient: 'insufficient',
  insufficient_cargo: 'insufficient',
  insufficient_funds: 'insufficient',
  insufficient_stock: 'insufficient',
  insufficient_resources: 'insufficient',
  daily_budget_exceeded: 'insufficient',
  allowance_exhausted: 'insufficient',
  expired: 'expired',
  offer_expired: 'expired',
};

/** Maps a trade or sim code onto the six catalog reasons. The default is `unknown`. */
export function tradeFailReason(code: string | undefined | null): TradeFailReason {
  const raw = (code ?? '').trim();
  if (raw === '') return 'unknown';
  const mapped = BY_CODE[raw] ?? BY_CODE[raw.toLowerCase()];
  if (mapped) return mapped;
  const lower = raw.toLowerCase();
  if (lower.includes('insufficient')) return 'insufficient';
  if (lower.includes('expire')) return 'expired';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('network') || lower.includes('unavailable')) return 'network';
  if (lower.includes('valid')) return 'validation';
  return 'unknown';
}
