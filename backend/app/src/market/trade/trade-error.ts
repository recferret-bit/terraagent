import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { TradeApiError, TradeErrorCode } from '@terra/contracts';
import { CoreException } from '../../core/errors/index.js';
import type { HttpRes } from '../../core/logging/request-id.js';

/** HTTP status of each trade API code. */
const STATUS: Record<TradeErrorCode, number> = {
  unauthorized: 401, forbidden_scope: 403, key_revoked: 401, wave_disabled: 403, rate_limited: 429, invalid_request: 400, no_colony: 409,
  idempotency_key_required: 400, idempotency_key_reuse: 422, order_not_found: 404, wrong_planet: 409, kill_switch: 422, pair_not_allowed: 422,
  max_open_orders: 422, max_order_notional: 422, daily_budget_exceeded: 422, price_out_of_band: 422, key_not_found: 404, order_not_open: 409, fill_policy_not_allowed: 422, fee_out_of_range: 422,
};

/** A trade API error with a stable `code` (contract `TradeErrorCode` or a sim `RejectCode`). */
export class TradeError extends CoreException {
  readonly code: string;
  constructor(code: TradeErrorCode | string, message: string, details?: Record<string, unknown>, status?: number) {
    super(code, { status: status ?? STATUS[code as TradeErrorCode] ?? 422, message, details });
    this.code = code;
  }

  body(): TradeApiError {
    return { error: { code: this.code, message: this.message, ...(this.details ? { details: this.details as Record<string, unknown> } : {}) } };
  }
}

/** Writes `{ error: { code, message, details? } }` for `TradeError`; everything else goes to the global filter's mapping. */
@Catch(TradeError)
export class TradeErrorFilter implements ExceptionFilter {
  catch(exception: TradeError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<HttpRes>().status(exception.status).json(exception.body());
  }
}
