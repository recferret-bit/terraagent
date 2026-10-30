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
