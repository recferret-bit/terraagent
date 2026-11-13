# Environment variables

Defaults the app uses when a variable is unset. The running catalog, including dev-console commands, is [`DEV_TOOLS.md`](./DEV_TOOLS.md). Later waves add their own rows here. Do not put this file in the repository root.

| Variable | Default | What it does |
|---|---|---|
| `NEAR_MODE` | `mock` | Global Web3 switch (`mock\|testnet\|devnet\|mainnet`) for all 11 NEAR ports + `IntentsBalanceRead`. `NEAR_ALLOW_MAINNET=1` (`true`) is required whenever any port resolves to `mainnet`. |
| `NEAR_ROOT_ACCOUNT` | `terraagent.testnet` (`terraagent.near` on mainnet) | Root namespace for the 6 Rust contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`) and 4 core accounts (`<root>`, `protocol.<root>`, `relayer.<root>`, `minter.<root>`). |
| `NEAR_PROTOCOL_ACCOUNT` | `protocol.<root>` (`protocol.terraagent.mock` in mock) | Protocol treasury recipient for 80% of platform trade fees, 20% staking yield share, and 10% diplomacy/war escrow slashes. |
| `NEAR_CONTRACT_PILOTS`, `NEAR_USE_PILOTS_FACTORY` | `pilots.<root>`, auto (`true` when `NEAR_ROOT_SECRET_KEY` unset) | Cold-root pilot sub-account factory (`{pilot}.pilots.<root>`) operated by `relayer.<root>` so `NEAR_ROOT_SECRET_KEY` stays offline in production. |
| `NEAR_ADAPTER_IDENTITY` | `mock` | `IdentityPort`. `testnet` or `mainnet` selects `TestnetIdentityAdapter` (`pilots.<root>` + atomic `[AddKey, DeleteKey]` `claimAccount`). Anything else is the mock. |
| `NEAR_ADAPTER_RELAYER` | `mock` | `RelayerPort` (NEP-366 `SignedDelegate` meta-transactions with `NEAR_RELAYER_DAILY_CAP` and `NEAR_RELAYER_MAX_DEPOSIT_NEAR`). |
| `NEAR_KEK` | dev 32-byte key | Base64 of 32 bytes. Seals custodial ed25519 seeds and `/me` NEAR.AI BYOK keys (AES-256-GCM). Production refuses a missing key or the dev key. |
| `MOCK_OAUTH_SECRET` | `terra-dev-mock-oauth-secret` | HMAC secret for `/dev/mock-oauth` tokens. Unset or empty uses the default. |
| `NEAR_ADAPTER_INTENTS` | `mock` | `IntentsPort` + `IntentsBalanceReadPort` (F2 markets, W13/W23): `mock` uses `mock_chain_intents_balance`; `testnet` uses hybrid Postgres settlement + live `res.<root>.testnet` cargo sync + 1Click `dry: true` quotes; `mainnet` executes directly on `intents.near` (`current_salt`, `add_public_key`, `simulate_intents`, `execute_intents`). |
| `NEAR_ADAPTER_CARGO` | `mock` | `CargoTokenPort` (NEP-245 `res.<root>`). Same `mock\|testnet\|mainnet` selection rule. |
| `NEAR_ADAPTER_AGENT_WALLET` | `mock` | `AgentWalletPort` (F3/F4, W15/W23). `testnet`, `devnet`, or `mainnet` selects `TestnetAgentWalletAdapter` (sub-accounts + scoped `FunctionCall` keys); anything else is `mock`. |
| `NEAR_ADAPTER_DEED`, `NEAR_ADAPTER_BADGE`, `NEAR_ADAPTER_STAKING`, `NEAR_ADAPTER_TREASURY`, `NEAR_ADAPTER_ESCROW`, `NEAR_ADAPTER_CHAIN_READ` | `mock` | Per-port overrides for `deed.<root>`, `staking.<root>`, `dao.<root>`, `bounty.<root>`, and FastNEAR RPC reads (`testnet` or `mainnet` selects real adapters). |
| `AI_PROVIDER`, `NEAR_AI_API_KEY`, `NEAR_AI_MODEL` | `mock`, —, `z-ai/glm-5.3-flash` | `AI_PROVIDER=nearai` routes Colony AI and Managed Staker Autopilot to NEAR AI Cloud TEE (`https://cloud-api.near.ai/v1`) with `/v1/signature/{chat_id}` verification (`NEARAI_API_KEY` / `NEARAI_MODEL` aliases also accepted). |
| `GUILD_ENABLED` | not read | Not an environment variable. Guild provisioning, visits, funding and the director key run when `TA_WAVES` includes `W15` (`flags.has('W15')`). `TA_WAVES` defaults to `all` (see DEV_TOOLS). Omitting `W15` (for example `..14`) turns the guild off. |
| `GUILD_NPC_COUNT` | not read | Not an environment variable. `guildPolicy` requires the `guild` table roster to be exactly `kestrel` then `vanguard` (`shared/sim/src/data/guild.ts`) and throws otherwise. Quote math does not take a count. |
| `NEAR_ALLOW_MOCK_IN_PROD` | unset | Production refuses any mock NEAR adapter (including Intents) unless this is `true`. Mock tokens are labelled "mock" in every UI. |
| `TA_ECONOMY_READ_TOKEN` | dev `dev-economy-reader` (not in production) | Bearer token of the economy `read` role (`/v1/economy/*`). Production without it: no read role. |
| `TA_ECONOMY_EDIT_TOKEN` | dev `dev-economy-operator` (not in production) | Bearer token of the `edit` role (candidate edits, experiments); includes read. |
| `TA_ECONOMY_ACTIVATE_TOKEN` | dev `dev-economy-activator` (not in production) | Bearer token of the operators-only `activate` role (approve, activate, rollback). Never given to AI experiment credentials. |
| `TA_ECONOMY_EXPERIMENT_WORKERS` | `1` | Concurrent experiment run threads (1..16). |
| `TA_ECONOMY_EXPERIMENT_LEASE_MS` | `30000` | Experiment run lease in ms (min 1000); an expired lease makes a crashed run reclaimable. |
| `TA_ECONOMY_ARTIFACT_DIR` | `tests/economy/artifacts/` | Where experiment artifacts are written (`<dir>/<experimentId>/<name>`). |
