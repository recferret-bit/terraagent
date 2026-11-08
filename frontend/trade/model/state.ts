import type { BookLevel, MarketPolicyView, MarketBookPayload, PriceBoardRow, TradeBalancesResponse, TradeBookOrdersResponse, TradeBookResponse, TradeStallResponse, TradeFillView, TradeKeyView, TradeOrderView, TradeOverviewResponse, TradePairsResponse, TradeStreamEvent } from '@terra/contracts';

export type PairView = TradePairsResponse['pairs'][number];
export type PanelId = 'pairs' | 'policy' | 'book' | 'board' | 'orders' | 'fills' | 'balances' | 'keys' | 'overview' | 'bookOrders' | 'stall';
export type PanelStatus = { readonly status: 'idle' | 'loading' | 'ready' | 'error'; readonly error?: string };
export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'no_colony';

export interface TopOfBook { readonly bid: BookLevel | null; readonly ask: BookLevel | null }

export interface TradeState {
  readonly planetId: string;
  readonly pair: string;
  readonly pairs: readonly PairView[];
  readonly policy: MarketPolicyView | null;
  readonly book: TradeBookResponse | null;
  readonly board: readonly PriceBoardRow[];
  readonly orders: readonly TradeOrderView[];
  readonly fills: readonly TradeFillView[];
  readonly balances: TradeBalancesResponse | null;
  /** Every resting order of the selected pair (public list). */
  readonly bookOrders: TradeBookOrdersResponse | null;
  /** The caller's stall (hub fee, earned fees); null without a colony here. */
  readonly stall: TradeStallResponse | null;
  readonly keys: readonly TradeKeyView[];
  /** Best bid/ask per pair of the planet (all-pairs overview). */
  readonly top: Readonly<Record<string, TopOfBook>>;
  readonly conn: ConnState;
  readonly panels: Readonly<Record<PanelId, PanelStatus>>;
}

export const PANEL_IDS: readonly PanelId[] = ['pairs', 'policy', 'book', 'board', 'orders', 'fills', 'balances', 'keys', 'overview', 'bookOrders', 'stall'];

export function initialState(planetId: string, pair: string): TradeState {
  const panels = Object.fromEntries(PANEL_IDS.map((id) => [id, { status: 'idle' } as PanelStatus])) as Record<PanelId, PanelStatus>;
  return { planetId, pair, pairs: [], policy: null, book: null, board: [], orders: [], fills: [], balances: null, bookOrders: null, stall: null, keys: [], top: {}, conn: 'connecting', panels };
}

export const setPanel = (s: TradeState, id: PanelId, p: PanelStatus): TradeState => ({ ...s, panels: { ...s.panels, [id]: p } });

const topOf = (b: { bids: readonly BookLevel[]; asks: readonly BookLevel[] }): TopOfBook => ({ bid: b.bids[0] ?? null, ask: b.asks[0] ?? null });

/** The one-request planet overview: replaces the best bid / ask of every listed pair (a stale answer for another planet is dropped). */
export function applyOverview(s: TradeState, o: TradeOverviewResponse): TradeState {
  if (o.planetId !== s.planetId) return s;
  return { ...s, top: { ...s.top, ...Object.fromEntries(o.overview.map((r) => [r.pair, { bid: r.bestBid, ask: r.bestAsk }])) } };
}

/** A full book fetched over REST. Never replaces a newer pushed book of the same pair. */
export function applyBookSnapshot(s: TradeState, book: TradeBookResponse): TradeState {
  const top = { ...s.top, [book.pair]: topOf(book) };
  if (book.pair !== s.pair) return { ...s, top };
  if (s.book && s.book.pair === book.pair && s.book.planetId === book.planetId && book.seq < s.book.seq) return { ...s, top };
  return { ...s, book, top };
}

/** A `book` push: drops one older than what is shown (`seq` is monotonic per planet and pair). */
export function applyBookPush(s: TradeState, p: MarketBookPayload): TradeState {
  if (p.planetId !== s.planetId) return s;
  const top = { ...s.top, [p.pair]: topOf(p) };
  if (p.pair !== s.pair) return { ...s, top };
  if (s.book && s.book.pair === p.pair && p.seq < s.book.seq) return { ...s, top };
  return { ...s, top, book: { planetId: p.planetId, pair: p.pair, seq: p.seq, bids: p.bids, asks: p.asks, reference: s.book?.pair === p.pair ? s.book.reference : null } };
}

/** Insert or replace by orderId; newest first. */
export function applyOrder(s: TradeState, o: TradeOrderView): TradeState {
  if (o.planetId !== s.planetId) return s;
  const rest = s.orders.filter((x) => x.orderId !== o.orderId);
  return { ...s, orders: [o, ...rest].sort((a, b) => b.createdAtMs - a.createdAtMs) };
}

/** Prepend a fill unless this (trade, order) pair is already listed. */
export function applyFill(s: TradeState, f: TradeFillView): TradeState {
  if (s.fills.some((x) => x.tradeId === f.tradeId && x.orderId === f.orderId)) {
    return { ...s, fills: s.fills.map((x) => (x.tradeId === f.tradeId && x.orderId === f.orderId ? f : x)) };
  }
  return { ...s, fills: [f, ...s.fills].sort((a, b) => b.atMs - a.atMs) };
}

export function applyStreamEvent(s: TradeState, e: TradeStreamEvent): TradeState {
  switch (e.type) {
    case 'order': return applyOrder(s, e.order);
    case 'fill': return e.planetId === s.planetId ? applyFill(s, e.fill) : s;
    case 'book': return applyBookPush(s, e.book);
    case 'hello': return e.planetId === s.planetId ? { ...s, conn: 'live' } : s;
  }
}

export const isOpenState = (st: string): boolean => st === 'OPEN' || st === 'PARTIAL' || st === 'PENDING' || st === 'MATCHED';

export type OrderFilter = 'open' | 'filled' | 'cancelled' | 'expired' | 'all';
export function filterOrders(orders: readonly TradeOrderView[], f: OrderFilter): TradeOrderView[] {
  switch (f) {
    case 'open': return orders.filter((o) => isOpenState(o.state));
    case 'filled': return orders.filter((o) => o.state === 'FILLED' || (o.filled > 0 && !isOpenState(o.state)));
    case 'cancelled': return orders.filter((o) => o.state === 'CANCELLED' || o.state === 'REJECTED');
    case 'expired': return orders.filter((o) => o.state === 'EXPIRED');
    case 'all': return [...orders];
  }
}

/** Cancellable = resting on the book (OPEN or PARTIAL). */
export const cancellable = (orders: readonly TradeOrderView[]): TradeOrderView[] => orders.filter((o) => o.state === 'OPEN' || o.state === 'PARTIAL');

/** Free units / quote for the ticket checks; null when balances are not loaded. */
export function freeOf(b: TradeBalancesResponse | null, token: string): bigint | null {
  if (!b) return null;
  const q = (b.quote as Record<string, { free: string } | undefined>)[token] ?? (b.inOrbit as Record<string, { free: string } | undefined>)[token];
  return q ? BigInt(q.free) : 0n;
}
