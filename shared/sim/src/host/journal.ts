import type { Stock } from '@terra/contracts';
import { createLedgerState, Ledger, transferLegs, type BalanceSheet, type JournalEntry, type LedgerState } from '@terra/ledger';
import { colonyAccount, colonyIndexOfAccount, isSystemAccount } from '../economy/accounts';
import { LEDGER_REASONS, type LedgerReason } from '../economy/reasons';
import { getColonyStock } from '../economy/store';
import type { LedgerPosting } from '../kernel/context';
import type { PlanetState } from '../kernel/state';

/** Journal entries a host keeps in memory; older ones fold into the opening balances (a server keeps them in its DB). */
export const HOST_JOURNAL_LIMIT = 1024;

/** One account's ledger as the dev tools show it (`GET /v1/dev/planets/:planetId/ledger`, local-host `ledger`). */
export interface LedgerView {
  readonly planetId: string;
  readonly account: string;
  /** Asset → whole units held by `account`. */
  readonly balances: Record<string, number>;
  /** Oldest first. */
  readonly entries: JournalEntry[];
}

/** A posting the journal refused: the host's journal and the sim's `col.stock` disagree (drift). */
export interface JournalProblem {
  readonly posting: LedgerPosting;
  readonly code: string;
  readonly detail?: string;
  /** For `insufficient_funds`: the account and asset that would go negative, its balance and the amount asked. */
  readonly account?: string;
  readonly asset?: string;
  readonly have?: number;
  readonly need?: number;
}

/** One line for a refused posting, the same on every host: `ledger rejected <reason> by <actor>: <code> (…)`. */
export function describeJournalProblem(p: JournalProblem): string {
  const where = p.account !== undefined ? ` ${p.account} ${p.asset ?? ''} have ${p.have ?? 0}, need ${p.need ?? 0}` : '';
  const detail = p.detail ? ` (${p.detail})` : '';
  return `ledger rejected ${p.posting.reason} by ${p.posting.actor} at tick ${p.posting.at}: ${p.code}${where}${detail}`;
}

/** A colony balance the journal does not explain. */
export interface BalanceMismatch {
  readonly account: string;
  readonly asset: string;
  /** Balance the journal says. */
  readonly ledger: number;
  /** `col.stock` of the state. */
  readonly state: number;
}

/** Deep copy of plain JSON data (ledger states hold only objects, arrays, strings and numbers). */
const copyData = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Actor of opening entries by situation. */
export type OpeningActor = 'system:resume' | 'system:seed' | 'system:genesis';

/**
 * The host's resource journal of one planet (D-34): a `@terra/ledger` fed by the sim's postings (`SimHost.onPostings`
 * / `StepResult.postings`). One class for every host — the game server, the `?host=local` worker and the in-process
 * fallback host; only persistence differs (server: Postgres rows + summed balances on restore; browser: the whole
 * {@link toState} inside its IndexedDB snapshot). Pure and synchronous. Clients never get it, only `col.stock`.
 */
export class PlanetJournal {
  private readonly ledger: Ledger<string>;

  private constructor(state: LedgerState) {
    this.ledger = new Ledger(state, isSystemAccount);
  }

  /** An empty journal (a planet whose first posting is still to come, or a scenario about to replay its setup). */
  static empty(journalLimit = HOST_JOURNAL_LIMIT): PlanetJournal {
    return new PlanetJournal(createLedgerState({ journalLimit }));
  }

  /** A journal continued from a saved {@link toState} (browser snapshot). The state is copied. */
  static fromState(state: LedgerState): PlanetJournal {
    return new PlanetJournal(copyData(state));
  }

  /**
   * A journal whose history lives elsewhere (server DB): `balances` are the sums of its first `seq` entries, which
   * become the opening balances; the in-memory tail starts empty and the next posting gets `seq + 1`.
   */
  static fromBalances(balances: BalanceSheet, seq: number, journalLimit = HOST_JOURNAL_LIMIT): PlanetJournal {
    const state = createLedgerState({ journalLimit });
    state.seq = seq;
    state.balances = copyData(balances);
    state.opening = copyData(balances);
    return new PlanetJournal(state);
  }

  /**
   * A journal that starts on a planet that already holds stock (its history is gone: a resumed snapshot without a
   * saved journal, an adopted planet): one `ledger.opening` entry per colony with stock, from `sys:opening` by
   * `actor`, so balances match `col.stock` from here on and `sys:*` totals count only what happens after.
   */
  static open(state: PlanetState, actor: OpeningActor, journalLimit = HOST_JOURNAL_LIMIT): PlanetJournal {
    const out = PlanetJournal.empty(journalLimit);
    const stocks = state.colonies.map((_col, i) => getColonyStock(state, i));
    out.record(PlanetJournal.openingPostings(stocks, state.meta.tick, actor));
    return out;
  }

  /**
   * The `ledger.opening` postings that explain `stocks` (by colony index): one `sys:opening → colony:<i>` per colony
   * with a positive stock, colonies with none skipped. {@link open} records them; a server also persists them as rows.
   */
  static openingPostings(stocks: readonly Readonly<Record<string, number>>[], at: number, actor: OpeningActor): LedgerPosting[] {
    const reason: LedgerReason = 'ledger.opening';
    const out: LedgerPosting[] = [];
    stocks.forEach((stock, i) => {
      const amounts = Object.fromEntries(Object.entries(stock).filter(([, v]) => v > 0));
      const legs = transferLegs(LEDGER_REASONS[reason].counter, colonyAccount(i), amounts);
      if (legs && legs.length > 0) out.push({ at, reason, actor, legs });
    });
    return out;
  }

  /** Posts postings in order; returns every one the ledger refused (never throws). */
  record(postings: readonly LedgerPosting[]): JournalProblem[] {
    const problems: JournalProblem[] = [];
    for (const posting of postings) {
      const r = this.ledger.post(posting);
      if (r.ok) continue;
      const { ok: _ok, code, ...where } = r;
      problems.push({ posting, code, ...where });
    }
    return problems;
  }

  /** The account's balances and its newest `limit` (≥ 1) retained entries, oldest first. */
  view(planetId: string, account: string, limit: number): LedgerView {
    const entries = this.ledger.entries({ account }).slice(-Math.max(1, limit));
    return { planetId, account, balances: this.ledger.balances(account), entries };
  }

  /** True when older entries were trimmed from memory and the retained ones cannot fill `limit` for `account`. */
  isTailShort(account: string, limit: number): boolean {
    const s = this.ledger.state;
    return s.seq > s.journal.length && this.ledger.entries({ account }).length < limit;
  }

  /**
   * Every colony balance the journal does not explain, both ways: a resource `col.stock` holds that the journal does
   * not, and a colony account the state does not have. `stocks` by colony index, or the state itself.
   */
  reconcile(stocks: PlanetState | readonly Readonly<Record<string, number>>[]): BalanceMismatch[] {
    const list = Array.isArray(stocks) ? stocks : (stocks as PlanetState).colonies.map((_c, i) => getColonyStock(stocks as PlanetState, i) as Stock);
    const out: BalanceMismatch[] = [];
    const compare = (account: string, stock: Readonly<Record<string, number>>) => {
      const held = this.ledger.balances(account);
      for (const asset of [...new Set([...Object.keys(stock), ...Object.keys(held)])].sort()) {
        const want = stock[asset] ?? 0;
        const got = held[asset] ?? 0;
        if (want !== got) out.push({ account, asset, ledger: got, state: want });
      }
    };
    list.forEach((stock, i) => compare(colonyAccount(i), stock));
    for (const account of this.ledger.accounts()) if (colonyIndexOfAccount(account) >= list.length) compare(account, {});
    return out;
  }

  balances(account: string): Record<string, number> {
    return this.ledger.balances(account);
  }

  accounts(): string[] {
    return this.ledger.accounts();
  }

  /** Last assigned entry seq (0 = none). */
  get seq(): number {
    return this.ledger.state.seq;
  }

  /** Double-entry consistency of the journal (see `verifyLedger`). */
  verify(): ReturnType<Ledger['verify']> {
    return this.ledger.verify();
  }

  /** A copy of the whole ledger state, for a host that persists the journal with its snapshot. */
  toState(): LedgerState {
    return copyData(this.ledger.state);
  }
}
