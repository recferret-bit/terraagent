import type { Leg } from '@terra/ledger';

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

/** Replay cursor: rows strictly after this `(tick, idx)`. */
export interface LedgerCursor {
  readonly tick: number;
  readonly idx: number;
}

/**
 * Server-side journal of every colony resource posting (D-34). The DB holds the full history; the in-memory ledger of
 * a loaded planet only keeps a bounded tail. Adapters: `PrismaLedgerStore` (Postgres), `InMemoryLedgerStore` (tests,
 * and whenever snapshot persistence is off).
 */
export abstract class LedgerStorePort {
  /** Appends rows; a row whose `(planetId, tick, idx)` already exists is skipped. Returns the number inserted. */
  abstract append(planetId: string, rows: readonly LedgerRow[]): Promise<number>;
  /** Deletes the rows after `tick` (steps lost after the snapshot the planet restores from). Returns the count. */
  abstract deleteAfter(planetId: string, tick: number): Promise<number>;
  /** Deletes every row of a planet (a brand-new planet reusing an id). Returns the count. */
  abstract deleteAll(planetId: string): Promise<number>;
  /** Up to `limit` rows with `tick ≤ throughTick` after `after`, ordered by `(tick, idx)`: the replay pages. */
  abstract page(planetId: string, q: { readonly throughTick: number; readonly after?: LedgerCursor; readonly limit: number }): Promise<LedgerRow[]>;
  /** The newest `limit` rows with a leg on `account`, returned oldest first, each with its journal `seq`. */
  abstract recent(planetId: string, q: { readonly account: string; readonly limit: number }): Promise<StoredLedgerRow[]>;
}
