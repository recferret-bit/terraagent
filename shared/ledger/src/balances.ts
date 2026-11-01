import type { AccountId, AssetId, BalanceSheet, LedgerState } from './types';

/** Default journal tail kept by a fresh ledger. */
export const DEFAULT_JOURNAL_LIMIT = 256;

/** An empty ledger. `journalLimit` 0 keeps the full journal (server); a bounded tail suits synced sim state. */
export function createLedgerState<R extends string = string>(opts: { journalLimit?: number } = {}): LedgerState<R> {
  const limit = opts.journalLimit ?? DEFAULT_JOURNAL_LIMIT;
  const journalLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
  return { seq: 0, journalLimit, balances: {}, opening: {}, journal: [] };
}

/** Balance of `asset` held by `account` in `sheet` (0 when absent; inherited keys like `constructor` count as absent). */
export function readSheet(sheet: BalanceSheet, account: AccountId, asset: AssetId): number {
  const row = Object.hasOwn(sheet, account) ? sheet[account] : undefined;
  return row !== undefined && Object.hasOwn(row, asset) ? row[asset] : 0;
}

/** Adds `delta` to `sheet[account][asset]`, dropping the cell when it returns to zero so the sheet stays canonical. */
export function addToSheet(sheet: BalanceSheet, account: AccountId, asset: AssetId, delta: number): void {
  const row = Object.hasOwn(sheet, account) ? sheet[account] : (sheet[account] = {});
  const next = (Object.hasOwn(row, asset) ? row[asset] : 0) + delta;
  if (next === 0) delete row[asset];
  else row[asset] = next;
  if (Object.keys(row).length === 0) delete sheet[account];
}

/** Balance of `asset` held by `account`. */
export function balanceOf(state: LedgerState, account: AccountId, asset: AssetId): number {
  return readSheet(state.balances, account, asset);
}

/** A copy of every non-zero balance held by `account`. */
export function balancesOf(state: LedgerState, account: AccountId): Record<AssetId, number> {
  return Object.hasOwn(state.balances, account) ? { ...state.balances[account] } : {};
}

/** Accounts with at least one non-zero balance, sorted. */
export function accountsOf(state: LedgerState): AccountId[] {
  return Object.keys(state.balances).sort();
}

/** Sum of every account's balance per asset. In a healthy double-entry ledger every value is 0 (so the map is empty). */
export function trialBalance(state: LedgerState): Record<AssetId, number> {
  const out: Record<AssetId, number> = {};
  for (const row of Object.values(state.balances)) {
    for (const [asset, v] of Object.entries(row)) {
      const next = (out[asset] ?? 0) + v;
      if (next === 0) delete out[asset];
      else out[asset] = next;
    }
  }
  return out;
}
