import type { MarketSnapshotResponse, TradeView } from '@terra/contracts';
import { mergeTrades, stateOf, type BoardState } from './boardModel';

export type SnapshotFetcher = (planetId: string) => Promise<MarketSnapshotResponse>;
export interface PushSource { onMessage?(fn: (m: unknown) => void): () => void }

/** `GET /v1/market/{planetId}` for the board (public: no token needed). */
export const httpSnapshot = (base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): SnapshotFetcher => async (planetId) => {
  const res = await fetchImpl(`${base}/v1/market/${encodeURIComponent(planetId)}`);
  if (!res.ok) throw new Error(`market board: HTTP ${res.status}`);
  return (await res.json()) as MarketSnapshotResponse;
};

/**
 * Keeps the board fresh: one fetch on open, then a refetch on every `market.trade` push of the planet. A pushed trade is kept
 * at once (so the sparkline and last price move before the refetch answers) and merged by id with the server's list.
 */
export class BoardController {
  private state: BoardState = { rows: [], trades: [] };
  private readonly listeners = new Set<(s: BoardState, error: string | null) => void>();
  private off: (() => void) | null = null;
  private seq = 0;

  constructor(private readonly fetchSnapshot: SnapshotFetcher, private readonly planetId: () => string | null, source?: PushSource) {
    this.off = source?.onMessage?.((m) => this.onMessage(m)) ?? null;
  }

  get current(): BoardState { return this.state; }

  onChange(fn: (s: BoardState, error: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(error: string | null): void {
    for (const fn of this.listeners) fn(this.state, error);
  }

  async refresh(): Promise<void> {
    const planet = this.planetId();
    if (!planet) { this.emit('Not connected to a planet yet.'); return; }
    const mine = ++this.seq;
    try {
      const snap = await this.fetchSnapshot(planet);
      if (mine !== this.seq) return; // a newer refresh is in flight
      const s = stateOf(snap);
      this.state = { rows: s.rows, trades: mergeTrades(this.state.trades, s.trades) };
      this.emit(null);
    } catch (e) {
      this.emit(e instanceof Error ? e.message : String(e));
    }
  }

  private onMessage(m: unknown): void {
    const msg = m as { t?: string; d?: { planetId?: string; trade?: TradeView } };
    if (msg.t !== 'market.trade' || !msg.d?.trade || msg.d.planetId !== this.planetId()) return;
    this.state = { rows: this.state.rows, trades: mergeTrades(this.state.trades, [msg.d.trade]) };
    this.emit(null);
    void this.refresh();
  }

  dispose(): void {
    this.off?.();
    this.off = null;
    this.listeners.clear();
  }
}
