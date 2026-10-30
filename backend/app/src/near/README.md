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
