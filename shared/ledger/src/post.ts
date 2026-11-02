import { isMajor } from './amount';
import { addToSheet, readSheet } from './balances';
import { trimJournal } from './journal';
import type {
  AccountId,
  AssetId,
  JournalEntry,
  Leg,
  LedgerReject,
  LedgerState,
  NegativePolicy,
  PostResult,
  PostingInput,
} from './types';

const NONE_NEGATIVE: NegativePolicy = () => false;

function reject(code: LedgerReject['code'], extra: Omit<LedgerReject, 'ok' | 'code'> = {}): LedgerReject {
  return { ok: false, code, ...extra };
}

/** An id must be a non-empty string that is not an `Object.prototype` key (`__proto__`, `constructor`, …). */
function isId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && !Object.hasOwn(Object.prototype, id);
}

/** Shape check of each leg: plain-key account and asset ids and a non-zero whole-unit delta. */
function checkLegs(legs: readonly Leg[]): LedgerReject | null {
  if (!Array.isArray(legs) || legs.length < 2) return reject('no_legs', { detail: 'an entry needs at least two legs' });
  for (const leg of legs as readonly (Leg | null | undefined)[]) {
    if (!leg || !isId(leg.account) || !isId(leg.asset)) {
      return reject('invalid_leg', { detail: 'leg needs a non-empty, non-reserved account and asset' });
    }
    if (!isMajor(leg.delta) || leg.delta === 0) {
      return reject('invalid_amount', { account: leg.account, asset: leg.asset, detail: `delta ${String(leg.delta)}` });
    }
  }
  return null;
}

/** The double-entry rule: per asset the legs sum to zero. Every partial sum must stay a safe integer (exact). */
function checkBalanced(legs: readonly Leg[]): LedgerReject | null {
  const sums = new Map<string, number>();
  for (const leg of legs) {
    const next = (sums.get(leg.asset) ?? 0) + leg.delta;
    if (!Number.isSafeInteger(next)) return reject('invalid_amount', { asset: leg.asset, detail: `legs of ${leg.asset} overflow` });
    sums.set(leg.asset, next);
  }
  for (const [asset, sum] of sums) {
    if (sum !== 0) return reject('unbalanced', { asset, detail: `legs of ${asset} sum to ${sum}` });
  }
  return null;
}

/**
 * Replays the legs on the touched balances: every intermediate balance must stay a safe integer, and no account
 * outside the negative policy may end below zero with a net debit (legs on the same account/asset are netted).
 */
function checkFunds(state: LedgerState, legs: readonly Leg[], mayGoNegative: NegativePolicy): LedgerReject | null {
  const after = new Map<AccountId, Map<AssetId, number>>();
  for (const { account, asset, delta } of legs) {
    let row = after.get(account);
    if (!row) after.set(account, (row = new Map()));
    const next = (row.get(asset) ?? readSheet(state.balances, account, asset)) + delta;
    if (!Number.isSafeInteger(next)) return reject('invalid_amount', { account, asset, detail: 'balance would overflow' });
    row.set(asset, next);
  }
  for (const [account, row] of after) {
    for (const [asset, end] of row) {
      const have = readSheet(state.balances, account, asset);
      if (end >= 0 || end >= have || mayGoNegative(account)) continue;
      return reject('insufficient_funds', { account, asset, have, need: have - end });
    }
  }
  return null;
}

/** Same reason, actor, ref and legs (`at` may differ: a retry at a later tick is still the same operation). */
function sameEntry(a: JournalEntry, b: PostingInput): boolean {
  if (a.reason !== b.reason || a.actor !== b.actor || a.ref !== b.ref || a.legs.length !== b.legs.length) return false;
  return a.legs.every((l, i) => l.account === b.legs[i].account && l.asset === b.legs[i].asset && l.delta === b.legs[i].delta);
}

/** Idempotency: a retained entry with the same `opId` is returned as a duplicate, or rejected if it differs. */
function findDuplicate<R extends string>(state: LedgerState<R>, input: PostingInput<R>): PostResult<R> | null {
  if (input.opId === undefined) return null;
  const prior = state.journal.find((e) => e.opId === input.opId);
  if (!prior) return null;
  if (!sameEntry(prior, input)) return reject('op_conflict', { detail: `opId ${input.opId} was posted with other content` });
  return { ok: true, entry: prior, duplicate: true };
}

/**
 * Validates and applies one entry atomically: either every leg is applied and the entry is appended to the journal,
 * or nothing changes and a reject code is returned. Never throws.
 */
export function post<R extends string>(
  state: LedgerState<R>,
  input: PostingInput<R>,
  mayGoNegative: NegativePolicy = NONE_NEGATIVE,
): PostResult<R> {
  const shape = checkLegs(input.legs);
  if (shape) return shape;
  const dup = findDuplicate(state, input);
  if (dup) return dup;
  const bad = checkBalanced(input.legs) ?? checkFunds(state, input.legs, mayGoNegative);
  if (bad) return bad;

  const legs = input.legs.map((l) => ({ account: l.account, asset: l.asset, delta: l.delta }));
  for (const leg of legs) addToSheet(state.balances, leg.account, leg.asset, leg.delta);
  const entry: JournalEntry<R> = { seq: state.seq + 1, at: input.at, reason: input.reason, actor: input.actor, legs };
  if (input.ref !== undefined) entry.ref = input.ref;
  if (input.opId !== undefined) entry.opId = input.opId;
  state.seq = entry.seq;
  state.journal.push(entry);
  trimJournal(state);
  return { ok: true, entry, duplicate: false };
}
