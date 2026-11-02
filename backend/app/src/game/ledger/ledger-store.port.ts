import type { BalanceSheet, Leg } from '@terra/ledger';

/**
 * One persisted sim posting (`world.ledger_entry`). Identity is `(planetId, tick, idx)`: `idx` is the posting's index
 * within its step, so a row is deterministic and re-inserting it is a no-op.
 */
export interface LedgerRow {
  readonly tick: number;
  readonly idx: number;
  readonly reason: string;
  readonly actor: string;
  readonly ref?: string;
  readonly legs: readonly Leg[];
}

/** A stored row with its 1-based position in the planet's journal (ordered by `tick`, `idx`). */
export interface StoredLedgerRow extends LedgerRow {
  readonly seq: number;
}

/** The journal of a planet up to a tick, summed: what a restore opens the in-memory `PlanetJournal` with. */
export interface LedgerTotals {
  /** Σ leg deltas per account per asset (zero sums omitted, like a ledger's canonical sheet). */
  readonly balances: BalanceSheet;
  /** Rows summed: the `seq` of the last of them (rows are numbered 1.. by `(tick, idx)`, see {@link StoredLedgerRow}). */
  readonly count: number;
}

/**
 * Server-side journal of every colony resource posting (D-34). The DB holds the full history; the in-memory
 * `PlanetJournal` of a loaded planet only keeps a bounded tail, opened from `balancesThrough` on restore. Adapters:
 * `PrismaLedgerStore` (Postgres), `InMemoryLedgerStore` (tests, and whenever snapshot persistence is off).
 */
export abstract class LedgerStorePort {
  /** Appends rows; a row whose `(planetId, tick, idx)` already exists is skipped. Returns the number inserted. */
  abstract append(planetId: string, rows: readonly LedgerRow[]): Promise<number>;
  /** Deletes the rows after `tick` (steps lost after the snapshot the planet restores from). Returns the count. */
  abstract deleteAfter(planetId: string, tick: number): Promise<number>;
  /** Deletes every row of a planet (a brand-new planet reusing an id). Returns the count. */
  abstract deleteAll(planetId: string): Promise<number>;
  /** Sums of every row with `tick ≤ tick` (restore): balances per account/asset and the number of rows. */
  abstract balancesThrough(planetId: string, tick: number): Promise<LedgerTotals>;
  /** The newest `limit` rows with a leg on `account`, returned oldest first, each with its journal `seq`. */
  abstract recent(planetId: string, q: { readonly account: string; readonly limit: number }): Promise<StoredLedgerRow[]>;
}
