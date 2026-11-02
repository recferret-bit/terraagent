# 09 — Proposal: a parallel NEAR lane from D2

> **Status:** 2026-11-02, **proposal only**. No wave file, plan file or spec was changed. It answers the owner's ask of 2026-11-02: "start the work on NEAR features in parallel while the game is at W02; temporary sites and services; working abstractions so an implementation can be swapped by IoC; a fully mocked version; dev / mainnet switches; NEAR best practices". If accepted, it is recorded as a new decision with the next free id at that time (`main` has D-37 = hosting; the unlanded W01 branch already uses D-37..D-41, so the pack uses the labels D-MP, D-PIVOT and D-LANE until an id is assigned) and the waves are edited by the lead with `python3 scripts/plan/index_waves.py --write`.
> Sources: code `backend/app/src/near/` (README, `application/ports/*.port.ts`, `infrastructure/adapter-selection.ts`, `infrastructure/mock/`), `infra/hosts/catalog.json`, `infra/compose/chain.yml`, waves W06, W10, W13, W15, W20, W22, W23, W26, `PRODUCT_WAVES.md` §7, [06](./06-near-tools-and-adapters.md) (tags `[X1]…`), the organisers' `near/agent-skills` (near-api-js, near-kit, near-smart-contracts SKILL.md, fetched 2026-11-02), https://github.com/near/intents (fetched 2026-11-02).

## 1. Where we are

**Already built (W00, on `main`) — most of the asked-for abstraction exists:**

| Piece | What it gives | Where |
|---|---|---|
| 11 NEAR ports + `LlmProviderPort`, `NotifierPort` as abstract classes (DI tokens) | game code depends on ports only | `near/application/ports/*.port.ts` |
| `adapterOf({port, kind, useClass})` discovery | add an adapter by dropping a file; no binding edit | `src/ports/adapters.ts` |
| `NEAR_ADAPTER_<PORT>` = `mock` \| `testnet` \| `mainnet`, fail-closed | per-port switch | `infrastructure/adapter-selection.ts` |
| Prod guard (`NEAR_ALLOW_MOCK_IN_PROD`, …), real kind without adapter aborts boot | no silent mocks in prod | `src/ports/prod-guard.ts` |
| `MockChainBase` (Postgres ledger, latency, injected failures, `mock:` hashes, `opId` idempotency) | a fully mocked chain, real-shaped | `infrastructure/mock/` |
| Outbox (`chain.chain_outbox`, same-transaction enqueue, lease, backoff, `DEAD`) | crash-safe chain writes | `application/outbox/` |
| Contract harness: one suite per port, same assertions on every adapter kind; in-memory fakes | swap proof | `near/__contract__/`, `near/testing/` |
| `/dev/chain/` explorer and `devchain.terraagent.fun` vhost | see mock receipts | `frontend/dev/chain/`, W26-07 |

**Built only for ChainRead and Badge:** mock adapters and suites. The other nine ports have the abstract class and nothing else.

**The blocker is the dependency shape, not the architecture.** Every port's mock adapter and suite sits inside a game wave: Identity / Relayer in W06 (needs W01), Cargo in W10 (needs W02, W06), Intents in W13 (needs W10), AgentWallet in W15, Deed in W20, Treasury / Escrow in W22. W23 (real adapters) needs all of them. So nothing NEAR can start until W06 opens, and the real chain waits for W13, which is the D10 gate in the cut.

## 2. Proposal A — split the port rows out of the game waves

Two new waves that depend on **W00 only** (W28 also uses W26 for hosts, already in `main`). Both can open today next to W02, on their own branches, worktrees, ports and databases (PRODUCT_WAVES §7). The game waves keep their gameplay, UI and e2e rows and gain a dependency on W27.

### W27 — Chain Ports (mock adapters + suites, every port)

| Moves from | Issues (port-level only) |
|---|---|
| W06 | 03 mock `loginSocial`, 04 name derivation, 05 `createNamedAccount`, 09 key store, 10 mock relayer, 11 nonce handling, 13 `/v1/near/health`, 14 explorer account views, 22 `identity` + `relayer` suites, 25 `near.mock.fail` / `near.mock.latency` console. W06-02 (`/dev/mock-oauth`) too |
| W10 | 10 `MockCargoTokenAdapter`, 11 `cargo` suite |
| W13 | 04 mock Intents ledger, 05 `simulate` / `execute`, 06 `intents` suite, 07 `signTokenDiff` |
| W15 | 03 `MockAgentWalletAdapter`, 04 `agent-wallet` suite (W15-01's port extension comes along) |
| W20 | 03 `MockDeedNftAdapter`, 04 `deed` suite (W20-01's port extension comes along) |
| W22 | 03 `MockTreasuryDaoAdapter`, 04 `treasury` suite, 17 `MockEscrowAdapter`, 18 `escrow` suite (W22-01 / 02 port extensions come along) |
| new | §3 abstractions: `NearSignerPort`, `NetworkProfile`, `sandbox` kind, `RealChainBase` skeleton, `/v1/near/config` |

**Split rows.** W06-02/03, W10-10, W13-04 and W15-01 depend on the contracts rows W06-01, W10-01, W13-01. Split each in two: the REST / event DTOs of the NEAR module (`/v1/auth/social`, `/v1/near/*`, `account.created`, port input types) move to W27; the game commands (`cargo.export`, `market.placeOrder`, …) stay in their wave. W27 types its mocks against the port inputs only.

Stays in the game waves (needs the sim or the client): the game-command half of W06-01 / W10-01 / W13-01, W06-06, 08, 12, 15, 16, 20, 28; W10-05…09, 12…; W13-09…; W15-05 onwards; W20-05 onwards; W22-05 onwards. Their deps on the moved rows become deps on `wave-27`.

**Rule kept:** W27 only writes `backend/app/src/near/**`, `shared/db/prisma/mock-chain*.prisma`, `frontend/dev/**`, `docs/dev/DEV_TOOLS.md` entries. It never edits `shared/contracts/` game commands or `shared/sim/`, so it cannot conflict with W02–W05.

### W28 — Chain Lab (real adapters, contracts, sandbox, temporary sites)

| Moves from W23 | Issues |
|---|---|
| infra | 01 real-mode config, 02 network matrix, 03 KEK (dev part), 04 accounts, 05 RPC client, 06 real ChainRead |
| F5 | 09 provider decision, 10 real Identity, 12 identity suite on real, 15 real Relayer, 16 relayer suite on real |
| F1 | 17 Rust `res` (NEP-245), 18 deploy, 19 real Cargo, 20 cargo suite on real |
| F2 | 21 deposit path, 22 real Intents, 23 intents suite in dry mode |
| new | §4 sandbox kind wiring, self-deployed verifier, §5 lab sites, probes (§5.3) |

W23 keeps the game-facing rows: 11 client login flow, 13–14 claim, 24 the tiny trade between two **game** colonies (needs W13-13), 41–47 (migration, rollback, chain-status panel, ports table, nightly, e2e). **Effect:** when W06 / W10 / W13 land, going real is an env flip of a port whose suite is already green on testnet / sandbox / mainnet-dev — not a D10 build gate.

**Units (cut scale):** W27 ≈ 14 (rows already counted in the H set, moved, not added) + 2 new (abstractions). W28 ≈ 15 H2 (already counted outside H) + 4 new (sandbox, verifier, lab, probes). Net new ≈ 6 units, on two agents from D2.

## 3. Abstractions to add before the consumers exist

Ports are cheapest to change now: no game code calls them yet.

| # | Add / change | Why (NEAR fact) | Mock | Real |
|---|---|---|---|---|
| A1 | **`NearSignerPort`** (key custody): `publicKey(accountId, role)`, `signTransaction`, `signDelegate` (NEP-366), `signNep413`. Roles: `player`, `colony`, `relayer`, `minter`, `npc`, `director`. W06-09's key store becomes its first adapter | Five ports need to sign (Identity, Relayer, Cargo, Intents, AgentWallet). Today signing is hidden inside each port (e.g. `IntentsPort.signTokenDiff`), so a custody change (app KEK → NEAR Auth MPC → Agent Connect grant → claim) would touch five adapters | deterministic ed25519 from `MOCK_SEED`, secrets in `chain.mock_chain_key` | `KekSigner` (AES-256-GCM, `NEAR_KEK`); later NEAR Auth (client side), Agent Connect grant |
| A2 | **`NetworkProfile`** data (one table in `shared/config`): per network the RPC URLs, explorer, contract ids (`res`, `deed`, `bounty`, verifier, DAO factory), root account, relayer account | Contract ids differ per network (`res.terraagent.testnet` vs `.near`); hard-coding them per adapter is how the "4 tokens vs 10 ids" kind of drift starts (R06-28) | `*.terraagent.mock` | `sandbox`, `testnet`, `mainnet` rows |
| A3 | **`sandbox` adapter kind** (`NEAR_ADAPTER_<PORT>=sandbox`, `NearNetwork` gains `sandbox`) | near-sandbox runs a real NEAR node locally (no faucet, `fast_forward`, deterministic); it is the organisers' recommended test target for contracts | — | `near-sandbox` binary or container (§5.2) |
| A4 | **`RealChainBase`** (twin of `MockChainBase`): send with an explicit `wait_until`, map RPC / action errors to the same `NearException` codes, metrics, **signed-tx journal** | Real NEAR is **not idempotent by `opId`**: a retry after a crash signs a new nonce and executes twice. Fix: sign → persist `{opId, txHash, signedTxBytes}` → broadcast; a retry looks up the hash and re-broadcasts the **same bytes** (same nonce, so it cannot run twice), then polls `tx` status | — | journal table `chain.near_tx` (separate from `chain.chain_outbox`; closes Q-06-15's naming by giving each name one meaning) |
| A5 | **`GET /v1/near/config`** (public, cached): per port `{kind, network}`, explorer base, NEAR Auth client config | The client must pick mock login vs NEAR Auth, and mock vs nearblocks links, **at runtime** — no rebuild to switch | `mock` everywhere | per profile |
| A6 | Client-side **`ChainClient`** in `frontend/game/features/identity/` with `mock` / `nearAuth` / `walletLink` implementations, chosen from A5 | NEAR Auth signs in the browser (MPC signer, [X4]); the wallet link uses **near-connect** (Wallet Selector is superseded, near-kit SKILL.md) | mock OAuth screen (W06-02) | `@fast-auth-near/*`, near-connect |
| A7 | Port fixes: `IntentsPort.deposit` documented as `mt_batch_transfer_call` to the verifier (R06-6); `AgentWalletPort.addLimitedKey` allowance documented as **gas-only NEAR** and per-token limits moved to a server-side `AgentLimits` service (R06-64/65); optional `AgentPolicy` adapter over **Agent Connect** (owner-signed policy, revocable grants) behind the same port | function-call keys have one receiver, gas-only allowance and cannot attach deposits ([X6]) | unchanged mock semantics, but the suite asserts the server-side limit, not the key | FC key per receiver, or Agent Connect |
| A8 | Port shape drift found in pass 4, settled before W27 writes mocks: `IdentityPort` result shapes vs W06-01/03/05 (R01-58, Q-01-22); W13-07's `nonce` argument vs the landed `SignTokenDiffInput` (03 W13 notes); `EscrowOpenInput.beneficiary` required although a posted bounty has no claimer (R05-77, Q-05-26); `AddLimitedKeyInput` single `receiverId` vs W23-26's two receivers (R04-3); `LlmResponse` has no completion id, which the NEAR AI Cloud signature check needs (R04-66) | a mock written against the wrong shape is rework for every consumer wave | — | — |

## 4. Mock / sandbox / testnet / mainnet switches

**Keep the per-port variable; add profiles on top.** `NEAR_PROFILE` expands to the eleven `NEAR_ADAPTER_<PORT>` values in `scripts/dev/env.mjs` (and the same function in `@terra/config` for the server); an explicit per-port variable wins; the boot log prints the resolved matrix (W23-02).

| Profile | Identity | Relayer | Cargo | Intents | AgentWallet | Deed / Badge | Treasury | Escrow | ChainRead | Guards |
|---|---|---|---|---|---|---|---|---|---|---|
| `mock` (default, CI, `?host=local`) | mock | mock | mock | mock | mock | mock | mock | mock | mock | none |
| `sandbox` (local real node) | custodial on sandbox | sandbox | sandbox `res` | sandbox **self-deployed verifier** | sandbox | sandbox `deed` | mock (or sandbox SputnikDAO) | sandbox `bounty` | sandbox | local only |
| `testnet` | NEAR Auth testnet (localhost or a TLS host: secure context, R06-90) | testnet | testnet `res` | testnet self-deployed verifier, or mock | testnet | testnet | testnet SputnikDAO | testnet | testnet | faucet funds |
| `mainnet-dev` | testnet (localhost only, secure context) | mainnet | mainnet `res` | `intents.near`, `dry: true` + tiny trades | mock | mock | mock | mock | mainnet | `NEAR_ALLOW_MAINNET=1`, daily spend cap, dev accounts only |
| `prod` (hackathon demo) | per green suite | per green suite | per green suite | per green suite | mock | mock | mock | mock | per green suite | prod guard + `NEAR_ALLOW_MOCK_IN_PROD=true` for the rest |

**Self-deployed verifier (Proposed, to verify):** the `intents.near` verifier source is public (`near/intents`, `contracts/defuse`, `make defuse`, integration tests `cargo integration-tests defuse`). Deploying it to sandbox and testnet as `intents.terraagent.testnet` would let the `intents` suite run deposits, `simulate_intents` and `execute_intents` without mainnet funds, and **answer Q10 (NEP-245 deposit) on a free chain first**. Mainnet stays the final smoke (HACKATHON.md Q-007). Risk: a self-deployed verifier is not the production one (versions, fees, registered keys): the mainnet `dry: true` run remains the gate.

Guards to add: `NEAR_ALLOW_MAINNET=1` (planned in W23-01 / W25-06, **not in the code yet**: R06-44), `NEAR_RELAYER_DAILY_CAP` (W23-08, pull to W28 since real NEAR now starts earlier), a profile name in every receipt and log line, and a red "MAINNET" chip in the dev console and `/dev/near/` when any port is mainnet.

## 5. Temporary sites and services

All of them are dev-only: behind the `W28` flag, not linked from the landing, and on the remote host behind nginx basic auth (one snippet in `infra/nginx/snippets/`). They are removed or hidden before judging if not needed.

### 5.1 Sites (add rows to `infra/hosts/catalog.json`)

| Host | Page | Purpose | Lifetime |
|---|---|---|---|
| `devchain.terraagent.fun` (exists) | `/dev/chain/` | mock explorer; extend with real receipts (nearblocks links per network) and the signed-tx journal. **Today the hosted page shows no data:** `/v1/dev/chain/*` returns 404 under `NODE_ENV=production`, the remote default (R06-55, Q-06-25); the lab needs an explicit `TA_DEV_ROUTES=1`-style flag on the dev host only | keep (W23-43 grows from it) |
| `nearlab.terraagent.fun` (new) | `/dev/near/` | **port console**: the resolved profile matrix, health per port, a form per port method (mint 1 `metals.t1`, create a sub-account, relay a delegate, `simulate` a two-leg batch), the last suite run per port and kind, probe results (§5.3) | until W23-43's chain-status panel replaces it |
| `auth-lab.terraagent.fun` (new) | `/dev/near-auth/` | NEAR Auth **testnet** login in isolation (FastAuth provider, `login()`, `getSigner()`, show the account id and a signed test message), with the CSP for `login.*.fast-auth.com`; answers Q-06-8 (account parent, gas sponsor) before W23-10. **Needs HTTPS:** the W26 hosts are plain HTTP (D-37), and the browser APIs NEAR Auth relies on (WebAuthn / passkeys, Web Crypto) need a secure context (R06-90, Q-06-24). Run it on `localhost` (a secure context) first; on the remote host it needs one TLS vhost, which is a change to D-37's "no certbot" | until W23-11 lands |

### 5.2 Services

| Service | Where | Notes |
|---|---|---|
| near-sandbox node | `infra/compose/chain.yml` gets a real service (today it only mounts a vhost), local profile only; or near-kit `Sandbox.start()` inside the contract-test process | the `sandbox` kind (A3); not deployed remotely |
| Relayer | **in the Nest app** (D-24 one app), as the real `RelayerPort` | a separate process only if throughput needs it; use several relayer keys rotated (near-api-js `MultiKeySigner` or near-kit `RotatingKeyStore`) instead of one key behind a mutex (W06-11) |
| Mock OAuth | `/dev/mock-oauth` (W06-02, moved to W27) | the mock login provider |
| Self-deployed verifier, `res`, `deed`, `bounty` | sandbox + testnet accounts under `terraagent.testnet` | deploy scripts in `infra/near/` (W23-18 pattern) |

### 5.3 Scripts and probes (each prints a pass / fail line the lab page shows)

`npm run near:accounts -- --network testnet` (create and fund `dev-a`, `dev-b`, `minter`, `relayer`, `npc` under `terraagent.testnet`; credentials to a git-ignored file) · `npm run near:deploy -- res --network sandbox|testnet|mainnet` · `npm run near:probe -- intents-deposit` (Q10: deposit 1 unit of NEP-245 into a verifier, read `mt_balance_of`, withdraw) · `npm run near:probe -- agent-api` (Agent Connect: `getTokens()` lists `nep245:res.terraagent.near:*` or not; which host is a sandbox) · `npm run near:probe -- ai-cloud` (one NEAR AI Cloud call on the claimed credits, fetch its signature and attestation; Q-06-5) · `npm run contract:real -- --port <Port> --network sandbox|testnet|mainnet` (exists; add `sandbox`).

## 6. NEAR best practices this lane follows

| Area | Practice | Source |
|---|---|---|
| JS SDK | One library for every real adapter. **Recommendation: near-api-js v7** (official; `KeyPairSigner` / `MultiKeySigner`, `FailoverRpcProvider`, `createSignedMetaTransaction` + `relayMetaTransaction`, `near-api-js/nep413`, typed RPC errors), with **near-kit only for tests** if its `Sandbox` runs on this machine and in CI. Decide in W28-01 by a 30-minute spike: both libraries sign and relay one delegate on sandbox | near/agent-skills near-api-js, near-kit SKILL.md; Q-06-10 |
| RPC | `FailoverRpcProvider` over FastNEAR + one fallback; `final` finality for money confirmations, `optimistic` reads; never hard-code endpoints (check docs.near.org/api/rpc/providers) | near-api-js SKILL.md; D-23; HACKATHON.md Q-009 |
| Idempotency | signed-tx journal + re-broadcast of the same bytes (A4); contracts emit NEP-297 events with `memo = opId` so ChainRead can reconcile | §3 A4 |
| Keys | one key per role, never in the repo, KEK-encrypted at rest; function-call keys with explicit `receiver_id` and method names wherever a key does not attach deposits; full-access root `terraagent.near` cold; relayer keys rotated | near-api-js SKILL.md; R06-64; HACKATHON.md (secrets in env) |
| Meta-transactions | NEP-366 delegate with a short `max_block_height`; relayer allow-list of receivers **and** methods; per-account daily cap | NEAR §4, W06-10 |
| Storage | contracts pay their own storage (≈ 1 NEAR per 100 KB); NEP-145 `storage_deposit` before a receiver holds NEP-141 / NEP-245 balances, paid by the relayer; `near_sdk::store` collections, unique prefixes | near-smart-contracts SKILL.md; W06-12 |
| Contracts | near-sdk 5.x via `cargo near new` (never hand-made `Cargo.toml`), `cargo near build --release` (reproducible), near-sdk-contract-tools for Owner / Pause / NEP-145 / NEP-297, `#[private]` callbacks, `require!`, `overflow-checks = true`, state versioned as enums with `migrate`, upgrade key held by the owner's multisig | near-smart-contracts SKILL.md |
| Tests | the pyramid already in the repo, one level added: in-memory fake → Postgres mock → **near-sandbox** → testnet → mainnet-dev (Intents only), **same suite** at every level; Rust unit tests with mock contexts, sandbox integration tests, `fast_forward` for time | near-smart-contracts SKILL.md; NEAR §1a r5 |
| Intents | no testnet: mainnet dev accounts, tiny amounts, `dry: true` / `simulate_intents` first; never send native NEAR to the verifier (wrap to wNEAR); register the signing key on the verifier (`add_public_key`, R06-66); 1Click partner key (fee without it: 0.2 % per HACKATHON.md, +0.25 % per the fees page; R06-10) | HACKATHON.md Q-006/007; [X2], [X21], [X22] |
| Wallets | near-connect (or HOT Connect) for the wallet link, not Wallet Selector | near-kit SKILL.md |
| AI | NEAR AI Cloud via the OpenAI-compatible `https://cloud-api.near.ai/v1`; verify signatures before saying "verifiable" | nearbuilders.org/build; Pivot Bet C |

## 7. Calendar (D2 = Nov 2), two agents on the lane

| Day | W27 (agent 1) | W28 (agent 2) | Gate |
|---|---|---|---|
| D2–D3 | A1 signer, A2 profiles, A3 kind, A5 config; Identity + Relayer mocks and suites | SDK spike; RPC client; `near:accounts` on testnet; sandbox up; `/dev/near/` shell | both waves open; suites green on mock |
| D4–D5 | Cargo + Intents mocks and suites | Rust `res` on sandbox; self-deployed verifier on sandbox; **Q10 probe** | `cargo` suite green on sandbox; Q10 answered |
| D6–D7 | AgentWallet, Deed, Treasury, Escrow mocks and suites | real Relayer + Identity (custodial) on sandbox and testnet; `auth-lab` NEAR Auth testnet | `relayer`, `identity` suites green on testnet |
| D8–D9 | owner check, land W27 (W06 can now consume it) | real Cargo on testnet, `res.terraagent.near` mainnet smoke; real Intents on sandbox | `cargo` green on testnet + mainnet smoke |
| D10–D11 | (W06 / W10 / W13 agents pick up) | `intents` suite dry on mainnet; Agent Connect probe; owner check, land W28 | `intents` dry green; real NEAR is an env flip |
| D12–D13 | — | W23 leftovers on the game: the tiny trade between two game colonies, README mock / real table | demo recorded |

## 8. Owner decisions this proposal needs

| # | Decision | Default proposed |
|---|---|---|
| L1 | Accept the split (W27, W28; W23 shrinks; W06 / W10 / W13 / W15 / W20 / W22 depend on W27) | yes |
| L2 | Two extra agents on the lane from D2 (Pivot §3 already counts on two for H2) | yes |
| L3 | JS SDK: near-api-js v7 for adapters, near-kit for sandbox tests if the spike passes | yes |
| L4 | `sandbox` kind and a self-deployed verifier for the `intents` suite (mainnet `dry: true` still the gate) | yes |
| L5 | Login provider: NEAR Auth with the custodial fallback (Q-01-3, W23-09); the lab answers the account-parent question first | NEAR Auth testnet now, mainnet when approved |
| L6 | Agent Connect: probe only (no build) until `getTokens()` answers the NEP-245 question | probe only |
| L7 | Record this lane as D-LANE (id assigned when recorded, after W01 lands its D-37..D-41) | record with L1 |
| L8 | One TLS vhost for `auth-lab` (and later `play`) so NEAR Auth runs in a secure context on the remote host (R06-90, Q-06-24); until then real login is demoed on `localhost` | ask on D3; amend D-37 only for that host |
