# W23 — Real NEAR (phase 2: swap mocks for real adapters)

> **Track:** Economy/NEAR (E) · **Flag:** `W23` (controls the real-mode UI bits; adapter choice is per port via `NEAR_ADAPTER_<PORT>`) · **Scenario:** `scenarios/w23-real-near.ts` · **Tag:** `wave-23`, plus per-port tags `wave-23-<port>` so each swap can be checked out alone
> **Depends on (per port group):**
> - Infra and `ChainReadPort`: W00
> - Identity and Relayer: W06
> - Cargo: W10
> - Intents: W13
> - Agent wallet: W15
> - Deed / Badge: W20, W12
> - Staking: W20, W21 (claim)
> - Treasury and Escrow: W22
>
> **Specs:** [`NEAR.md`](../../spec/NEAR.md) §1a (swap order, contract suites), §2–§12, §14–§15 · [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) §2, §5 · [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) · [`OWNER_TASKS.md`](../OWNER_TASKS.md) · D-18, D-19, D-23, D-26, D-30.

## Goal

Swap each NEAR port from its Postgres mock to the **real adapter**, one port at a time in the D-30 swap order. A port goes real only when **its shared contract suite passes against the real adapter**, and it can be rolled back to the mock with one env change. Game and application code do not change.

**Hackathon subset:** F5 (Identity + Relayer), F1 (Cargo) and F2 (Intents), and only after the D10 gate.

## Demo story (wave e2e, "real mode")

1. Set `NEAR_ADAPTER_IDENTITY=testnet`, `NEAR_ADAPTER_RELAYER=testnet` → log in with the real social provider → a `{name}.terraagent.testnet` account appears on the explorer, with no wallet popup.
2. Set `NEAR_ADAPTER_CARGO=mainnet` → export 1 metal at the Trade Hub → a real NEP-245 mint tx with a nearblocks link on the cargo panel.
3. Set `NEAR_ADAPTER_INTENTS=mainnet` → place two mirror orders between two dev colonies → `simulate_intents` passes, then `execute_intents` settles one tiny trade on mainnet → both colonies see the trade, with a real receipt.
4. Open **Settings → Chain status** (dev) → the table shows each port as mock / testnet / mainnet with health. The README table matches.
5. Rollback: set `NEAR_ADAPTER_INTENTS=mock` and restart → markets work on the mock again; real balances are shown read-only with a "frozen in chain mode" notice.
6. Every earlier wave e2e still passes in default (all-mock) mode.

## Owned paths

`backend/app/src/near/infrastructure/adapters/real/**`, `backend/app/src/near/infrastructure/{rpc,keys,network}/**`, `near-contracts/{res,deed,bounty}/**` (Rust, near-sdk), `infra/near/**` (deploy scripts, account setup), `scripts/near-*.ts`, `client/src/features/identity/real/**`, `client/src/features/chain-status/**`, `docs/plan/runbooks/near-*.md`, `e2e/w23.spec.ts`, `scenarios/w23-real-near.ts`.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **H2 rows** are the F5 / F1 / F2 swap (Identity + Relayer, Cargo, Intents) plus their contract suites and the tiny mainnet trade. They start only if the D10 gate in HACKATHON_CUT passes, and each port goes real only when its contract suite passes against the real adapter.
- **Everything else in this wave** (agent wallets, deed/badge, staking, DAO, escrow, monitoring, migration) is after the hackathon; those ports stay mocked in the demo.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Per-port adapter env, fail-closed selection, mock-in-prod guard, network per port (mainnet for cargo/intents, testnet elsewhere in dev) | W23-01, W23-02 |
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
| W23-01 | Contracts & config: zod env for every `NEAR_ADAPTER_<PORT>` (`mock\|testnet\|mainnet`), `NEAR_NETWORK_<PORT>` override, `NEAR_ALLOW_MAINNET`, `NEAR_ALLOW_MOCK_IN_PROD`, RPC URLs, KEK; adapter-binding factory per port; flag `W23` | contract | M | H2 | W00-31 | Boot with `NEAR_ADAPTER_CARGO=mainnet` but without `NEAR_ALLOW_MAINNET=1` → the app refuses to start with a clear env error | NEAR §1a rule 3, §12 | TA-10.1 (part) |
| W23-02 | Network matrix: mainnet for Cargo and Intents (Intents has no testnet), testnet for the other ports in dev, mainnet in prod; a startup log line lists every port's adapter and network (no secrets) | server | S | H2 | W23-01 | Start with the default dev env → the log shows `cargo=mock … identity=mock`; with real envs → the matrix matches the README | NEAR-64, §12 | TA-10.1 (part) |
| W23-03 | Production KEK: load `NEAR_KEK` from the deploy secrets (W25-06), rotation runbook, and run the W06-09 key store against real keys (no new key code) | server | S | H2 | W23-01, W06-09 | Grep logs after a full e2e run → no secret key material; rotate the KEK → old keys still decrypt via `kek_version` | NEAR §2 | TA-10.1 (part) |
| W23-04 | Owner + ops: create `terraagent.testnet` / `.near`, `relayer.*`, `minter.*`, `npc.*` sub-accounts; load relayer/minter keys from file secrets; KEK rotation runbook (`docs/plan/runbooks/near-keys.md`) | ops | M | H2 | W23-03 | Follow the runbook on testnet → the accounts exist and the app reads their keys at boot | NEAR §2, OWNER_TASKS | TA-10.1 (part) |
| W23-05 | RPC client: FastNEAR primary + fallback provider, timeouts, retry with jitter, finality `final` for writes and `optimistic` for reads, circuit-break to the fallback | server | M | H2 | W23-01 | Point the primary at a dead URL → reads succeed through the fallback, and `near_rpc_failover_total` increments | D-23, NEAR §12 | TA-10.1 (part) |
| W23-06 | Real `ChainReadPort` (`receipt`, `health`, `explorerUrl` → nearblocks testnet/mainnet) + contract suite vs testnet | server | S | H2 | W23-05 | `npm run test:contract:real -- chainread` → green on testnet; explorer links open the right network | NEAR §1a | TA-10.1 (part) |
| W23-07 | Chain-ops monitoring: metrics `near_tx_total{kind,result}`, `near_tx_pending`, `near_rpc_latency_seconds`, `near_balance_near{account}`; alerts for relayer balance < `NEAR_MIN_RELAYER_BALANCE` (5 NEAR), outbox rows stuck > 10 min, error rate > 5 % | ops | M |  | W23-05 | Drain the testnet relayer below 5 NEAR → an alert fires to the configured channel | NEAR §12, §14 | TA-13.x (monitoring part) |
| W23-08 | Spend budget + circuit breaker: daily relayer spend cap (`NEAR_RELAYER_DAILY_CAP`), storage-deposit accounting; over the cap → chain writes pause and outbox rows queue, the UI shows "chain busy, will settle"; resumes automatically | server | M |  | W23-07 | Set the cap to 0.01 NEAR → the second export queues with the notice, and resumes after the cap is raised | NEAR §12 cost estimate | — |

### Identity & Relayer (F5)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-09 | Owner decision: choose the social-login provider. Criteria: NEAR named-account support, mobile/PWA redirect, cost, hackathon partner (HOT). Record as a decision note; add a credentials owner task | docs | S | H2 | — | A decision row exists with the chosen provider and the reasoning | NEAR §2, D-27 | TA-10.3 (part) |
| W23-10 | Real `IdentityPort`: provider SDK, `loginSocial`, `createNamedAccount` (`{name}.terraagent.near`, relayer-funded), key generation + KEK storage, idempotent by provider subject | server | M | H2 | W23-03, W23-09 | Log in twice with the same social account → one named account; the explorer shows the account creation tx | NEAR §2 | TA-10.3 (part) |
| W23-11 | Client real login flow: provider redirect or popup, PWA / iOS fallback (redirect), error states (cancelled, provider down → fall back to guest) | client | M | H2 | W23-10 | On an iPhone PWA, complete social login → you land back in the game logged in; cancel → still a guest | CLIENT, D-22 | TA-10.3 (part) |
| W23-12 | `IdentityPort` contract suite vs real (testnet) | test | S | H2 | W23-10 | `npm run test:contract:real -- identity` → green | NEAR §1a rule 5 | — |
| W23-13 | Wallet link on the real chain: the W06-18 verifier also checks that the signing key is a FullAccess key of the account via RPC at `final` | server | S |  | W06-18, W23-05 | Run the verifier test vectors; tamper one byte → rejected; a wrong network suffix → rejected | NEAR §3 | TA-10.2 |
| W23-14 | Real account claim: add the player's full-access key, remove the app's full-access key, keep the function-call key with allowance (scoped to `intents.near` and `res.*`); one-way; UI uses the W20 signer modal replaced by the real wallet selector | server | M |  | W23-13 | Claim on testnet → `view_access_key_list` shows the player key as full-access and the app key as function-call only; gameplay still works | D-18, NEAR §2 | TA-10.7 (part) |
| W23-15 | Real `RelayerPort` (NEP-366): sign `DelegateAction`, wrap in `Action::Delegate`, allow-list receivers (`res.*`, `deed.*`, `bounty.*`, planet DAOs, `intents.near`), per-signer async mutex + nonce cache, one retry on `InvalidNonce` | server | M | H2 | W23-05, W23-03 | Send 20 meta-txs from one signer concurrently → all land, nonces strictly increasing; a non-allow-listed receiver → rejected before submit | NEAR §4 | TA-10.3 (part) |
| W23-16 | `RelayerPort` contract suite vs real (testnet) + gas cost report (`docs/plan/runbooks/near-costs.md`: create account, mint, burn, intent batch, NFT mint, metadata update) | test | S | H2 | W23-15 | The suite is green and the cost report has measured numbers that replace the spec's estimates | NEAR §12 cost estimate | — |

### Cargo (F1)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-17 | Rust NEP-245 contract `res`: token ids `metals`, `minerals`, `petroleum`, `water` (18 decimals), `mt_mint`/`mt_burn` minter-only, unrestricted transfers (beta), `mt_transfer_call`, storage management, NEP-297 events; `cargo test` + `near-workspaces` tests | contract | M | H2 | — | `cargo test` and the workspaces tests pass; mint from a non-minter → panics with a clear message | NEAR-50 | TA-10.6 (part) |
| W23-18 | Deploy `res.terraagent.testnet` then `res.terraagent.near`; set the minter; deploy script `infra/near/deploy-res.sh` with dry-run | ops | S | H2 | W23-17, W23-04 | Run the script on testnet → the contract is deployed and `mt_metadata` returns the 4 tokens | NEAR-50 | TA-10.6 (part) |
| W23-19 | Real `CargoTokenPort` (`mint`, `burn`, `balanceOf`, `transfer`) via minter key and the relayer, outbox `opId` → idempotent mint (memo carries `opId`; check the existing receipt before retry) | server | M | H2 | W23-18, W23-15 | Export 1 metal in real mode → one mint tx on chain; kill the app mid-mint and restart → still exactly one mint | NEAR-51, NEAR-52 | TA-10.6 (part) |
| W23-20 | `CargoTokenPort` contract suite vs real (testnet) + mainnet smoke (mint and burn 1 unit) | test | S | H2 | W23-19 | `npm run test:contract:real -- cargo` → green; the mainnet smoke shows 2 txs on nearblocks | NEAR §15 | — |

### Intents (F2)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-21 | Verify the deposit path in the Intents docs: NEP-245 deposit via `mt_transfer_call` to `intents.near` and the balance token-id format (`nep245:res.terraagent.near:<id>`?). If unsupported, decide the fallback: 4 NEP-141 tokens (then add issues W23-21a/b for the NEP-141 contract) | docs | S | H2 | W23-18 | A decision note with a doc link and a tested deposit of 1 unit on mainnet (or the fallback decision) | NEAR-55 | TA-10.6 (part) |
| W23-22 | Real `IntentsPort`: `deposit`, `signTokenDiff` (NEP-413 payload per the docs, deadline = order TTL), `simulate` (`simulate_intents`), `execute` (`execute_intents` via the relayer), `withdraw` | server | M | H2 | W23-21, W23-15 | Two mirror orders on mainnet with `simulate` → returns ok and the current salt; a broken diff (sum ≠ 0) → rejected by simulate | NEAR-60..62 | TA-10.6 (part) |
| W23-23 | `IntentsPort` contract suite: CI uses the stub verifier; a manual or nightly run uses mainnet `simulate_intents` only (no state change) | test | S | H2 | W23-22 | `npm run test:contract:real -- intents --dry` → green against mainnet simulate | NEAR-64 | — |
| W23-24 | Tiny mainnet trade: two dev colonies trade 1 metal for 1 water (plus the 1 % fee leg to a hub owner and the W22 treasury leg if on) → `execute_intents` final → both sims get `market.settled`; receipt link in the UI | test | M | H2 | W23-22, W13-13 | Run `npm run near:smoke-trade` → one batch tx on nearblocks, and both colonies' trade history shows it | NEAR-61, NEAR-62 | TA-10.6 (part) |
| W23-25 | 1Click (optional, open in beta): partner JWT config (`ONECLICK_JWT`, else 0.2 % fee), quote endpoint wrapper for NEAR/USDC-priced orders; verify the API details in the docs | server | S |  | W23-22 | With the JWT set, request a quote → the response shows no 0.2 % surcharge; without it → the fee line appears in the order preview | NEAR-65 | — |

### Agent wallet (F3, F4)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-26 | Real `AgentWalletPort`: `createSubAccount` (`guild-N.npc.*`, `merc-N.npc.*`, colony accounts), `addLimitedKey(allowance, receivers: intents.near + res.*)`, `revokeKey` | server | M |  | W23-15 | Add a director key with a 0.1 NEAR allowance on testnet → `view_access_key` shows a function-call key with that allowance; revoke → the key is gone | NEAR-70, NEAR-80 | TA-10.13 (part) |
| W23-27 | `AgentWalletPort` contract suite vs real, including "allowance exhausted" → stable error `NEAR_ALLOWANCE_EXHAUSTED` and autoTrade pauses | test | S |  | W23-26 | Exhaust a tiny allowance → the director's next order fails with that code and the HUD shows "Director key empty" | NEAR-81 | — |
| W23-28 | NPC funding: seed Guild and mercenary accounts from the owner treasury with capped NEAR float + initial cargo via the minter; cap check script; top-up runbook | ops | S |  | W23-26, W23-19 | Run `npm run near:fund-npcs -- --dry` → prints planned transfers within the caps; the real run funds 3 Guild NPCs | NEAR-73 | — |

### Deed & Badge (F6, achievements)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-29 | Rust NEP-171 contract `deed` (collections `deed` and `badge`; badge tokens non-transferable, i.e. soulbound; operator-only `update_metadata` on `extra`; settled flag) + tests | contract | M |  | — | `cargo test` passes; transferring a badge → panics "soulbound" | NEAR-90, NEAR-91 | TA-10.4 (part) |
| W23-30 | Deploy `deed.terraagent.testnet` / `.near` + real `DeedNftPort` and `BadgeNftPort` adapters; metadata image URLs served by the app (or R2) | server | M |  | W23-29, W23-15 | Found a colony in real mode → a deed NFT on the explorer whose metadata image loads | NEAR-90, NEAR-91 | TA-10.4 (part) |
| W23-31 | Deed and Badge contract suites vs real (testnet) | test | S |  | W23-30 | `npm run test:contract:real -- deed badge` → green | NEAR §15 | — |

### Staking (F6)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-32 | Real `StakingPort`: `deposit_and_stake`, `unstake`, `withdraw`, `get_account_staked_balance` on pools from `NEAR_STAKING_POOLS`; wallet-signed by the **claimed** account (never the relayer, never app keys) | server | M |  | W23-14, W20-18 | On testnet, stake 1 NEAR from a claimed colony account → the pool shows the staked balance; the app never holds the player's NEAR | NEAR-92, D-18 | TA-10.7 (part) |
| W23-33 | `StakingPort` contract suite vs testnet pools | test | S |  | W23-32 | `npm run test:contract:real -- staking` → green | NEAR §15 | — |
| W23-34 | Owner + legal: validator whitelist governance (who adds or removes pools, how often) and staking-copy / legal review; owner tasks recorded | docs | S |  | — | A runbook section and an owner task exist; the UI copy is approved | NEAR §9 follow-up | — |

### Treasury DAO (F7)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-35 | Research: SputnikDAO factory vs Trezu multisig for per-planet DAOs (create cost, proposal kinds, policy fit for "1 colony = 1 vote"); decision note | docs | S |  | — | A decision note naming the platform, with the cost per DAO measured on testnet | NEAR-100 | TA-10.13 (part) |
| W23-36 | Real `TreasuryDaoPort`: create a DAO per planet (factory), add/remove members, deposit, `add_proposal`, `act_proposal` (vote), finalize; map DAO states to the app's | server | M |  | W23-35, W23-15 | On testnet, run the W22 demo story steps 1–3 → the proposal passes on chain and the sim effect starts | NEAR-100..102 | TA-10.13 (part) |
| W23-37 | `TreasuryDaoPort` contract suite vs testnet | test | S |  | W23-36 | `npm run test:contract:real -- treasury` → green | NEAR §15 | — |

### Escrow (F8)

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-38 | Rust escrow contract `bounty`: `open` (via `mt_transfer_call` of cargo or attached NEAR), operator-only `release` to the claimer, `refund` after expiry or cancel, one-shot state machine + tests | contract | M |  | W23-17 | `cargo test` passes; double release → panics; refund after release → panics | NEAR-110, NEAR-111 | TA-10.13 (part) |
| W23-39 | Deploy `bounty.terraagent.*` + real `EscrowPort` adapter | server | M |  | W23-38, W23-15 | Post and complete a bounty on testnet → open and release txs on the explorer, and the claimer's balance rises | NEAR-110..112 | TA-10.13 (part) |
| W23-40 | `EscrowPort` contract suite vs testnet | test | S |  | W23-39 | `npm run test:contract:real -- escrow` → green | NEAR §15 | — |

### Rollout, migration, visibility

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W23-41 | Mock → real migration per port (beta rule): cargo mock balances are **re-minted** on chain to each colony account by a one-shot script (or reset, chosen per environment); deeds re-minted with their current metadata; DAO and escrow open items settled or refunded before the switch | ops | M |  | W23-19, W23-30 | Run the migration on a staging copy → every colony's on-chain cargo equals its mock balance, and the script is idempotent on a second run | D-30 | — |
| W23-42 | Rollback rule: switching a port back to mock freezes real-chain balances as read-only in the UI ("held on NEAR, frozen in demo mode"), stops new chain writes for that port, and leaves outbox rows parked for replay | server | S |  | W23-01 | Flip `NEAR_ADAPTER_CARGO` to mock after real exports → the cargo panel shows the frozen notice and exports use the mock; flip back → the parked rows replay | D-30 | — |
| W23-43 | Chain status panel (dev and admin): per port, adapter (mock / testnet / mainnet), health, last tx, pending outbox; the player-facing UI never shows chain words except the receipt links | client | S |  | W23-02, W23-06 | Open Settings → Chain status in dev → 10 rows with the correct adapter labels | NEAR §1a | — |
| W23-44 | README mock/real table generator: `npm run near:status-table` writes the per-port table from the active bindings into the README section (W25 owns the README) | docs | S | H2 | W23-02 | Run the script → the README table matches the startup log matrix | NEAR §1a swap order | — |
| W23-45 | Nightly job: runs every `test:contract:real` suite against testnet (and Intents dry-run on mainnet); a failure opens an alert and blocks switching that port to real | ops | S |  | W23-06..40 | Break a real adapter on purpose → the nightly job fails and names the port | NEAR §1a rule 5 | — |
| W23-46 | Analytics + dev console: `track()` `social_login_completed`, `account_claimed`, `chain_receipt_opened`; console `near.ports`, `near.switch <port> <mode>` (dev only, restart required), `near.relayer-balance` | client | S |  | W23-43 | Run `near.ports` → prints the same matrix as the startup log | CLIENT §10 | — |
| W23-47 | Wave e2e + scenario + tags: `e2e/w23.spec.ts` runs the real-mode demo against testnet (and Intents simulate on mainnet) behind `E2E_REAL_NEAR=1`; the default mode re-runs every earlier e2e on all mocks; tag `wave-23` plus `wave-23-<port>` at each port swap | test | M |  | W23-01..46 | `E2E_REAL_NEAR=1 npm run e2e -- w23` → green; `npm run e2e -- --waves ..23` → green on mocks | PRODUCT_WAVES §3 | — |

**Issue count: 47** (plus W23-21a/b only if the NEP-141 fallback is needed).

## Swap order and per-port gates

Order: Identity + Relayer (W23-09..16) → Cargo (17..20) → Intents (21..25) → Agent wallet (26..28) → Deed / Badge (29..31) → Staking (32..34) → Treasury (35..37) → Escrow (38..40).

Infra W23-01..08 come first. A port's adapter env may be set to real only after its contract suite is green against the real chain **and** W23-41 (migration) has run for that port. Each swap is tagged `wave-23-<port>`.

## Wave DoD

- Every port has a real adapter whose shared contract suite passes against real NEAR (testnet, or mainnet for Cargo smoke and Intents).
- The real-mode e2e passes, and the all-mock e2e of every earlier wave still passes.
- Rollback to mock works per port.
- The README mock/real table is generated.
- Monitoring and alerts are live, and the spend circuit breaker has been tested.
- Tags `wave-23-<port>` and `wave-23` are created.
