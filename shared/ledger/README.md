# @terra/ledger — double-entry ledger in whole units

Every resource amount in the game (a colony's metals, the water a pump yields, a construction site's spend) is an
integer number of **major units** held in a double-entry ledger. The sim calls it inside `step()`, the browser and the
server use the same code, so it is pure and isomorphic like `@terra/sim` (SIM-D-06): no clock, no randomness, no
timers, no I/O, no host globals, no async, and no other `@terra/*` import. `shared/sim/eslint.rules.js` enforces it.
State is plain data (MessagePack-able), so a ledger lives inside sim state, a snapshot or a database row.

## Model

- **Accounts** (`colony:0`, `sys:construction`, `player:p_123`) hold a balance per **asset** (`metals.t1`). A missing
  cell is zero; cells and rows that return to zero are deleted, so the sheet is canonical.
- An **entry** is ≥ 2 **legs** `{ account, asset, delta }`. Per asset the deltas sum to zero: value only moves between
  accounts. Sources (the world yielding ore) and sinks (a site consuming it) are accounts too.
- Each entry carries **`reason`** (closed code from the caller's catalog, `construction.spend`), **`actor`** (who caused
  it, `system:terraform`), optional **`ref`** (what it relates to, `order:42`), **`at`** (caller's clock: sim tick or
  epoch ms) and a gap-free **`seq`**.
- **`opId`** makes a post idempotent: the same `opId` with the same reason/actor/ref/legs returns
  `{ ok: true, duplicate: true }` with the original entry (`at` may differ: a retry at a later tick); different content
  is `op_conflict`. Only the **retained** journal is searched — once an entry is trimmed out of the tail, its `opId`
  posts again as a new entry. Keep `journalLimit` larger than any retry window, or `0` where exactly-once matters.
- The **negative policy** `(account) => boolean` names the accounts allowed below zero (sources/sinks). Every other
  account must end each entry ≥ 0 after netting its legs; the default policy allows none.
- **Journal tail + opening:** `journalLimit` (default 256, `0` = unlimited) bounds the journal. Trimmed entries fold
  into `opening`, so `opening + Σ journal == balances` always holds and `verifyLedger` works on a bounded journal.

## API

| Export | File | Notes |
|---|---|---|
| `Ledger` | `src/ledger.ts` | Wraps a `LedgerState` in place plus a negative policy: `post`, `transfer`, `balance`, `balances`, `accounts`, `covers`, `entries`, `trialBalance`, `verify` |
| `transferLegs(from, to, amounts)` | `src/ledger.ts` | One debit + one credit per asset, assets sorted, zeros skipped; `null` on a negative or fractional amount |
| `post(state, input, policy?)` | `src/post.ts` | Validate and apply one entry atomically; returns `PostResult` |
| `createLedgerState({ journalLimit })` | `src/balances.ts` | Empty state; `DEFAULT_JOURNAL_LIMIT` = 256, non-finite → 0 |
| `balanceOf`, `balancesOf`, `accountsOf`, `readSheet`, `trialBalance` | `src/balances.ts` | Reads; `trialBalance` is `{}` in a healthy ledger |
| `entries(state, filter)`, `trimJournal`, `verifyLedger` | `src/journal.ts` | Filter by account/asset/reason/actor/ref/`sinceSeq`; verify replays `opening + journal` and checks seq, balance, whole units, trial balance |
| `isMajor`, `isPositiveMajor`, `shareBp`, `ratioToBp`, `owedAt`, `BP_SCALE` | `src/amount.ts` | Whole-unit maths: `shareBp` = exact `floor(amount × bp / 10000)`; `owedAt(total, p)` = `floor(total × p)`, exactly `total` at `p ≥ 1` |
| Types | `src/types.ts` | `Leg`, `PostingInput`, `JournalEntry`, `LedgerState`, `PostResult`, `LedgerRejectCode`, `NegativePolicy`, `JournalFilter`, `VerifyResult` |

Reject codes, in check order: `no_legs` (< 2 legs) → `invalid_leg` (empty, non-string or `Object.prototype` key id
such as `__proto__`/`constructor`) → `invalid_amount` (zero, fractional or unsafe delta) → `op_conflict` →
`unbalanced` (per-asset sum ≠ 0; a partial sum leaving the safe-integer range is `invalid_amount`) →
`insufficient_funds` (with `have`/`need`; a balance that would leave the safe-integer range is `invalid_amount`).

## Rules

- **Whole units only.** Deltas and balances are safe integers. Any share or progress slice goes through `shareBp` /
  `owedAt` so it rounds down deterministically, and paying `owedAt(total, p₂) − owedAt(total, p₁)` per step settles
  exactly `total`.
- **Never throws.** Bad input is a reject code; a rejected or duplicate post leaves the state byte-identical.
- **Pure and deterministic.** Same state + same inputs → identical state and results on every host.
- Tests: `npm test` / `npm run coverage` (100 % lines/branches/functions/statements of `src/`) in this folder;
  property tests use `fast-check`.
