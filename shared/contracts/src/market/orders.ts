import { z } from 'zod';
import { ResourceKey } from '../ws/sim';
import { AtomicAmount, PairId, QuoteToken } from './tokens';

/** `buy` / `sell` always refers to the pair's base resource. */
export const OrderSide = z.enum(['buy', 'sell']);
export type OrderSide = z.infer<typeof OrderSide>;

/**
 * A limit price as the **total quote amount for the order's full base amount** (W13-01 decision, recorded in
 * `docs/questions-and-limitations/economy-ledger.md`): "300 water for 10 USDC" is `amount: 300, price: {token: 'USDC',
 * amount: '10000000'}`. The unit limit price is the exact rational `price.amount / amount` (quote atomic per whole base
 * unit); priority and crossing compare these rationals by cross-multiplication, never floats. A fill of `q` base units
 * at the maker's price has notional `floor(q × maker.price.amount / maker.amount)` with cumulative rounding per order
 * (ECONOMY §3), so the unsplit fill and any split of it cost the same.
 */
export const MarketPrice = z.strictObject({ token: QuoteToken, amount: AtomicAmount });
export type MarketPrice = z.infer<typeof MarketPrice>;

/** Order states persisted in `chain.market_order` (DATA_MODEL). `PENDING` = accepted by the sim, not yet reserved. */
export const ORDER_STATES = ['PENDING', 'OPEN', 'PARTIAL', 'MATCHED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'] as const;
export const OrderState = z.enum(ORDER_STATES);
export type OrderState = z.infer<typeof OrderState>;

/** Trade (settlement) states persisted in `chain.intent_trade`. `UNKNOWN` = ambiguous chain outcome, quarantined. */
export const TRADE_STATES = ['PENDING', 'SUBMITTED', 'FINAL', 'FAILED', 'UNKNOWN'] as const;
export const TradeState = z.enum(TRADE_STATES);
export type TradeState = z.infer<typeof TradeState>;

/** Custodial colony accounts allow partial fills; claimed accounts use all-or-nothing orders (D-44). */
export const FillPolicy = z.enum(['partial', 'all_or_nothing']);
export type FillPolicy = z.infer<typeof FillPolicy>;

/** Who funded/placed an order: organic-price metrics count only `player` fills between unrelated colonies (D-44). */
export const ActorKind = z.enum(['player', 'bot', 'npc', 'guild', 'fixture', 'subsidy']);
export type ActorKind = z.infer<typeof ActorKind>;

// --- deterministic ids (opIds / refs; NEAR §1a rule 6: derived from the game fact, never random) -------------------
/** Sim-assigned order reference; the server's order id is derived from it, so a replayed event is idempotent. */
export const marketOrderRef = (colonyId: string, orderSeq: number): string => `market-order:${colonyId}:${orderSeq}`;
/** Outbox op of the automatic deposit to the verifier when an order is placed (W13-09). */
export const marketDepositOpId = (orderRef: string): string => `market-deposit:${orderRef}`;
/** Outbox op of one trade's settlement batch (W13-13). */
export const marketTradeOpId = (tradeId: string): string => `trade:${tradeId}`;
/** Outbox op of the auto-withdraw before a `cargo.import` (W13-16). */
export const marketWithdrawOpId = (colonyId: string, importSeq: number): string => `market-withdraw:${colonyId}:${importSeq}`;

/** One level of an aggregated book side (top N levels; `price` is the level's total-quote/base rational). */
export const BookLevel = z.object({
  /** Unit price as an exact rational: quote atomic `num` per `den` whole base units. */
  num: AtomicAmount,
  den: z.number().int().positive(),
  amount: z.number().int().nonnegative(),
  orders: z.number().int().positive(),
});
export type BookLevel = z.infer<typeof BookLevel>;

export const TradeView = z.object({
  tradeId: z.string().min(1),
  pair: PairId,
  base: ResourceKey,
  quote: QuoteToken,
  amount: z.number().int().positive(),
  notional: AtomicAmount,
  platformFee: AtomicAmount,
  stallFee: AtomicAmount,
  stallFeeBp: z.number().int().min(0).max(10_000),
  makerSide: OrderSide,
  state: TradeState,
  organic: z.boolean().optional(),
  actorKind: ActorKind.optional(),
  txHash: z.string().optional(),
  atMs: z.number().int().nonnegative(),
});
export type TradeView = z.infer<typeof TradeView>;

/** Common fields of a settled-trade summary (`market.settled` sim command and `tradeSettled` event, W13-02). */
export const SettledTradeFields = {
  base: ResourceKey,
  amount: z.number().int().positive(),
  quote: QuoteToken,
  notional: AtomicAmount,
  platformFee: AtomicAmount,
  stallFee: AtomicAmount,
  stallFeeBp: z.number().int().min(0).max(10_000),
  makerSide: OrderSide,
  stallName: z.string().max(64).optional(),
  txHash: z.string().max(128).optional(),
} as const;
