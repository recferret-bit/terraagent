import { Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import type { JournalEntry, Ledger } from '@terra/ledger';
import type { LedgerPosting } from '@terra/sim';
import type { Logger } from 'pino';
import { CoreException } from '../../core/errors';
import { layerLogger } from '../../core/logging/logger';
import { APP_ENV, LOGGER, type AppEnv } from '../../core/tokens';
import { GamePlanets } from '../game-planets.service';
import type { LoadedInfo } from '../thread/protocol';
import { newPlanetLedger, openingRows, postRow, reconcileColonies, rowsOf, rowsOfPostings, toJournalEntry } from './ledger-book';
import { LedgerStorePort, type LedgerCursor, type LedgerRow } from './ledger-store.port';

/** Rows read per replay page on restore (memory stays bounded by the page plus the ledger's journal tail). */
const REPLAY_PAGE = 2000;
/** Waits before retrying a failed journal write; after the last one the batch is logged as lost. */
const RETRY_DELAYS_MS = [100, 500, 2000];
/** Mismatches logged per restore (the count is always logged). */
const MISMATCH_LOG_LIMIT = 20;

/** `GET /v1/dev/planets/:planetId/ledger` (dev tools). */
export interface LedgerView {
  readonly planetId: string;
  readonly account: string;
  /** Asset → whole units held by `account`. */
  readonly balances: Record<string, number>;
  /** Newest last. */
  readonly entries: JournalEntry[];
}

interface Book {
  /** Null until the restore finished, and when it failed (then nothing is checked in memory until the next load). */
  ledger: Ledger | null;
  ready: boolean;
}

/**
 * The server's colony-resource journal (D-34). Sim threads post every step's postings (`ledger` messages); this
 * service keeps one bounded in-memory {@link Ledger} per loaded planet (a reject there means sim/ledger drift: logged,
 * never thrown) and persists every row through {@link LedgerStorePort}. Per planet all work runs on one ordered
 * promise chain, off the hot path: restore (delete rows after the snapshot tick, replay, reconcile with `col.stock`),
 * then each batch (post in memory, write). Clients never see the journal, only `col.stock`.
 */
@Injectable()
export class PlanetLedgerService implements BeforeApplicationShutdown {
  private readonly log: Logger;
  private readonly books = new Map<string, Book>();
  private readonly chains = new Map<string, Promise<void>>();
  /** Rows waiting for their write job, per planet: later postings join the queued batch (one insert per busy period). */
  private readonly batches = new Map<string, LedgerRow[]>();

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

  /** Lets queued journal writes finish before the database client disconnects. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.settled();
  }

  /** Resolves once every job queued so far for `planetId` (or for every planet) has finished. */
  async settled(planetId?: string): Promise<void> {
    if (planetId !== undefined) return this.chains.get(planetId);
    await Promise.all([...this.chains.values()]);
  }

  /** In-memory ledger of a loaded planet (null while restoring, after a failed restore, or when not loaded). */
  ledgerOf(planetId: string): Ledger | null {
    return this.books.get(planetId)?.ledger ?? null;
  }

  /**
   * Balances and the newest `limit` entries of `account` on a loaded planet, newest last. Served from the in-memory
   * tail; when older entries were trimmed from it and it cannot fill `limit`, from the database. Null = not loaded.
   */
  async view(planetId: string, account: string, limit: number): Promise<LedgerView | null> {
    const book = this.books.get(planetId);
    if (!book) return null;
    if (!book.ready) await this.settled(planetId);
    if (!book.ledger) throw new CoreException('LEDGER_UNAVAILABLE', { status: 503, message: `ledger of ${planetId} is unavailable (restore failed, see logs)` });
    const balances = book.ledger.balances(account);
    const tail = book.ledger.entries({ account });
    const trimmed = book.ledger.state.seq > book.ledger.state.journal.length;
    if (tail.length >= limit || !trimmed) return { planetId, account, balances, entries: tail.slice(-limit) };
    await this.settled(planetId);
    const rows = await this.store.recent(planetId, { account, limit });
    return { planetId, account, balances, entries: rows.map(toJournalEntry) };
  }

  private onLoaded(planetId: string, tick: number, info: LoadedInfo): void {
    const book: Book = { ledger: null, ready: false };
    this.books.set(planetId, book);
    // Postings from now on start a new batch queued after the restore (it may delete rows after `tick`).
    this.batches.delete(planetId);
    this.enqueue(planetId, () => this.restore(planetId, tick, info, book));
  }

  private onUnloaded(planetId: string): void {
    this.books.delete(planetId); // queued batches still get written
  }

  private onPostings(planetId: string, tick: number, postings: readonly LedgerPosting[]): void {
    const rows = rowsOf(tick, postings);
    const open = this.batches.get(planetId);
    if (open) { open.push(...rows); return; }
    const batch = [...rows];
    this.batches.set(planetId, batch);
    this.enqueue(planetId, async () => {
      if (this.batches.get(planetId) === batch) this.batches.delete(planetId);
      const ledger = this.books.get(planetId)?.ledger;
      if (ledger) for (const row of batch) this.post(planetId, ledger, row);
      await this.persist(planetId, batch);
    });
  }

  /**
   * Fresh planet: drop any rows of an older planet with this id. Genesis snapshot (scenario): the same, then opening
   * entries for the seeded stock. Restore at `tick`: drop the rows after it, replay the rest, reconcile with the state.
   */
  private async restore(planetId: string, tick: number, info: LoadedInfo, book: Book): Promise<void> {
    try {
      const ledger = newPlanetLedger();
      if (!info.restored || info.genesis) {
        const dropped = await this.store.deleteAll(planetId);
        // a scenario's setup postings (the real `landing.cargo`); opening entries only when a genesis came without them
        const opening = !info.genesis ? [] : info.setupPostings ? rowsOfPostings(info.setupPostings) : openingRows(tick, info.stocks);
        for (const row of opening) this.post(planetId, ledger, row);
        if (opening.length) await this.store.append(planetId, opening);
        if (info.genesis) this.reconcile(planetId, tick, ledger, info);
        this.log.info({ planetId, tick, dropped, opening: opening.length }, `ledger opened for ${planetId}`);
      } else {
        const dropped = await this.store.deleteAfter(planetId, tick);
        const replayed = await this.replay(planetId, tick, ledger);
        this.reconcile(planetId, tick, ledger, info);
        this.log.info({ planetId, tick, dropped, replayed }, `ledger restored for ${planetId} at tick ${tick}`);
      }
      if (this.books.get(planetId) === book) book.ledger = ledger;
    } catch (e) {
      this.log.error({ planetId, tick, err: e instanceof Error ? e.message : String(e) }, 'ledger restore failed: no in-memory checks until the next load');
    } finally {
      book.ready = true;
    }
  }

  private async replay(planetId: string, tick: number, ledger: Ledger): Promise<number> {
    let after: LedgerCursor | undefined;
    let n = 0;
    for (;;) {
      const page = await this.store.page(planetId, { throughTick: tick, after, limit: REPLAY_PAGE });
      for (const row of page) this.post(planetId, ledger, row);
      n += page.length;
      if (page.length < REPLAY_PAGE) return n;
      const last = page[page.length - 1];
      after = { tick: last.tick, idx: last.idx };
    }
  }

  private reconcile(planetId: string, tick: number, ledger: Ledger, info: LoadedInfo): void {
    const mismatches = reconcileColonies(ledger, info.stocks);
    if (mismatches.length === 0) return;
    this.log.error(
      { planetId, tick, count: mismatches.length, mismatches: mismatches.slice(0, MISMATCH_LOG_LIMIT) },
      `ledger/state mismatch on restore of ${planetId}: the journal does not explain col.stock`,
    );
  }

  /** Posts one row in memory; a reject is sim/ledger drift (logged with planet, tick and reason, never thrown). */
  private post(planetId: string, ledger: Ledger, row: LedgerRow): void {
    const r = postRow(ledger, row);
    if (r.ok) return;
    this.log.error(
      { planetId, tick: row.tick, idx: row.idx, reason: row.reason, actor: row.actor, code: r.code, account: r.account, asset: r.asset, have: r.have, need: r.need },
      `ledger drift on ${planetId}: posting ${row.reason} at tick ${row.tick} rejected (${r.code})`,
    );
  }

  private async persist(planetId: string, rows: readonly LedgerRow[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.store.append(planetId, rows);
        return;
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        if (attempt >= RETRY_DELAYS_MS.length) {
          const span = { fromTick: rows[0]?.tick, toTick: rows[rows.length - 1]?.tick, rows: rows.length };
          this.log.error({ planetId, ...span, err }, `ledger rows of ${planetId} lost: journal write failed`);
          return;
        }
        this.log.warn({ planetId, attempt: attempt + 1, err }, 'ledger write failed, retrying');
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  private enqueue(planetId: string, job: () => Promise<void>): void {
    const next = (this.chains.get(planetId) ?? Promise.resolve()).then(job).catch((e: unknown) => {
      this.log.error({ planetId, err: e instanceof Error ? e.message : String(e) }, 'ledger job failed');
    });
    this.chains.set(planetId, next);
    void next.then(() => { if (this.chains.get(planetId) === next) this.chains.delete(planetId); });
  }
}
