# 06 — NEAR tools, standards and the port/adapter architecture

> **Status:** 2026-10-31, grooming reference, pass 2, pass 4 (2026-11-02) (legend, precedence, abbreviations: [`README.md`](./README.md)). Covers NEAR Intents, NEAR AI Cloud, NEAR Auth, NEPs, access keys, SputnikDAO / Trezu, staking pools, RPC, Chain Signatures / HOT, the organisers' agent skills, partner tools (Agent Connect, OutLayer, Agent Market), the JS SDK and Rust contract tooling, the D-30 ports with mock and real adapters, and live-sector operations. Feature rules live in [01](./01-accounts-keys-relayer.md)–[05](./05-deed-staking-treasury-bounties.md); consolidated gaps in [07](./07-gaps-and-grooming.md).

**External sources.** An external fact never changes the repo status (README precedence). Fetched 2026-10-31 by this file: [X1] https://docs.near-intents.org/llms.txt · [X2] https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits.md · [X3] https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/balances.md · [X4] https://docs.auth.near.org/ · [X5] https://docs.auth.near.org/resources/testnet.md · [X6] https://docs.near.org/protocol/access-keys. **Re-verified** by the pass-2 reviewer on 2026-10-31: [X2]–[X5]; [X4] re-fetched again by the pass-3 auditor on 2026-10-31 (R06-22, R06-25, R06-26 corrected to it); [X1] and [X6] fetched once. "Per session research, not re-fetched" marks facts from earlier research this session; [T1] marks a third-party claim, to verify. · [X7] https://auth.near.org (product homepage, fetched 2026-10-31 by the orchestrator: "We provision a real NEAR account in the background", "a real NEAR named account", transactions "wrapped as NEP-366 meta-transactions", "Your dApp pays gas through the NEAR Auth relayer"; mainnet access whitelisted on application; X not listed). **Pass 4:** [X1] and [X2] re-fetched 2026-11-02 by this file. Fetched 2026-11-01 by the lead (shared brief, not re-fetched here): [X8] https://nearhackathon.com/ (13 tracks, judges) · [X9] https://nearhackathon.com/HACKATHON.md (FAQ Q-000…Q-012, submission API) · [X10] https://nearbuilders.org/build (NEAR AI Cloud base URL, Agent Connect, OutLayer, Agent Market, partner list). Fetched 2026-11-02 by this file: [X11] https://github.com/NEAR-Intents-Agent-API/skills · [X12] https://github.com/NEAR-Intents-Agent-API/sdk-typescript · [X13] https://app.outlayer.ai/docs/getting-started · [X14] https://docs.market.near.ai/ · [X15] https://raw.githubusercontent.com/near/agent-skills/main/skills/near-ai-cloud/SKILL.md · [X16] https://docs.near.ai/cloud/verification (overview; links only) · [X17] https://docs.near.ai/cloud/verification/cloud-api/response-signatures.md · [X18] `near/agent-skills` `skills/near-api-js/SKILL.md` · [X19] `skills/near-kit/SKILL.md` · [X20] `skills/near-smart-contracts/SKILL.md` (all three under https://raw.githubusercontent.com/near/agent-skills/main/) · [X21] https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/withdrawals.md · [X22] https://docs.near-intents.org/resources/fees.md · [X23] https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts and its "features restricted to secure contexts" list. Owner facts seen on the owner's nearbuilders.org dashboard 2026-11-01 (brief) are marked "owner dashboard".

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
| NEAR AI Cloud | TEE inference | each response, by an `ecdsa` or `ed25519` key held in the TEE [X15], [X17] | app API key (owner key issued 31 Oct, US$10 credits, owner dashboard) | §3.2 |
| Agent Connect agent account (not used) | NEAR Intents Agent API | swaps / transfers / withdrawals inside an owner-signed policy [X11] | the agent's Intents balance | §3.8 |
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
| R06-6 | Deposit method: NEAR-55, W23-17 (`res` implements `mt_transfer_call`), W23-21 and W23-38 (escrow `open`) say `mt_transfer_call`; the docs accept NEP-245 via **`mt_batch_transfer_call`** (NEP-141 `ft_transfer_call`, NEP-171 `nft_transfer_call`), `receiver_id` always `intents.near`, `msg` empty / account id / `DepositMessage {receiver_id, execute_intents, refund_if_fails=false}`; re-fetch 2026-11-02: the page names only `mt_batch_transfer_call` for NEP-245 and states gas (100 TGas) and 1 yoctoNEAR for NEP-141 only; not yet tested with a call | Conflict | NEAR-55 vs [X2] verified 2026-10-31, re-verified 2026-11-02 → Q-06-1 |
| R06-7 | Verifier token id `nep245:res.terraagent.near:<ResourceKey>`; also `nep141:<contract>`, `nep171:<contract>:<token_id>`; balances by `mt_balance_of` / `mt_batch_balance_of` on `intents.near` | Decided | NEAR-55 · [X3] verified 2026-10-31 |
| R06-8 | The ten-NEP-141 fallback is not needed (Q10 answered by docs); W23-21a/b fall away; W23-21 still needs a tested 1-unit mainnet deposit | Proposed | Pivot Bet B · [X2], W23-21 (H2) → Q-06-4 |
| R06-9 | Native NEAR must not be sent to the verifier; wrap to wNEAR first. No repo file mentions wNEAR (grep), yet NEAR pairs (Bet B) need it | Gap | [X2] verified 2026-10-31 → Q-06-2 |
| R06-10 | 1Click API for external swaps, 0.2 % fee without a partner JWT (to verify); registration `partners.near-intents.org` named only in OWNER_TASKS. External sources disagree on the no-key fee: HACKATHON.md Q-006 says JWT optional, 0.2 % without [X9]; fees.md says **+0.25 % without an API key**, 0.20 % with a key and no `appFees` (0.01 % for stablecoin / same-asset routes), plus the `intents.near` protocol fee of 1 pip (0.0001 %) per transaction [X22] | Decided | NEAR-65, W23-25 (—) · [X9], [X22] → Q-06-13 |

### 3.2 NEAR AI Cloud and the LLM port

| # | Rule | Status | Source |
|---|---|---|---|
| R06-11 | The AI provider is Z.ai `glm-5.3` on `https://api.z.ai/api/paas/v4` behind `LlmProviderPort`; other providers plug in as fallback | Decided | D-09, AI §4 |
| R06-12 | `AI_PROVIDER` selects exactly `zai` (outside prod also `AI_LIVE=1`, else mock); prod refuses a mocked port unless the integration's flag is `true`: `NEAR_ALLOW_MOCK_IN_PROD`, `AI_ALLOW_MOCK_IN_PROD`, `NOTIFY_ALLOW_MOCK_IN_PROD` | Planned | code: `backend/app/src/near/README.md`, `backend/app/src/ports/`; W00-31 (H) |
| R06-13 | NEAR AI Cloud as "simple verifiable layer": Guild / Director ask the LLM and show the attestation | Proposed | MP §0 |
| R06-14 | Orchestrator calls NEAR AI Cloud every 5–15 min or on events, every response with attestation (Review C1 cuts this to one hourly call type) | Proposed | MP §4 |
| R06-15 | One LLM call type only: Guild strategy, hourly (W16-21 hook), on NEAR AI Cloud with attestation in the Guild panel, H+ after D10; record as D-MP; Z.ai fallback. Owner of provider, home and budget gate: [04](./04-agents-and-communication.md) | Proposed | Review C1 → Q-04-8 |
| R06-16 | The app verifies each response signature against the attested signing address; Guild quote shows "reasoning attested ✓"; ≈ 4 units | Proposed | Pivot Bet C |
| R06-17 | Base URL `https://cloud-api.near.ai/v1`, OpenAI-compatible (`/v1/chat/completions`, `/v1/models`), bearer auth, keys from cloud.near.ai; signing key generated in the TEE (Intel TDX confidential VMs + NVIDIA TEE GPUs); every response signed, signatures stored and fetchable later; docs `docs.near.ai/cloud/verification`; verifiers `near-examples/nearai-cloud-verification-example`, `nearai/nearai-cloud-verifier`; browser check `cloud.near.ai/verify` | Gap | [X10] (base URL), [X15], [X16] verified 2026-11-02 → Q-06-5 |
| R06-18 | `GET /v1/attestation/report?model=<id>` (model attestation: `signing_address`, `nvidia_payload`, `intel_quote`, bound to a 32-byte hex nonce) and without `model` (gateway attestation); API key required, not billed. `GET /v1/signature/{chat_id}?signing_algo=ecdsa\|ed25519` (default `ecdsa`; `resp_*` ids too) returns `text`, `signature`, `signing_address`; `text` = `<MODEL_ID>:<sha256 request body>:<sha256 response body>` (`provider_tee`) or without the model id (`gateway`); `ecdsa` = recover the EIP-191 signer and compare with the attested `signing_address`, `ed25519` = verify the UTF-8 `text` with `signing_address` as public key; a 2xx with `error_code` is "unavailable", not a signature | Gap | [X15], [X17] verified 2026-11-02 (was [T1]) → Q-06-5 |
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
| R06-37 | HOT: named as partner / candidate provider only; **not used**. HOT Connect (`@hot-labs/near-connect`) is the wallet connector in near-kit's browser example (R06-77) | Gap | NEAR §2, W23-09 · [X19] → Q-06-9 |
| R06-38 | Organisers' `near/agent-skills` (near-ai-cloud, near-api-js, near-dapp, near-intents, near-kit, near-smart-contracts; `npx skills add near/agent-skills`) and the advice to read `docs.near.org/llms.txt` (not fetched) and `docs.near-intents.org/llms.txt` ([X1]) rather than guess; `.agents/skills/` holds 3D skills only (checked 2026-11-02); no backend JS SDK chosen (options: R06-88); the Agent API has its own skills repo [X11] | Gap | organisers' setup prompt (relayed by the coordinator; Review header cites `nearai/near-hackathon-prompt-examples`) → Q-06-10 |

### 3.5 Ports, adapters, outbox

| # | Rule | Status | Source |
|---|---|---|---|
| R06-39 | Ports are abstract classes (DI tokens) in `near/application/ports/*.port.ts`: 11 NEAR ports + `LlmProviderPort`, `NotifierPort` | Decided | NEAR §1a r1, W00-30 (H) |
| R06-40 | Bindings in one module; adapters are files `infrastructure/adapters/**/*.adapter.ts` exporting `adapterOf({port, kind, useClass})`, discovered at load; ESLint blocks adapter imports elsewhere | Decided | NEAR §1a r2; code: `backend/app/src/ports/adapters.ts` |
| R06-41 | Selection `NEAR_ADAPTER_<UPPER_SNAKE(port)>`: only `testnet` / `mainnet` count, anything else is mock (a typo silently selects mock); a real kind with no registered adapter aborts boot | Planned | W00-31 (H); code: `backend/app/src/near/infrastructure/adapter-selection.ts` |
| R06-42 | Code keys: `NEAR_ADAPTER_CARGO_TOKEN`, `_DEED_NFT`, `_TREASURY_DAO`, `_AGENT_WALLET`, `_CHAIN_READ`, `_BADGE_NFT`, `_INTENTS`, `_IDENTITY`, `_RELAYER`, `_STAKING`, `_ESCROW`. `contract-real.mjs` takes PascalCase `--port` (`^[A-Z][A-Za-z]+$`), one port, no `--dry`; `test:contract` filters on `CONTRACT_PORT` env, not `--port`. Wrong in waves: env `NEAR_ADAPTER_CARGO` (W10-10, W10-29, W23-01, W23 demo 2, W23-42), `NEAR_ADAPTER_DEED` (W20-03), `NEAR_ADAPTER_TREASURY` (W22-03); `contract:real --port` kebab in the W23 "Reused, not rebuilt" paragraph (`--port <key>`), W23-06, 12, 16, 20, 23 (`--dry`), 27, 31 (`deed,badge`), 33, 37, 40; W23-45's nightly job runs "every port's suite" with `contract:real`, which takes one port per run; `test:contract -- --port` in W06-22, W10-11, W13-06, W15-04, W20-04, W20-13, W22-04, W22-18. W20-03's acceptance passes on mock regardless (re-checked 2026-11-02) | Conflict | code: `scripts/dev/contract-real.mjs`, `backend/app/test/contract/ports.contract.spec.ts` → Q-06-11 |
| R06-43 | In production a mocked NEAR port is allowed only with `NEAR_ALLOW_MOCK_IN_PROD=true` (NEAR §1a r3); the landed code aborts boot naming every mocked port and adds per-integration flags (R06-12) | Decided | NEAR §1a r3; code: W00-31 (H); W25-06 (H) |
| R06-44 | `mainnet` without `NEAR_ALLOW_MAINNET=1` aborts boot; W23-01 adds a `NEAR_NETWORK_<PORT>` override and `NEAR_RPC_URL` / `_FALLBACK_URL`. Not in the code yet (no `NEAR_ALLOW_MAINNET` in `backend/`, `shared/`, `scripts/`); W25-06 writes the guard as one global `NEAR_NETWORK=mainnet`, while the code selects the network per port (`NEAR_ADAPTER_<PORT>=mainnet`) and W23-01 tests it that way; DEPLOYMENT §4 (W26 rewrite) now only says the mainnet and mock-in-prod guards "stay in W25-06" | Decided | NEAR §12, W25-06 (H), W23-01 (H2); DEPLOYMENT §4 → Q-06-11 |
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
| R06-55 | Dev mock-chain explorer `/dev/chain/` (receipts, balances, NFTs, DAO, escrow, outbox); hosted at `devchain.terraagent.fun/dev/chain/` (HTML 200 even with the app down, `/v1/dev/chain/` proxied to the app; W26 `chain` stack has no service of its own). The `/v1/dev/chain/*` routes return 404 when `NODE_ENV=production` (the remote `.env` default) or when ChainRead is not the mock, so the hosted page shows no data (the local stack runs `NODE_ENV=development`) | Planned | W00-39 (H), W26 (landed), DEPLOYMENT §1–2, DEV_TOOLS; code: `near/infrastructure/dev/chain-explorer.controller.ts`; `docs/plan/checks/w26-check.md` → Q-06-25 |
| R06-56 | Rollback per port to mock freezes real balances read-only and parks outbox rows | Planned | W23-42 (—) |

### 3.6 Network, funding, cost

| # | Rule | Status | Source |
|---|---|---|---|
| R06-57 | Keys: `NEAR_KEK` (AES-256-GCM, `kek_version`), relayer / minter / NPC keys as file secrets (DEP-04: server `.env` or `/srv/terraagent/secrets`, mode 600; the per-key file list left DEPLOYMENT in the W26 rewrite) | Decided | NEAR §2, DEP-04 (W25-06), W23-03/04 (H2) |
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
| R06-65 | Consequences (to verify): two receivers need two keys or another design; token allowances, director and agent limits are enforced by the server, not the key; `ft_transfer_call` needs 1 yoctoNEAR ([X2]; the page does not restate it for `mt_batch_transfer_call`, to verify), so an FC key cannot deposit into the verifier (post-claim app key cannot deposit cargo); allowance not checked when the key signs a NEP-366 delegate (the relayer pays gas; R01-59, docs.near.org meta-tx page, 2026-11-02); W23-27 cannot run W15-04's per-token allowance cases unchanged | Gap | [X2], [X6] → Q-06-17 |
| R06-66 | Named accounts must register their public key with `add_public_key` on `intents.near` before their signed intents count; implicit accounts skip this ([X21]). Every TerraAgent colony, Guild and NPC account is named, so each signer key needs this step; who pays and which key calls it: no repo file says. PROTOCOL §7's F4 row already names an "`add_public_key` intent / function-call key with allowance" for the director key, without saying which. [X1] also lists an "Account Abstraction" page (`integration/verifier-contract/account-abstraction.md`, not read) | Gap | [X21] verified 2026-11-02; PROTOCOL §7 → Q-06-17 |
| R06-67 | "The allowance, the revoke and the limits are enforced by the key, not by a prompt" depends on R06-65 | Proposed | WP §3 → Q-06-17 |
| R06-68 | Mixed mode: Intents real (W23-22, H2) while AgentWallet stays mock (W23-26, —): Guild accounts `guild-N.npc.terraagent.mock` and mock director keys cannot sign `token_diff` on `intents.near`, so Guild and director orders cannot settle on real books; Bet B needs W23-26/28 real | Conflict | W23-22 (H2) vs W23-26/28 (—) → Q-06-18 |
| R06-69 | Guild NEAR float is seeded from the owner treasury and capped; numbers and NPC count owned by [04](./04-agents-and-communication.md) (R04-50 Planned, R04-51 Proposed, R04-52 Conflict → Q-04-24); demo use → Q-03-15 | Decided | NEAR-73 → R04-5 |
| R06-70 | Daily relayer spend cap `NEAR_RELAYER_DAILY_CAP` with circuit breaker | Planned | W23-08 (—) → Q-01-17 |
| R06-71 | AI_ORCHESTRATOR wants `AI_PROVIDER=zai` in prod and its AI-13 test refuses prod + `mock`; the code allows prod + mock with `AI_ALLOW_MOCK_IN_PROD=true`, and `zai` aborts boot because no LLM adapter exists at all (`backend/app/src/ai/adapters/` is absent on `main`; W16-03 Z.ai adapter is —). W25-06 omits the AI rule; DEPLOYMENT §4 no longer states it (W26 rewrite; it was the old `validate-env` line) | Conflict | AI_ORCHESTRATOR §4 config table, AI-13 vs code: `backend/app/src/ai/`, `src/ports/prod-guard.ts`; W16-03 (—), W25-06 (H) → Q-06-6 |
| R06-72 | W16-04 and the AI-13 test row: non-prod `zai` without `AI_LIVE=1` is refused (W16-04: boot fails with `AI_LIVE_REQUIRED`); code falls back to mock | Conflict | AI_ORCHESTRATOR AI-13, W16-04 (—) vs code: `backend/app/src/ai/ai-selection.ts`, `near/README.md` → Q-06-6 |
| R06-73 | Hosted demo (W25-28 on the W26 hosts `play.terraagent.fun`, `api.terraagent.fun`) sets `NEAR_ALLOW_MOCK_IN_PROD=true` with real adapters only for green ports; it also needs `AI_ALLOW_MOCK_IN_PROD` and `NOTIFY_ALLOW_MOCK_IN_PROD`, which no issue sets. The flags live in the server `/srv/terraagent/.env` (DEPLOYMENT §4 "mock flags"); `deploy` leaves existing keys as they are | Gap | W25-28 (H), DEPLOYMENT §4, code → Q-06-6 |
| R06-74 | Test matrix: `nep413.verifier.spec`, `relayer.spec`, `res` `cargo test` + `near-workspaces`, `cargo.int.spec`, `market-matcher.spec`, `intents-settle.int.spec` (manual `simulate_intents` on a mainnet dev account), `guild-pricing.spec`, `director-key.int.spec`, `deed-metadata.spec`, DAO and escrow workspaces tests. External: the organisers' contract skill treats near-workspaces-rs as replaced by near-api-rs + near-sandbox (R06-89) | Decided | NEAR §15; W23-13, 15, 17, 23, 29, 36, 38 · [X20] → Q-06-23 |
| R06-75 | Verify in docs before building: social-login provider (→ R06-21), NEP-245 deposit path (→ R06-6), 1Click (→ R06-10) | Decided | NEAR §16 |
| R06-76 | `?host=local`: accounts, NEAR and LLM report `host_unavailable`, so Bet A's offline step 1 cannot touch any NEAR port | Planned | W00-55 (H) |
| R06-77 | Wallet connector for NEP-413 link, claim and staking (W23-14 "real wallet selector") not chosen (owner 01: R01-56). near-kit's skill: "Wallet Selector is superseded by the near-connect connector for new apps" (example uses HOT Connect `@hot-labs/near-connect`); the near-api-js skill gives no wallet advice. So the W23-14 wording names a superseded library | Gap | W23-14 (—) · [X19], [X18] → Q-01-21 |
| R06-78 | NEAR AI beyond Cloud inference (agent hosting, hub): **not used**, no spec | Gap | → Q-06-9 |
| R06-79 | Verifier withdraw: direct calls on `intents.near` `ft_withdraw {token, receiver_id, amount, msg?}` (1 yoctoNEAR, 100 TGas in the example), `nft_withdraw`, `mt_withdraw` ("same patterns", arguments not listed), or signed intents `FtWithdraw` / `NftWithdraw` / `MtWithdraw` / `NativeWithdraw` in `execute_intents`; token ids without prefix; `msg` omitted or `null` → refundable `mt_transfer`, any string (even empty) → `mt_transfer_call`, no refund. Fees: protocol fee 1 pip (0.0001 %) per transaction; a 0.1 % withdrawal fee applies only to NEAR, ZEC, STRK withdrawn to Solana; no storage or registration cost stated | Gap | [X21], [X22] verified 2026-11-02 → Q-06-3 |
| R06-80 | Apply to NEAR Protocol Rewards after results (post-hackathon programme) | Proposed | Playbook Nov 18 |

### 3.8 Pass-4 additions (hackathon rules, partner tools, SDKs, contract tooling, hosting)

| # | Rule | Status | Source |
|---|---|---|---|
| R06-81 | Organiser rules that bear on the NEAR lane: **no integration is mandatory** (Q-011); testnet-only projects are eligible (Q-010); Intents has no testnet, use mainnet dev accounts, tiny amounts, `dry: true` (Q-007 / Q-008, matches R06-2); 1Click JWT optional (Q-006, fee → R06-10); a local-only demo is acceptable with a reproducible README, a hosted demo is a plus, kept up through Nov 18, ideally Nov 25 (Q-012). So the H2 rows and the D10 gate buy track fit, not eligibility | Gap | [X9] (lead, 2026-11-01) → Q-06-13 |
| R06-82 | NEAR AI Cloud key: issued 31 Oct with the US$10 NEAR Builders credits, no expiry (owner task done). No spec names its env variable or secret file (Z.ai has `ZAI_API_KEY`, AI-14); per-token price still unknown (§5) | Gap | owner dashboard (2026-11-01), [X9] Q-000 → Q-06-5 |
| R06-83 | **Agent Connect / NEAR Intents Agent API**: one agent account per agent on NEAR Intents; the owner signs a policy once with their wallet (actions swap / transfer / withdraw, assets, per-asset limits, destinations, USD budget, timelock, owner approval, freeze, weekly schedule); the backend holds a revocable grant token `ngt_…` per agent and a partner key `naa_…` (`NEAR_INTENTS_AGENT_API_KEY`); SDK `@near-intents-agent-api/sdk` (Node 24+; the repo runs Node 24: CI `NODE_VERSION: '24'`, `infra/docker/Dockerfile.app` `node:24-bookworm`) with `swap` / `withdraw` (`dry: true` previews), `transfer`, `deposit`, `getBalances`, `getTokens()`. Mainnet only, "real funds"; no testnet. Hosts disagree: nearbuilders lists `https://api.demo.agentsonintents.com` + partner portal `partners.demo.agentsonintents.com` [X10]; the skills repo and SDK default to `https://api.agentsonintents.com` and call demo.agentsonintents.com an app on the same API [X11], [X12]. No repo file mentions it | Gap | [X10], [X11], [X12] → Q-06-21 |
| R06-84 | Agent Connect fit: its policy gives the per-token limits, budgets, destinations and kill switch that a FunctionCall key cannot carry (R06-64, R06-65), so it is a candidate for the director key (F4) and Guild NPC custody (R06-68), and matches track 06's "policy engine / sandboxed wallets" and track 07's custody checkpoint. Unknown: every example asset is `nep141:` (`nep141:wrap.near`, USDT); NEP-245 is never mentioned, so whether `nep245:res.terraagent.near:*` can be held, limited or swapped is open. 09 L6 proposes a probe only, no build, until `getTokens()` answers that | Proposed | 09 §8 L6 · [X11], [X12], [X8] → Q-06-21 |
| R06-85 | **OutLayer**: off-chain execution in Intel TDX with a per-execution attestation (hash of the WASM, input, output, worker measurements); TEE key vault and per-project derived keys; called from a NEAR contract by `request_execution` (yield / `yield_resume`, paid in NEAR) or over HTTPS with Payment Keys (paid in USDC); testnet availability not stated (CLI examples use `outlayer.testnet`); price on a separate page. Possible second attestation path for Bet C or TEE key custody. No repo file mentions it | Gap | [X13], [X10] → Q-06-22 |
| R06-86 | **Agent Market** (market.near.ai): list an agent you run and earn per job, or hire one by brief; payment held when a job is awarded and released on acceptance, refunded on dispute; MCP surface for doing and hiring work, REST at market.near.ai/docs; currency, fees and testnet not stated. Possible listing for the Bet A MCP agent. No repo file mentions it | Gap | [X14], [X10] → Q-06-22 |
| R06-87 | Partners with no fit found for TerraAgent: Rhea, Aurora, HOT (beyond the login / connector candidate R06-37, R06-77), HEX, meme.cooking, SVRN, GoMining | Gap | [X10] (lead assessment, brief) → Q-06-22 |
| R06-88 | JS SDK options for the real adapters (not chosen; R06-38). **near-api-js v7** (official): `KeyPairSigner`, `MultiKeySigner`, `FailoverRpcProvider`, `createSignedMetaTransaction` + `relayMetaTransaction` (NEP-366), `near-api-js/nep413` `signMessage` / `verifyMessage`; FT / NFT helpers, no NEP-245 helpers, no wallet advice; NEAR Auth's JS provider also uses it (R06-23). **near-kit** (community; "Official docs do not cover near-kit"): `near-kit/sandbox` `Sandbox.start()`, `RotatingKeyStore` for high throughput, NEP-366 meta-transactions, `verifyNep413Signature`, typed `near.contract<T>()` wrappers, `@near-kit/react`. 09 §6 / L3 proposes near-api-js v7 for adapters and near-kit only for sandbox tests after a spike | Proposed | 09 §6, §8 L3 · [X18], [X19] → Q-06-10 |
| R06-89 | Rust tooling for `res`, `deed`, `bounty`: near-sdk 5.x (latest 5.29.x); `cargo near new`, `cargo near build --release`, `cargo near deploy`; near-sdk-contract-tools for FT / NFT, NEP-297 events, storage management, Owner, Pause, roles; `#[private]` callbacks, `require!`, `overflow-checks = true`; integration tests on near-sandbox with near-api-rs (near-workspaces-rs replaced; `fast_forward` for time); storage ≈ 1 NEAR per 100 kB. The skill gives **no NEP-245 guidance**, so `res` has no organiser template. Repo: W23 owned paths `backend/near-contracts/{res,deed,bounty}/**` "location still to be confirmed"; NEAR §15 still names near-workspaces (R06-74) | Gap | [X20]; W23 owned paths, NEAR §15 → Q-06-23 |
| R06-90 | Hosted demo is HTTP only (DEPLOYMENT §3: TLS off, port 80). Browsers give secure-context APIs (Web Authentication / passkeys, Web Crypto, service workers, Push API) only on HTTPS or loopback origins [X23], so real NEAR Auth login (W23-11) and wallet popups may not run on `http://play.terraagent.fun` (which FastAuth step needs which API: to verify). `play` CSP is `connect-src 'self'`; NEAR RPC and social-login origins need `CSP_CONNECT_EXTRA` (DEPLOYMENT §2); NEAR AI Cloud and Intents calls are server-side and unaffected | Gap | DEPLOYMENT §2, §3; W23-11 (H2), W25-28 (H) · [X23] → Q-06-24 |

## 4. Flows

**A. Boot.** For each of 11 ports compute `NEAR_ADAPTER_<UPPER_SNAKE>` → exact `testnet`/`mainnet` picks a real kind, else mock → real kind with no adapter → abort naming the port → `mainnet` without `NEAR_ALLOW_MAINNET=1` → abort (W23-01, W25-06; not landed, R06-44) → prod with any mock and its allow flag not `true` → abort naming mocked ports (NEAR, AI, NOTIFY separately) → log the matrix (W23-02).

**B. Chain write.** Game change + `outbox.enqueue({opId, port, method, payload})` in one transaction → relay claims (`SKIP LOCKED`, lease 30 s) → `port[method]({...payload, opId})` → `DONE`. Failures: error → `FAILED`, backoff `min(2^n s, 10 min)` → after 8 attempts `DEAD` (alert); relay crash → lease expires → same `opId` returns the stored receipt; rolled-back game change → no row.

**C. Swap one port.** Real adapter file → `npm run contract:real -- --port <PascalName> --network <net>` green → set env → restart → tag `wave-23-<port>`. Failures: suite red → stays mock; misspelt env key → silently mock (R06-42); rollback (W23-42, post) → frozen balances, parked rows.

**D. Intents trade (real).** Cargo minted to colony (F1) → `mt_batch_transfer_call` to `intents.near`, `msg` empty → balance `nep245:res.terraagent.near:<id>` → each named signer registered once with `add_public_key` on `intents.near` (R06-66) → maker / taker sign `token_diff` (NEP-413) → match + fee leg → `simulate_intents` → `execute_intents` via relayer → final → `market.settled` → withdraw when needed by `mt_withdraw` or an `MtWithdraw` intent, `msg` omitted for a refundable transfer (R06-79). Failures: deposit signed by an FC key → impossible (R06-65); simulate rejects → orders back to book; execute fails → reservations released ([03](./03-markets-trading-rules.md)); verifier / RPC down → `market_unavailable` (NEAR §1 p4).

**E. NEAR Auth login (testnet, [X5]).** `JavascriptProvider({network:'testnet', clientId})` → `FastAuthClient(provider, connection, fast-auth.testnet, v1.signer-prod.testnet)` → `login()` → `getSigner()`. Failures: cancel or provider down → stay guest (W23-11). Undocumented: how this signer feeds `IdentityPort.createNamedAccount` and app-held colony keys (Q-06-7).

**F. Attested Guild strategy (Proposed).** Once per boot (refresh cadence not documented) `GET /v1/attestation/report?model=<id>` with a fresh nonce → verify NVIDIA payload + Intel quote, keep `signing_address` → hourly chat completion → `GET /v1/signature/{chat_id}` → check `text` = `<model>:<sha256 req>:<sha256 resp>` and recover the signer = `signing_address` (R06-18) → chip. Failures: verify fails → deterministic reason strings, drop "verifiable" (Pivot §6); provider down → Z.ai or mock; budget hit → rules only.

## 5. Numbers

| Value | Source | Status |
|---|---|---|
| 11 NEAR ports + 2 = 13 abstract classes (the count is a code fact, W00-30 landed; the abstract-class rule is R06-39, Decided) | code: `near/application/ports/index.ts`, `src/ports/`; W00-30 (H) → R06-39 | Planned |
| Mock latency 300–1 500 ms; `MOCK_FAIL_RATE` 0 | NEAR §1a r4; code: `near/README.md` | Decided |
| Outbox: poll 1 s, lease 30 s, 8 attempts, backoff ≤ 10 min | code: `near/README.md`; W00-37 (H) | Planned |
| 10 cargo ids, 18 decimals | NEAR-50, D-34 | Decided |
| Simple deposit 100 TGas; `ft_transfer_call` 1 yoctoNEAR | [X2] | Gap |
| `intents.near` protocol fee 1 pip (0.0001 %) per transaction; withdrawal fee 0.1 % only for NEAR / ZEC / STRK to Solana | [X22] | Gap |
| Verifier storage / registration (`add_public_key`) cost | — | Gap |
| Account ≈ 0.01 NEAR; tx ≈ 0.0005–0.002 NEAR | NEAR §12, estimate; W23-16 measures | Decided (value proposed) |
| Relayer alert 5 NEAR | NEAR §12 | Decided |
| 1Click fee 0.2 % without JWT (to verify); fees.md: +0.25 % without an API key, 0.20 % with one [X22]; HACKATHON.md Q-006: 0.2 % without [X9] | NEAR-65 | Decided |
| AI budget 20 M tokens/day ≈ $40; Z.ai $1.40 / $4.40 per 1 M (third-party prices) | AI §4, §8 | Decided |
| NEAR AI Cloud price per token (attestation report not billed [X15]); US$10 credits claimed, no expiry | owner dashboard | Gap |
| H2 real rows 15 units; Bet B ≈ 4; Bet C ≈ 4 | Pivot §3 | Proposed |
| Owner deadlines: login + relayer by D11, mainnet dev accounts by D12 | OWNER_TASKS | Planned |
| Hackathon: deadline 2026-11-14 23:59 UTC; hosted demo up through Nov 18, ideally Nov 25 | [X9] Q-012 | Gap |

### 5.1 Live sector operations (Pivot season)

| Item | Value | Source | Status | Risk / question |
|---|---|---|---|---|
| Sector | 5 planets × 5 colonies (20 scripted agents + 5 owner sessions), open Nov 10, up to Nov 25 (organisers: hosted demo up through Nov 18, ideally Nov 25, [X9]) | Pivot §2 "living season", Playbook | Proposed | Q-06-19 |
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
| LlmProvider | `complete` (W00-30; no adapter of any kind on `main`) | R06-11–19, 71–73 | W16-02 · — | Z.ai W16-03 · —; NEAR AI Cloud: **none** | — | no issue (Q-04-8) |

Cross-cutting W23: 01, 02, 03, 04 · H2; 44 · H2; 07, 08 · —; 41, 42 · —; 43, 45, 46, 47 · —. Extra port methods missing from NEAR §1a: OWNER_TASKS N3.

## 8. Open questions

| Id | Question | Proposed default |
|---|---|---|
| Q-06-1 | NEAR-55 / W23-21 / W23-38 say `mt_transfer_call`; [X2] names `mt_batch_transfer_call`. Is the single call accepted too? | Use `mt_batch_transfer_call` with one id; correct NEAR-55; **W23-17 `res` implements `mt_batch_transfer_call`**; check W23-38 escrow `open`; Q-02-9 closes here |
| Q-06-2 | NEAR pairs need wNEAR in the verifier: who wraps, which account holds it? | Only if Bet B: Guild float held as wNEAR |
| Q-06-3 | Verifier storage / registration cost and `mt_withdraw` arguments (method names and fees now in [X21], [X22], R06-79) | Measure in the W23-21 1-unit deposit and one `mt_withdraw` with `msg` omitted |
| Q-06-4 | Drop W23-21a/b; fix "4 tokens" in W23-18 / W23-21 to 10 | Yes; run the 1-unit mainnet deposit before the D10 gate (the Nov 1 date passed; no real adapter or `res` contract exists yet, so it was not run) |
| Q-06-5 | NEAR AI Cloud: endpoints, signature format and attestation report are now documented (R06-18, [X15], [X17]); still open: the key's env / secret name (R06-82), which models serve `provider_tee` signatures (`/v1/models`), price per token, and a first signed call checked end to end | One manual check with the claimed key and `nearai-cloud-verifier` before any adapter; ownership → Q-04-8 |
| Q-06-6 | AI and notifier prod config: AI_ORCHESTRATOR's `zai`-in-prod rule and AI-13 vs no LLM adapter on `main` and none in the cut (R06-71); W16-04 / AI-13 `AI_LIVE` refusal vs code fallback (R06-72); hosted demo needs three allow flags | Owner: either tag W16-03 or amend AI_ORCHESTRATOR §4 / AI-13 to the code's allow-flag rule; W25-06 / W25-28 set all three flags in the server `.env` |
| Q-06-7 | Closed → Q-01-2 (NEAR Auth MPC-signed player key vs app-created `{colony}.{name}` sub-accounts and the D-18 claim; needs a new decision before W23-10) | — |
| Q-06-8 | NEAR Auth account name format, gas sponsor, mainnet approval lead time | Apply now (whether the Nov 1 application was sent: unknown); custodial fallback (HACKATHON_CUT §5) |
| Q-06-9 | Chain Signatures, HOT, NEAR AI beyond Cloud | Record "not used directly" in D-MP |
| Q-06-10 | Install `near/agent-skills` (and `NEAR-Intents-Agent-API/skills`) and route them in `AGENTS.md`? Which JS SDK do real adapters use: near-api-js v7 or near-kit (R06-88)? | Install before the first real adapter; 09 L3 proposes near-api-js v7 for adapters and near-kit for sandbox tests after a spike (owner decides; pick in W23-01 or in the SDK spike of 09's proposed lane) |
| Q-06-11 | Env and port names in waves differ from code (R06-42); the global `NEAR_NETWORK` of NEAR §12 / W25-06 vs per-port selection in code and W23-01 (R06-44) | Rename in the waves + add `--dry` and comma lists to `contract-real.mjs` (a W23-01 subtask), or drop them |
| Q-06-12 | ChainRead in the hackathon: real (W23-05/06 H2) or mocked (cut §1)? MP §10 also lists the Guild in the day-10 swap | Owner picks one; then retag W23 or amend the cut |
| Q-06-13 | D10 gate (cut) or D6 start (Pivot)? W23-25 1Click untagged while Bet B needs it by D11; no integration is mandatory for eligibility (R06-81); 1Click fee without a key 0.2 % or 0.25 % (R06-10) | Owner decides with D-PIVOT; get a 1Click key if Bet B stays |
| Q-06-14 | Closed → Q-01-17 (rollback W23-42 and alerts W23-07 while real funds move) | — |
| Q-06-15 | Outbox table name (R06-62); extra port methods (N3) | Use the code name `chain.chain_outbox` in NEAR §13 and DATA_MODEL; Q-02-11 closes here |
| Q-06-16 | Closed → Q-04-8 (where LLM signature and attestation are stored) | — |
| Q-06-17 | Access-key semantics (R06-63–67): one receiver, gas-only allowance, no deposits, `add_public_key` registration | Server-enforced limits as the design; one FC key per receiver; deposits by the relayer path or full-access key; reword WP §3 if confirmed |
| Q-06-18 | Mixed mode (R06-68): can Guild / director orders settle on real Intents while AgentWallet is mock? | Either tag W23-26/28 H2 for Bet B or keep NPC trades on mock books, said in the README |
| Q-06-19 | Live-sector chain budget: accounts, storage, trades, who tops up, Guild coverage of five planets | Owner budget before D10; real ports only for green suites |
| Q-06-20 | Closed → Q-01-21 (wallet connector; 01 owns the wallet link). Default carried there: post-hackathon, pick with W23-14 | — |
| Q-06-21 | Agent Connect (R06-83, R06-84): does `getTokens()` list any `nep245:` asset, can a policy name `nep245:res.terraagent.near:*`, which host (demo vs `api.agentsonintents.com` mainnet), and would it replace the AgentWallet FC-key design for the director and Guild (Q-06-17, Q-06-18)? | Probe only (09 L6): one partner key, `getTokens()` and a `dry: true` swap on mainnet with a tiny NEP-141 amount; no build before the NEP-245 answer |
| Q-06-22 | OutLayer, Agent Market and the other partners (R06-85–87): use any? | No build. OutLayer only as a Bet C fallback if the NEAR AI Cloud signature check fails; Agent Market listing of the Bet A MCP agent only if OD-19 adds Bet A; confirm the no-fit list |
| Q-06-23 | Rust contracts (R06-89): where do `res`, `deed`, `bounty` live (`backend/near-contracts/` is "to be confirmed"), which NEP-245 implementation (no organiser template), and near-sandbox + near-api-rs instead of NEAR §15's near-workspaces? | `cargo near new` per contract under the W23 path; hand-written NEP-245 on near-sdk 5.x with near-sdk-contract-tools for events / Owner / Pause; update NEAR §15 to near-sandbox |
| Q-06-24 | Hosted demo over HTTP (R06-90): does real NEAR Auth login (passkeys, Auth0 redirect, `crypto.subtle`) work on `http://play.terraagent.fun`, and which origins go in `CSP_CONNECT_EXTRA`? | Test on the hosted demo before D10; if it fails, a TLS row before real F5 is shown there, else show real login locally only |
| Q-06-25 | The hosted `devchain.terraagent.fun` explorer is empty in production (R06-55): should judges see mock receipts on the hosted demo? | Owner: either a read-only explorer flag for the hosted demo (new S row in W25) or link receipts only from the local stack and say so in the README |

## 9. Grill questions

- **W00 (landed):** do every wave's env keys and `--port` names match the code (R06-42)?
- **W06:** does the `identity` suite assume app-held keys NEAR Auth cannot give (Q-06-7)? Does the mock relayer path cover the one-off `add_public_key` on `intents.near` per named account (R06-66)?
- **W10:** does the `cargo` suite use the 10 ids and `opId` idempotency the real `res` will enforce; does `res` expose `mt_batch_transfer_call`; which NEP-245 implementation, with no organiser template (Q-06-23)?
- **W13:** does the mock `deposit` use `nep245:res.terraagent.near:<id>` and the batch method (R06-6, R06-7); does the mock refuse a `token_diff` from a signer not registered with `add_public_key` (R06-66); does the mock `withdraw` follow `mt_withdraw` (R06-79)?
- **W15:** per-token allowances on a key that real NEAR cannot carry (R06-64); can Guild orders settle when Intents is real and AgentWallet mock (Q-06-18)? Would an Agent Connect policy replace the FC-key design for the director and Guild, and can it hold NEP-245 cargo (Q-06-21)?
- **W16:** provider, home and budget gate for the Guild LLM call → Q-04-8; who fixes the AI prod rule (Q-06-6)? NEAR AI Cloud endpoints are now documented (R06-18): who runs the first signed call (Q-06-5); OutLayer as fallback (Q-06-22)?
- **W20 / W22:** these ports stay mock in the demo; does the README say so? Fix `NEAR_ADAPTER_DEED` / `_TREASURY`.
- **W23:** which rows are really H2 (Q-06-12); is W23-21 a doc check or a mainnet deposit; who decides custody before W23-10; testnet Pilot ID vs mainnet cargo (Q-01-19); mixed mode (Q-06-18); CSP for `login.*.fast-auth.com` (W23-11) and HTTP-only hosting (Q-06-24); which JS SDK (Q-06-10); W23-14 "wallet selector" → near-connect (Q-01-21); Rust tooling and contract path (Q-06-23); Agent Connect probe (Q-06-21); 1Click fee 0.2 % vs 0.25 % (R06-10)?
- **W25:** `ports:table` with network; `validate-env` and the three allow flags (Q-06-6); the global `NEAR_NETWORK` in W25-06 vs per-port selection (R06-44); alerts while the sector runs to Nov 25 (Q-06-19); hosted demo kept up through Nov 18 (R06-81); empty hosted explorer (Q-06-25).
- **Owner, Nov 1 (status 2026-11-02):** NEAR AI Cloud key: **done** (issued 31 Oct, US$10 credits, no expiry; owner dashboard). NEAR Auth mainnet application, 1Click partner key / JWT, funded mainnet dev accounts: **unknown** (not seen in the repo or the brief). 1-unit mainnet deposit (Q-06-4): **not done** (nothing real exists). D-MP / D-PIVOT: still Proposed. TerraAgent is listed as an active project on nearbuilders.org (`ferretrecovic.near`); builder profile 60 % (avatar, first idea missing).
