import { TradeApiFailure, type TradeClient } from './api/client';
import type { OrderSide } from '@terra/contracts';
import { applyBookSnapshot, applyOverview } from './model/state';
import type { Store } from './Store';

const noColony = (e: unknown): boolean => e instanceof TradeApiFailure && (e.code === 'no_colony' || e.code === 'wrong_planet');

/** Data loading of every panel; each one reports its own loading / error status so one failure never blanks the page. */
export class Loaders {
  constructor(private readonly store: Store, private readonly client: TradeClient) {}

  catalog(): Promise<void[]> {
    return Promise.all([
      this.store.load('pairs', async () => { const r = await this.client.pairs(); return (s) => ({ ...s, pairs: r.pairs }); }),
      this.store.load('policy', async () => { const r = await this.client.policy(); return (s) => ({ ...s, policy: r.policy }); }),
    ]);
  }

  book(quiet = false): Promise<void> {
    return this.store.load('book', async (s) => { const r = await this.client.book(s.planetId, s.pair, 25); return (x) => (x.pair === r.pair ? applyBookSnapshot(x, r) : x); }, quiet);
  }

  board(quiet = false): Promise<void> {
    return this.store.load('board', async (s) => { const r = await this.client.board(s.planetId); return (x) => ({ ...x, board: r.board }); }, quiet);
  }

  orders(quiet = false): Promise<void> {
    return this.store.load('orders', async (s) => {
      try { const r = await this.client.orders(s.planetId); return (x) => ({ ...x, orders: r.orders }); } catch (e) { if (noColony(e)) return (x) => ({ ...x, orders: [] }); throw e; }
    }, quiet);
  }

  fills(quiet = false): Promise<void> {
    return this.store.load('fills', async (s) => { try { const r = await this.client.fills(s.planetId); return (x) => ({ ...x, fills: r.fills }); } catch (e) { if (noColony(e)) return (x) => ({ ...x, fills: [] }); throw e; } }, quiet);
  }

  balances(quiet = false): Promise<void> {
    return this.store.load('balances', async (s) => {
      try { const r = await this.client.tradeBalances(s.planetId); return (x) => ({ ...x, balances: r }); } catch (e) { if (noColony(e)) return (x) => ({ ...x, balances: null }); throw e; }
    }, quiet);
  }

  /** Every resting order of the selected pair (public endpoint; own ones carry `mine`). */
  bookOrders(side: OrderSide | null, quiet = false): Promise<void> {
    return this.store.load('bookOrders', async (s) => { const r = await this.client.bookOrders(s.planetId, s.pair, side); return (x) => (x.pair === r.pair && x.planetId === r.planetId ? { ...x, bookOrders: r } : x); }, quiet);
  }

  stall(quiet = false): Promise<void> {
    return this.store.load('stall', async (s) => {
      try { const r = await this.client.getStall(s.planetId); return (x) => ({ ...x, stall: r }); } catch (e) { if (noColony(e)) return (x) => ({ ...x, stall: null }); throw e; }
    }, quiet);
  }

  keys(quiet = false): Promise<void> {
    return this.store.load('keys', async () => { const r = await this.client.keys(); return (x) => ({ ...x, keys: r.keys.filter((k) => k.planetId === x.planetId) }); }, quiet);
  }

  /** Best bid / ask of every pair of the planet: ONE request (`GET /v1/trade/overview/:planet`), never one book call per pair. */
  overview(quiet = false): Promise<void> {
    return this.store.load('overview', async (s) => { const r = await this.client.overview(s.planetId); return (x) => applyOverview(x, r); }, quiet);
  }

  all(): Promise<unknown> {
    return Promise.all([this.catalog().then(() => this.overview()), this.book(), this.board(), this.orders(), this.fills(), this.balances(), this.keys(), this.stall()]);
  }
}
