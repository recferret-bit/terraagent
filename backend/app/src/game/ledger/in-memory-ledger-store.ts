import { sheetOf } from './ledger-book';
import { LedgerStorePort, type LedgerRow, type LedgerTotals, type StoredLedgerRow } from './ledger-store.port';

const byKey = (a: LedgerRow, b: LedgerRow) => a.tick - b.tick || a.idx - b.idx;
const keyOf = (r: LedgerRow) => `${r.tick}:${r.idx}`;

/** Rows kept per planet by default; older ones are dropped (see {@link InMemoryLedgerStore}). */
export const IN_MEMORY_LEDGER_ROWS = 20_000;

interface PlanetRows {
  list: LedgerRow[];
  keys: Set<string>;
  /** Oldest rows dropped by the cap: `recent` numbers the kept ones after them, like the DB's `ROW_NUMBER`. */
  dropped: number;
}

/**
 * In-memory `LedgerStorePort`: unit tests, and the store used when snapshot persistence is off (`NODE_ENV=test`,
 * `SNAPSHOTS=off`). It keeps at most `maxRowsPerPlanet` rows per planet (oldest dropped) so a long dev run does not
 * grow without bound. Consequence: `balancesThrough` only sums the kept rows, so it no longer explains the balances
 * once rows were dropped — harmless here, because without persistence there are no snapshots and nothing is ever
 * restored (`SnapshotService.restoreAll` is off); fresh and genesis loads only call `deleteAll`.
 */
export class InMemoryLedgerStore extends LedgerStorePort {
  private readonly planets = new Map<string, PlanetRows>();

  constructor(private readonly maxRowsPerPlanet = IN_MEMORY_LEDGER_ROWS) {
    super();
  }

  async append(planetId: string, rows: readonly LedgerRow[]): Promise<number> {
    const p = this.planet(planetId);
    let inserted = 0;
    let ordered = true;
    for (const r of rows) {
      if (p.keys.has(keyOf(r))) continue;
      p.keys.add(keyOf(r));
      const last = p.list[p.list.length - 1];
      if (last && byKey(last, r) > 0) ordered = false;
      p.list.push({ ...r, legs: r.legs.map((l) => ({ ...l })) });
      inserted++;
    }
    if (!ordered) p.list.sort(byKey);
    const excess = p.list.length - this.maxRowsPerPlanet;
    if (excess > 0) {
      for (const r of p.list.splice(0, excess)) p.keys.delete(keyOf(r));
      p.dropped += excess;
    }
    return inserted;
  }

  async deleteAfter(planetId: string, tick: number): Promise<number> {
    return this.remove(planetId, (r) => r.tick > tick);
  }

  async deleteAll(planetId: string): Promise<number> {
    const n = this.remove(planetId, () => true);
    this.planet(planetId).dropped = 0;
    return n;
  }

  async balancesThrough(planetId: string, tick: number): Promise<LedgerTotals> {
    const p = this.planet(planetId);
    const sums = new Map<string, { account: string; asset: string; total: number }>();
    let count = p.dropped;
    for (const r of p.list) {
      if (r.tick > tick) continue;
      count++;
      for (const l of r.legs) {
        const key = JSON.stringify([l.account, l.asset]);
        const cell = sums.get(key) ?? { account: l.account, asset: l.asset, total: 0 };
        cell.total += l.delta;
        sums.set(key, cell);
      }
    }
    return { balances: sheetOf(sums.values()), count };
  }

  async recent(planetId: string, q: { account: string; limit: number }): Promise<StoredLedgerRow[]> {
    const p = this.planet(planetId);
    return p.list
      .map((r, i) => ({ ...r, seq: p.dropped + i + 1 }))
      .filter((r) => r.legs.some((l) => l.account === q.account))
      .slice(-q.limit);
  }

  /** Every kept row of a planet in `(tick, idx)` order (tests). */
  all(planetId: string): readonly LedgerRow[] {
    return this.planet(planetId).list;
  }

  private planet(planetId: string): PlanetRows {
    let p = this.planets.get(planetId);
    if (!p) this.planets.set(planetId, (p = { list: [], keys: new Set(), dropped: 0 }));
    return p;
  }

  private remove(planetId: string, drop: (r: LedgerRow) => boolean): number {
    const p = this.planet(planetId);
    const keep = p.list.filter((r) => !drop(r));
    const n = p.list.length - keep.length;
    p.list = keep;
    p.keys = new Set(keep.map(keyOf));
    return n;
  }
}
