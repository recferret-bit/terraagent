import type { MarketBookPayload, MarketSnapshotResponse, MarketTradePayload, TradeView } from '@terra/contracts';

export const TRADES_KEPT = 50;

/**
 * What the Market tab shows, as plain data: the newest book per pair and the recent FINAL trades. A `market.book` push older
 * than the book on screen (`seq`) is dropped; a snapshot never replaces a newer push. No DOM, no network.
 */
export class MarketState {
  private readonly books = new Map<string, MarketBookPayload>();
  private tradeList: TradeView[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly planetId: () => string | null) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private mine(planetId: string): boolean {
    const id = this.planetId();
    return id === null || id === planetId;
  }

  book(pair: string): MarketBookPayload | undefined {
    return this.books.get(pair);
  }

  trades(pair?: string): readonly TradeView[] {
    return pair ? this.tradeList.filter((t) => t.pair === pair) : this.tradeList;
  }

  /** Pairs that have resting orders right now. */
  activePairs(): string[] {
    return [...this.books].filter(([, b]) => b.bids.length + b.asks.length > 0).map(([p]) => p);
  }

  applyBook(p: MarketBookPayload): boolean {
    if (!this.mine(p.planetId)) return false;
    const cur = this.books.get(p.pair);
    if (cur && p.seq < cur.seq) return false;
    this.books.set(p.pair, p);
    this.emit();
    return true;
  }

  applyTrade(p: MarketTradePayload): boolean {
    if (!this.mine(p.planetId) || this.tradeList.some((t) => t.tradeId === p.trade.tradeId)) return false;
    this.tradeList = [p.trade, ...this.tradeList].sort((a, b) => b.atMs - a.atMs).slice(0, TRADES_KEPT);
    this.emit();
    return true;
  }

  applySnapshot(s: MarketSnapshotResponse): void {
    if (!this.mine(s.planetId)) return;
    const fresh = new Set(s.books.map((b) => b.pair));
    for (const [pair, cur] of this.books) if (!fresh.has(pair) && cur.seq === 0) this.books.delete(pair);
    for (const b of s.books) {
      const cur = this.books.get(b.pair);
      if (!cur || b.seq >= cur.seq) this.books.set(b.pair, b);
    }
    const known = new Set(this.tradeList.map((t) => t.tradeId));
    this.tradeList = [...this.tradeList, ...s.recentTrades.filter((t) => !known.has(t.tradeId))].sort((a, b) => b.atMs - a.atMs).slice(0, TRADES_KEPT);
    this.emit();
  }
}
