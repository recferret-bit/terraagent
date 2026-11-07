import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { ActorKind, BookLevel, FillPolicy, MarketPrice, OrderSide, OrderState, TradeView } from './orders';
import { AtomicAmount, MarketTokenKey, PairId } from './tokens';
import { MarketBookPayload, MarketPolicyView, MyOrderView, PriceBoardRow } from './views';

/**
 * Trade API (W13): REST + SSE for humans (session / dev identity, actor `player`) and bots (API key, actor `bot`).
 * Every schema here is the wire shape; `TRADE_API_ROUTES` is the table clients (and an OpenAPI generator) are built from.
 * Mutating routes take an `Idempotency-Key` header; errors are `{ error: { code, message, details? } }` with a stable `code`.
 */

export const TRADE_SCOPES = ['read', 'trade', 'manage'] as const;
export const TradeScope = z.enum(TRADE_SCOPES);
export type TradeScope = z.infer<typeof TradeScope>;

/** Prefix of every API key secret (`ta_bot_<keyId>_<random>`); the server tells keys from session tokens by it. */
export const TRADE_KEY_PREFIX = 'ta_bot_';

/** Codes owned by the trade API; sim rejections (`insufficient_cargo`, `order_limit`, ...) pass through as their own `RejectCode`. */
export const TRADE_ERROR_CODES = [
  'unauthorized', 'forbidden_scope', 'key_revoked', 'wave_disabled', 'rate_limited', 'invalid_request', 'no_colony',
  'idempotency_key_required', 'idempotency_key_reuse', 'order_not_found', 'wrong_planet',
  'kill_switch', 'pair_not_allowed', 'max_open_orders', 'max_order_notional', 'daily_budget_exceeded', 'price_out_of_band', 'key_not_found', 'order_not_open', 'fill_policy_not_allowed', 'fee_out_of_range',
] as const;
export const TradeErrorCode = z.enum(TRADE_ERROR_CODES);
export type TradeErrorCode = z.infer<typeof TradeErrorCode>;

export const TradeApiError = z.object({
  error: z.object({ code: z.string().min(1), message: z.string(), details: z.record(z.string(), z.unknown()).optional() }),
});
export type TradeApiError = z.infer<typeof TradeApiError>;

// --- keys and allowance ------------------------------------------------------------------------------------------
export const TradeAllowance = z.strictObject({
  maxOpenOrders: z.number().int().min(0).max(1000),
  /** Largest single order's total quote (quote atomic). */
  maxOrderNotional: AtomicAmount,
  /** Quote atomic the key may commit per UTC day: open/pending orders count in full before any fill, ended orders count what filled. */
  dailyBudget: AtomicAmount,
  allowedPairs: z.array(PairId).max(200),
  /** Max distance of the order's unit price from the organic reference price (bp); null = no band. Skipped while no reference exists. */
  priceBandBp: z.number().int().min(0).max(100_000).nullable(),
  killSwitch: z.boolean(),
});
export type TradeAllowance = z.infer<typeof TradeAllowance>;
export const TradeAllowanceUpdate = TradeAllowance.partial();
export type TradeAllowanceUpdate = z.infer<typeof TradeAllowanceUpdate>;

export const CreateTradeKeyRequest = z.strictObject({
  planetId: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  scopes: z.array(TradeScope).min(1).default(['read', 'trade']),
  allowance: TradeAllowanceUpdate.optional(),
  ratePerSecond: z.number().int().min(1).max(1000).optional(),
  rateBurst: z.number().int().min(1).max(5000).optional(),
});
export type CreateTradeKeyRequest = z.infer<typeof CreateTradeKeyRequest>;

export const TradeKeyView = z.object({
  keyId: z.string().min(1),
  label: z.string(),
  planetId: z.string(),
  colonyId: z.string(),
  accountId: z.string(),
  scopes: z.array(TradeScope),
  ratePerSecond: z.number().int().nullable(),
  rateBurst: z.number().int().nullable(),
  createdAtMs: z.number().int(),
  lastUsedAtMs: z.number().int().nullable(),
  revokedAtMs: z.number().int().nullable(),
  allowance: TradeAllowance,
  /** Usage (optional, present on `GET /v1/trade/keys` and key mutations): quote atomic committed today (UTC day; same count as the `dailyBudget` check), the budget left, and the key's colony's open + in-flight orders. */
  dailySpent: AtomicAmount.optional(),
  dailyRemaining: AtomicAmount.optional(),
  openOrders: z.number().int().nonnegative().optional(),
});
export type TradeKeyView = z.infer<typeof TradeKeyView>;
/** The secret is returned exactly once, here. */
export const CreateTradeKeyResponse = TradeKeyView.extend({ secret: z.string().startsWith(TRADE_KEY_PREFIX) });
export type CreateTradeKeyResponse = z.infer<typeof CreateTradeKeyResponse>;
export const TradeKeyListResponse = z.object({ keys: z.array(TradeKeyView) });
export type TradeKeyListResponse = z.infer<typeof TradeKeyListResponse>;
export const RevokeTradeKeyResponse = z.object({ keyId: z.string(), revoked: z.literal(true), cancelledUnsubmitted: z.number().int(), cancelRequested: z.number().int() });
export type RevokeTradeKeyResponse = z.infer<typeof RevokeTradeKeyResponse>;

// --- orders ------------------------------------------------------------------------------------------------------
export const PlaceTradeOrderRequest = z.strictObject({
  /** Required for session callers; a key is bound to one planet and rejects a different value (`wrong_planet`). */
  planetId: z.string().min(1).max(64).optional(),
  side: OrderSide,
  resource: ResourceKey,
  amount: z.number().int().positive().max(1_000_000_000),
  price: MarketPrice,
  ttlS: z.number().int().positive().max(7 * 86_400),
  maxStallFeeBp: z.number().int().min(0).max(10_000).optional(),
  /** Default `partial`. `all_or_nothing` is accepted by the schema but the sim `market.placeOrder` command has no such argument yet: the server answers `invalid_request` until it does. */
  fillPolicy: FillPolicy.optional(),
});
export type PlaceTradeOrderRequest = z.infer<typeof PlaceTradeOrderRequest>;

export const TradeOrderView = MyOrderView.extend({ planetId: z.string(), actorKind: ActorKind, lastError: z.string().nullable() });
export type TradeOrderView = z.infer<typeof TradeOrderView>;

/** `accepted`: order exists (resting, partly or fully filled); `pending`: handed to the sim, outcome not known yet (poll `GET /orders`); `rejected`: `error` says why. */
export const TradeRequestStatus = z.enum(['accepted', 'pending', 'rejected']);
export const PlaceTradeOrderResponse = z.object({
  requestId: z.string(),
  status: TradeRequestStatus,
  order: TradeOrderView.optional(),
  error: TradeApiError.shape.error.optional(),
});
export type PlaceTradeOrderResponse = z.infer<typeof PlaceTradeOrderResponse>;

export const CancelTradeOrderResponse = z.object({
  requestId: z.string(),
  status: z.enum(['cancelled', 'pending', 'rejected']),
  order: TradeOrderView.optional(),
  error: TradeApiError.shape.error.optional(),
});
export type CancelTradeOrderResponse = z.infer<typeof CancelTradeOrderResponse>;

export const ListTradeOrdersQuery = z.object({
  planetId: z.string().min(1).optional(),
  state: z.union([OrderState, z.literal('open')]).optional(),
  pair: PairId.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTradeOrdersQuery = z.infer<typeof ListTradeOrdersQuery>;
export const TradeOrdersResponse = z.object({ orders: z.array(TradeOrderView) });
export type TradeOrdersResponse = z.infer<typeof TradeOrdersResponse>;

export const TradeFillView = TradeView.extend({ side: OrderSide, orderId: z.string(), counterpartyKind: ActorKind });
export type TradeFillView = z.infer<typeof TradeFillView>;
export const TradeFillsResponse = z.object({ fills: z.array(TradeFillView) });
export type TradeFillsResponse = z.infer<typeof TradeFillsResponse>;

// --- balances, book, board, pairs, policy ------------------------------------------------------------------------
export const TokenBalance = z.object({ free: AtomicAmount, reserved: AtomicAmount, total: AtomicAmount });
export type TokenBalance = z.infer<typeof TokenBalance>;
/** `quote` = USDC/NEAR (verifier balances); `inOrbit` = ONLY the caller's own colony cargo (whole units), reserved vs free. */
export const TradeBalancesResponse = z.object({
  planetId: z.string(),
  colonyId: z.string(),
  quote: z.partialRecord(MarketTokenKey, TokenBalance),
  inOrbit: z.partialRecord(ResourceKey, TokenBalance),
});
export type TradeBalancesResponse = z.infer<typeof TradeBalancesResponse>;

export const TradeBookResponse = z.object({
  planetId: z.string(), pair: PairId, seq: z.number().int().nonnegative(),
  bids: z.array(BookLevel), asks: z.array(BookLevel),
  reference: z.object({ num: AtomicAmount, den: z.number().int().positive() }).nullable(),
});
export type TradeBookResponse = z.infer<typeof TradeBookResponse>;

/** One resting order of a public book. No account, owner or reservation data; `colonyRef` is a per-planet pseudonym of the placing colony. */
export const TradeBookOrderView = z.object({
  orderId: z.string(),
  side: OrderSide,
  price: z.object({ num: AtomicAmount, den: z.number().int().positive() }),
  amount: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  actorKind: ActorKind,
  stallFeeBp: z.number().int().min(0).max(10_000),
  expiresAtMs: z.number().int(),
  fillPolicy: FillPolicy,
  colonyRef: z.string(),
  /** Only when the request was authenticated. */
  mine: z.boolean().optional(),
});
export type TradeBookOrderView = z.infer<typeof TradeBookOrderView>;
export const TradeBookOrdersQuery = z.object({
  side: OrderSide.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const TradeBookOrdersResponse = z.object({
  planetId: z.string(), pair: PairId, seq: z.number().int().nonnegative(),
  /** Best price first per side, bids then asks. */
  orders: z.array(TradeBookOrderView),
  /** True when `limit` cut the list. */
  truncated: z.boolean(),
});
export type TradeBookOrdersResponse = z.infer<typeof TradeBookOrdersResponse>;

export const TradeBoardResponse = z.object({ planetId: z.string(), board: z.array(PriceBoardRow) });
export type TradeBoardResponse = z.infer<typeof TradeBoardResponse>;

export const TradePairView = z.object({ pair: PairId, base: ResourceKey, quote: MarketTokenKey, lot: z.number().int().positive(), minNotionalAtomic: AtomicAmount });
export const TradePairsResponse = z.object({ pairs: z.array(TradePairView) });
export type TradePairsResponse = z.infer<typeof TradePairsResponse>;
export const TradePolicyResponse = z.object({ policy: MarketPolicyView, rateLimit: z.object({ perSecond: z.number(), burst: z.number() }) });
export type TradePolicyResponse = z.infer<typeof TradePolicyResponse>;

// --- push stream (SSE `GET /v1/trade/stream`) --------------------------------------------------------------------
export const TradeStreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('order'), order: TradeOrderView }),
  z.object({ type: z.literal('fill'), planetId: z.string(), fill: TradeFillView }),
  z.object({ type: z.literal('book'), book: MarketBookPayload }),
  z.object({ type: z.literal('hello'), planetId: z.string(), serverTimeMs: z.number().int() }),
]);
export type TradeStreamEvent = z.infer<typeof TradeStreamEvent>;


// --- agent quote (GET /v1/trade/agent/quote) -----------------------------------------------------------------------
const Rational = z.string().regex(/^\d+(\/[1-9]\d*)?$/, 'expected an integer or num/den');
const Units = z.string().regex(/^\d{1,15}$/, 'expected a non-negative integer');
/** Planning inputs the sim holds and the backend cannot see; all optional (unknown stays unknown and shows up as a reason code). */
export const AgentQuoteQuery = z.object({
  planetId: z.string().min(1).optional(),
  resource: ResourceKey,
  quote: MarketTokenKey.default('USDC'),
  ttlS: z.coerce.number().int().positive().max(7 * 86_400).default(3600),
  /** Whole units: planned consumption, reserve to keep for it, already available, and expected own production. */
  planned: Units.default('0'), reserve: Units.default('0'), available: Units.default('0'), expectedOwn: Units.default('0'),
  /** Target inventory (default: the current inventory, i.e. neutral scarcity) and units a sell must keep. */
  target: Units.optional(), keep: Units.default('0'),
  /** Quote atomic per unit as `n` or `num/den`; omitted = unmeasured (the matching side pauses with a reason). */
  ownUnitCost: Rational.optional(), transportPerUnit: Rational.optional(), localUnitCost: Rational.optional(),
  localMinutesPerUnit: Rational.optional(), minuteValue: Rational.optional(), needValue: Rational.optional(),
});
export type AgentQuoteQuery = z.infer<typeof AgentQuoteQuery>;

export const AgentSideQuote = z.object({
  /** Ready to POST to `/v1/trade/orders` (with an Idempotency-Key). */
  order: PlaceTradeOrderRequest,
  /** Quote atomic the colony must hold for a bid (principal + maximum fees + transport); 0 for asks. */
  maxSpend: AtomicAmount,
});
export const AgentQuoteResponse = z.object({
  planetId: z.string(), resource: ResourceKey, quote: MarketTokenKey,
  basis: z.enum(['organic', 'bootstrap_subsidy']).nullable(),
  mid: z.object({ num: AtomicAmount, den: AtomicAmount }).nullable(),
  bid: AgentSideQuote.nullable(), ask: AgentSideQuote.nullable(),
  /** Why a side is null (`no_reference`, `stale_reference`, `thin_reference`, `no_cash`, ...); empty when quoted. */
  bidReasons: z.array(z.string()), askReasons: z.array(z.string()),
  /** What the quote was computed from, so a strategy layer can log it. */
  inputs: z.object({ freeUnits: AtomicAmount, inventory: AtomicAmount, freeQuote: AtomicAmount, budgetLeft: AtomicAmount.nullable(), referenceAgeS: z.number().nullable(), eligibleVolume: z.number().nullable() }),
});
export type AgentQuoteResponse = z.infer<typeof AgentQuoteResponse>;

// --- stall (hub fee) ---------------------------------------------------------------------------------------------
export const PutTradeStallRequest = z.strictObject({ bp: z.number().int().min(0).max(10_000), planetId: z.string().min(1).max(64).optional() });
export type PutTradeStallRequest = z.infer<typeof PutTradeStallRequest>;
export const TradeStallQuery = z.strictObject({ planetId: z.string().min(1).max(64).optional() });
export type TradeStallQuery = z.infer<typeof TradeStallQuery>;
/** The caller's own Trade Hub stall: the fee it charges buyers on fills where it is the maker's stall, its policy range and what it earned (FINAL fills). */
export const TradeStallResponse = z.object({
  planetId: z.string(),
  hubFeeBp: z.number().int().min(0).max(10_000),
  minBp: z.number().int().min(0).max(10_000),
  maxBp: z.number().int().min(0).max(10_000),
  defaultBp: z.number().int().min(0).max(10_000),
  earned: z.partialRecord(MarketTokenKey, AtomicAmount),
});
export type TradeStallResponse = z.infer<typeof TradeStallResponse>;

// --- route table (client / OpenAPI generation) -------------------------------------------------------------------
export interface TradeRouteDef {
  readonly method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
  readonly path: string;
  /** `session`: session or dev identity (actor player); `key`: API key (actor bot); `either`: both. */
  readonly auth: 'session' | 'key' | 'either' | 'none';
  readonly scope?: TradeScope;
  readonly idempotent?: boolean;
  readonly summary: string;
  readonly request?: z.ZodType;
  readonly response: z.ZodType;
}

export const TRADE_API_ROUTES = {
  createKey: { method: 'POST', path: '/v1/trade/keys', auth: 'session', summary: 'Create an API key for the caller\'s colony (secret shown once)', request: CreateTradeKeyRequest, response: CreateTradeKeyResponse },
  listKeys: { method: 'GET', path: '/v1/trade/keys', auth: 'session', summary: 'List the caller\'s keys', response: TradeKeyListResponse },
  updateAllowance: { method: 'PATCH', path: '/v1/trade/keys/:keyId/allowance', auth: 'session', summary: 'Change a key\'s allowance / kill switch', request: TradeAllowanceUpdate, response: TradeKeyView },
  revokeKey: { method: 'DELETE', path: '/v1/trade/keys/:keyId', auth: 'session', summary: 'Revoke a key: unsubmitted orders are cancelled, open orders get a cancel request', response: RevokeTradeKeyResponse },
  placeOrder: { method: 'POST', path: '/v1/trade/orders', auth: 'either', scope: 'trade', idempotent: true, summary: 'Place a limit order (same sim reservation path as the game client)', request: PlaceTradeOrderRequest, response: PlaceTradeOrderResponse },
  cancelOrder: { method: 'DELETE', path: '/v1/trade/orders/:orderId', auth: 'either', scope: 'trade', idempotent: true, summary: 'Cancel one of the caller\'s open orders', response: CancelTradeOrderResponse },
  listOrders: { method: 'GET', path: '/v1/trade/orders', auth: 'either', scope: 'read', summary: 'The caller\'s orders (filter state, pair)', request: ListTradeOrdersQuery, response: TradeOrdersResponse },
  listFills: { method: 'GET', path: '/v1/trade/fills', auth: 'either', scope: 'read', summary: 'The caller\'s fills, newest first', response: TradeFillsResponse },
  balances: { method: 'GET', path: '/v1/trade/balances', auth: 'either', scope: 'read', summary: 'Quote balances and the caller\'s in-orbit cargo, reserved vs free', response: TradeBalancesResponse },
  book: { method: 'GET', path: '/v1/trade/book/:planetId/:pair', auth: 'none', summary: 'Book depth (query levels=N) and reference price', response: TradeBookResponse },
  bookOrders: { method: 'GET', path: '/v1/trade/book/:planetId/:pair/orders', auth: 'none', summary: 'Every resting order of a pair (query side, limit); with a bearer/dev identity each order carries `mine`', response: TradeBookOrdersResponse },
  board: { method: 'GET', path: '/v1/trade/board/:planetId', auth: 'none', summary: 'Price board of a planet', response: TradeBoardResponse },
  pairs: { method: 'GET', path: '/v1/trade/pairs', auth: 'none', summary: 'Tradable pairs', response: TradePairsResponse },
  policy: { method: 'GET', path: '/v1/trade/policy', auth: 'none', summary: 'Market policy and the rate limit of the caller', response: TradePolicyResponse },
  agentQuote: { method: 'GET', path: '/v1/trade/agent/quote', auth: 'either', scope: 'read', summary: 'Deterministic bid/ask for the caller\'s colony and one resource (quote library), with reason codes; bodies are ready to POST', request: AgentQuoteQuery, response: AgentQuoteResponse },
  getStall: { method: 'GET', path: '/v1/trade/stall', auth: 'session', summary: 'The caller\'s stall: own hub fee, allowed range, earned stall fees', request: TradeStallQuery, response: TradeStallResponse },
  setStall: { method: 'PUT', path: '/v1/trade/stall', auth: 'session', summary: 'Set the caller\'s Trade Hub stall fee (sim `market.setHubFee`); session only, API keys are refused; out of range is `fee_out_of_range`', request: PutTradeStallRequest, response: TradeStallResponse },
  stream: { method: 'GET', path: '/v1/trade/stream', auth: 'either', scope: 'read', summary: 'SSE stream of own order/fill events and book updates (query planetId, pairs)', response: TradeStreamEvent },
} as const satisfies Record<string, TradeRouteDef>;
export type TradeRouteName = keyof typeof TRADE_API_ROUTES;

/** Minimal OpenAPI 3.1 document of the trade API (`z.toJSONSchema` per schema); for client generation. */
export function tradeApiOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [name, r] of Object.entries(TRADE_API_ROUTES as Record<string, TradeRouteDef>)) {
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const headers = r.idempotent ? [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 80 } }] : [];
    (paths[path] ??= {})[r.method.toLowerCase()] = {
      operationId: name, summary: r.summary, parameters: headers,
      security: r.auth === 'none' ? [] : [{ bearer: [] }], ...(r.scope ? { 'x-scope': r.scope } : {}),
      ...(r.request && r.method !== 'GET' ? { requestBody: { content: { 'application/json': { schema: z.toJSONSchema(r.request, { io: 'input', unrepresentable: 'any' }) } } } } : {}),
      responses: { '200': { description: 'ok', content: { 'application/json': { schema: z.toJSONSchema(r.response, { unrepresentable: 'any' }) } } }, default: { description: 'error', content: { 'application/json': { schema: z.toJSONSchema(TradeApiError) } } } },
    };
  }
  return { openapi: '3.1.0', info: { title: 'TerraAgent trade API', version: '1' }, components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, paths };
}
