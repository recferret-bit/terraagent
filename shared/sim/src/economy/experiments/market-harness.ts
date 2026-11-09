import { isResourceToken, type MarketTokenKey, type ResourceKey } from '@terra/contracts';
import { canonical } from '../../data/_hash';
import { buildTradeBatch, type BatchOrder, type TradeBatch, type TreasuryTerms } from '../../systems/trade/market-batch';
import { OrderBook } from '../../systems/trade/market-book';
import { maxBuyerSpend } from '../../systems/trade/market-fees';
import { matchIncoming, type Fill, type MatchableOrder } from '../../systems/trade/market-matcher';
import { planParties, type SettleParty } from '../../systems/trade/market-parties';
import { sha256Hex } from '../sha256';

/**
 * In-memory market harness (W13-44): the isolated mock port of the market module. It runs the SAME pure functions the
 * server uses (`matchIncoming`, `buildTradeBatch`, `planParties`) against a mock ledger held in memory, so an experiment
 * never touches Postgres, the verifier or any chain. Nothing here reads a clock or a random source; the caller passes
 * the tick.
 */

/** The `marketOrderRequested` fields the harness needs (what the sim emits after `market.placeOrder`). */
export interface OrderRequest {
  readonly ref: string;
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly side: 'buy' | 'sell';
  readonly resource: ResourceKey;
  readonly amount: number;
  readonly price: { readonly token: string; readonly amount: string };
  readonly ttlS: number;
  readonly stallFeeBp: number;
  readonly maxStallFeeBp?: number;
}

export interface HarnessConfig {
  readonly policyVersion: string;
  readonly platformFeeBp: number;
  readonly stallFeeMaxBp: number;
  readonly openOrderLimit: number;
  readonly treasury: TreasuryTerms;
  readonly ticksPerSecond: number;
  /** Prefix of every trade id (`<scenario>:<seed>`), so ids are deterministic and unique per run. */
  readonly tradeIdPrefix: string;
}

export interface HarnessOrder extends MatchableOrder, BatchOrder {
  readonly ref: string;
  readonly colonyIndex: number;
  readonly base: ResourceKey;
  readonly quote: string;
  readonly state: 'OPEN' | 'FILLED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  readonly expiresAtTick: number;
}

export interface HarnessTrade {
  readonly batch: TradeBatch;
  readonly fill: Fill;
  readonly parties: SettleParty[];
  readonly atTick: number;
}

export interface PlaceOutcome {
  readonly order: HarnessOrder;
  readonly rejected?: { readonly code: 'insufficient_cargo' | 'order_limit' | 'invalid_args'; readonly detail: string };
  /** In-orbit units the sim mirror reserves for the new order (`market.reserve`). */
  readonly reserve: Partial<Record<ResourceKey, number>>;
  readonly trades: HarnessTrade[];
}

export interface ExpiredOutcome {
  readonly order: HarnessOrder;
  readonly released: Partial<Record<ResourceKey, number>>;
}

export const platformAccountId = 'acct:platform';
export const colonyAccountId = (colonyId: string): string => `acct:${colonyId}`;
const balanceKey = (account: string, token: string): string => `${account}\u0000${token}`;

export class MarketHarness {
  private readonly books = new Map<string, OrderBook<HarnessOrder>>();
  private readonly orders = new Map<string, HarnessOrder>();
  private readonly balances = new Map<string, bigint>();
  private seq = 0n;
  private tradeSeq = 0;
  /** Mock faucet totals per token: the only way value enters the harness (reconciliation input). */
  readonly funded = new Map<string, bigint>();
  readonly trades: HarnessTrade[] = [];
  /** Counts for the fill-ratio metric. */
  placed = 0;
  rejected = 0;
  expired = 0;

  constructor(readonly config: HarnessConfig) {}

  /** Mock faucet (fixture funding): credits `amount` of `token` to the colony's account. */
  fund(colonyId: string, token: string, amount: bigint): void {
    this.credit(colonyAccountId(colonyId), token, amount);
    this.funded.set(token, (this.funded.get(token) ?? 0n) + amount);
  }

  balanceOf(account: string, token: string): bigint {
    return this.balances.get(balanceKey(account, token)) ?? 0n;
  }

  private credit(account: string, token: string, delta: bigint): void {
    const key = balanceKey(account, token);
    const next = (this.balances.get(key) ?? 0n) + delta;
    this.balances.set(key, next);
  }

  /** Quote tokens locked by the colony's open orders. */
  reservedOf(colonyId: string, token: string): bigint {
    let sum = 0n;
    for (const o of this.orders.values()) if (o.state === 'OPEN' && o.colonyId === colonyId && o.side === 'buy' && o.quote === token) sum += o.reservedPrincipal + o.reservedFees;
    return sum;
  }

  /** Quote tokens the colony can still lock. */
  freeQuote(colonyId: string, token: string): bigint {
    return this.balanceOf(colonyAccountId(colonyId), token) - this.reservedOf(colonyId, token);
  }

  /** Sum of every account's balance of `token` (a conserved total: only the faucet changes it). */
  totalOf(token: string): bigint {
    let sum = 0n;
    for (const [k, v] of this.balances) if (k.endsWith(`\u0000${token}`)) sum += v;
    return sum;
  }

  openOrders(colonyId?: string): HarnessOrder[] {
    return [...this.orders.values()].filter((o) => o.state === 'OPEN' && (colonyId === undefined || o.colonyId === colonyId));
  }

  private bookOf(pair: string): OrderBook<HarnessOrder> {
    let b = this.books.get(pair);
    if (!b) this.books.set(pair, (b = new OrderBook<HarnessOrder>(pair)));
    return b;
  }

  /** The pair's book (read only use: depth for behaviours and metrics). */
  book(base: string, quote: string): OrderBook<HarnessOrder> {
    return this.bookOf(`${base}/${quote}`);
  }

  private reject(order: HarnessOrder, code: 'insufficient_cargo' | 'order_limit' | 'invalid_args', detail: string): PlaceOutcome {
    const rejected: HarnessOrder = { ...order, state: 'REJECTED', reservedPrincipal: 0n, reservedFees: 0n };
    this.orders.set(rejected.orderId, rejected);
    this.rejected++;
    return { order: rejected, rejected: { code, detail }, reserve: {}, trades: [] };
  }

  /** Mirrors `PlaceOrderService.place` then `matchAndHand`: reserve funds, rest the order, match, settle every fill. */
  handleRequested(req: OrderRequest, tick: number): PlaceOutcome {
    const cfg = this.config;
    const quote = req.price.token;
    const priceAmount = BigInt(req.price.amount);
    const amount = BigInt(req.amount);
    const maxStall = req.maxStallFeeBp ?? cfg.stallFeeMaxBp;
    const account = colonyAccountId(req.colonyId);
    const base: HarnessOrder = {
      orderId: `mo:${req.ref}`, seq: ++this.seq, side: req.side, colonyId: req.colonyId, amount, filled: 0n, priceAmount,
      fillPolicy: 'partial', policyVersion: cfg.policyVersion, platformFeeBp: cfg.platformFeeBp, stallFeeBp: req.stallFeeBp,
      maxStallFeeBp: req.side === 'buy' ? maxStall : null, accountId: account, stallColonyId: req.colonyId, stallAccountId: account,
      platformAccountId: platformAccountId, feeBuckets: {}, cumNotional: 0n, reservedPrincipal: 0n, reservedFees: 0n,
      ref: req.ref, colonyIndex: req.colonyIndex, base: req.resource, quote, state: 'OPEN',
      expiresAtTick: tick + req.ttlS * cfg.ticksPerSecond,
    };
    this.placed++;
    if (amount <= 0n || priceAmount <= 0n) return this.reject(base, 'invalid_args', 'amount and price must be positive');
    if (this.openOrders(req.colonyId).length >= cfg.openOrderLimit) return this.reject(base, 'order_limit', `At most ${cfg.openOrderLimit} open orders.`);
    const fees = req.side === 'buy' ? maxBuyerSpend(priceAmount, cfg.platformFeeBp, maxStall) - priceAmount : 0n;
    const principal = req.side === 'buy' ? priceAmount : amount;
    if (req.side === 'buy' && !isResourceToken(quote as MarketTokenKey)) {
      const free = this.freeQuote(req.colonyId, quote);
      if (free < principal + fees) return this.reject(base, 'insufficient_cargo', `Need ${principal + fees} ${quote}, ${free} free.`);
    }
    const order: HarnessOrder = { ...base, reservedPrincipal: principal, reservedFees: fees };
    this.orders.set(order.orderId, order);
    const reserveToken = req.side === 'sell' ? req.resource : quote;
    const reserve = isResourceToken(reserveToken as MarketTokenKey) ? { [reserveToken]: Number(principal + fees) } : {};
    const trades = this.matchAndSettle(order, tick);
    return { order: this.orders.get(order.orderId)!, reserve, trades };
  }

  private matchAndSettle(incoming: HarnessOrder, tick: number): HarnessTrade[] {
    const book = this.bookOf(`${incoming.base}/${incoming.quote}`);
    const result = matchIncoming(book, incoming);
    const out: HarnessTrade[] = [];
    for (const fill of result.fills) out.push(this.settle(fill, tick));
    const after = this.orders.get(incoming.orderId)!;
    if (after.state === 'OPEN') book.add(after);
    return out;
  }

  private settle(fill: Fill, tick: number): HarnessTrade {
    const buyer = this.orders.get(fill.buyerOrderId)!;
    const seller = this.orders.get(fill.sellerOrderId)!;
    const maker = fill.makerSide === 'buy' ? buyer : seller;
    const tradeId = `${this.config.tradeIdPrefix}:t${++this.tradeSeq}`;
    const batch = buildTradeBatch({ tradeId, base: buyer.base, quote: buyer.quote, fill, buyer, seller, treasury: this.config.treasury });
    this.apply(batch);
    for (const [order, upd] of [[buyer, batch.buyer], [seller, batch.seller]] as const) {
      const next: HarnessOrder = {
        ...order, filled: upd.filled, cumNotional: upd.cumNotional, feeBuckets: upd.feeBuckets,
        reservedPrincipal: upd.reservedPrincipal, reservedFees: upd.reservedFees, state: upd.filled === order.amount ? 'FILLED' : 'OPEN',
      };
      this.orders.set(next.orderId, next);
      const book = this.bookOf(`${next.base}/${next.quote}`);
      if (next.state === 'OPEN' && book.has(next.orderId)) book.add(next);
      else if (next.state !== 'OPEN') book.remove(next.orderId);
    }
    const parties = planParties(batch, buyer, seller, maker);
    const trade: HarnessTrade = { batch, fill, parties, atTick: tick };
    this.trades.push(trade);
    return trade;
  }

  /** Applies a batch's legs to the mock ledger; a quote leg below zero is an invariant violation (never silently allowed). */
  private apply(batch: TradeBatch): void {
    for (const l of batch.legs) {
      this.credit(l.accountId, l.token, l.delta);
      if (!isResourceToken(l.token as MarketTokenKey) && this.balanceOf(l.accountId, l.token) < 0n) {
        throw new Error(`harness: ${l.accountId} would hold a negative ${l.token} balance after ${batch.tradeId}`);
      }
    }
  }

  /** Expires every open order whose TTL has passed; returns what the sim mirror must release. */
  expireDue(tick: number): ExpiredOutcome[] {
    const out: ExpiredOutcome[] = [];
    for (const o of [...this.orders.values()]) {
      if (o.state !== 'OPEN' || o.expiresAtTick > tick) continue;
      const token = o.side === 'sell' ? o.base : o.quote;
      const left = o.reservedPrincipal + o.reservedFees;
      const expired: HarnessOrder = { ...o, state: 'EXPIRED', reservedPrincipal: 0n, reservedFees: 0n };
      this.orders.set(o.orderId, expired);
      this.bookOf(`${o.base}/${o.quote}`).remove(o.orderId);
      this.expired++;
      out.push({ order: expired, released: isResourceToken(token as MarketTokenKey) && left > 0n ? { [token]: Number(left) } : {} });
    }
    return out;
  }

  /** Canonical digest of orders and balances: part of the run's state hash. */
  digest(): string {
    const orders = [...this.orders.values()].sort((a, b) => (a.seq < b.seq ? -1 : 1)).map((o) => ({
      id: o.orderId, state: o.state, filled: o.filled.toString(), amount: o.amount.toString(), cum: o.cumNotional.toString(),
      rp: o.reservedPrincipal.toString(), rf: o.reservedFees.toString(),
    }));
    const balances = [...this.balances.entries()].filter(([, v]) => v !== 0n).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.toString()]);
    return `sha256:${sha256Hex(canonical({ orders, balances, trades: this.trades.map((t) => t.batch.batchHash) }))}`;
  }
}
