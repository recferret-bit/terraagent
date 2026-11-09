import type { LedgerState } from '@terra/ledger';
import { canMigrateSnapshot } from '@terra/sim';

/** One saved local planet (`terra-local:<scenario>`). */
export interface LocalSnapshot {
  readonly bytes: Uint8Array;
  readonly tick: number;
  readonly savedAt: number;
  readonly dataHash: string;
  readonly simVersion: number;
  /** The wave set the planet runs with; a snapshot of another `?waves=` is not resumed. */
  readonly flags: readonly string[];
  /** Live balance overrides (dev `tune`), so a resumed planet keeps its numbers. */
  readonly overrides?: Record<string, unknown>;
  /**
   * The host's resource journal (`PlanetJournal.toState()`, tail bounded at `HOST_JOURNAL_LIMIT` entries), captured at
   * the same tick as `bytes`. A resume continues it when it reconciles with the planet's `col.stock`; older snapshots
   * have none and open their balances instead.
   */
  readonly journal?: LedgerState;
}

/** Where local planets are persisted. `idbSnapshotStore` in the browser, a Map in tests. */
export interface SnapshotStore {
  load(key: string): Promise<LocalSnapshot | null>;
  save(key: string, snap: LocalSnapshot): Promise<void>;
  remove(key: string): Promise<void>;
}

export const snapshotKey = (scenario: string): string => `terra-local:${scenario}`;

/** What a snapshot must match to be resumed (else the planet starts fresh from the scenario). */
export interface ResumeExpect { readonly simVersion: number; readonly dataHash: string; readonly flags: readonly string[] }

export const compatible = (s: LocalSnapshot, e: ResumeExpect): boolean =>
  canMigrateSnapshot(s.simVersion, e.simVersion) && s.dataHash === e.dataHash && s.flags.length === e.flags.length && s.flags.every((f, i) => f === e.flags[i]);

/** In-memory store (tests, and the fallback when IndexedDB is unavailable). */
export function memorySnapshotStore(): SnapshotStore & { readonly map: Map<string, LocalSnapshot> } {
  const map = new Map<string, LocalSnapshot>();
  return {
    map,
    load: async (k) => map.get(k) ?? null,
    save: async (k, s) => { map.set(k, s); },
    remove: async (k) => { map.delete(k); },
  };
}

const DB = 'terra-local';
const STORE = 'snapshots';

const asPromise = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((ok, fail) => { req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error ?? new Error('indexedDB request failed')); });

/** Plain-`indexedDB` store: database `terra-local`, object store `snapshots`, one record per key. Works in a Worker. */
export function idbSnapshotStore(factory: IDBFactory = indexedDB): SnapshotStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => (db ??= new Promise((ok, fail) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => { db = null; fail(req.error ?? new Error('indexedDB open failed')); };
  }));
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = (await open()).transaction(STORE, mode);
    const done = new Promise<void>((ok, fail) => { tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error ?? new Error('indexedDB tx failed')); tx.onabort = () => fail(tx.error ?? new Error('indexedDB tx aborted')); });
    // both are awaited together: a failed request also fails the transaction, and that rejection must be observed too
    const [r] = await Promise.all([asPromise(f(tx.objectStore(STORE))), done]);
    return r;
  };
  return {
    load: async (k) => ((await run<LocalSnapshot | undefined>('readonly', (s) => s.get(k))) ?? null),
    save: async (k, v) => { await run('readwrite', (s) => s.put(v, k)); },
    remove: async (k) => { await run('readwrite', (s) => s.delete(k)); },
  };
}
