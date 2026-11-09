import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { TradeApiError, TradeErrorCode } from '@terra/contracts';
import { CoreException } from '../../core/errors/index.js';
import type { HttpRes } from '../../core/logging/request-id.js';

/** HTTP status of each trade API code. */
const STATUS: Record<TradeErrorCode, number> = {
  unauthorized: 401, forbidden_scope: 403, key_revoked: 401, wave_disabled: 403, rate_limited: 429, invalid_request: 400, no_colony: 409,
  idempotency_key_required: 400, idempotency_key_reuse: 422, order_not_found: 404, wrong_planet: 409, kill_switch: 422, pair_not_allowed: 422,
  max_open_orders: 422, max_order_notional: 422, daily_budget_exceeded: 422, price_out_of_band: 422, key_not_found: 404, order_not_open: 409, fill_policy_not_allowed: 422, fee_out_of_range: 422, key_limit: 409, too_many_streams: 429, server_busy: 503,
};

/** A trade API error with a stable `code` (contract `TradeErrorCode` or a sim `RejectCode`). */
export class TradeError extends CoreException {
  readonly code: string;
  constructor(code: TradeErrorCode | string, message: string, details?: Record<string, unknown>, status?: number) {
    super(code, { status: status ?? STATUS[code as TradeErrorCode] ?? 422, message, details });
    this.code = code;
  }

  /** A 429 with the limiter's refill time as `details.retryAfterMs` (floor 1 ms; `Retry-After` is its whole-second ceiling). */
  static rateLimited(message: string, details: Record<string, unknown>, retryAfterMs: number): TradeError {
    return new TradeError('rate_limited', message, { ...details, retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)) });
  }

  /** 503 `server_busy`: the placement queue is full for longer than the bounded wait. */
  static busy(message: string, details: Record<string, unknown>, retryAfterMs = 1000): TradeError {
    return new TradeError('server_busy', message, { ...details, retryAfterMs });
  }

  /** Whole milliseconds a client should wait before retrying (429 / 503 only); a missing hint defaults to one second. */
  retryAfterMs(): number | null {
    if (this.status !== 429 && this.status !== 503) return null;
    const hinted = (this.details as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
    return typeof hinted === 'number' && hinted > 0 ? Math.ceil(hinted) : 1000;
  }

  body(): TradeApiError {
    const retry = this.retryAfterMs();
    const details = retry === null ? this.details : { ...(this.details as Record<string, unknown> | undefined), retryAfterMs: retry };
    return { error: { code: this.code, message: this.message, ...(details ? { details: details as Record<string, unknown> } : {}) } };
  }
}

/** Writes `{ error: { code, message, details? } }` for `TradeError` (+ `Retry-After` on every 429 / 503); everything else goes to the global filter's mapping. */
@Catch(TradeError)
export class TradeErrorFilter implements ExceptionFilter {
  catch(exception: TradeError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpRes>();
    const retry = exception.retryAfterMs();
    if (retry !== null) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retry / 1000))));
    res.status(exception.status).json(exception.body());
  }
}
