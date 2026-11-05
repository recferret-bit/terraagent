import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { ActorKind, BookLevel, FillPolicy, MarketPrice, OrderSide, OrderState, TradeView } from './orders';
import { AtomicAmount, MarketTokenKey, PairId, QuoteToken } from './tokens';

/** Book depth of one pair (top levels per side; best first). Payload of the `market.book` push (debounced 1 Hz/pair). */
export const MarketBookPayload = z.object({
  planetId: z.string().min(1),
  pair: PairId,
  bids: z.array(BookLevel),
  asks: z.array(BookLevel),
  last: TradeView.optional(),
  /** Monotonic per planet+pair; a client drops a push older than the one it shows. */
  seq: z.number().int().nonnegative(),
});
export type MarketBookPayload = z.infer<typeof MarketBookPayload>;

/** Payload of the `market.trade` push: one finalized settlement. */
export const MarketTradePayload = z.object({ planetId: z.string().min(1), trade: TradeView });
export type MarketTradePayload = z.infer<typeof MarketTradePayload>;

/** One of the caller's orders (REST `myOrders`). */
export const MyOrderView = z.object({
  orderId: z.string().min(1),
  ref: z.string().min(1),
  pair: PairId,
  side: OrderSide,
  resource: ResourceKey,
  amount: z.number().int().positive(),
  filled: z.number().int().nonnegative(),
  price: MarketPrice,
  state: OrderState,
  fillPolicy: FillPolicy,
  policyVersion: z.string().min(1),
  platformFeeBp: z.number().int().min(0).max(10_000),
  stallFeeBp: z.number().int().min(0).max(10_000),
  /** Reserved principal + fees still held for this order (quote atomic for buys, base units for sells). */
  reserved: AtomicAmount,
  expiresAtMs: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
});
export type MyOrderView = z.infer<typeof MyOrderView>;

/** Price-board row of one pair (W13-18). `insufficient_data` and other reasons are explicit, never a made-up price. */
export const PriceBoardRow = z.object({
  pair: PairId,
  last: z.object({ num: AtomicAmount, den: z.number().int().positive() }).nullable(),
  change24hBp: z.number().int().nullable(),
  volume24h: z.number().int().nonnegative(),
  vwap: z.object({ num: AtomicAmount, den: z.number().int().positive() }).nullable(),
  candles1h: z.array(z.object({ t: z.number().int(), o: z.string(), h: z.string(), l: z.string(), c: z.string(), v: z.number().int() })),
  classification: z.enum(['organic', 'fixture', 'mixed', 'insufficient_data']),
  reason: z.string().optional(),
  eligibleVolume: z.number().int().nonnegative().optional(),
  counterparties: z.number().int().nonnegative().optional(),
  /** Largest share one counterparty takes in organic volume (bp of 2x volume: each trade has two sides). */
  concentrationBp: z.number().int().nonnegative().optional(),
});
export type PriceBoardRow = z.infer<typeof PriceBoardRow>;

/** The fee/size policy the server pins on new orders (from the compiled market profile, W13-03). */
export const MarketPolicyView = z.object({
  policyVersion: z.string().min(1),
  policyHash: z.string().min(1),
  platformFeeBp: z.number().int().min(0).max(10_000),
  stallFeeMaxBp: z.number().int().min(0).max(10_000),
  stallFeeDefaultBp: z.number().int().min(0).max(10_000),
  ttlOptionsS: z.array(z.number().int().positive()),
  openOrderLimit: z.number().int().positive(),
  minNotional: z.partialRecord(QuoteToken, AtomicAmount),
});
export type MarketPolicyView = z.infer<typeof MarketPolicyView>;

/** `GET /v1/market/{planetId}` (W13-19): book snapshot + board, plus the caller's orders and balances when authenticated. */
export const MarketSnapshotResponse = z.object({
  planetId: z.string().min(1),
  books: z.array(MarketBookPayload),
  board: z.array(PriceBoardRow),
  recentTrades: z.array(TradeView),
  policy: MarketPolicyView.optional(),
  myOrders: z.array(MyOrderView).optional(),
  /** Free verifier + cargo-account balances of the caller's colony, market atomic units (mock tokens labelled). */
  balances: z.partialRecord(MarketTokenKey, AtomicAmount).optional(),
  reserved: z.partialRecord(MarketTokenKey, AtomicAmount).optional(),
  stall: z.object({ hubFeeBp: z.number().int().min(0).max(10_000), earned: z.partialRecord(MarketTokenKey, AtomicAmount) }).optional(),
  actorKind: ActorKind.optional(),
});
export type MarketSnapshotResponse = z.infer<typeof MarketSnapshotResponse>;
