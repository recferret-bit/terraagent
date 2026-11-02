/**
 * Double-entry ledger model. Every change of a balance is a journal entry made of legs; the legs of one entry sum to
 * zero per asset, so value is only ever moved between accounts, never created or lost. "Sources" and "sinks" (the
 * world that yields ore, the construction site that consumes it) are accounts too, and are the ones allowed to go
 * negative. All types are plain data (MessagePack-able) so a ledger can live inside sim state or a database row.
 */

/** Account id, e.g. `colony:0`, `sys:construction`. */
export type AccountId = string;
/** Asset id, e.g. a resource key `metals.t1`. */
export type AssetId = string;

/** One side of an entry: `delta > 0` raises `account`'s balance of `asset`, `delta < 0` lowers it. Whole units. */
export interface Leg {
  account: AccountId;
  asset: AssetId;
  delta: number;
}

/** Who caused a change and why: the "by who" and "reason" columns of the journal. */
export interface EntryMeta<R extends string = string> {
  /** Closed reason code from the caller's catalog (`construction.spend`, `terraform.yield`, …). */
  reason: R;
  /** Who caused it, e.g. `player:p_123`, `colony:0`, `system:terraform`, `dev:console`. */
  actor: string;
  /** What it relates to, e.g. `order:42`, `tile:3,-1`. */
  ref?: string;
  /** Idempotency key: posting the same `opId` again returns the original entry and changes nothing. */
  opId?: string;
}

/** A request to post an entry. `at` is the caller's clock (a sim tick, or epoch ms on the server). */
export interface PostingInput<R extends string = string> extends EntryMeta<R> {
  at: number;
  legs: readonly Leg[];
}

/** A posted, immutable journal entry. `seq` is gap-free and increasing per ledger. */
export interface JournalEntry<R extends string = string> extends EntryMeta<R> {
  seq: number;
  at: number;
  legs: Leg[];
}

/** Balances per account per asset. Missing means zero. */
export type BalanceSheet = Record<AccountId, Record<AssetId, number>>;

/**
 * The whole ledger as plain data. `opening` holds the balances folded out of the journal when it is trimmed, so
 * `opening + Σ journal = balances` always holds and the ledger can be verified with a bounded journal.
 */
export interface LedgerState<R extends string = string> {
  /** Last assigned entry `seq` (0 = none yet). */
  seq: number;
  /** Max journal entries kept; older ones fold into `opening`. `0` keeps everything. */
  journalLimit: number;
  balances: BalanceSheet;
  opening: BalanceSheet;
  journal: JournalEntry<R>[];
}

export type LedgerRejectCode =
  | 'no_legs'
  | 'invalid_leg'
  | 'invalid_amount'
  | 'unbalanced'
  | 'insufficient_funds'
  | 'op_conflict';

export interface LedgerReject {
  ok: false;
  code: LedgerRejectCode;
  /** Offending account/asset, plus `have`/`need` for `insufficient_funds`. */
  account?: AccountId;
  asset?: AssetId;
  have?: number;
  need?: number;
  detail?: string;
}

export interface LedgerAccept<R extends string = string> {
  ok: true;
  entry: JournalEntry<R>;
  /** True when `opId` was already posted and the original entry is returned unchanged. */
  duplicate: boolean;
}

export type PostResult<R extends string = string> = LedgerAccept<R> | LedgerReject;

/** Which accounts may hold a negative balance (sources/sinks). Default: none. */
export type NegativePolicy = (account: AccountId) => boolean;

export interface JournalFilter<R extends string = string> {
  account?: AccountId;
  asset?: AssetId;
  reason?: R;
  actor?: string;
  ref?: string;
  /** Only entries with `seq > sinceSeq`. */
  sinceSeq?: number;
}

export type VerifyResult = { ok: true } | { ok: false; problems: string[] };
