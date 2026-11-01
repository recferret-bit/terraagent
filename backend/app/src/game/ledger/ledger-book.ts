import { createLedgerState, Ledger, transferLegs, type JournalEntry } from '@terra/ledger';
import { LEDGER_REASONS, colonyAccount, colonyIndexOfAccount, isSystemAccount, type LedgerPosting, type LedgerReason } from '@terra/sim';
import type { LedgerRow, StoredLedgerRow } from './ledger-store.port';

/** Journal entries a loaded planet keeps in memory; older ones fold into `opening` (the DB has the full journal). */
export const LEDGER_JOURNAL_LIMIT = 1024;

/** Server-only reason/actor/counter account of the opening entries of a brand-new planet from a snapshot (scenario). */
export const OPENING_REASON = 'ledger.opening' satisfies LedgerReason;
export const OPENING_ACTOR = 'system:genesis';
export const OPENING_ACCOUNT = LEDGER_REASONS[OPENING_REASON].counter;

/** A loaded planet's in-memory ledger: `sys:*` accounts may go negative (sources and sinks), colonies may not. */
export function newPlanetLedger(journalLimit = LEDGER_JOURNAL_LIMIT): Ledger {
  return new Ledger(createLedgerState({ journalLimit }), isSystemAccount);
}

/** The rows of one step's postings: `idx` is the posting's index in the step. */
export function rowsOf(tick: number, postings: readonly LedgerPosting[]): LedgerRow[] {
  return postings.map((p, idx) => ({
    tick, idx, reason: p.reason, actor: p.actor, ...(p.ref === undefined ? {} : { ref: p.ref }), legs: p.legs,
  }));
}

/** Rows of postings that span several ticks (a scenario's setup): `idx` counts per tick, in order. */
export function rowsOfPostings(postings: readonly LedgerPosting[]): LedgerRow[] {
  const perTick = new Map<number, number>();
  return postings.map((p) => {
    const idx = perTick.get(p.at) ?? 0;
    perTick.set(p.at, idx + 1);
    return { tick: p.at, idx, reason: p.reason, actor: p.actor, ...(p.ref === undefined ? {} : { ref: p.ref }), legs: p.legs };
  });
}

/** Posts a stored row into a ledger (the row's tick is the entry's `at`). Never throws. */
export function postRow(ledger: Ledger, row: LedgerRow) {
  return ledger.post({ at: row.tick, reason: row.reason, actor: row.actor, ...(row.ref === undefined ? {} : { ref: row.ref }), legs: row.legs });
}

/** A DB row as a journal entry (dev endpoint). */
export function toJournalEntry(row: StoredLedgerRow): JournalEntry {
  return { seq: row.seq, at: row.tick, reason: row.reason, actor: row.actor, ...(row.ref === undefined ? {} : { ref: row.ref }), legs: row.legs.map((l) => ({ ...l })) };
}

/**
 * Opening entries of a brand-new planet whose colonies already hold stock (a scenario seeds it without postings): one
 * `sys:opening → colony:<n>` entry per colony with a non-zero stock, so the journal explains every starting balance.
 */
export function openingRows(tick: number, stocks: readonly Readonly<Record<string, number>>[]): LedgerRow[] {
  const rows: LedgerRow[] = [];
  stocks.forEach((stock, colony) => {
    const amounts = Object.fromEntries(Object.entries(stock).filter(([, v]) => v > 0));
    const legs = transferLegs(OPENING_ACCOUNT, colonyAccount(colony), amounts);
    if (legs?.length) rows.push({ tick, idx: rows.length, reason: OPENING_REASON, actor: OPENING_ACTOR, legs });
  });
  return rows;
}

export interface BalanceMismatch {
  readonly account: string;
  readonly asset: string;
  /** Balance the journal says. */
  readonly ledger: number;
  /** `col.stock` of the restored state. */
  readonly state: number;
}

/**
 * Compares every `colony:<n>` balance of the ledger with the restored state's colony stock (by colony index), both
 * ways: a resource the state holds but the journal does not explain, and a colony account the state does not have.
 */
export function reconcileColonies(ledger: Ledger, stocks: readonly Readonly<Record<string, number>>[]): BalanceMismatch[] {
  const out: BalanceMismatch[] = [];
  const compare = (account: string, stock: Readonly<Record<string, number>>) => {
    const held = ledger.balances(account);
    for (const asset of [...new Set([...Object.keys(stock), ...Object.keys(held)])].sort()) {
      const want = stock[asset] ?? 0;
      const got = held[asset] ?? 0;
      if (want !== got) out.push({ account, asset, ledger: got, state: want });
    }
  };
  stocks.forEach((stock, i) => compare(colonyAccount(i), stock));
  for (const account of ledger.accounts()) {
    const i = colonyIndexOfAccount(account);
    if (i >= stocks.length) compare(account, {});
  }
  return out;
}
