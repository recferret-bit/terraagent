
## Mock chain

State of the mock NEAR adapters lives in Postgres (`chain.mock_chain_*`: account, balance, nft, nft_meta_history, intent, dao, dao_proposal, escrow, receipt; schema `shared/db/prisma/mock-chain.prisma`). Every `Mock*Adapter` extends `MockChainBase` (`infrastructure/mock/mock-chain.base.ts`).

- `this.call(port, method, opId | undefined, async (tx) => payload, { failCode? })` returns a `ChainReceipt` (`network: 'mock'`). It sleeps a random latency, maybe injects a failure, runs the callback and writes the `mock_chain_receipt` row in one transaction. `callWithResult` also returns the callback's value.
- **Idempotency.** The same `opId` returns the stored receipt and never re-runs the callback. The hash is `mock:` + 44 base58 characters, derived from the `opId` (random when there is none). `blockHeight` comes from the Postgres sequence `chain.mock_chain_block_height_seq`, so it is monotonic.
- **Ledger helpers.** `credit`, `debit` (not enough funds: `NEAR_INSUFFICIENT_BALANCE`, transaction rolls back), `balanceOf`, `ensureAccount`. Amounts are decimal strings (`numeric(40,0)`).
- **Errors.** `NEAR_ERROR_CODES` in `domain/errors.ts` lists every stable code with HTTP status and description; throw `NearException(code)` (a `CoreException`). Add new codes there.

| Env | Default | Meaning |
|---|---|---|
| `MOCK_LATENCY_MIN_MS` / `MOCK_LATENCY_MAX_MS` | 300 / 1500 | Uniform random sleep before each call |
| `MOCK_FAIL_RATE` | 0 | Probability 0..1 of throwing `NEAR_MOCK_INJECTED_FAILURE` (503) with no state change and no receipt |
| `MOCK_SEED` | unset | Seeds latency, failure and hash randomness for reproducible tests |

Tests build the base with `new FixtureMock(prisma, config, { sleep })` (fake sleep, no real waits); see `backend/app/test/near/`. The binding module provides `MOCK_CHAIN_CONFIG` (optional; defaults to `parseMockChainConfig()`).
