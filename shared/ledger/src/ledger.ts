import { isMajor } from './amount';
import { accountsOf, balanceOf, balancesOf, createLedgerState, trialBalance } from './balances';
import { entries, verifyLedger } from './journal';
import { post } from './post';
import type {
  AccountId,
  AssetId,
  JournalEntry,
  JournalFilter,
  Leg,
  LedgerState,
  NegativePolicy,
  PostResult,
  PostingInput,
  VerifyResult,
} from './types';

/** Metadata of a transfer: everything of a posting except its legs. */
export type TransferMeta<R extends string> = Omit<PostingInput<R>, 'legs'>;

/**
 * Builds the legs moving `amounts` (asset → whole units) from `from` to `to`: one debit and one credit per asset,
 * zero amounts skipped, assets in sorted order so the journal is deterministic. Returns null when an amount is not a
 * non-negative whole number.
 */
export function transferLegs(from: AccountId, to: AccountId, amounts: Readonly<Record<AssetId, number>>): Leg[] | null {
  const legs: Leg[] = [];
  for (const asset of Object.keys(amounts).sort()) {
    const amount = amounts[asset];
    if (!isMajor(amount) || amount < 0) return null;
    if (amount === 0) continue;
    legs.push({ account: from, asset, delta: -amount }, { account: to, asset, delta: amount });
  }
  return legs;
}

/**
 * A ledger over a plain-data {@link LedgerState}. The state is mutated in place, so a host can keep it in sim state,
 * a snapshot or a database row; the class only adds the negative-balance policy and convenience methods.
 */
export class Ledger<R extends string = string> {
  readonly state: LedgerState<R>;
  private readonly mayGoNegative: NegativePolicy;

  constructor(state: LedgerState<R> = createLedgerState<R>(), mayGoNegative: NegativePolicy = () => false) {
    this.state = state;
    this.mayGoNegative = mayGoNegative;
  }

  /** Posts a raw multi-leg entry (atomic, never throws). */
  post(input: PostingInput<R>): PostResult<R> {
    return post(this.state, input, this.mayGoNegative);
  }

  /** Moves `amounts` from `from` to `to` as one entry. Rejects `invalid_amount` on fractions or negatives. */
  transfer(from: AccountId, to: AccountId, amounts: Readonly<Record<AssetId, number>>, meta: TransferMeta<R>): PostResult<R> {
    const legs = transferLegs(from, to, amounts);
    if (!legs) return { ok: false, code: 'invalid_amount', detail: 'amounts must be whole non-negative numbers' };
    return this.post({ ...meta, legs });
  }

  balance(account: AccountId, asset: AssetId): number {
    return balanceOf(this.state, account, asset);
  }

  balances(account: AccountId): Record<AssetId, number> {
    return balancesOf(this.state, account);
  }

  accounts(): AccountId[] {
    return accountsOf(this.state);
  }

  /** Whether `account` holds at least `amounts` of every asset. */
  covers(account: AccountId, amounts: Readonly<Record<AssetId, number>>): boolean {
    return Object.entries(amounts).every(([asset, need]) => this.balance(account, asset) >= need);
  }

  entries(filter?: JournalFilter<R>): JournalEntry<R>[] {
    return entries(this.state, filter);
  }

  trialBalance(): Record<AssetId, number> {
    return trialBalance(this.state);
  }

  verify(): VerifyResult {
    return verifyLedger(this.state);
  }
}
