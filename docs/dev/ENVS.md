# Environment variables

Defaults the app uses when a variable is unset. The running catalog, including dev-console commands, is [`DEV_TOOLS.md`](./DEV_TOOLS.md). Later waves add their own rows here. Do not put this file in the repository root.

| Variable | Default | What it does |
|---|---|---|
| `NEAR_ADAPTER_IDENTITY` | `mock` | `IdentityPort`. `testnet` or `mainnet` selects the real adapter (W23). Anything else is the mock. |
| `NEAR_ADAPTER_RELAYER` | `mock` | `RelayerPort`. Same selection rule as identity. |
| `NEAR_KEK` | dev 32-byte key | Base64 of 32 bytes. Seals ed25519 seeds (AES-256-GCM). Production refuses a missing key or the dev key. |
| `MOCK_OAUTH_SECRET` | `terra-dev-mock-oauth-secret` | HMAC secret for `/dev/mock-oauth` tokens. Unset or empty uses the default. |
| `NEAR_ADAPTER_INTENTS` | `mock` | `IntentsPort` (F2 markets, W13): the mock verifier ledger in Postgres (`mock_chain_intents_balance`). `testnet` or `mainnet` selects a real adapter (W23; `intents.near` has no testnet, NEAR-64). Also selects the read-only `IntentsBalanceRead` companion. |
| `NEAR_ADAPTER_CARGO` | `mock` | `CargoTokenPort` (W10 cargo, also read by the market for cargo balances). Same selection rule. |
| `NEAR_ALLOW_MOCK_IN_PROD` | unset | Production refuses any mock NEAR adapter (including Intents) unless this is `true`. Mock tokens are labelled "mock" in every UI. |
| `TA_ECONOMY_READ_TOKEN` | dev `dev-economy-reader` (not in production) | Bearer token of the economy `read` role (`/v1/economy/*`). Production without it: no read role. |
| `TA_ECONOMY_EDIT_TOKEN` | dev `dev-economy-operator` (not in production) | Bearer token of the `edit` role (candidate edits, experiments); includes read. |
| `TA_ECONOMY_ACTIVATE_TOKEN` | dev `dev-economy-activator` (not in production) | Bearer token of the operators-only `activate` role (approve, activate, rollback). Never given to AI experiment credentials. |
| `TA_ECONOMY_EXPERIMENT_WORKERS` | `1` | Concurrent experiment run threads (1..16). |
| `TA_ECONOMY_EXPERIMENT_LEASE_MS` | `30000` | Experiment run lease in ms (min 1000); an expired lease makes a crashed run reclaimable. |
| `TA_ECONOMY_ARTIFACT_DIR` | `tests/economy/artifacts/` | Where experiment artifacts are written (`<dir>/<experimentId>/<name>`). |
