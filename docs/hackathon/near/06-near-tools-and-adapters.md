# 06 — NEAR tools, standards and the port/adapter architecture

> **Status:** 2026-10-31, grooming reference, pass 2 (legend, precedence, abbreviations: [`README.md`](./README.md)). Covers NEAR Intents, NEAR AI Cloud, NEAR Auth, NEPs, access keys, SputnikDAO / Trezu, staking pools, RPC, Chain Signatures / HOT, the organisers' agent skills, the D-30 ports with mock and real adapters, and live-sector operations. Feature rules live in [01](./01-accounts-keys-relayer.md)–[05](./05-deed-staking-treasury-bounties.md); consolidated gaps in [07](./07-gaps-and-grooming.md).

**External sources.** An external fact never changes the repo status (README precedence). Fetched 2026-10-31 by this file: [X1] https://docs.near-intents.org/llms.txt · [X2] https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits.md · [X3] https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/balances.md · [X4] https://docs.auth.near.org/ · [X5] https://docs.auth.near.org/resources/testnet.md · [X6] https://docs.near.org/protocol/access-keys. **Re-verified** by the pass-2 reviewer on 2026-10-31: [X2]–[X5]; [X4] re-fetched again by the pass-3 auditor on 2026-10-31 (R06-22, R06-25, R06-26 corrected to it); [X1] and [X6] fetched once. "Per session research, not re-fetched" marks facts from earlier research this session; [T1] marks a third-party claim, to verify. · [X7] https://auth.near.org (product homepage, fetched 2026-10-31 by the orchestrator: "We provision a real NEAR account in the background", "a real NEAR named account", transactions "wrapped as NEP-366 meta-transactions", "Your dApp pays gas through the NEAR Auth relayer"; mainnet access whitelisted on application; X not listed).

## 1. Purpose

The game reaches NEAR only through the `near` module (NEAR §1 p6). Every NEAR feature F1–F8 sits behind an abstract port with a Postgres mock in phase 1; a real adapter replaces the mock per port, by env, once that port's shared contract suite passes against the real chain (NEAR §1a). This file is the owner of: the external tool facts, the port/adapter/env rules, access-key semantics, mixed real/mock mode, and the live-sector chain budget.

## 2. Actors and accounts

| Actor / account | Tool | Signs | Pays | Detail |
|---|---|---|---|---|
| `relayer.terraagent.*` | NEP-366 | wraps colony / player / NPC `DelegateAction`s | gas + storage deposits | [01](./01-accounts-keys-relayer.md) |
| `minter.terraagent.*` | NEP-245 `res` | `mt_mint`, `mt_burn` | via relayer | [02](./02-mining-cargo-mint-authority.md) |
| Colony / Guild accounts | `intents.near` | `token_diff` intents (NEP-413 payload) | nothing (relayer) | [03](./03-markets-trading-rules.md), [04](./04-agents-and-communication.md) |
| `intents.near` | verifier | executes zero-sum batches | — | holds deposited balances per account [X2] |
| NEAR Auth (`fast-auth.testnet`, `jwt.fast-auth.testnet`, MPC `v1.signer-prod.testnet`) | FastAuth | a key derived per identity; an MPC network produces every signature [X4]; MPC contract id in [X5] | "sponsor gas via delegate actions" [X4]; who sponsors: to verify | §3.3 |
| NEAR AI Cloud | TEE inference | each response (per session research, not re-fetched) | app API key | §3.2 |
| FastNEAR + fallback RPC | RPC | — | API key (owner) | D-23 |
| Owner `terraagent.near` | root | creates sub-accounts, funds | dev, relayer, Guild float | cold; [01](./01-accounts-keys-relayer.md) |

## 3. Rules

### 3.1 NEAR Intents

| # | Rule | Status | Source |
|---|---|---|---|
| R06-1 | Only the `near` module calls NEAR RPC and `intents.near`; other modules call it in-process | Decided | NEAR §1 p6, D-24 |
| R06-2 | `intents.near` is mainnet only; dev uses mainnet dev accounts with tiny amounts plus `simulate_intents` / `dry: true` quotes; CI stubs the verifier | Decided | NEAR-64, HACKATHON_CUT §5 |
| R06-3 | An order is a signed `token_diff` intent (NEP-413 payload) from the maker's colony account, deadline = order TTL ([03](./03-markets-trading-rules.md)) | Decided | NEAR-60 |
| R06-4 | A batch `[maker, taker, feeLeg]` sums to zero per token or `execute_intents` rejects it whole; the mock raises `NEAR_INTENT_DIFF_NOT_ZERO` | Decided | NEAR-61, NEAR §1a r4 |
| R06-5 | Batches go to `execute_intents` through the relayer, after `simulate_intents` | Decided | NEAR-62, W23-22 (H2) |
| R06-6 | Deposit method: NEAR-55, W23-17 (`res` implements `mt_transfer_call`), W23-21 and W23-38 (escrow `open`) say `mt_transfer_call`; the docs accept NEP-245 via **`mt_batch_transfer_call`** (NEP-141 `ft_transfer_call`, NEP-171 `nft_transfer_call`), `receiver_id` always `intents.near`, `msg` empty / account id / `DepositMessage {receiver_id, execute_intents, refund_if_fails=false}`; not yet tested with a call | Conflict | NEAR-55 vs [X2] verified 2026-10-31 → Q-06-1 |
| R06-7 | Verifier token id `nep245:res.terraagent.near:<ResourceKey>`; also `nep141:<contract>`, `nep171:<contract>:<token_id>`; balances by `mt_balance_of` / `mt_batch_balance_of` on `intents.near` | Decided | NEAR-55 · [X3] verified 2026-10-31 |
| R06-8 | The ten-NEP-141 fallback is not needed (Q10 answered by docs); W23-21a/b fall away; W23-21 still needs a tested 1-unit mainnet deposit | Proposed | Pivot Bet B · [X2], W23-21 (H2) → Q-06-4 |
| R06-9 | Native NEAR must not be sent to the verifier; wrap to wNEAR first. No repo file mentions wNEAR (grep), yet NEAR pairs (Bet B) need it | Gap | [X2] verified 2026-10-31 → Q-06-2 |
| R06-10 | 1Click API for external swaps, 0.2 % fee without a partner JWT (to verify); registration `partners.near-intents.org` named only in OWNER_TASKS | Decided | NEAR-65, W23-25 (—) |

### 3.2 NEAR AI Cloud and the LLM port

| # | Rule | Status | Source |
|---|---|---|---|
| R06-11 | The AI provider is Z.ai `glm-5.3` on `https://api.z.ai/api/paas/v4` behind `LlmProviderPort`; other providers plug in as fallback | Decided | D-09, AI §4 |
| R06-12 | `AI_PROVIDER` selects exactly `zai` (outside prod also `AI_LIVE=1`, else mock); prod refuses a mocked port unless the integration's flag is `true`: `NEAR_ALLOW_MOCK_IN_PROD`, `AI_ALLOW_MOCK_IN_PROD`, `NOTIFY_ALLOW_MOCK_IN_PROD` | Planned | code: `backend/app/src/near/README.md`, `backend/app/src/ports/`; W00-31 (H) |
| R06-13 | NEAR AI Cloud as "simple verifiable layer": Guild / Director ask the LLM and show the attestation | Proposed | MP §0 |
| R06-14 | Orchestrator calls NEAR AI Cloud every 5–15 min or on events, every response with attestation (Review C1 cuts this to one hourly call type) | Proposed | MP §4 |
| R06-15 | One LLM call type only: Guild strategy, hourly (W16-21 hook), on NEAR AI Cloud with attestation in the Guild panel, H+ after D10; record as D-37; Z.ai fallback. Owner of provider, home and budget gate: [04](./04-agents-and-communication.md) | Proposed | Review C1 → Q-04-8 |
| R06-16 | The app verifies each response signature against the attested signing address; Guild quote shows "reasoning attested ✓"; ≈ 4 units | Proposed | Pivot Bet C |
| R06-17 | Base URL `https://cloud-api.near.ai/v1`, OpenAI-compatible, bearer auth; signing key generated in the TEE (NVIDIA H100/H200 confidential VMs); every response signed; docs `docs.near.ai/cloud/verification`; verifiers `near-examples/nearai-cloud-verification-example`, `nearai/nearai-cloud-verifier` | Gap | per session research, not re-fetched; Review header lists docs.near.ai/cloud/verification as checked → Q-06-5 |
| R06-18 | `GET /v1/attestation/report` and `GET /v1/signature/{chat_id}` | Gap | [T1] to verify → Q-06-5 |
| R06-19 | No issue builds a NEAR AI Cloud adapter or verifier; W16 has no H / H+ row (W16-02, 03, 04, 07, 08, 15, 21 all —) | Gap | W16 → Q-04-8 |

### 3.3 NEAR Auth (F5 login)

| # | Rule | Status | Source |
|---|---|---|---|
| R06-20 | Social login is NEAR Auth (auth.near.org) | Proposed | MP §0, Review C6 |
| R06-21 | Provider still to be chosen (named accounts, PWA redirect, cost, HOT partner); fallback: server-created custodial named sub-accounts | Planned | W23-09 (H2) · NEAR §2, HACKATHON_CUT §5 |
| R06-22 | Providers Google, Apple, email, passkeys through Auth0; X is not listed (Review C6 reads this as "no X login") | Gap | [X4] verified 2026-10-31 → Q-06-8 |
| R06-23 | Packages `@fast-auth-near/react-sdk`, `@fast-auth-near/javascript-provider` (+ `near-api-js`), also `@fast-auth-near/browser-sdk`, `@fast-auth-near/react-native-provider`; source github.com/peersyst/fast-auth (per session research, not re-fetched) | Gap | [X4] verified 2026-10-31; W23-10, W23-11 |
| R06-24 | Testnet: no sign-off; Auth0 domain `login.testnet.fast-auth.com`, `fastAuthContractId` `fast-auth.testnet`, MPC `v1.signer-prod.testnet`; `JavascriptProvider` → connect → `FastAuthClient` → `login()` → `getSigner()`. Mainnet needs approved credentials (`home/apply.md`) | Gap | [X5], [X4] verified 2026-10-31 |
| R06-25 | Each identity has its own deterministically derived key, and "a Multi-Party Computation network produces every signature from distributed key shares"; no single party holds the key [X4]; the MPC contract is `v1.signer-prod.testnet` on testnet [X5]. NEAR §2 assumes app-generated ed25519 keys under `NEAR_KEK` and app-created `{colony}.{name}` sub-accounts | Gap | [X4] re-fetched 2026-10-31, [X5] → Q-06-7 |
| R06-26 | NEAR Auth provisions a real named NEAR account per login and pays gas through its own relayer as NEP-366 meta-transactions ([X7] homepage); the developer docs say gas is sponsored "via delegate actions" ([X4]). Neither page says under which parent the account is named (`{name}.terraagent.near` or the provider's) | Gap | [X7], [X4], Review C6 → Q-06-8 |

### 3.4 Standards and other NEAR tools

| # | Rule | Status | Source |
|---|---|---|---|
| R06-27 | NEP-245: one contract `res.terraagent.near`, 10 ids = D-34 `ResourceKey`s, 18 decimals, minter-only mint/burn, unrestricted transfers, NEP-297 events ([02](./02-mining-cargo-mint-authority.md)) | Decided | NEAR-50, W23-17 (H2) |
| R06-28 | W23-18 ("`mt_metadata` returns the 4 tokens") and W23-21 ("4 NEP-141 tokens") vs the 10 ids of NEAR-50 / W23-17 | Conflict | → Q-06-4 |
| R06-29 | NEP-171: one `deed` contract, collections `deed` and `badge` (soulbound), operator-only `extra` updates ([05](./05-deed-staking-treasury-bounties.md)) | Decided | NEAR-90/91, W23-29 (—) |
| R06-30 | NEP-366: `DelegateAction` wrapped by the relayer, receiver allow-list, per-signer nonce mutex, one retry on `InvalidNonce`, no public HTTP | Decided | NEAR §4, W23-15 (H2) |
| R06-31 | NEP-413: wallet link (tag 2^31+413, SHA-256, ed25519 vs a FullAccess key at `final`, single-use 5-min nonce) and the intent payload | Decided | NEAR §3, NEAR-60, W23-13 (—) |
| R06-32 | NEP-141: fallback only (R06-8); wNEAR `nep141:wrap.near` would be the NEAR leg of any NEAR pair | Gap | [X3] → Q-06-2 |
| R06-33 | Treasury `{planet}.sputnik-dao.near`; SputnikDAO factory vs Trezu decided by research | Decided | NEAR-100, W23-35 (—) |
| R06-34 | Staking pools from `NEAR_STAKING_POOLS`; `deposit_and_stake` signed by the claimed account only | Decided | NEAR-92, W23-32 (—) |
| R06-35 | RPC: FastNEAR + fallback (D-23, NEAR §12); W23-05 (Planned) adds `final` for writes, `optimistic` for reads, circuit-break to fallback | Decided | D-23, NEAR §12; W23-05 (H2) |
| R06-36 | Chain Signatures: **not used directly**; only in early `tech-stack-spec.md` / `autonomous-colony-spec.md` text; NEAR Auth signs through an MPC network [X4] and configures an MPC signer contract [X5] | Gap | → Q-06-9 |
| R06-37 | HOT: named as partner / candidate provider only; **not used** | Gap | NEAR §2, W23-09 → Q-06-9 |
| R06-38 | Organisers' `near/agent-skills` (near-ai-cloud, near-api-js, near-dapp, near-intents, near-kit, near-smart-contracts; `npx skills add near/agent-skills`) and the advice to read `docs.near.org/llms.txt` (not fetched) and `docs.near-intents.org/llms.txt` ([X1]) rather than guess; `.agents/skills/` holds 3D skills only; no backend JS SDK chosen | Gap | organisers' setup prompt (relayed by the coordinator; Review header cites `nearai/near-hackathon-prompt-examples`) → Q-06-10 |

### 3.5 Ports, adapters, outbox

| # | Rule | Status | Source |
|---|---|---|---|
| R06-39 | Ports are abstract classes (DI tokens) in `near/application/ports/*.port.ts`: 11 NEAR ports + `LlmProviderPort`, `NotifierPort` | Decided | NEAR §1a r1, W00-30 (H) |
| R06-40 | Bindings in one module; adapters are files `infrastructure/adapters/**/*.adapter.ts` exporting `adapterOf({port, kind, useClass})`, discovered at load; ESLint blocks adapter imports elsewhere | Decided | NEAR §1a r2; code: `backend/app/src/ports/adapters.ts` |
| R06-41 | Selection `NEAR_ADAPTER_<UPPER_SNAKE(port)>`: only `testnet` / `mainnet` count, anything else is mock (a typo silently selects mock); a real kind with no registered adapter aborts boot | Planned | W00-31 (H); code: `backend/app/src/near/infrastructure/adapter-selection.ts` |
| R06-42 | Code keys: `NEAR_ADAPTER_CARGO_TOKEN`, `_DEED_NFT`, `_TREASURY_DAO`, `_AGENT_WALLET`, `_CHAIN_READ`, `_BADGE_NFT`, `_INTENTS`, `_IDENTITY`, `_RELAYER`, `_STAKING`, `_ESCROW`. `contract-real.mjs` takes PascalCase `--port` (`^[A-Z][A-Za-z]+$`), one port, no `--dry`; `test:contract` filters on `CONTRACT_PORT` env, not `--port`. Wrong in waves: env `NEAR_ADAPTER_CARGO` (W10-10, W10-29, W23-01, W23 demo 2, W23-42), `NEAR_ADAPTER_DEED` (W20-03), `NEAR_ADAPTER_TREASURY` (W22-03); `contract:real --port` kebab in W23 header, W23-06, 12, 16, 20, 23 (`--dry`), 27, 31 (`deed,badge`), 33, 37, 40; `test:contract -- --port` in W06-22, W10-11, W13-06, W15-04, W20-04, W20-13, W22-04, W22-18. W20-03's acceptance passes on mock regardless | Conflict | code: `scripts/dev/contract-real.mjs`, `backend/app/test/contract/ports.contract.spec.ts` → Q-06-11 |
| R06-43 | In production a mocked NEAR port is allowed only with `NEAR_ALLOW_MOCK_IN_PROD=true` (NEAR §1a r3); the landed code aborts boot naming every mocked port and adds per-integration flags (R06-12) | Decided | NEAR §1a r3; code: W00-31 (H); W25-06 (H) |
| R06-44 | `mainnet` without `NEAR_ALLOW_MAINNET=1` aborts boot; W23-01 adds a `NEAR_NETWORK_<PORT>` override and `NEAR_RPC_URL` / `_FALLBACK_URL` | Decided | NEAR §12, DEPLOYMENT §4, W23-01 (H2) |
| R06-45 | Mocks real-shaped: `chain.mock_chain_*`, `mock:` + 44 base58 from `opId`, stable `NearException` codes, 300–1 500 ms, `MOCK_FAIL_RATE` → `NEAR_MOCK_INJECTED_FAILURE`, `MOCK_SEED` | Decided | NEAR §1a r4, W00-32 (H) |
| R06-46 | Every chain write goes through the outbox in the game change's transaction, deterministic `opId`; adapters idempotent by `opId` | Decided | NEAR §1a r6, W00-37 (H) |
| R06-47 | One contract suite per port, same assertions on mock (CI) and real; W23 adds no cases | Decided | NEAR §1a r5, W00-38 (H) |
| R06-48 | zod at env, port inputs and adapter responses; in-memory fakes only in unit tests | Decided | NEAR §1a r7–8 |
| R06-49 | Swap order F5 → F1 → F2 → F3/F4 → F6 → F7 → F8, enforced by W23 deps (W23-19 needs W23-16, W23-22 needs W23-20); a port goes real only after its suite is green on real | Planned | W23 "Swap order" (D-30 Proposed) |
| R06-50 | Hackathon: only F5, F1, F2 go real, after the D10 gate; every other port, including ChainRead, stays mocked | Decided | HACKATHON_CUT §1 (D-27) |
| R06-51 | W23-05 / W23-06 (real RPC, `ChainReadPort`) are H2 vs R06-50 | Conflict | → Q-06-12 |
| R06-52 | Real swap starts D6 (F5 testnet), F1 D9, F2 D11, with two extra agents | Proposed | Pivot §4, Playbook |
| R06-53 | Network matrix: mainnet for Cargo and Intents, testnet elsewhere in dev, mainnet in prod; startup log lists it. A testnet colony account cannot hold mainnet cargo (→ Q-01-19) | Decided | NEAR §12, W23-01/02 (H2) |
| R06-54 | README mock/real table generated by `npm run ports:table`, network column for real adapters | Decided | NEAR §1a, W25-26 (H), W23-44 (H2) |
| R06-55 | Dev mock-chain explorer `/dev/chain/` (receipts, balances, NFTs, DAO, escrow, outbox) | Planned | W00-39 (H), DEV_TOOLS |
| R06-56 | Rollback per port to mock freezes real balances read-only and parks outbox rows | Planned | W23-42 (—) |

### 3.6 Network, funding, cost

| # | Rule | Status | Source |
|---|---|---|---|
| R06-57 | Keys: `NEAR_KEK` (AES-256-GCM, `kek_version`), relayer / minter / NPC keys as file secrets | Decided | NEAR §2, DEPLOYMENT §4, W23-03/04 (H2) |
| R06-58 | Alert when the relayer is below `NEAR_MIN_RELAYER_BALANCE` = 5 NEAR (relayer owned by 01: R01-32) | Decided | NEAR §12; W23-07 (—), W25-13 (—) |
| R06-59 | Account ≈ 0.01 NEAR; mint / burn / batch ≈ 0.0005–0.002 NEAR; storage deposits by the relayer | Decided (value proposed) | NEAR §12, estimate; W23-16 (H2) measures |
| R06-60 | Accounts to create and fund before real F1/F2: `dev-a`, `dev-b`, `minter`, `relayer`, `res` deployer, `npc.*` | Planned | W23-04 (H2) · OWNER_TASKS |
| R06-61 | Telemetry `near_rpc_latency_seconds`, `near_tx_total`, `near_tx_pending`, `near_balance_near`, `intent_batch_failed_total` …; code outbox metrics `ta_chain_outbox_{pending,dead,relayed_total}` | Decided | NEAR §14; code: `backend/app/src/near/README.md` |

### 3.7 Pass-2 additions (outbox name, access keys, mixed mode, ops, tests)

| # | Rule | Status | Source |
|---|---|---|---|
| R06-62 | Outbox table: code `chain.chain_outbox` (`shared/db/prisma/chain-outbox.prisma`, W00-37) vs NEAR §1a `chain_outbox` vs NEAR §13 `chain.near_tx` vs DATA_MODEL §4.4 `chain.near_job` (§4.2 note `chain.near_tx`) | Conflict | → Q-06-15 |
| R06-63 | Key design that R06-64 tests: Guild NPC FC keys for `intents.near` and `res.*` only (NEAR §2); a director key with an allowance on the colony account (NEAR §2, NEAR-80). Disputed elsewhere, not restated here: the residual app FC key after claim (Conflict → Q-01-11) and the allowance basis and unit (Conflict → Q-04-1). W15-03 / W23-26 (Planned) give keys a per-token allowance and both receivers | Decided | NEAR §2, NEAR-80; W15-03 (H), W23-26 (—) → Q-06-17 |
| R06-64 | A FunctionCall key has **one** `receiver_id`, optional method names, an allowance in NEAR **spent on gas only** (charged at buy price, refunded later); FC keys cannot attach a deposit or transfer NEAR | Gap | [X6] verified 2026-10-31 → Q-06-17 |
| R06-65 | Consequences (to verify): two receivers need two keys or another design; token allowances, director and agent limits are enforced by the server, not the key; `mt_batch_transfer_call` / `ft_transfer_call` need 1 yoctoNEAR, so an FC key cannot deposit into the verifier (post-claim app key cannot deposit cargo); allowance accounting under NEP-366 (relayer pays gas) unknown; W23-27 cannot run W15-04's per-token allowance cases unchanged | Gap | [X2], [X6] → Q-06-17 |
| R06-66 | Signing keys may need registering on `intents.near` (`add_public_key`; [X1] lists an "Account Abstraction" page, not read). PROTOCOL §7's F4 row already names an "`add_public_key` intent / function-call key with allowance" for the director key, without saying which | Gap | to verify; PROTOCOL §7 → Q-06-17 |
| R06-67 | "The allowance, the revoke and the limits are enforced by the key, not by a prompt" depends on R06-65 | Proposed | WP §3 → Q-06-17 |
| R06-68 | Mixed mode: Intents real (W23-22, H2) while AgentWallet stays mock (W23-26, —): Guild accounts `guild-N.npc.terraagent.mock` and mock director keys cannot sign `token_diff` on `intents.near`, so Guild and director orders cannot settle on real books; Bet B needs W23-26/28 real | Conflict | W23-22 (H2) vs W23-26/28 (—) → Q-06-18 |
| R06-69 | Guild NEAR float is seeded from the owner treasury and capped; numbers and NPC count owned by [04](./04-agents-and-communication.md) (R04-50 Planned, R04-51 Proposed, R04-52 Conflict → Q-04-24); demo use → Q-03-15 | Decided | NEAR-73 → R04-5 |
| R06-70 | Daily relayer spend cap `NEAR_RELAYER_DAILY_CAP` with circuit breaker | Planned | W23-08 (—) → Q-01-17 |
| R06-71 | `validate-env` requires `AI_PROVIDER=zai` in prod, but no Z.ai adapter is in the cut (W16-03 —), so `zai` aborts boot (no adapter of that kind); W25-06 omits this rule | Conflict | DEPLOYMENT §4 vs code, W16-03 (—), W25-06 (H) → Q-06-6 |
| R06-72 | W16-04: non-prod `zai` without `AI_LIVE` fails boot with `AI_LIVE_REQUIRED`; code falls back to mock | Conflict | W16-04 (—) vs code: `backend/app/src/near/README.md` → Q-06-6 |
| R06-73 | Hosted demo sets `NEAR_ALLOW_MOCK_IN_PROD=true` with real adapters only for green ports; it also needs `AI_ALLOW_MOCK_IN_PROD` and `NOTIFY_ALLOW_MOCK_IN_PROD`, which no issue sets | Gap | W25-28 (H), code → Q-06-6 |
| R06-74 | Test matrix: `nep413.verifier.spec`, `relayer.spec`, `res` `cargo test` + `near-workspaces`, `cargo.int.spec`, `market-matcher.spec`, `intents-settle.int.spec` (manual `simulate_intents` on a mainnet dev account), `guild-pricing.spec`, `director-key.int.spec`, `deed-metadata.spec`, DAO and escrow workspaces tests | Decided | NEAR §15; W23-13, 15, 17, 23, 29, 36, 38 |
| R06-75 | Verify in docs before building: social-login provider (→ R06-21), NEP-245 deposit path (→ R06-6), 1Click (→ R06-10) | Decided | NEAR §16 |
| R06-76 | `?host=local`: accounts, NEAR and LLM report `host_unavailable`, so Bet A's offline step 1 cannot touch any NEAR port | Planned | W00-55 (H) |
| R06-77 | Wallet connector for NEP-413 link, claim and staking (W23-14 "real wallet selector") not chosen (owner 01: R01-56) | Gap | W23-14 (—) → Q-01-21 |
| R06-78 | NEAR AI beyond Cloud inference (agent hosting, hub): **not used**, no spec | Gap | → Q-06-9 |
| R06-79 | Verifier withdraw method names and verifier fees: to verify ([X1] lists a withdrawals page, not read) | Gap | [X1] → Q-06-3 |
| R06-80 | Apply to NEAR Protocol Rewards after results (post-hackathon programme) | Proposed | Playbook Nov 18 |

## 4. Flows

**A. Boot.** For each of 11 ports compute `NEAR_ADAPTER_<UPPER_SNAKE>` → exact `testnet`/`mainnet` picks a real kind, else mock → real kind with no adapter → abort naming the port → `mainnet` without `NEAR_ALLOW_MAINNET=1` → abort (W23-01) → prod with any mock and its allow flag not `true` → abort naming mocked ports (NEAR, AI, NOTIFY separately) → log the matrix (W23-02).

**B. Chain write.** Game change + `outbox.enqueue({opId, port, method, payload})` in one transaction → relay claims (`SKIP LOCKED`, lease 30 s) → `port[method]({...payload, opId})` → `DONE`. Failures: error → `FAILED`, backoff `min(2^n s, 10 min)` → after 8 attempts `DEAD` (alert); relay crash → lease expires → same `opId` returns the stored receipt; rolled-back game change → no row.

**C. Swap one port.** Real adapter file → `npm run contract:real -- --port <PascalName> --network <net>` green → set env → restart → tag `wave-23-<port>`. Failures: suite red → stays mock; misspelt env key → silently mock (R06-42); rollback (W23-42, post) → frozen balances, parked rows.

**D. Intents trade (real).** Cargo minted to colony (F1) → `mt_batch_transfer_call` to `intents.near`, `msg` empty → balance `nep245:res.terraagent.near:<id>` → maker / taker sign `token_diff` (NEP-413) → match + fee leg → `simulate_intents` → `execute_intents` via relayer → final → `market.settled` → withdraw when needed (method to verify). Failures: deposit signed by an FC key → impossible (R06-65); simulate rejects → orders back to book; execute fails → reservations released ([03](./03-markets-trading-rules.md)); verifier / RPC down → `market_unavailable` (NEAR §1 p4).

**E. NEAR Auth login (testnet, [X5]).** `JavascriptProvider({network:'testnet', clientId})` → `FastAuthClient(provider, connection, fast-auth.testnet, v1.signer-prod.testnet)` → `login()` → `getSigner()`. Failures: cancel or provider down → stay guest (W23-11). Undocumented: how this signer feeds `IdentityPort.createNamedAccount` and app-held colony keys (Q-06-7).

**F. Attested Guild strategy (Proposed).** Hourly → NEAR AI Cloud adapter → response + signature → verify against the attested address → chip. Failures: verify fails → deterministic reason strings, drop "verifiable" (Pivot §6); provider down → Z.ai or mock; budget hit → rules only.

## 5. Numbers

| Value | Source | Status |
|---|---|---|
| 11 NEAR ports + 2 = 13 abstract classes (the count is a code fact, W00-30 landed; the abstract-class rule is R06-39, Decided) | code: `near/application/ports/index.ts`, `src/ports/`; W00-30 (H) → R06-39 | Planned |
| Mock latency 300–1 500 ms; `MOCK_FAIL_RATE` 0 | NEAR §1a r4; code: `near/README.md` | Decided |
| Outbox: poll 1 s, lease 30 s, 8 attempts, backoff ≤ 10 min | code: `near/README.md`; W00-37 (H) | Planned |
| 10 cargo ids, 18 decimals | NEAR-50, D-34 | Decided |
| Simple deposit 100 TGas; `ft_transfer_call` 1 yoctoNEAR | [X2] | Gap |
| Verifier storage / registration cost, withdraw fees | — | Gap |
| Account ≈ 0.01 NEAR; tx ≈ 0.0005–0.002 NEAR | NEAR §12, estimate; W23-16 measures | Decided (value proposed) |
| Relayer alert 5 NEAR | NEAR §12 | Decided |
| 1Click fee 0.2 % without JWT (to verify) | NEAR-65 | Decided |
| AI budget 20 M tokens/day ≈ $40; Z.ai $1.40 / $4.40 per 1 M (third-party prices) | AI §4, §8 | Decided |
| NEAR AI Cloud price per token | — | Gap |
| H2 real rows 15 units; Bet B ≈ 4; Bet C ≈ 4 | Pivot §3 | Proposed |
| Owner deadlines: login + relayer by D11, mainnet dev accounts by D12 | OWNER_TASKS | Planned |

### 5.1 Live sector operations (Pivot season)

| Item | Value | Source | Status | Risk / question |
|---|---|---|---|---|
| Sector | 5 planets × 5 colonies (20 scripted agents + 5 owner sessions), open Nov 10, up to Nov 25 | Pivot §2 "living season", Playbook | Proposed | Q-06-19 |
| Colony accounts | ≈ 25 creations + storage deposits ≈ 0.25 NEAR + unmeasured storage; real only if Identity / AgentWallet are real | NEAR §12 estimate, R06-68 | Gap | Q-06-19 |
| DAOs | 5, lazy-created on first Council open; real DAO is W23-36 (—), so mock | W22-05 (H) | Planned | — |
| Guild NPCs | 2 NPCs (Kestrel, Osprey) for 5 planets; visits every 20–40 min, dock 12 min | W15-02 (H) | Planned | thin Guild coverage per planet → Q-06-19 |
| Relayer spend | no cap in the cut; alerts W23-07, W25-13 untagged while real NEAR runs to Nov 25 | W23-07/08, W25-13 (—) | Gap | Q-01-17 |
| External agents | judges' agents via MCP / Agent API add tx volume; D-25 no anti-bot; Pivot "rate limit per account" | Pivot Bet A, D-25 | Proposed | Q-04-17 (rate limits), Q-01-17 (relayer spend) |
| Prod flags | `NEAR_ALLOW_MOCK_IN_PROD=true` + real only where green; AI / NOTIFY flags unset | W25-28 (H), R06-73 | Gap | Q-06-6 |
| Loss limit | Guild float 10 NEAR total, kill switch W15-12 | Pivot Bet B | Proposed | → R04-51 |

## 6. On-chain vs app vs sim

| State | Mock mode | Real mode | Truth |
|---|---|---|---|
| Cargo balances | `chain.mock_chain_balance` | `res.terraagent.near` | chain (sim until export) |
| Verifier balances | mock ledger (`IntentsPort.deposit`) | `intents.near` (`mt_balance_of`) | chain |
| Orders, trades | `chain.market_order`, `chain.intent_trade` | same + tx hash | app for the book, chain for settlement |
| Receipts | `mock_chain_receipt` (`mock:` hash) | nearblocks via `ChainReadPort` | chain |
| Outbox, adapter matrix | `chain.chain_outbox` (R06-62), env | same | app |
| Keys | `chain.near_colony_account.encrypted_secret` (NEAR §2) vs `chain.near_account` (DATA_MODEL §4.4); neither in the merged schema → Q-01-7 | same; NEAR Auth player key (Q-06-7) | app / provider |
| Key limits (allowance, receivers) | `mock_chain_access_key` per-token allowance | gas-only allowance, one receiver (R06-64) | server (Q-06-17) |
| LLM decisions | `ai.ai_decision` (W16-15, —) | no signature / attestation column | → Q-04-8 |

## 7. Wave map

**W00 card.** Deps: none · @hack: NEAR rows W00-30, 31, 32, 33, 35, 37, 38, 39 landed (all H, commit `d2970e8`); W00-55 local host H · DoD: `npm run test:contract` green for ChainRead and Badge.
**W23 card.** Deps: W00, W06, W10, W13 for the H2 ports (W15/W20/W21/W22/W25 for the rest) · no `@hack` tag; the H2 rows cover demo steps 1–3 (Identity, Cargo, Intents); step 4 needs W23-43/46, step 5 W23-42, step 6 W23-47, all — · DoD gates: per-port suite green on real (W23-12, 16, 20, 23), README network column (W23-44); the wave DoD (every port real, monitoring, rollback) is post-hackathon.

| Port | Methods (`*.port.ts`) | Rules | Mock (suite) | Real target | W23 issues · H | Real in hackathon? |
|---|---|---|---|---|---|---|
| Identity | `loginSocial`, `createNamedAccount`, `claimAccount` | R06-20–26 | W06 (W06-22) | NEAR Auth or W23-09 choice | 09, 10, 11, 12 · H2; 13, 14 · — | after gate; testnet; mainnet needs whitelist |
| Relayer | `submitMetaTx` | R06-30, 58, 70 | W06 (W06-22) | NEP-366 `relayer.*` | 15, 16 · H2 | after gate |
| CargoToken | `mint`, `burn`, `balanceOf`, `transfer` | R06-27, 28 | W10-10 (W10-11) | NEP-245 `res.terraagent.near` | 17, 18, 19, 20 · H2 | after gate (mainnet smoke) |
| Intents | `deposit`, `signTokenDiff`, `simulate`, `execute`, `withdraw` | R06-1–10, 64–66 | W13 (W13-06) | `intents.near` | 21, 22, 23, 24 · H2; 25 · — | after gate: simulate + one tiny trade |
| ChainRead | `explorerUrl`, `receipt`, `health` | R06-35, 50, 51 | W00-33 (W00-38) | FastNEAR + nearblocks | 05, 06 · H2 | Conflict (Q-06-12) |
| AgentWallet | `createSubAccount`, `addLimitedKey`, `revokeKey` | R06-63–65, 68 | W15-03 (W15-04) | sub-accounts + FC keys | 26, 27, 28 · — | **no** (breaks Bet B, R06-68) |
| DeedNft / BadgeNft | `mint`, `updateMetadata`, `ownerOf` | R06-29 | Deed W20-03 on the W00-35 base (W20-04); Badge W00-35 (W00-38) | NEP-171 `deed.*` | 29, 30, 31 · — | **no** |
| Staking | `stake`, `unstake`, `rewards` | R06-34 | W20 (W20-13) | whitelisted pools | 32, 33, 34 · — | **no** |
| TreasuryDao | `createDao`, `propose`, `vote`, `finalize`, `deposit` | R06-33 | W22-03 (W22-04) | SputnikDAO / Trezu | 35, 36, 37 · — | **no** |
| Escrow | `open`, `claim`, `refund` | R06-6 (`open`) | W22 (W22-18) | `bounty.*` contract | 38, 39, 40 · — | **no** |
| LlmProvider | (W00-30) | R06-11–19, 71–73 | W16-02 · — | Z.ai W16-03 · —; NEAR AI Cloud: **none** | — | no issue (Q-04-8) |

Cross-cutting W23: 01, 02, 03, 04 · H2; 44 · H2; 07, 08 · —; 41, 42 · —; 43, 45, 46, 47 · —. Extra port methods missing from NEAR §1a: OWNER_TASKS N3.

## 8. Open questions

| Id | Question | Proposed default |
|---|---|---|
| Q-06-1 | NEAR-55 / W23-21 / W23-38 say `mt_transfer_call`; [X2] names `mt_batch_transfer_call`. Is the single call accepted too? | Use `mt_batch_transfer_call` with one id; correct NEAR-55; **W23-17 `res` implements `mt_batch_transfer_call`**; check W23-38 escrow `open`; Q-02-9 closes here |
| Q-06-2 | NEAR pairs need wNEAR in the verifier: who wraps, which account holds it? | Only if Bet B: Guild float held as wNEAR |
| Q-06-3 | Verifier storage / registration cost, withdraw method names and fees | Measure in the W23-21 1-unit deposit and a withdraw |
| Q-06-4 | Drop W23-21a/b; fix "4 tokens" in W23-18 / W23-21 to 10 | Yes; still run the mainnet deposit on Nov 1 |
| Q-06-5 | NEAR AI Cloud endpoints, signature format and attestation report are unverified ([T1]) | Verify on docs.near.ai before any adapter; ownership → Q-04-8 |
| Q-06-6 | AI and notifier prod config: `validate-env` `zai` rule vs no Z.ai adapter in the cut; W16-04 `AI_LIVE_REQUIRED` vs code fallback; hosted demo needs three allow flags | Owner: either tag W16-03 or relax `validate-env`; W25-06 / W25-28 set all three flags |
| Q-06-7 | Closed → Q-01-2 (NEAR Auth MPC-signed player key vs app-created `{colony}.{name}` sub-accounts and the D-18 claim; needs a new decision before W23-10) | — |
| Q-06-8 | NEAR Auth account name format, gas sponsor, mainnet approval lead time | Apply Nov 1; custodial fallback (HACKATHON_CUT §5) |
| Q-06-9 | Chain Signatures, HOT, NEAR AI beyond Cloud | Record "not used directly" in D-37 |
| Q-06-10 | Install `near/agent-skills` and route them in `AGENTS.md`? Which JS SDK do real adapters use? | Install before W23; pick in W23-01 |
| Q-06-11 | Env and port names in waves differ from code (R06-42) | Rename in the waves + add `--dry` and comma lists to `contract-real.mjs` (a W23-01 subtask), or drop them |
| Q-06-12 | ChainRead in the hackathon: real (W23-05/06 H2) or mocked (cut §1)? MP §10 also lists the Guild in the day-10 swap | Owner picks one; then retag W23 or amend the cut |
| Q-06-13 | D10 gate (cut) or D6 start (Pivot)? W23-25 1Click untagged while Bet B needs it by D11 | Owner decides with D-38 |
| Q-06-14 | Closed → Q-01-17 (rollback W23-42 and alerts W23-07 while real funds move) | — |
| Q-06-15 | Outbox table name (R06-62); extra port methods (N3) | Use the code name `chain.chain_outbox` in NEAR §13 and DATA_MODEL; Q-02-11 closes here |
| Q-06-16 | Closed → Q-04-8 (where LLM signature and attestation are stored) | — |
| Q-06-17 | Access-key semantics (R06-63–67): one receiver, gas-only allowance, no deposits, `add_public_key` registration | Server-enforced limits as the design; one FC key per receiver; deposits by the relayer path or full-access key; reword WP §3 if confirmed |
| Q-06-18 | Mixed mode (R06-68): can Guild / director orders settle on real Intents while AgentWallet is mock? | Either tag W23-26/28 H2 for Bet B or keep NPC trades on mock books, said in the README |
| Q-06-19 | Live-sector chain budget: accounts, storage, trades, who tops up, Guild coverage of five planets | Owner budget before D10; real ports only for green suites |
| Q-06-20 | Closed → Q-01-21 (wallet connector; 01 owns the wallet link). Default carried there: post-hackathon, pick with W23-14 | — |

## 9. Grill questions

- **W00 (landed):** do every wave's env keys and `--port` names match the code (R06-42)?
- **W06:** does the `identity` suite assume app-held keys NEAR Auth cannot give (Q-06-7)?
- **W10:** does the `cargo` suite use the 10 ids and `opId` idempotency the real `res` will enforce; does `res` expose `mt_batch_transfer_call`?
- **W13:** does the mock `deposit` use `nep245:res.terraagent.near:<id>` and the batch method (R06-6, R06-7)?
- **W15:** per-token allowances on a key that real NEAR cannot carry (R06-64); can Guild orders settle when Intents is real and AgentWallet mock (Q-06-18)?
- **W16:** provider, home and budget gate for the Guild LLM call → Q-04-8; who fixes `validate-env` (Q-06-6)?
- **W20 / W22:** these ports stay mock in the demo; does the README say so? Fix `NEAR_ADAPTER_DEED` / `_TREASURY`.
- **W23:** which rows are really H2 (Q-06-12); is W23-21 a doc check or a mainnet deposit; who decides custody before W23-10; testnet Pilot ID vs mainnet cargo (Q-01-19); mixed mode (Q-06-18); CSP for `login.*.fast-auth.com` (W23-11)?
- **W25:** `ports:table` with network; `validate-env` and the three allow flags (Q-06-6); alerts while the sector runs to Nov 25 (Q-06-19).
- **Owner, Nov 1:** NEAR Auth mainnet application, 1Click JWT, NEAR AI Cloud key, funded accounts, D-37 / D-38.
