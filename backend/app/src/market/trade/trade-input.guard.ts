import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { SAFE_ID_MAX, SAFE_ID_RE } from '@terra/contracts';
import { TradeError } from './trade-error.js';

interface RequestLike {
  readonly params?: Record<string, unknown>;
  readonly query?: Record<string, unknown>;
}

// eslint-disable-next-line no-control-regex -- the point is to reject them
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const PAIR_RE = /^[A-Za-z0-9._-]{1,48}\/[A-Za-z0-9._-]{1,48}$/;
/** Longest free-form query value (a `pairs` list is the largest legitimate one). */
const QUERY_MAX = 512;

const bad = (what: string): never => {
  throw new TradeError('invalid_request', `${what} is not a valid identifier (letters, digits and . _ : ~ @ - only, at most ${SAFE_ID_MAX} characters).`);
};

/** `bio.water/USDC`, possibly still percent-encoded (`%2F`): a malformed escape is a 400, never a thrown URIError. */
export function isPairId(raw: string): boolean {
  if (raw.length > 2 * SAFE_ID_MAX) return false;
  try { return PAIR_RE.test(decodeURIComponent(raw)); } catch { return false; }
}

export const isSafeId = (raw: string): boolean => raw.length <= SAFE_ID_MAX && SAFE_ID_RE.test(raw);

/** Query names that carry ids; every other query value only has to be printable and short (zod checks its shape). */
const ID_QUERY = new Set(['planetId', 'as']);

function checkParams(params: Record<string, unknown>): void {
  for (const [name, v] of Object.entries(params)) {
    if (typeof v !== 'string' || (name === 'pair' ? !isPairId(v) : !isSafeId(v))) bad(name); // orderId may be a sim ref (`market-order:<colony>:<n>`): `:` is allowed
  }
}

function checkQuery(query: Record<string, unknown>): void {
  for (const [name, v] of Object.entries(query)) {
    if (CONTROL_RE.test(name) || name.length > 64) bad(`query key`);
    for (const item of Array.isArray(v) ? v : [v]) {
      if (typeof item !== 'string') continue; // nested objects are left to the zod schemas (strict)
      if (CONTROL_RE.test(item) || item.length > QUERY_MAX) bad(name);
      if (ID_QUERY.has(name) && item !== '' && !isSafeId(item)) bad(name);
      if (name === 'pair' && item !== '' && !isPairId(item)) bad(name);
      if (name === 'pairs') for (const p of item.split(',').filter(Boolean)) if (!isPairId(p)) bad(name);
    }
  }
}

/**
 * Strict validation of every path and query identifier of `/v1/trade/*` and `/v1/market/*` before any handler or database call:
 * a NUL byte or an overlong id never reaches Postgres (22021 used to answer 500). Fails as 400 `invalid_request`.
 */
@Injectable()
export class TradeInputGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestLike>();
    if (req.params) checkParams(req.params);
    if (req.query) checkQuery(req.query);
    return true;
  }
}
