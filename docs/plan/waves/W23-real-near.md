# W23 — Real NEAR (phase 2: swap mocks for real adapters)

> **Mandatory cash gates (D-44):** [ECONOMY §7](../../spec/ECONOMY.md#7-test-matrix-and-release-gates) separates capped technical smoke tests from public cash activation. Require W13 accounting/fee/profile tests and W15 funded-bot gates for any live bot; public cash additionally needs approved baseline/held-out/stress results and a limited real-player demand pilot. Deadline or adapter success does not waive these requirements.

> **D-45 (2026-11-07):** the W13 exchange is fully automatic with bots (bot API `/v1/trade/*`, actor kind `bot`) and humans on one book. W23 swaps the **real** FT/Intents settlement in behind the same ports the W13 mock implements (`IntentsPort`, `CargoTokenPort`, `RelayerPort`); the bot API, quote library, allowances and organic rule are not rebuilt. Bot API keys on real accounts start with real cash disabled and pass the same smoke/pilot gates; the W13 emulated chain's fault matrix (W13-65, W13-67) is rerun against the real adapter's `simulate`/testnet paths where the chain allows.

> **Track:** Economy/NEAR (E) · **Flag:** `W23` (controls the real-mode UI bits; adapter choice is per port via `NEAR_ADAPTER_<PORT>`) · **Scenario:** `tests/scenarios/w23-real-near.ts` · **Tag:** `wave-23`, plus per-port tags `wave-23-<port>` so each swap can be checked out alone
> **Depends on (per port group):**
> - Infra and `ChainReadPort`: W00
> - Identity and Relayer: W06
> - Cargo: W10
> - Intents: W13
> - Agent wallet: W15
> - Deed / Badge: W20, W12
> - Staking & Account Claim: W20
> - Treasury and Escrow: W22
> - Ops & Env Foundation: W00 (W00-31, W00-48)
>
> **Specs:** [`NEAR.md`](../../spec/NEAR.md) §1a (swap order, contract suites), §2–§12, §14–§15 · [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) §2, §5 · [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) · [`OWNER_TASKS.md`](../OWNER_TASKS.md) · D-18, D-19, D-23, D-26, D-30.

## Goal

Swap each NEAR port from its Postgres mock to the **real adapter**, one port at a time in the D-30 swap order. A port goes real only when **its shared contract suite passes against the real adapter**, and it can be rolled back to the mock with one env change. Game and application code do not change.

**Hackathon subset:** F5 (Identity + Relayer), F1 (Cargo) and F2 (Intents), and only after the D10 gate.

## Demo story (wave e2e, "real mode")

1. Set `NEAR_ADAPTER_IDENTITY=testnet NEAR_ADAPTER_RELAYER=testnet` and run `npm run dev:restart` → at `/play.html?scenario=w23` log in with the real social provider → a `{name}.terraagent.testnet` account appears on the explorer (the nearblocks link in **Settings → Chain status**), with no wallet popup.
2. Set `NEAR_ADAPTER_CARGO=mainnet` and `npm run dev:restart` → export 1 metal at the Trade Hub (Trade Hub panel → Export) → a real NEP-245 mint tx with a nearblocks link on the cargo panel.
3. Set `NEAR_ADAPTER_INTENTS=mainnet` and `npm run dev:restart` → in the Market tab place two mirror orders between two dev colonies (two profiles: `&as=a`, and the join link from the dev console `planet b`) → `simulate_intents` passes, then `execute_intents` settles one tiny trade on mainnet → both colonies see the trade, with a real receipt. Repeat once with one side placed through a bot API key (`/v1/trade/orders`) under a tiny allowance → the same receipt shape, and the key's spend counter matches.
4. Open **Settings → Chain status** (dev), or run `near.ports` in the dev console → the table shows each port as mock / testnet / mainnet with health. The README table matches.
5. Rollback: run `NEAR_ADAPTER_INTENTS=mock npm run dev:restart` → markets work on the mock again; real balances are shown read-only with a "frozen in chain mode" notice.
6. (e2e only) Every earlier wave e2e still passes in default (all-mock) mode: `npm run e2e -- --waves ..23`.

## Owned paths

`backend/app/src/near/infrastructure/adapters/real/**`, `backend/app/src/near/infrastructure/{rpc,keys,network}/**`, `backend/near-contracts/{res,deed,bounty}/**` (Rust, near-sdk; location still to be confirmed against the frontend/shared/backend layout), `infra/near/**` (deploy scripts, account setup), `scripts/near-*.ts`, `frontend/game/features/identity/real/**`, `frontend/game/features/chain-status/**`, `docs/plan/runbooks/near-*.md`, `tests/e2e/w23.spec.ts`, `tests/scenarios/w23-real-near.ts`.

**Reused, not rebuilt:** the ports (W00-30), adapter selection and the prod mock guard (W00-31), the outbox (W00-37), the contract harness (W00-38) and every port's contract suite, which the mock wave defined: `chain-read`, `badge` (W00-38), `identity`, `relayer` (W06-22), `cargo` (W10-11), `intents` (W13-06), `agent-wallet` (W15-04), `deed`, `staking` (W20-04, W20-13), `treasury`, `escrow` (W22-04, W22-18). W23 adds **no** suite cases; its "suite" rows only run the existing suite with `npm run contract:real -- --port <key>` against the real adapter.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **In H (Hackathon Vertical Slice — Unified `NEAR_MODE` Feature Flag/Switch + Real Testnet/Devnet Adapters):** Issues `W23-01..23`, `W23-26..47`, `W23-50`, and `W23-51` are in `H`. Everything in the game works 100% in `NEAR_MODE=mock` by default, and a single top-level switch `NEAR_MODE=mock|testnet|devnet|mainnet` (plus per-port `NEAR_ADAPTER_<PORT>` override and runtime/dev-console `near.switch`) flips Identity, Relayer, Cargo NEP-245, Intents `simulate`/testnet, Agent Wallet, Deed/Badge NEP-171, Staking, Treasury DAO, and Escrow to real NEAR testnet/devnet.
- **In H2 (post-hackathon public mainnet cash gate):** `W23-24`, `W23-48`, `W23-49` (mainnet USDC cash trade and public cash activation pilot).

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Real-mode env on top of W00-31's fail-closed selection: mainnet allow flag, network per port (mainnet for cargo/intents, testnet elsewhere in dev), RPC URLs | W23-01, W23-02 |
| 2 | Key management: KEK envelope encryption, rotation, relayer/minter keys (NEAR §2) | W23-03, W23-04 |
| 3 | RPC: FastNEAR + fallback, finality, retries; real `ChainReadPort`, explorer links | W23-05, W23-06 |
| 4 | Chain-ops monitoring, relayer balance alert, outbox-stuck alert (NEAR §14) | W23-07 |
| 5 | Funding and spend budget, circuit breaker (NEAR §12) | W23-08 |
| 6 | Identity: provider choice (owner), real adapter, client flow, contract suite | W23-09..W23-12 |
| 7 | Account claim (NEP-413 wallet link, add player key, drop app full-access key) (D-18, NEAR §2–§3) | W23-13, W23-14 |
| 8 | Relayer NEP-366: DelegateAction, allow-list, nonce mutex (NEAR §4) | W23-15, W23-16 |
| 9 | Cargo NEP-245 contract + deploy + adapter + suite (`NEAR-50..54`) | W23-17..W23-20 |
| 10 | Intents: deposit path verification (`NEAR-55`), adapter, dry-run, tiny mainnet trade, 1Click (`NEAR-60..65`) | W23-21..W23-25 |
| 11 | Agent wallet: sub-accounts + limited keys, NPC funding (`NEAR-70..73`, `NEAR-80..81`) | W23-26..W23-28 |
| 12 | Deed / Badge NEP-171 contract + adapters + suites (`NEAR-90..91`) | W23-29..W23-31 |
| 13 | Staking real pools, legal / whitelist governance (`NEAR-92..93`) | W23-32..W23-34 |
| 14 | Treasury DAO real (SputnikDAO or Trezu) (`NEAR-100..102`) | W23-35..W23-37 |
| 15 | Escrow contract + adapter (`NEAR-110..112`) | W23-38..W23-40 |
| 16 | Mock → real state migration and rollback rules | W23-41, W23-42 |
| 17 | Chain status panel, README mock/real table | W23-43, W23-44 |
| 18 | Nightly real contract-suite job | W23-45 |
| 19 | Analytics, dev console | W23-46 |
| 20 | Wave e2e, scenario, tags | W23-47 |

## Issues

### Infra (do first)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-01 | Unified `NEAR_MODE=mock\|testnet\|devnet\|mainnet` feature flag/switch (default `mock`) + per-port `NEAR_ADAPTER_<PORT>` override on top of W00-31: when `NEAR_MODE=mock`, all ports run 100% mocked; when `NEAR_MODE=testnet\|devnet`, all ports default to real NEAR testnet/devnet RPC & contracts unless overridden per port; `NEAR_ALLOW_MAINNET=1` guard for mainnet; flag `W23` | contract | S | H | W00-31 | Boot with `NEAR_MODE=mock` → all 11 NEAR ports bind to mock adapters; boot with `NEAR_MODE=testnet` → all ports bind to real testnet adapters (with per-port `NEAR_ADAPTER_<PORT>=mock` override respected); `mainnet` without `NEAR_ALLOW_MAINNET=1` aborts boot | NEAR §1a rule 3, §12 | TA-10.1 (part) |
| W23-02 | Network matrix & runtime switch resolver: `NEAR_MODE=mock\|testnet\|devnet\|mainnet` + per-port `NEAR_ADAPTER_<PORT>` + `NEAR_NETWORK_<PORT>`; startup log line and `/v1/near/status` endpoint list every port's active mode (`mock` / `testnet` / `devnet` / `mainnet`), contract account, and RPC health (no secrets) | server | S | H | W23-01 | Start with the default dev env → the log shows `cargo=mock … identity=mock`; with real envs → the matrix matches the README | NEAR-64, §12 | TA-10.1 (part) |
| W23-03 | Production KEK: load `NEAR_KEK` from the deploy secrets (W25-06), the KEK rotation runbook (`docs/plan/runbooks/near-keys.md`, KEK section), and run the W06-09 key store against real keys (no new key code) | server | S | H | W23-01, W06-09, W00-31 | Grep logs after a full e2e run → no secret key material; rotate the KEK → old keys still decrypt via `kek_version` | NEAR §2 | TA-10.1 (part) |
| W23-04 | Owner + ops: create `terraagent.testnet` / `.near`, `relayer.*`, `minter.*`, `npc.*` sub-accounts; load relayer/minter keys from file secrets; accounts section of `docs/plan/runbooks/near-keys.md` (the KEK section is W23-03's) | ops | M | H | W23-03 | Follow the runbook on testnet → the accounts exist and the app reads their keys at boot | NEAR §2, OWNER_TASKS | TA-10.1 (part) |
| W23-05 | RPC client: FastNEAR primary + fallback provider, timeouts, retry with jitter, finality `final` for writes and `optimistic` for reads, circuit-break to the fallback | server | M | H | W23-01 | Point the primary at a dead URL → reads succeed through the fallback, and `near_rpc_failover_total` increments | D-23, NEAR §12 | TA-10.1 (part) |
| W23-06 | Real `ChainReadPort` (`receipt`, `health`, `explorerUrl` → nearblocks testnet/mainnet), checked by running W00-38's existing `chain-read` suite against it | server | S | H | W23-05 | `npm run contract:real -- --port chain-read` → green on testnet | NEAR §1a | TA-10.1 (part) |
| W23-07 | Chain-ops monitoring: new gauge `near_balance_near{account}` (the `near_tx_total`, `near_tx_pending`, `near_rpc_latency_seconds` metrics already exist from W06-24 / W10-25); alerts for relayer balance < `NEAR_MIN_RELAYER_BALANCE` (5 NEAR), outbox rows stuck > 10 min, error rate > 5 % | ops | M | H | W23-05 | Drain the testnet relayer below 5 NEAR → an alert fires to the configured channel | NEAR §12, §14 | TA-13.x (monitoring part) |
| W23-08 | Spend budget + circuit breaker: daily relayer spend cap (`NEAR_RELAYER_DAILY_CAP`), storage-deposit accounting; over the cap → chain writes pause and outbox rows queue, the UI shows "chain busy, will settle"; resumes automatically | server | M | H | W23-07 | Set the cap to 0.01 NEAR → the second export queues with the notice, and resumes after the cap is raised | NEAR §12 cost estimate | — |

### Identity & Relayer (F5)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-09 | Owner decision: choose the social-login provider. Criteria: NEAR named-account support, mobile/PWA redirect, cost, hackathon partner (HOT). Record as a decision note; add a credentials owner task | docs | S | H | — | A decision row exists with the chosen provider and the reasoning | NEAR §2, D-27 | TA-10.3 (part) |
| W23-10 | Real `IdentityPort`: provider SDK, `loginSocial`, `createNamedAccount` (`{name}.terraagent.near`, relayer-funded), key generation + KEK storage, idempotent by provider subject | server | M | H | W23-03, W23-09 | Log in twice with the same social account → one named account; the explorer shows the account creation tx | NEAR §2 | TA-10.3 (part) |
| W23-11 | Client real login flow: provider redirect or popup, PWA / iOS fallback (redirect), error states (cancelled, provider down → fall back to guest) | client | M | H | W23-10 | On an iPhone PWA, complete social login → you land back in the game logged in; cancel → still a guest | CLIENT, D-22 | TA-10.3 (part) |
| W23-12 | Run W06-22's `identity` suite against the real adapter (testnet accounts and fixtures only; no new cases) | test | S | H | W23-10 | `npm run contract:real -- --port identity` → green | NEAR §1a rule 5 | — |
| W23-13 | Wallet link on the real chain: the W06-18 verifier also checks that the signing key is a FullAccess key of the account via RPC at `final` | server | S | H | W06-05, W06-09, W23-05 | Run the verifier test vectors; tamper one byte → rejected; a wrong network suffix → rejected | NEAR §3 | TA-10.2 |
| W23-14 | Real account claim: add the player's full-access key, remove the app's full-access key, keep the function-call key with allowance (scoped to `intents.near` and `res.*`); one-way; UI uses the W20 signer modal replaced by the real wallet selector | server | M | H | W23-13 | Claim on testnet → `view_access_key_list` shows the player key as full-access and the app key as function-call only; gameplay still works | D-18, NEAR §2 | TA-10.7 (part) |
| W23-15 | Real `RelayerPort` (NEP-366): sign `DelegateAction`, wrap in `Action::Delegate`, allow-list receivers (`res.*`, `deed.*`, `bounty.*`, planet DAOs, `intents.near`), per-signer async mutex + nonce cache, one retry on `InvalidNonce` | server | M | H | W23-05, W23-03 | Send 20 meta-txs from one signer concurrently → all land, nonces strictly increasing; a non-allow-listed receiver → rejected before submit | NEAR §4 | TA-10.3 (part) |
| W23-16 | Run W06-22's `relayer` suite against the real adapter (testnet) + gas cost report (`docs/plan/runbooks/near-costs.md`: create account, mint, burn, intent batch, NFT mint, metadata update); green here is the F5 gate before any F1 swap | test | S | H | W23-15 | `npm run contract:real -- --port relayer` is green and the cost report has measured numbers that replace the spec's estimates | NEAR §12 cost estimate | — |

### Cargo (F1)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-17 | Rust NEP-245 contract `res`: token ids = the 4 Tier-1 `ResourceKey`s (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`, extensible D-34 schema; 18 decimals), `mt_mint`/`mt_burn` minter-only, unrestricted transfers (beta), `mt_transfer_call`, storage management, NEP-297 events; `cargo test` + `near-workspaces` tests | contract | M | H | — | `cargo test` and the workspaces tests pass; mint from a non-minter → panics with a clear message | NEAR-50 | TA-10.6 (part) |
| W23-18 | Deploy `res.terraagent.testnet` then `res.terraagent.near`; set the minter; deploy script `infra/near/deploy-res.sh` with dry-run | ops | S | H | W23-17, W23-04 | Run the script on testnet → the contract is deployed and `mt_metadata` returns the 4 tokens | NEAR-50 | TA-10.6 (part) |
| W23-19 | Real `CargoTokenPort` (`mint`, `burn`, `balanceOf`, `transfer`) via minter key and the relayer, outbox `opId` → idempotent mint (memo carries `opId`; check the existing receipt before retry) | server | M | H | W23-18, W23-16 | Export 1 metal in real mode → one mint tx on chain; kill the app mid-mint and restart → still exactly one mint | NEAR-51, NEAR-52 | TA-10.6 (part) |
| W23-20 | Run W10-11's `cargo` suite against the real adapter (testnet) + mainnet smoke (mint and burn 1 unit); green here is the F1 gate before any F2 swap | test | S | H | W23-19 | `npm run contract:real -- --port cargo` → green, and the mainnet smoke shows 2 txs on nearblocks | NEAR §15 | — |

### Intents (F2)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-21 | Verify the deposit path in the Intents docs: NEP-245 deposit via `mt_transfer_call` to `intents.near` and the balance token-id format (`nep245:res.terraagent.near:<id>`?). If unsupported, decide the fallback: 4 NEP-141 tokens (then add issues W23-21a/b for the NEP-141 contract) | docs | S | H | W23-18 | A decision note with a doc link and a tested deposit of 1 unit on mainnet (or the fallback decision) | NEAR-55 | TA-10.6 (part) |
| W23-22 | Real `IntentsPort`: `deposit`, `signTokenDiff` (NEP-413 payload per the docs, deadline = order TTL), `simulate` (`simulate_intents`), `execute` (`execute_intents` via the relayer), `withdraw`; reuses W13-07's NEP-413 payload builder; implements exactly the port surface the W13 mock does, so the bot API and human orders reach it unchanged | server | M | H | W23-21, W23-20 | Two mirror orders on mainnet with `simulate` → returns ok and the current salt; a broken diff (sum ≠ 0) → rejected by simulate | NEAR-60..62 | TA-10.6 (part) |
| W23-23 | Run W13-06's `intents` suite against the real adapter in dry mode: mainnet `simulate_intents` only (no state change); CI keeps running it against the mock | test | S | H | W23-22 | `npm run contract:real -- --port intents --dry` → green against mainnet simulate | NEAR-64 | — |
| W23-24 | Capped mainnet smoke trade with USDC quote using actual configured lot/min-notional: exact buyer/platform/stall fee reconciliation, recorded spend cap and receipt, run once for a human order and once for a bot-key order (W13-58/59 allowances apply); no public cash activation implied | test | M | H2 | W23-22, W23-23, W13-49, W23-48 | One budget-bounded finalized trade reconciles all legs and reservations; public cash remains disabled pending ECONOMY gates | NEAR-61, NEAR-62 | TA-10.6 (part) |
| W23-25 | 1Click (optional, open in beta): partner JWT config (`ONECLICK_JWT`, else 0.2 % fee), quote endpoint wrapper for NEAR/USDC-priced orders; verify the API details in the docs | server | S |  | W23-22 | With the JWT set, request a quote → the response shows no 0.2 % surcharge; without it → the fee line appears in the order preview | NEAR-65 | — |

### Agent wallet (F3, F4)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-26 | Real `AgentWalletPort`: `createSubAccount` (`guild-N.npc.*`, `merc-N.npc.*`, colony accounts), `addLimitedKey(allowance, receivers: intents.near + res.*)`, `revokeKey` | server | M | H | W23-15 | Add a director key with a 0.1 NEAR allowance on testnet → `view_access_key` shows a function-call key with that allowance; revoke → the key is gone | NEAR-70, NEAR-80 | TA-10.13 (part) |
| W23-27 | Run W15-04's `agent-wallet` suite (it already asserts `NEAR_ALLOWANCE_EXHAUSTED`) against the real adapter on testnet | test | S | H | W23-26 | `npm run contract:real -- --port agent-wallet` → green, including the exhausted-allowance case | NEAR-81 | — |
| W23-28 | Real NPC funding runbook: explicit finite cash allocations and purchased/stock-backed cargo, no automatic top-up, global/per-NPC caps and kill switch; Guild NPCs are agents on the W13 bot API, so these caps are their key allowances; cash enabled only after W15 stress evidence | ops | S | H | W23-26, W15-12, W15-29, W15-30 | Cap/restart/reconciliation checks pass; no mint exception or unbounded treasury access | NEAR-73 | — |

### Deed & Badge (F6, achievements)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-29 | Rust NEP-171 contract `deed` (collections `deed` and `badge`; badge tokens non-transferable, i.e. soulbound; operator-only `update_metadata` on `extra`; settled flag) + tests | contract | M | H | — | `cargo test` passes; transferring a badge → panics "soulbound" | NEAR-90, NEAR-91 | TA-10.4 (part) |
| W23-30 | Deploy `deed.terraagent.testnet` / `.near` + real `DeedNftPort` and `BadgeNftPort` adapters; metadata image URLs served by the app (or R2) | server | M | H | W23-29, W23-15 | Found a colony in real mode → a deed NFT on the explorer whose metadata image loads | NEAR-90, NEAR-91 | TA-10.4 (part) |
| W23-31 | Run W20-04's `deed` suite and W00-38's `badge` suite against the real adapters (testnet) | test | S | H | W23-30 | `npm run contract:real -- --port deed,badge` → green | NEAR §15 | — |

### Staking (F6)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-32 | Real `StakingPort`: `deposit_and_stake`, `unstake`, `withdraw`, `get_account_staked_balance` on pools from `NEAR_STAKING_POOLS`; wallet-signed by the **claimed** account (never the relayer, never app keys) | server | M | H | W23-14, W20-18 | On testnet, stake 1 NEAR from a claimed colony account → the pool shows the staked balance; the app never holds the player's NEAR | NEAR-92, D-18 | TA-10.7 (part) |
| W23-33 | Run W20-13's `staking` suite against testnet pools | test | S | H | W23-32 | `npm run contract:real -- --port staking` → green | NEAR §15 | — |
| W23-34 | Owner + legal: validator whitelist governance (who adds or removes pools, how often) and staking-copy / legal review; owner tasks recorded | docs | S | H | — | A runbook section and an owner task exist; the UI copy is approved | NEAR §9 follow-up | — |

### Treasury DAO (F7)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-35 | Research: SputnikDAO factory vs Trezu multisig for per-planet DAOs (create cost, proposal kinds, policy fit for "1 colony = 1 vote"); decision note | docs | S | H | — | A decision note naming the platform, with the cost per DAO measured on testnet | NEAR-100 | TA-10.13 (part) |
| W23-36 | Real `TreasuryDaoPort`: create a DAO per planet (factory), add/remove members, deposit, `add_proposal`, `act_proposal` (vote), finalize; map DAO states to the app's | server | M | H | W23-35, W23-15 | On testnet, run the W22 demo story steps 1–3 → the proposal passes on chain and the sim effect starts | NEAR-100..102 | TA-10.13 (part) |
| W23-37 | Run W22-04's `treasury` suite against the real DAO on testnet | test | S | H | W23-36 | `npm run contract:real -- --port treasury` → green | NEAR §15 | — |

### Escrow (F8)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-38 | Rust escrow contract `bounty`: `open` (via `mt_transfer_call` of cargo or attached NEAR), operator-only `claim` that pays the claimer (the `EscrowPort.claim` method), `refund` after expiry or cancel, one-shot state machine + tests | contract | M | H | W23-17 | `cargo test` passes; double claim → panics; refund after claim → panics | NEAR-110, NEAR-111 | TA-10.13 (part) |
| W23-39 | Deploy `bounty.terraagent.*` + real `EscrowPort` adapter (`open`, `claim`, `refund`, `get`) | server | M | H | W23-38, W23-15 | Post and complete a bounty on testnet → open and claim txs on the explorer, and the claimer's balance rises | NEAR-110..112 | TA-10.13 (part) |
| W23-40 | Run W22-18's `escrow` suite against the real contract on testnet | test | S | H | W23-39 | `npm run contract:real -- --port escrow` → green | NEAR §15 | — |

### Rollout, migration, visibility

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-41 | Mock → real migration per port (beta rule): cargo mock balances are **re-minted** on chain to each colony account by a one-shot script (or reset, chosen per environment); deeds re-minted with their current metadata; DAO and escrow open items settled or refunded before the switch | ops | M | H | W23-19, W23-30 | Run the migration on a staging copy → every colony's on-chain cargo equals its mock balance, and the script is idempotent on a second run | D-30 | — |
| W23-42 | Rollback rule: switching a port back to mock freezes real-chain balances as read-only in the UI ("held on NEAR, frozen in demo mode"), stops new chain writes for that port, and leaves outbox rows parked for replay | server | S | H | W23-01 | Flip `NEAR_ADAPTER_CARGO` to mock after real exports → the cargo panel shows the frozen notice and exports use the mock; flip back → the parked rows replay | D-30 | — |
| W23-43 | Chain status panel (dev and admin): per port, adapter (mock / testnet / mainnet), health, last tx, pending outbox; the player-facing UI never shows chain words except the receipt links | client | S | H | W23-02, W23-06 | Open Settings → Chain status in dev → 11 rows (one per NEAR port of W00-30) with the correct adapter labels | NEAR §1a | — |
| W23-44 | Add a `network` (`mock` / `testnet` / `devnet` / `mainnet`) column and `NEAR_MODE` switch summary to `npm run ports:table` for the README mock/real matrix | docs | S | H | W23-02, W00-48 | Run the script → the README table matches the startup log matrix | NEAR §1a swap order | — |
| W23-45 | Nightly job: runs every port's suite with `npm run contract:real` against testnet (and Intents dry-run on mainnet); a failure opens an alert and blocks switching that port to real | ops | S | H | W23-06..40 | Break a real adapter on purpose → the nightly job fails and names the port | NEAR §1a rule 5 | — |
| W23-46 | Analytics + dev console: `track()` `social_login_completed`, `account_claimed`, `chain_receipt_opened`; console `near.mode`, `near.ports`, `near.switch <port\|all> <mock\|testnet\|devnet>` (instant dev switch + status refresh), `near.relayer-balance` | client | S | H | W23-43 | Run `near.ports` → prints the same matrix as the startup log | CLIENT §10 | — |
| W23-50 | Wire W20 DeedMintOutboxService, StakingPositionSyncService, claim-account endpoint, and wallet signer modal to NEAR_MODE switch | server | S | H | W23-01, W23-14, W23-30, W23-32, W20-05, W20-19, W20-20, W20-22 | Switch NEAR_MODE=testnet and run deed mint/update/settle + claim-account + stake -> outbox handlers, StakingPositionSyncService, and wallet signer switch cleanly from mock to real adapters without UI or sim code changes | NEAR §1a, §9, D-18, D-30, W20 handoff | — |
| W23-51 | Wire W15 GuildProvisionService, DirectorKeyService, AcceptGuildOfferService, and DirectorLoopService per-token allowance reservations to NEAR_MODE switch | server | S | H | W23-01, W23-22, W23-26, W15-05, W15-11, W15-18, W15-21 | Switch NEAR_MODE=testnet and run director-key add/revoke + Guild offer accept + away autoTrade -> GuildWalletBinder, DirectorKeyService, and DirectorLoopService reserve/consume/release per-token allowances and settle through real TestnetAgentWalletAdapter and IntentsPort without sim or UI changes | NEAR §1a, NEAR-70..81, D-30, W15 handoff | — |
| W23-47 | Wave e2e + scenario + tags: `tests/e2e/w23.spec.ts` runs the real-mode demo against testnet (and Intents simulate on mainnet) behind `E2E_REAL_NEAR=1`; the default mode re-runs every earlier e2e on all mocks; tag `wave-23` plus `wave-23-<port>` at each port swap | test | M | H | W23-01..23, W23-26..46, W23-50, W23-51 | `E2E_REAL_NEAR=1 npm run e2e -- w23` → green; `npm run e2e -- --waves ..23` → green on mocks | PRODUCT_WAVES §3 | — |
| W23-48 | Cash activation enforcement: default disabled, separately scoped capped smoke/pilot/public modes, exact engine/profile/adapter evidence, spend limits, kill switch and persisted operator activation; live bots additionally require W15 reports; every bot API key on a real account (`/v1/trade/*`) has real-cash mode off by default, its own capped smoke/pilot scope, allowances (order notional, daily spend/loss, pairs, price band) and kill switch, and a bot key cannot raise its own scope | server | M | H2 | W13-49, W23-23 | Adapter switched to real without approved gate record cannot open public cash trading, and a bot key cannot place a real-cash order outside its approved scope; smoke limits survive restart; missing/stale evidence blocks activation | ECONOMY section 7 | — |
| W23-49 | Bounded real-player pilot and public-cash review: preregister threshold/window/cohort coverage, run held-out/stress cases, observe voluntary repeat purchases, publish fee/subsidy and uncertainty report | test | M | H2 | W23-48, W23-24, W15-29, W15-30 | Public activation requires approved sufficient evidence; failed or insufficient demand stays disabled, with no guaranteed earnings claim | ECONOMY section 7 | — |

**Issue count: 48** (plus W23-21a/b only if the NEP-141 fallback is needed).

## Swap order and per-port gates

Order: Identity + Relayer (W23-09..16) → Cargo (17..20) → Intents (21..25) → Agent wallet (26..28) → Deed / Badge (29..31) → Staking (32..34) → Treasury (35..37) → Escrow (38..40).

Infra W23-01..06 come first (W23-07/08 are post-hackathon). The H2 order F5 → F1 → F2 is enforced by deps: the real Cargo adapter (W23-19) needs the relayer suite green on the real chain (W23-16), and the real Intents adapter (W23-22) needs the cargo suite green (W23-20). A port's adapter env may be set to real only after its contract suite is green against the real chain. In an environment whose mock state must be kept, W23-41 (migration) must also have run for that port; the hackathon H2 demo switches on a fresh database, so it does not need W23-41. Each swap is tagged `wave-23-<port>`.

## Wave DoD

- Every port has a real adapter whose shared contract suite passes against real NEAR (testnet, or mainnet for Cargo smoke and Intents).
- The real-mode e2e passes, and the all-mock e2e of every earlier wave still passes.
- Rollback to mock works per port.
- The README mock/real table is generated.
- Monitoring and alerts are live, and the spend circuit breaker has been tested.
- Tags `wave-23-<port>` and `wave-23` are created.

## W08 follow-up: executable progression and priorities

Verify goal/tutor flows against real adapters, failures and reconnect without mock completion assumptions.

Mandatory landing criteria: [Progression, tutorial goals and priorities contract](../W08-PROGRESSION-CONTRACT.md). Add a real accept → orders → progress → completion owner check, blocked/resume and reload tests, relevant slider low/high decision tests, and a later-waves-off test. Unimplemented goals stay unavailable; stage previews do not authorize gameplay.

## W12 progression integration gate (revised)

Follow [Progression persistence and delivery](../../spec/PROGRESSION_ENGINE.md). Consume achievement.badge through BadgeNftPort using the effect ID as mint idempotency key; cover failure, restart, delayed mint and notification independence.

Acceptance: producer-to-profile persistence, replay/restart, concurrent inputs, threshold boundaries, independent queue retries and disabled-wave behavior are covered by unit and PostgreSQL integration tests. New achievement conditions use catalogue configuration; new event semantics use registered producers. Keep earned achievements and lifetime statistics across colony transitions. ME opens in a new tab from authenticated landing/selection only; the hub's W12 mock is explicit.

## Public cash activation evidence

Before enabling public cash pairs, persist the approved profile hash, exact adapter/engine versions, W13-49 report, applicable W15-29/30 reports, held-out/stress gates and a limited real-player pilot showing repeated voluntary purchases. Pilot has explicit user/treasury spend caps and a stop switch; bot participants in the pilot are labelled, bound by their allowances, and bot demand counts toward the evidence only to the extent the bots consume what they buy (hypothesis, LED-18); bot-to-bot fills of one owner are never organic (D-45). Record thresholds and sample sufficiency before observing results; missing demand evidence is insufficient_data. Approval is an audited operator activation, never an LLM experiment side effect. W23-24 is only a technical smoke test.

## Vertical Slice Testing, Full-Game Integration & Mock/Real Switch Gates

1. **Unified Feature Flag / Switch (`NEAR_MODE=mock|testnet|devnet|mainnet`):**
   - **Default (`NEAR_MODE=mock`):** Every Web3 and economy feature (`W06` Invisible Chain Identity + Relayer, `W10` NEP-245 Cargo Tokens, `W12` Soulbound Badges, `W13` NEP-413 Intents Order Book & Bot API, `W15` Orbital Guild & Director Agent Wallets, `W20` Dynamic Colony Deed NFT & Staking, `W22` Planet Treasury DAO & Bounty Escrow) runs **100% locally in Postgres mock mode** with zero external RPC dependencies.
   - **One-Flag Switch (`NEAR_MODE=testnet` or `NEAR_MODE=devnet`):** Flips all NEAR ports to real NEAR testnet/devnet contracts and RPC (with `NEAR_ADAPTER_<PORT>=mock|testnet|devnet|mainnet` available to override any individual port and `near.switch <port|all> <mode>` in the in-game dev console).
2. **Shared Contract Suite Parity (Mock ↔ Real Testnet/Devnet):**
   - Every port runs the **exact same `describeNearPortContract('<port>')` suite** against both its Postgres mock (`npm run test:contract`) and its real NEAR testnet/devnet adapter (`npm run contract:real -- --port <port>`): `chain-read`, `identity`, `relayer`, `cargo`, `intents` (dry-run simulate + testnet), `agent-wallet`, `deed`, `badge`, `staking`, `treasury`, and `escrow`.
3. **Unit, Integration & Rollback Matrix (Positive / Negative / Corner):**
   - **Positive:** `NEAR_MODE=mock` → `NEAR_MODE=testnet` transition, real NEP-366 meta-tx relay, NEP-245 mint/burn idempotency via outbox `opId`, NEP-413 `simulate_intents`, limited key allowance enforcement, NEP-171 deed mint/update, testnet pool stake/unstake, DAO proposal vote, and bounty escrow claim/refund.
   - **Negative & Corner Cases:** RPC primary timeout → automatic failover to fallback URL (`W23-05`), relayer daily cap circuit breaker (`W23-08`), `InvalidNonce` concurrent meta-tx retry (`W23-15`), `mainnet` boot without `NEAR_ALLOW_MAINNET=1` rejected (`W23-01`), unknown adapter string fail-closed to `mock`, and instant rollback (`NEAR_MODE=mock` or `NEAR_ADAPTER_<PORT>=mock`) parking pending outbox rows and showing real balances as read-only (`W23-42`).
4. **Full Game Integration + Online Server E2E (`tests/e2e/w23.spec.ts`):**
   - Verified end-to-end against the running backend + UI **Settings → Chain Status** panel (`W23-43`) + dev console `near.ports` / `near.switch` (`W23-46`), proving both `E2E_REAL_NEAR=1 npm run e2e -- w23` on testnet and `npm run e2e -- --waves ..23` 100% green in default mock mode.
