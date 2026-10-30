# NEAR integration: port bindings

Ports (abstract classes) live in `application/ports/`; adapters live in `infrastructure/adapters/**/*.adapter.ts` and are the
only thing that talks to a chain. `infrastructure/near-infrastructure.module.ts` is the **only** place NEAR ports are bound
(ESLint `no-restricted-imports` blocks `**/adapters/**` imports outside `near/infrastructure`, `ai/`, `notify/`).

## Selecting an adapter (fail-closed, readable before DI)

| Port | Variable | Values |
|---|---|---|
| each of the 11 NEAR ports | `NEAR_ADAPTER_<UPPER_SNAKE(port)>` e.g. `NEAR_ADAPTER_CHAIN_READ`, `NEAR_ADAPTER_BADGE_NFT` | exactly `testnet` or `mainnet`; anything else (unset, typo, `Mainnet`) is `mock` |
| `LlmProviderPort` | `AI_PROVIDER` (+ `AI_LIVE`) | exactly `zai`, else `mock`. Outside production `zai` also needs `AI_LIVE=1` (else mock); in production `zai` suffices |
| `NotifierPort` | `NOTIFY_ADAPTER` | `live`, `webpush` or `telegram` -> live; anything else mock |

`nearAdapterFor(port, env)`, `aiProvider(env)`, `notifyAdapter(env)` are plain functions over an env source.

## Production guard (boot aborts before Nest starts)

Each module exports an env section (`near`, `ai`, `notify`). With `NODE_ENV=production`, any port resolving to mock aborts boot
with an `EnvError` naming every mocked port, unless the integration's allow flag is exactly `true` (one flag per integration):
`NEAR_ALLOW_MOCK_IN_PROD` (11 NEAR ports), `AI_ALLOW_MOCK_IN_PROD` (LlmProvider), `NOTIFY_ALLOW_MOCK_IN_PROD` (Notifier).
Selecting `testnet`/`mainnet`/`zai`/`live` for a port with no registered adapter also aborts boot (any environment), naming the port.

## Adding an adapter (no binding module edit)

Drop `infrastructure/adapters/<anything>/<name>.adapter.ts` (`ai/adapters/`, `notify/adapters/` likewise) exporting
`adapterOf({ port: ChainReadPort, kind: 'mock' | 'testnet' | 'mainnet', useClass: MockChainRead })`. Adapters are discovered at
module load (like Nest modules); the class may inject providers from the binding module. A port with no adapter at all stays unbound;
a port with adapters but none of the selected kind fails when first resolved.


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

## Chain outbox

**Rule: every chain write goes through the outbox, in the same database transaction as the game change that causes it, with a deterministic `opId`.** Game code never calls a NEAR port directly (NEAR §1a rule 6).

```ts
await withTransaction(prisma, async (tx) => {
  await colonies.recordExport(colonyId, seq, tx);                       // the game change
  await outbox.enqueue({ opId: opId('cargo-export', colonyId, seq),     // cargo-export:{colonyId}:{seq}
                         port: 'CargoToken', method: 'mint', payload }, tx);
});
```

- `ChainOutboxRepository.enqueue(entry, tx?)` (`application/outbox/`): insert-or-ignore on `opId`, so repeating it is a no-op returning the existing row. A rolled-back game change leaves no outbox row. Derive the id from the game fact (never random, never a timestamp); build it with `opId(kind, ...parts)` (max 160 chars).
- `OutboxRelay` (started by `OutboxRelayService`) polls `chain.chain_outbox` for due `PENDING`/`FAILED` rows, claims them with `FOR UPDATE SKIP LOCKED` (`RUNNING`, `lockedUntil = now + lease`), resolves the port from the Nest container by name and calls `port[method]({ ...payload, opId })`. Success stores `receipt` + `txHash` and sets `DONE`.
- **Crash safety.** A relay that dies mid-call leaves the row `RUNNING`; once `lockedUntil` passes, any relay reclaims it and calls again with the same `opId`. Adapters are idempotent by `opId`, so the retry returns the stored receipt: one effect, one receipt. Result writes are fenced on the claim, so a stale relay cannot overwrite a newer one.
- **Failure.** Every claim counts as an attempt. On error: `FAILED`, `nextAttemptAt = now + jitter(min(2^attempts s, 10 min))`, `lastError`; after `OUTBOX_MAX_ATTEMPTS` the row is `DEAD` (alert on `ta_chain_outbox_dead`).
- Methods used through the outbox must take their input as one object containing `opId` (all port methods do).

| Env | Default | Meaning |
|---|---|---|
| `OUTBOX_RELAY_ENABLED` | on (off when `NODE_ENV=test`) | `true`/`false` |
| `OUTBOX_POLL_MS` | 1000 | Poll interval |
| `OUTBOX_LEASE_MS` | 30000 | Claim lease; must exceed the slowest port call |
| `OUTBOX_MAX_ATTEMPTS` | 8 | Attempts before `DEAD` |

Metrics: `ta_chain_outbox_pending`, `ta_chain_outbox_dead`, `ta_chain_outbox_relayed_total{port,status}` (`done`/`failed`/`dead`).

## Contract tests

Every port has one suite, and the same assertions run against every adapter of that port (NEAR §1a rules 5 and 8, D-30).

- **Harness** (`near/__contract__/harness.ts`): `describePortContract(port, label, makeAdapter, suite)` is generic (the LLM and notifier ports use it too); `describeNearPortContract` adds `expectReceipt` (`mock:` hash and network `mock` for mocks, a real base58 hash otherwise). `makeAdapter(env)` returns `{ port, kind: 'mock' | 'testnet' | 'mainnet', cleanup?, ...helpers }`. A suite calls `test`, `mockOnly` or `realOnly` (the latter two skip on the wrong kind).
- **A wave adds its port's suite** by creating one file `near/__contract__/<port>.contract.ts` (LLM and notifier: `src/ports/__contract__/`) that exports `contract = defineNearContract({ port: 'CargoToken', helpers, suite })`. `helpers(port, kind, env)` supplies what the suite needs beyond the port (e.g. `ChainRead` gets `writeReceipt`). Shared suites live in `*.suite.ts` (not discovered), e.g. `nft.suite.ts` for Badge and Deed. No runner edit.
- **Mocks in CI**: `npm run test:contract` runs `backend/app/test/contract/ports.contract.spec.ts`. It discovers every `*.contract.ts`, boots the app on a fresh test database (Postgres needed), resolves each port from the container and runs its suite against the adapter `NEAR_ADAPTER_<PORT>` selects (mock by default). Its own Vitest config is `vitest.contract.config.ts`; the file is not an `*.int.spec.ts` and is excluded from the default config, so `npx vitest run` and `npm run test:integration` never repeat it. Mock-specific checks stay in `test/near/*.int.spec.ts`.
- **Real adapters** (W23): `npm run contract:real -- --port ChainRead [--network mainnet]` sets `NEAR_ADAPTER_CHAIN_READ=testnet` and runs only that port's suite. With no adapter of that kind registered it fails with `no testnet adapter registered for ChainRead`. `ChainRead` reads an existing receipt from `CONTRACT_CHAIN_READ_TX` (a successful tx hash on the network) since a real adapter has no write.
- **Fakes** (`near/testing/`, rule 8): `InMemoryChainRead`, `InMemoryBadgeNft`, `InMemoryCargoToken` extend the abstract ports over a Map ledger (idempotent by `opId`, `mock:` hashes, the same `NearException` codes). Unit tests construct them directly; they are never bound in a module. `test/near/in-memory-contract.spec.ts` runs the ChainRead and Badge suites against them in the default `npx vitest run`, which proves a suite does not depend on Postgres. A new fake gets a line there.
