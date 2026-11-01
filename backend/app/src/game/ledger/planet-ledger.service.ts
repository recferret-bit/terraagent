import { Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { PlanetJournal, describeJournalProblem, type LedgerPosting, type LedgerView } from '@terra/sim';
import type { Logger } from 'pino';
import { CoreException } from '../../core/errors';
import { layerLogger } from '../../core/logging/logger';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { GamePlanets } from '../game-planets.service';
import type { LoadedInfo } from '../thread/protocol';
import { OPENING_ACTOR, rowsOf, rowsOfPostings, toJournalEntry } from './ledger-book';
import { LedgerStorePort, type LedgerRow, type LedgerTotals } from './ledger-store.port';

/** Backoff of a failed journal write or restore: doubles from the first wait up to the cap, and never gives up. */
export const RETRY_FIRST_MS = 100;
export const RETRY_MAX_MS = 30_000;
/** Shutdown waits this long for queued journal writes, then logs what is left unwritten and stops retrying. */
export const SHUTDOWN_WAIT_MS = 10_000;
/** The dev endpoint waits this long for a pending restore (then 503) and for queued writes before a database read. */
export const VIEW_WAIT_MS = 2_000;
/** Mismatches logged per restore (the count is always logged). */
const MISMATCH_LOG_LIMIT = 20;

interface Book {
  /** Null until the restore finished, and when it was abandoned at shutdown. */
  journal: PlanetJournal | null;
  ready: boolean;
  /** Settles when the restore finished (either way). */
  restored: Promise<void>;
  /** Postings that arrived while restoring: recorded right after it, in order. */
  backlog: LedgerPosting[];
}

/** What a load does to the stored rows (see {@link PlanetLedgerService.prepare}). */
type Prepared =
  | { readonly kind: 'new'; readonly dropped: number }
  | { readonly kind: 'unchecked' }
  | ({ readonly kind: 'restored'; readonly dropped: number } & LedgerTotals);

type Retried<T> = { readonly ok: true; readonly value: T; readonly attempts: number } | { readonly ok: false };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** True when `p` settled within `ms`. */
async function within(ms: number, p: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((r) => { timer = setTimeout(() => r(false), ms); });
  try {
    return await Promise.race([p.then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The server's colony-resource journal (D-34). Sim threads post every step's postings (`ledger` messages); this
 * service keeps one bounded in-memory {@link PlanetJournal} per loaded planet (the same class every host uses; a
 * refused posting there is sim/journal drift: logged, never thrown) and persists every row through
 * {@link LedgerStorePort}. Postings are recorded in memory as they arrive (after the restore); writes run per planet on
 * one ordered promise chain, off the hot path: restore (delete rows after the snapshot tick, open from the summed rows,
 * reconcile with `col.stock`; a genesis writes its opening rows), then each batch. A failed restore or write is retried
 * with backoff until it succeeds (later batches wait behind it: no batch is written before the restore deleted the rows
 * of a lost timeline), so no row is ever dropped while the process lives. Clients never see the journal.
 */
@Injectable()
export class PlanetLedgerService implements BeforeApplicationShutdown {
  private readonly log: Logger;
  private readonly books = new Map<string, Book>();
  private readonly chains = new Map<string, Promise<void>>();
  /** Rows waiting for their write job, per planet: later postings join the queued batch (one insert per busy period). */
  private readonly batches = new Map<string, LedgerRow[]>();
  /** Rows received but not yet written, per planet (kept after an unload: its rows are still being written). */
  private readonly unwritten = new Map<string, number>();
  /** Planets whose restore was abandoned at shutdown: their later batches are not written (stale rows may remain). */
  private readonly unrestored = new Set<string>();
  /** Backoff waits in progress (shutdown cuts them short). */
  private readonly sleepers = new Set<() => void>();
  private stopped = false;

  constructor(
    planets: GamePlanets,
    private readonly store: LedgerStorePort,
    @Inject(LOGGER) root: Logger,
    @Inject(APP_ENV) env: AppEnv,
  ) {
    this.log = layerLogger(root, 'sim', env.LOG_LEVELS as string | undefined);
    planets.onPlanetLoaded((id, tick, info) => this.onLoaded(id, tick, info));
    planets.onPlanetUnloaded((id) => this.onUnloaded(id));
    planets.onPlanetLedger((id, tick, postings) => this.onPostings(id, tick, postings));
  }

  /**
   * Lets queued journal writes finish before the database client disconnects, for at most {@link SHUTDOWN_WAIT_MS}
   * (a database that stays down must not hang the shutdown); then stops retrying and logs the rows left unwritten.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (await within(SHUTDOWN_WAIT_MS, this.settled())) return;
    this.stopped = true;
    for (const wake of [...this.sleepers]) wake();
    const left = Object.fromEntries([...this.unwritten].filter(([, n]) => n > 0));
    this.log.error({ unwritten: left, waitedMs: SHUTDOWN_WAIT_MS }, `ledger rows not written at shutdown: ${JSON.stringify(left)}`);
  }

  /** True once shutdown gave up waiting: retries stopped, rows still counted in {@link unwrittenRows} are lost. */
  isStopped(): boolean {
    return this.stopped;
  }

  /** Resolves once every job queued so far for `planetId` (or for every planet) has finished. */
  async settled(planetId?: string): Promise<void> {
    if (planetId !== undefined) return this.chains.get(planetId);
    await Promise.all([...this.chains.values()]);
  }

  /** In-memory journal of a loaded planet (null while restoring, after an abandoned restore, or when not loaded). */
  journalOf(planetId: string): PlanetJournal | null {
    return this.books.get(planetId)?.journal ?? null;
  }

  /** Rows of `planetId` received but not yet written (a write is failing, or still queued). */
  unwrittenRows(planetId: string): number {
    return this.unwritten.get(planetId) ?? 0;
  }

  /**
   * Balances and the newest `limit` entries of `account` on a loaded planet, newest last. Served from the in-memory
   * tail; when older entries were trimmed from it and it cannot fill `limit`, from the database. Null = not loaded;
   * `LEDGER_UNAVAILABLE` (503) while the restore is still pending ({@link VIEW_WAIT_MS}) or after it was abandoned.
   */
  async view(planetId: string, account: string, limit: number): Promise<LedgerView | null> {
    const book = this.books.get(planetId);
    if (!book) return null;
    if (!book.ready && !(await within(VIEW_WAIT_MS, book.restored))) {
      throw new CoreException('LEDGER_UNAVAILABLE', { status: 503, message: `ledger of ${planetId} is still restoring (database unavailable?)` });
    }
    const journal = book.journal;
    if (!journal) throw new CoreException('LEDGER_UNAVAILABLE', { status: 503, message: `ledger of ${planetId} is unavailable (restore abandoned, see logs)` });
    const view = journal.view(planetId, account, limit);
    if (!journal.isTailShort(account, limit)) return view;
    await within(VIEW_WAIT_MS, this.settled(planetId));
    const rows = await this.store.recent(planetId, { account, limit });
    return { ...view, entries: rows.map(toJournalEntry) };
  }

  private onLoaded(planetId: string, tick: number, info: LoadedInfo): void {
    let done!: () => void;
    const book: Book = { journal: null, ready: false, restored: new Promise((r) => { done = r; }), backlog: [] };
    this.books.set(planetId, book);
    // Postings from now on start a new batch queued after the restore (it may delete rows after `tick`).
    this.batches.delete(planetId);
    this.enqueue(planetId, () => this.restore(planetId, tick, info, book, done));
  }

  private onUnloaded(planetId: string): void {
    this.books.delete(planetId); // queued batches still get written
  }

  private onPostings(planetId: string, tick: number, postings: readonly LedgerPosting[]): void {
    const book = this.books.get(planetId);
    if (book && !book.ready) book.backlog.push(...postings);
    else if (book?.journal) this.record(planetId, book.journal, postings);
    const rows = rowsOf(tick, postings);
    const open = this.batches.get(planetId);
    if (open) {
      this.count(planetId, rows.length);
      open.push(...rows);
      return;
    }
    const batch = [...rows];
    this.count(planetId, batch.length);
    this.batches.set(planetId, batch);
    this.enqueue(planetId, async () => {
      if (this.batches.get(planetId) === batch) this.batches.delete(planetId);
      await this.persist(planetId, batch);
    });
  }

  /**
   * The restore job (holds the planet's write chain): prepares the stored rows, retried until it succeeds (or the
   * shutdown gives up), opens the in-memory journal, then — a genesis — writes its opening rows, so a snapshot write
   * that waited for {@link settled} has them. Never throws.
   */
  private async restore(planetId: string, tick: number, info: LoadedInfo, book: Book, done: () => void): Promise<void> {
    let opening: LedgerPosting[] = [];
    try {
      const prepared = await this.retrying(planetId, `ledger restore of ${planetId}`, { tick }, () => this.prepare(planetId, tick, info));
      if (prepared.ok) {
        this.unrestored.delete(planetId);
        opening = this.open(planetId, tick, info, book, prepared.value);
      } else {
        this.unrestored.add(planetId);
        this.log.error({ planetId, tick }, `ledger restore of ${planetId} abandoned at shutdown: no in-memory checks, its later rows are not written`);
      }
    } finally {
      book.backlog = [];
      book.ready = true;
      done();
    }
    if (opening.length === 0) return;
    const rows = rowsOfPostings(opening);
    this.count(planetId, rows.length);
    await this.persist(planetId, rows);
  }

  /**
   * Genesis snapshot (scenario), or a fresh planet the loader checked has no snapshots: drop every row under its id (an
   * older planet's). Restore at `tick`: drop the rows after it (a lost timeline) and sum the rest. A fresh load without
   * that check keeps the rows (never wipe the journal of a planet that may have snapshots).
   */
  private async prepare(planetId: string, tick: number, info: LoadedInfo): Promise<Prepared> {
    if (info.genesis || (!info.restored && info.noSnapshots)) return { kind: 'new', dropped: await this.store.deleteAll(planetId) };
    if (!info.restored) return { kind: 'unchecked' };
    const dropped = await this.store.deleteAfter(planetId, tick);
    return { kind: 'restored', dropped, ...(await this.store.balancesThrough(planetId, tick)) };
  }

  /** Opens the in-memory journal from the prepared rows, reconciles, records the backlog; returns a genesis' opening postings. */
  private open(planetId: string, tick: number, info: LoadedInfo, book: Book, prepared: Prepared): LedgerPosting[] {
    let journal: PlanetJournal;
    let opening: LedgerPosting[] = [];
    if (prepared.kind === 'restored') {
      journal = PlanetJournal.fromBalances(prepared.balances, prepared.count);
      this.reconcile(planetId, tick, journal, info);
      this.log.info({ planetId, tick, dropped: prepared.dropped, rows: prepared.count }, `ledger restored for ${planetId} at tick ${tick}`);
    } else {
      journal = PlanetJournal.empty();
      // a scenario's setup postings (the real `landing.cargo`); opening entries only when a genesis came without them
      if (info.genesis) opening = [...(info.setupPostings ?? PlanetJournal.openingPostings(info.stocks, tick, OPENING_ACTOR))];
      this.record(planetId, journal, opening);
      if (info.genesis) this.reconcile(planetId, tick, journal, info);
      if (prepared.kind === 'unchecked') {
        this.log.error({ planetId, tick }, `fresh load of ${planetId} without the no-snapshot check: its stored journal rows are kept`);
      } else {
        this.log.info({ planetId, tick, dropped: prepared.dropped, opening: opening.length }, `ledger opened for ${planetId}`);
      }
    }
    if (this.books.get(planetId) === book) {
      book.journal = journal;
      this.record(planetId, journal, book.backlog);
    }
    return opening;
  }

  private reconcile(planetId: string, tick: number, journal: PlanetJournal, info: LoadedInfo): void {
    const mismatches = journal.reconcile(info.stocks);
    if (mismatches.length === 0) return;
    this.log.error(
      { planetId, tick, count: mismatches.length, mismatches: mismatches.slice(0, MISMATCH_LOG_LIMIT) },
      `ledger/state mismatch on restore of ${planetId}: the journal does not explain col.stock`,
    );
  }

  /** Records postings in memory; a refused one is sim/journal drift (logged with planet, tick and reason, never thrown). */
  private record(planetId: string, journal: PlanetJournal, postings: readonly LedgerPosting[]): void {
    for (const problem of journal.record(postings)) {
      const { posting: p, ...why } = problem;
      this.log.error(
        { planetId, tick: p.at, reason: p.reason, actor: p.actor, ref: p.ref, ...why, legs: p.legs },
        `ledger drift on ${planetId}: ${describeJournalProblem(problem)}`,
      );
    }
  }

  /** Writes a batch counted in `unwritten`, retried until it is written (or the service stopped). */
  private async persist(planetId: string, rows: readonly LedgerRow[]): Promise<void> {
    if (this.unrestored.has(planetId)) return; // counted in `unwritten`; the shutdown already logged it
    const span = { fromTick: rows[0]?.tick, toTick: rows[rows.length - 1]?.tick, rows: rows.length };
    const out = await this.retrying(planetId, `ledger write of ${planetId}`, span, () => this.store.append(planetId, rows));
    if (!out.ok) return;
    this.count(planetId, -rows.length);
    if (out.value >= rows.length) return;
    // After a restore, a row that already exists can only come from an earlier attempt of this write that committed
    // before failing; on a first attempt it is a stale row of another timeline that the new one did not replace.
    const fields = { planetId, ...span, inserted: out.value, skipped: rows.length - out.value, attempts: out.attempts };
    const msg = `ledger write of ${planetId}: ${fields.skipped} of ${rows.length} rows were already stored`;
    if (out.attempts > 1) this.log.warn(fields, msg);
    else this.log.error(fields, msg);
  }

  /** Runs `fn` until it resolves, with capped exponential backoff between failures; `ok: false` once the service stopped. */
  private async retrying<T>(planetId: string, what: string, span: Record<string, unknown>, fn: () => Promise<T>): Promise<Retried<T>> {
    for (let attempt = 1; ; attempt++) {
      try {
        const value = await fn();
        if (attempt > 1) this.log.info({ planetId, attempt, ...span }, `${what} recovered`);
        return { ok: true, value, attempts: attempt };
      } catch (e) {
        if (this.stopped) return { ok: false };
        const retryInMs = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** (attempt - 1));
        this.log.error({ planetId, attempt, ...span, retryInMs, err: errText(e) }, `${what} failed, retrying in ${retryInMs} ms`);
        await this.sleep(retryInMs);
        if (this.stopped) return { ok: false };
      }
    }
  }

  private count(planetId: string, delta: number): void {
    const n = this.unwrittenRows(planetId) + delta;
    if (n > 0) this.unwritten.set(planetId, n);
    else this.unwritten.delete(planetId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(timer); this.sleepers.delete(wake); resolve(); };
      const timer = setTimeout(wake, ms);
      this.sleepers.add(wake);
    });
  }

  private enqueue(planetId: string, job: () => Promise<void>): void {
    const next = (this.chains.get(planetId) ?? Promise.resolve()).then(job).catch((e: unknown) => {
      this.log.error({ planetId, err: errText(e) }, 'ledger job failed');
    });
    this.chains.set(planetId, next);
    void next.then(() => { if (this.chains.get(planetId) === next) this.chains.delete(planetId); });
  }
}
