import type { BalanceSheet, JournalEntry } from '@terra/ledger';
import { LEDGER_REASONS, type LedgerPosting, type LedgerReason, type OpeningActor } from '@terra/sim';
import type { LedgerRow, StoredLedgerRow } from './ledger-store.port';

// Persistence helpers of the server journal: postings ↔ `world.ledger_entry` rows. The journal logic itself (posting,
// views, reconcile) is the shared `PlanetJournal` of `@terra/sim`.

/** Reason/actor/counter account of the opening entries of a brand-new planet from a snapshot (scenario). */
export const OPENING_REASON = 'ledger.opening' satisfies LedgerReason;
export const OPENING_ACTOR: OpeningActor = 'system:genesis';
export const OPENING_ACCOUNT = LEDGER_REASONS[OPENING_REASON].counter;

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

/** A DB row as a journal entry (dev endpoint). */
export function toJournalEntry(row: StoredLedgerRow): JournalEntry {
  return { seq: row.seq, at: row.tick, reason: row.reason, actor: row.actor, ...(row.ref === undefined ? {} : { ref: row.ref }), legs: row.legs.map((l) => ({ ...l })) };
}

/**
 * Summed leg cells (`account`, `asset`, `total`) as a canonical balance sheet: zero totals omitted, keys set as own
 * data properties (an id like `__proto__` from the database never reaches a prototype).
 */
export function sheetOf(cells: Iterable<{ readonly account: string; readonly asset: string; readonly total: number }>): BalanceSheet {
  const rows = new Map<string, Array<[string, number]>>();
  for (const c of cells) {
    if (c.total === 0) continue;
    if (!Number.isSafeInteger(c.total)) throw new Error(`ledger sum of ${c.account}/${c.asset} is not a safe integer: ${c.total}`);
    const row = rows.get(c.account) ?? [];
    row.push([c.asset, c.total]);
    rows.set(c.account, row);
  }
  return Object.fromEntries([...rows].map(([account, row]) => [account, Object.fromEntries(row)]));
}
