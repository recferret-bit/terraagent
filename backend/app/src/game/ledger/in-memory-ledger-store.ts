import { LedgerStorePort, type LedgerCursor, type LedgerRow, type StoredLedgerRow } from './ledger-store.port';

const after = (r: LedgerRow, c: LedgerCursor) => r.tick > c.tick || (r.tick === c.tick && r.idx > c.idx);
const byKey = (a: LedgerRow, b: LedgerRow) => a.tick - b.tick || a.idx - b.idx;

/** In-memory `LedgerStorePort`: unit tests, and the store used when snapshot persistence is off (`NODE_ENV=test`). */
export class InMemoryLedgerStore extends LedgerStorePort {
  private readonly planets = new Map<string, LedgerRow[]>();
  private readonly keys = new Map<string, Set<string>>();

  async append(planetId: string, rows: readonly LedgerRow[]): Promise<number> {
    const list = this.rows(planetId);
    let have = this.keys.get(planetId);
    if (!have) this.keys.set(planetId, (have = new Set(list.map((r) => `${r.tick}:${r.idx}`))));
    let inserted = 0;
    let ordered = true;
    for (const r of rows) {
      if (have.has(`${r.tick}:${r.idx}`)) continue;
      have.add(`${r.tick}:${r.idx}`);
      const last = list[list.length - 1];
      if (last && byKey(last, r) > 0) ordered = false;
      list.push({ ...r, legs: r.legs.map((l) => ({ ...l })) });
      inserted++;
    }
    if (!ordered) list.sort(byKey);
    return inserted;
  }

  async deleteAfter(planetId: string, tick: number): Promise<number> {
    return this.remove(planetId, (r) => r.tick > tick);
  }

  async deleteAll(planetId: string): Promise<number> {
    return this.remove(planetId, () => true);
  }

  async page(planetId: string, q: { throughTick: number; after?: LedgerCursor; limit: number }): Promise<LedgerRow[]> {
    return this.rows(planetId)
      .filter((r) => r.tick <= q.throughTick && (!q.after || after(r, q.after)))
      .slice(0, q.limit);
  }

  async recent(planetId: string, q: { account: string; limit: number }): Promise<StoredLedgerRow[]> {
    return this.rows(planetId)
      .map((r, i) => ({ ...r, seq: i + 1 }))
      .filter((r) => r.legs.some((l) => l.account === q.account))
      .slice(-q.limit);
  }

  /** Every stored row of a planet in `(tick, idx)` order (tests). */
  all(planetId: string): readonly LedgerRow[] {
    return this.rows(planetId);
  }

  private rows(planetId: string): LedgerRow[] {
    let list = this.planets.get(planetId);
    if (!list) this.planets.set(planetId, (list = []));
    return list;
  }

  private remove(planetId: string, drop: (r: LedgerRow) => boolean): number {
    const list = this.rows(planetId);
    const keep = list.filter((r) => !drop(r));
    this.planets.set(planetId, keep);
    this.keys.delete(planetId);
    return list.length - keep.length;
  }
}
