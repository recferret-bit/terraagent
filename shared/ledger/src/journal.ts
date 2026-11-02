import { addToSheet, trialBalance } from './balances';
import type { BalanceSheet, JournalEntry, JournalFilter, LedgerState, VerifyResult } from './types';

/** Folds entries beyond `journalLimit` (oldest first) into `opening`, keeping `opening + Σ journal = balances`. */
export function trimJournal(state: LedgerState): void {
  if (state.journalLimit <= 0) return;
  const excess = state.journal.length - state.journalLimit;
  if (excess <= 0) return;
  for (const entry of state.journal.splice(0, excess)) {
    for (const leg of entry.legs) addToSheet(state.opening, leg.account, leg.asset, leg.delta);
  }
}

function matches<R extends string>(e: JournalEntry<R>, f: JournalFilter<R>): boolean {
  if (f.sinceSeq !== undefined && e.seq <= f.sinceSeq) return false;
  if (f.reason !== undefined && e.reason !== f.reason) return false;
  if (f.actor !== undefined && e.actor !== f.actor) return false;
  if (f.ref !== undefined && e.ref !== f.ref) return false;
  if (f.account === undefined && f.asset === undefined) return true;
  return e.legs.some(
    (l) => (f.account === undefined || l.account === f.account) && (f.asset === undefined || l.asset === f.asset),
  );
}

/** Retained journal entries matching `filter`, oldest first. */
export function entries<R extends string>(state: LedgerState<R>, filter: JournalFilter<R> = {}): JournalEntry<R>[] {
  return state.journal.filter((e) => matches(e, filter));
}

function diffSheets(expected: BalanceSheet, actual: BalanceSheet, problems: string[]): void {
  const accounts = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const account of [...accounts].sort()) {
    const assets = new Set([...Object.keys(expected[account] ?? {}), ...Object.keys(actual[account] ?? {})]);
    for (const asset of [...assets].sort()) {
      const want = expected[account]?.[asset] ?? 0;
      const got = actual[account]?.[asset] ?? 0;
      if (want !== got) problems.push(`balance ${account}/${asset} is ${got}, journal says ${want}`);
    }
  }
}

/**
 * Full consistency check: every journal entry is balanced and whole-unit, `seq` is gap-free, `opening + Σ journal`
 * equals `balances`, and the trial balance of every asset is zero.
 */
export function verifyLedger(state: LedgerState): VerifyResult {
  const problems: string[] = [];
  const replay: BalanceSheet = {};
  for (const [account, row] of Object.entries(state.opening)) {
    for (const [asset, v] of Object.entries(row)) addToSheet(replay, account, asset, v);
  }
  let prevSeq = state.journal.length > 0 ? state.journal[0].seq - 1 : state.seq;
  for (const entry of state.journal) {
    if (entry.seq !== prevSeq + 1) problems.push(`seq gap before entry ${entry.seq}`);
    prevSeq = entry.seq;
    const sums: Record<string, number> = {};
    for (const leg of entry.legs) {
      if (!Number.isSafeInteger(leg.delta)) problems.push(`entry ${entry.seq} has non-integer delta ${leg.delta}`);
      sums[leg.asset] = (sums[leg.asset] ?? 0) + leg.delta;
      addToSheet(replay, leg.account, leg.asset, leg.delta);
    }
    for (const [asset, sum] of Object.entries(sums)) {
      if (sum !== 0) problems.push(`entry ${entry.seq} is unbalanced in ${asset} by ${sum}`);
    }
  }
  if (prevSeq !== state.seq) problems.push(`last entry seq ${prevSeq} != ledger seq ${state.seq}`);
  diffSheets(replay, state.balances, problems);
  for (const [asset, sum] of Object.entries(trialBalance(state))) problems.push(`trial balance of ${asset} is ${sum}, not 0`);
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
