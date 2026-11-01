# 01 — Accounts, keys and the relayer (F5, plus director / Guild / agent keys)

> **Status:** 2026-10-31, grooming reference (legend, precedence and abbreviations: [`README.md`](./README.md)). Sources: [`NEAR.md`](../../spec/NEAR.md) §1–§4, §8, §12, §16 · [`W06`](../../plan/waves/W06-invisible-chain.md) · [`W23`](../../plan/waves/W23-real-near.md) F5 and infra rows · [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) §4.1, §4.4, §11 · D-10, D-17, D-18, D-25, D-26, D-30 · [`PROTOCOL.md`](../../spec/PROTOCOL.md) §7–§8 · `MP` §0, §9 · `Review` §2 · `Pivot` · code in `backend/app/src/near/`, `shared/db/prisma/`. Spec wins over this file. This file owns: account naming, key custody, the claim (Q-01-11), the relayer, the wallet link and the F5 error model.

## 1. Purpose

F5 makes the chain invisible: a player starts as a guest, saves progress with a social login, and gets a named account ("Pilot ID") without seeing a wallet, gas or a transaction. Every gameplay write is signed by keys the app holds and paid by our relayer (NEP-366). The same key model carries the colony accounts that hold cargo ([`./02-…`](./02-mining-cargo-mint-authority.md)) and sign market intents ([`./03-…`](./03-markets-trading-rules.md)), the director key and the Guild / mercenary / agent keys ([`./04-…`](./04-agents-and-communication.md)), and the one-way claim to self-custody that staking needs ([`./05-…`](./05-deed-staking-treasury-bounties.md)). Key scopes below are the **design**; whether NEAR function-call keys can express them is owned by [`./06-…`](./06-near-tools-and-adapters.md) (function-call key semantics, R06-63..67, Q-06-17).

## 2. Actors and accounts (accounts registry)

| Account | Role | Keys and who holds them | Funded by | Status | Source |
|---|---|---|---|---|---|
| `terraagent.near` (+ `.testnet`) | Root; "creates the sub-accounts below" | owner hardware / cold wallet; app holds **none** | owner | Decided | NEAR §2, §16 #1, D-23 |
| `colonies.terraagent.*` | Parent for colony accounts, key in a "near-gateway secret store" (pre-D-24 text) | full access, online | owner | Conflict | OWNER_TASKS vs NEAR §2 → Q-01-1 |
| `relayer.terraagent.near` | Pays gas for meta-txs; operator of deed metadata and escrow release | full access, file secret (app) | owner; alert below 5 NEAR | Decided | NEAR §2, §4, §12, NEAR-91, NEAR-111 |
| `minter.terraagent.near` | Sole `mt_mint` / `mt_burn` on `res.*` | full access, file secret (app) | owner (not stated) | Decided | NEAR §2, NEAR-50 |
| `res.terraagent.near` | NEP-245 cargo contract ([`./02-…`](./02-mining-cargo-mint-authority.md)) | deployer key; holder not stated | owner | Decided | NEAR-50, OWNER_TASKS, W23-18 (H2) |
| `deed.terraagent.near` | NEP-171 deeds and badges ([`./05-…`](./05-deed-staking-treasury-bounties.md)) | deployer not stated; relayer is operator | owner | Decided | NEAR-90, NEAR-91 |
| `bounty.terraagent.near` | Escrow (F8) | deployer not stated; relayer is operator | owner | Decided | NEAR-110, NEAR-111 |
| `{planet}.sputnik-dao.near` | Planet treasury DAO; members = colony accounts | DAO policy | fee legs | Decided | NEAR-100 |
| `intents.near` | NEAR Intents verifier (external, mainnet only) | not ours | — | Decided | NEAR-64 |
| `{name}.terraagent.near` | Player named account ("Pilot ID") | per-player key, app, KEK-encrypted until claim | relayer ("relayer-funded", W23-10) | Decided | NEAR §2 |
| `{colony}.{name}.terraagent.near` | Holds cargo, signs intents, owns the deed, stakes after claim | per-colony key (app) until claim; then player full access + app FC key (Q-01-11); director key | relayer | Decided | NEAR §2 |
| `npc.terraagent.near` | Parent of NPC accounts | not stated | owner | Planned | W23-04 (H2), DATA_MODEL §4.4.1 |
| `guild-N.npc.terraagent.near` | Guild NPC traders (F3) | FC keys for `intents.near` + `res.*` (app) | owner treasury, capped float | Decided | NEAR §2, NEAR-70, NEAR-73 |
| `merc-N.npc.terraagent.near` | Mercenary NPCs (F8) | limited keys via `AgentWalletPort` (app) | funding cap per NPC | Planned | W22-27 (—), W23-26 (—) |
| Project protocol-fee account | Receives the protocol fee | — | — | Gap | Q-03-7 |
| Mainnet prize-payout wallet | Submission form field; owned by the owner, not used by the app | owner | — | Planned | W25-31 (H), Playbook §6 |
| `dev-a.terraagent.near`, `dev-b.terraagent.near` | Mainnet dev accounts for Intents tests (no testnet) | owner / dev env (not stated) | owner, "a few NEAR" | Proposed | OWNER_TASKS, Pivot §8 |
| Agent API colonies | External AI agents play a colony via API / MCP | custodial colony key under an allowance | relayer | Proposed | Pivot Bet A, Q-04-16 |

Login provider (not an account): NEAR Auth proposed (R01-3, R01-4); mock provider in W06 (R01-6).

## 3. Rules

| # | Rule | Status | Source |
|---|---|---|---|
| R01-1 | Guest play first; first visit creates a guest bound to a device secret; gameplay never shows the chain | Decided | NEAR §1 p1 |
| R01-2 | Social login creates the named account `{name}.terraagent.near` | Decided | NEAR §2, NEF F5 |
| R01-3 | Login provider is **NEAR Auth** (auth.near.org); W23-09 still lists the choice as open, no D-37 records it (06 R06-20/21) | Proposed | MP §0, W23-09 (H2) |
| R01-4 | NEAR Auth facts: Google / Apple / email / passkeys via Auth0, gas sponsored through delegate actions, React and JS SDKs, mainnet needs approved credentials, testnet usable without approval, X not listed ([X4]); real named accounts and NEP-366 meta-transactions through the NEAR Auth relayer are stated on the product homepage ([X7]); the parent account is unstated (R06-26). In no spec; owner of the facts is 06 (R06-22..26) | Gap | [X4] re-fetched 2026-10-31, Review C6 · Q-06-8 |
| R01-5 | Fallback if the provider (or its mainnet whitelist) is not ready: guest + server-created custodial named accounts | Proposed | OWNER_TASKS, Review C6, Pivot §6 |
| R01-6 | Mock provider screen `/dev/mock-oauth` with "Google (mock)" and "X (mock)", HMAC-signed mock token | Planned | W06-02 (H) |
| R01-7 | `loginSocial` verifies the token → `{provider, subject, email?}`; bad/expired → `NEAR_PROVIDER_REJECTED` (401) | Planned | W06-03 (H) |
| R01-8 | Name derivation: lowercase `[a-z0-9-]`, 2–32 chars, from the display name; reserved list (`relayer`, `minter`, `guild-*`, `npc`, `admin`…) → `relayer-1` | Planned | W06-04 (H) |
| R01-9 | Collision appends `-2`, `-3`…; account creation is idempotent per `(provider, subject)` | Planned | W06-05 (H), W23-10 (H2) |
| R01-10 | Guest → social upgrade links `core.social_identity` to the guest player, keeps every colony, rotates the refresh token, emits `account.created` | Planned | W06-06 (H) |
| R01-11 | Same `(provider, subject)` on a new device resolves to the same player; no duplicate player | Planned | W06-07 (—) |
| R01-12 | Real login: redirect or popup, PWA / iOS redirect fallback; cancel or provider down → stay guest | Planned | W23-11 (H2) |
| R01-13 | Colony sub-account `{colony}.{name}.*` created on `colonyFounded`; guest colonies get one at upgrade time | Planned | W06-08 (H) |
| R01-14 | Account suffix per adapter: `.terraagent.mock` (mock), `.testnet` in dev, `.near` in prod; root from `NEAR_ACCOUNT_ROOT` | Decided | NEAR §1a table, §12 |
| R01-15 | Root holds no app key; relayer and minter keys are full-access file secrets loaded at boot | Decided | NEAR §2; W23-04 (H2) |
| R01-16 | App generates ed25519 keys per player and per colony; AES-256-GCM under `NEAR_KEK`, stored with `kek_version`; decrypted only inside the `near` module; no plaintext in the DB | Decided | NEAR §2 Keys; W06-09 (H) |
| R01-17 | Production KEK from deploy secrets; rotation keeps old rows decryptable by `kek_version`; no key material in logs | Planned | W23-03 (H2) |
| R01-18 | Only the `near` module talks to NEAR RPC and `intents.near` | Decided | NEAR §1 p6 |
| R01-19 | Claim: player links a wallet (NEP-413); the app adds the player key as **full access** and removes its own full-access key; one-way; required for staking | Decided | NEAR §2, D-18 |
| R01-20 | Residual app key after claim: NEAR §2 / W23-14 keep one FC key with allowance scoped to `intents.near` + `res.*`; D-18 ("the game's key is removed") / W21-15 ("drop game key") keep none | Conflict | NEAR §2, W23-14 (—) vs D-18, W21-15 (—) → Q-01-11 |
| R01-21 | Claim is available "at launch" | Decided | D-18, NEAR §16 #3 |
| R01-22 | W06 ships only a claim stub: `POST /v1/near/claim` → `409 not_available_yet`; button "Take custody" disabled | Planned | W06-17 (—) |
| R01-23 | Wallet UI appears only for claim and staking | Decided | NEAR §1 p1, CLIENT §8a |
| R01-24 | NEP-413 link: challenge `{nonce 32 B, recipient "terraagent.com", message}`, single use, 5 min; verify `borsh({tag 2^31+413,…})` → SHA-256 → ed25519 against a FullAccess key at `final`; wrong network suffix rejected | Decided | NEAR §3 |
| R01-25 | Wallet link is optional: needed only for claim, staking and cross-device portability | Decided | NEAR §3 |
| R01-26 | Verifier + vectors in W06, UI behind sub-flag `W06.walletLink` (off); real FullAccess check over RPC in W23 | Planned | W06-18 (—), W23-13 (—) |
| R01-27 | Colony, player and NPC keys sign `DelegateAction`s; `relayer.*` wraps them in `Action::Delegate` and pays gas | Decided | NEAR §4 |
| R01-28 | Relayer is in-process; no public HTTP surface | Decided | NEAR §4 |
| R01-29 | Receiver allow-list: `res.*`, `deed.*`, `bounty.*`, planet DAOs, `intents.near`; cost control, not anti-cheat; checked before submit (W06-10) | Decided | NEAR §4, D-25; W06-10 (H) |
| R01-30 | Nonces: per-signer async mutex + access-key nonce cache; one retry on `InvalidNonce` | Decided | NEAR §4 |
| R01-31 | Every chain write goes through the outbox in the game's DB transaction with a deterministic `opId` (table name → Q-06-15) | Decided | NEAR §1a r6; code: `shared/db/prisma/chain-outbox.prisma` (W00-37) |
| R01-32 | Relayer alerts implemented by W23-07: balance < `NEAR_MIN_RELAYER_BALANCE` (5 NEAR; the threshold itself is a spec rule, R06-58 Decided), outbox stuck > 10 min, error rate > 5 % (these two only in W23-07) | Planned | NEAR §12; W23-07 (—) |
| R01-33 | Daily relayer spend cap `NEAR_RELAYER_DAILY_CAP`; over cap → chain writes pause, outbox queues, UI "chain busy, will settle" | Planned | W23-08 (—) |
| R01-34 | Real adapter selection fails closed; `mainnet` needs `NEAR_ALLOW_MAINNET=1`; mocks in prod need `NEAR_ALLOW_MOCK_IN_PROD=true` (env key names → Q-06-11) | Decided | NEAR §1a r3, §12; W23-01 (H2) |
| R01-35 | A port goes real only when its shared contract suite passes on the real adapter; relayer suite + measured cost report is the F5 gate before any F1 swap | Decided | NEAR §1a r5; W23-16 (H2) |
| R01-36 | Director key: a separate function-call / intents key on the colony account (design; key semantics → Q-06-17); `POST /v1/near/director-key` adds, revoke deletes; HUD shows spent vs allowance | Decided | NEAR §2, NEAR-80 |
| R01-37 | Orders signed with the director key stay within `autoTrade` limits; sim and `near` module both check. In the cut the "director" is the sim autotrade system (W15-21), not the W16 AI director | Decided | NEAR-81, W15-21 (H) |
| R01-38 | Director allowance basis (away trading budget vs autoTrade per-session caps) and unit (per token, W15-03 / W15-04, vs NEAR, W23-26 "0.1 NEAR"; `chain.director_key.allowance` single numeric) | Conflict | NEAR-80, W15-03 (H), W15-18 (H), W23-26 (—), DATA_MODEL §4.4.1 → Q-04-1 |
| R01-39 | Guild NPC accounts: FC keys for `intents.near` and `res.*` only (design; semantics → Q-06-17); sign their own intents; NEAR float seeded from the owner treasury and capped (owner 04: R04-5) | Decided | NEAR §2, NEAR-70, NEAR-73 |
| R01-40 | Mercenary accounts `merc-N.npc.*` via `AgentWalletPort`, funding cap per NPC | Planned | W22-27 (—), W23-26 (—) |
| R01-41 | Agent API `foundColony` gives an external agent a named sub-account with **custodial** keys "as F5 does for humans"; trading uses intents under the director allowance; one receipt per trade (owner: 04) | Proposed | Pivot Bet A |
| R01-42 | Track 07 checkpoint: explain key custody and what an agent cannot do without approval; deny list owned by 04 (Q-04-16) | Proposed | Review §3.2, WP §3 |
| R01-43 | No `wallet`, `gas`, `transaction`, `seed phrase`, `private key` in player-facing strings, except claim and staking screens | Decided | NEAR §1 p1; W06-21 (—) |
| R01-44 | Relayed actions: chip "Saving to orbit…", failure toast "Couldn't save to orbit, retrying" with Retry; driven by `relay.settled/failed` | Planned | W06-20 (H) |
| R01-45 | Errors as `CoreException` subclasses with stable codes `NEAR_PROVIDER_REJECTED`, `NEAR_NAME_TAKEN`, `NEAR_RELAY_FAILED`, `NEAR_RELAY_RECEIVER_NOT_ALLOWED`; global filter → HTTP status; client → toasts | Planned | W06-10, W06-11, W06-19 (H) |
| R01-46 | REST error envelope `{error:{code,message,details?},requestId}` with lowercase codes incl. `near_unavailable` (503); no `rate_limited` | Decided | PROTOCOL §8, D-25 |
| R01-47 | Mocks are real-shaped: `mock:` hashes, 300–1 500 ms latency, injectable failure rate; `near.mock.fail` / `near.mock.latency` for every port | Decided | NEAR §1a r4; W06-25 (H); code: `NEAR_MOCK_INJECTED_FAILURE` |
| R01-48 | `TA_WAVES` below W06 hides login, Pilot ID, Account settings and `/dev/chain` | Planned | W06-28 (H) |
| R01-49 | The named account is shown as "Pilot ID" with a copy button; guests see "Guest pilot · Save progress" | Planned | W06-16 (H) |
| R01-50 | First gasless action: NEP-145 `storage_deposit` on `res.*` per colony account, `opId = storage-deposit:{colonyAccountId}`, paid by the relayer | Planned | W06-12 (H) |
| R01-51 | Guild float cap "5 NEAR"; per NPC or in total is not stated (owner 04: R04-50) | Planned | W15-02 (H) |
| R01-52 | Guild float "5 NEAR per NPC, 10 NEAR total", kill switch W15-12 promoted to H (owner 04: R04-51) | Proposed | Pivot Bet B |
| R01-53 | Landed NEAR error codes differ from the waves: `NEAR_ACCOUNT_EXISTS` (409) vs W06-19 `NEAR_NAME_TAKEN`; `NEAR_UNAVAILABLE` (503) vs `near_unavailable` / `market_unavailable`; `NEAR_MOCK_INJECTED_FAILURE` (503) | Conflict | code: `backend/app/src/near/domain/errors.ts` vs W06-19, PROTOCOL §8, NEAR §1 p4 → Q-01-16 |
| R01-54 | REST endpoints: `POST /auth/social` `{provider, token}` → `{accessToken, player, accountId}` (optional bearer); `POST /auth/near/challenge` and `POST /auth/near/verify` (NEP-413 link); `POST /v1/near/claim` | Decided | PROTOCOL §7, §8 |
| R01-55 | Key storage table: `chain.near_colony_account.encrypted_secret` (NEAR §2, §13; DATA_MODEL §11 adds `claimed_at`) vs `chain.near_account` with `publicKey` only (DATA_MODEL §4.4); neither table, nor `core.social_identity`, is in the merged schema | Conflict | NEAR §2 vs DATA_MODEL §4.4; code: `shared/db/prisma/` → Q-01-7 |
| R01-56 | The "real wallet selector" for NEP-413 claim and staking is not named (no connector chosen) | Gap | W23-14 (—) · Q-01-21 |

## 4. Flows

**A. Guest → Pilot ID (happy path).** Guest founds a colony (W01) → "Save progress → Continue with …" → provider returns a token → `POST /v1/auth/social {provider, token}` with the guest bearer → `loginSocial` → `createNamedAccount` (derive name, collision suffix) → link `core.social_identity` to the guest player, rotate refresh token → for each existing colony create `{colony}.{name}` → outbox `storage_deposit` per colony → relayer submits → `relay.settled` → HUD "Pilot ID …" (W06-03..06, 08, 12, 15, 16).
- *Provider rejects / token tampered:* 401 `NEAR_PROVIDER_REJECTED`, player stays guest (W06-03). *Cancel or provider down (real):* stay guest (W23-11).
- *Name taken:* suffix `-2`… (W06-05); `NEAR_NAME_TAKEN` (W06-19) or landed `NEAR_ACCOUNT_EXISTS` (R01-53): no row says when either is thrown instead of suffixing.
- *Relayer fails:* chip → Retry toast; outbox row stays, `opId` prevents a double deposit after restart (W06-12, W06-20).

**B. Returning login on another device.** Same `(provider, subject)` → same player and colonies (W06-07, not H). Second device already holding a guest with its own colony: not specified (Q-01-15).

**C. Relayed gameplay write.** Sim/market change + outbox row (same DB tx) → relay decrypts the signer key in the `near` module → `DelegateAction` → receiver allow-list → per-signer mutex + nonce → submit → final → push. Failure: one retry on `InvalidNonce` → `NEAR_RELAY_FAILED` → `relay.failed` → Retry toast. Over the spend cap (post-hackathon): queued, "chain busy, will settle" (W23-08).

**D. Claim (post-hackathon).** `POST /auth/near/challenge` → wallet `signMessage` → `POST /auth/near/verify` against a FullAccess key at `final` (W23-13) → add the player key as full access → delete the app's full-access key → keep an FC key (NEAR §2) or none (D-18, W21-15): Q-01-11 → `account_claimed`. Mock in W21-15/16; real in W23-14.

**E. Director key.** Player sets away budget + autoTrade limits → `POST /v1/near/director-key` → `addLimitedKey(allowance)` (basis and unit: Q-04-1) → sim emits `directorOrderRequested` → market module signs with the director key → allowance decremented on settle → exhausted → `directorAllowanceExhausted` → notification `away_budget_exhausted`; Revoke → key deleted, `director_key_revoked` (W15-18, W15-21..23). Owner of this flow: 04.

## 5. Numbers

| Value | Source | Status |
|---|---|---|
| Name 2–32 chars, `[a-z0-9-]` | W06-04 (H) | Planned |
| `accountId` column `VarChar(64)`: with a 32-char name, `{colony}` ≤ 15 chars on `.near` / `.mock`, ≤ 12 on `.testnet` (arithmetic on the column, not a NEAR rule) | DATA_MODEL §4.4 · Q-01-8 | Gap |
| NEP-413 nonce 32 B, expiry 5 min, single use | NEAR §3, DATA_MODEL `NearLoginNonce` | Decided |
| Access JWT 15 min; refresh cookie `ta_rt` 30 d | PROTOCOL §8, DATA_MODEL `RefreshToken` | Decided |
| Mock latency 300–1 500 ms; failure rate injectable | NEAR §1a r4 | Decided |
| Relayer low-balance alert 5 NEAR | NEAR §12 (not marked proposed); alert issue W23-07 (—); R06-58 | Decided |
| Account creation ≈ 0.01 NEAR | NEAR §12; estimate, W23-16 measures | Decided (value proposed) |
| Mint / burn / intent batch gas ≈ 0.0005–0.002 NEAR each; storage deposits paid by the relayer | NEAR §12; estimate, W23-16 measures | Decided (value proposed) |
| Pivot season: 5 planets × 5 colonies ≈ 25 colony accounts (+ their named accounts) created and funded by the relayer from Nov 10 | Pivot §2 "living season"; funding owned by 06 §3.6 | Proposed |
| Director key allowance: 600 metals (mock test) vs 0.1 NEAR (real test) | W15-03 (H), W23-26 (—) → Q-04-1 | Conflict |
| Away budget defaults 40 % per directive, 60 % per away session (owner 04, R04-30) | D-17, AW-20 | Decided |
| Guild NEAR float: "seeded, capped" | NEAR-73 → R04-5 | Decided |
| Guild NEAR float cap 5 NEAR (scope unstated) | W15-02 (H) → R04-50 | Planned |
| Guild NEAR float 5 per NPC, 10 total | Pivot Bet B → R04-51 | Proposed |
| Relayer daily spend cap: no value in the repo (test uses 0.01 NEAR) | W23-08 (—) · Q-01-17 | Gap |

## 6. On-chain vs app vs sim

| State | Lives in | Truth |
|---|---|---|
| Guest player, device secret, refresh tokens, sessions | `core.player`, `core.auth_identity`, `core.refresh_token` | app DB |
| Social identity → account id | `core.social_identity (player_id, provider, subject, account_id)`, not yet in the merged schema (R01-55) | app DB |
| Named and colony accounts, access keys, allowances | NEAR; mock: `mock_chain_account` (in `mock-chain.prisma`); `mock_chain_access_key` (W15-03) is not in the merged schema | chain |
| Encrypted secrets + `kek_version` | `chain.near_colony_account` vs `chain.near_account` (R01-55) | app DB (Q-01-7) |
| Director key mirror (allowance, spent, revoked_at) | `chain.director_key` | chain for the key; app for `spent` (Q-04-1) |
| Away budget, autoTrade limits | sim state (snapshots) | sim |
| Pending relayed writes | the outbox; its table name differs between code, NEAR §13 and DATA_MODEL → Q-06-15 | app DB |

## 7. Wave map

- **W06** · deps: W00 (ports, mock base, outbox, contract harness, dev console), W01 (guest login W01-02, `colonyFounded` W01-31) · `@hack` e2e steps: 1, 2, 4, 6, 7 · DoD gates: `e2e/w06.spec.ts` + earlier e2e, `?scenario=w06`, `TA_WAVES=..05` flag-off, identity + relayer suites on mocks, **W06-21 copy lint green (W06-21 is not H)**, tag `wave-06`.
- **W23 (F5 slice)** · deps: W06 (identity, relayer), W00 (infra), W25-06 (deploy secrets for W23-03) · `@hack`: none; H2 rows only after the D10 gate (or D6 in the Pivot, Q-06-13) · DoD gates: suites green on real, real-mode e2e, per-port rollback, README table, **monitoring + spend breaker (W23-07 / W23-08 are untagged)**, tags `wave-23-<port>`.

| Issue | H | Rules | Flag |
|---|---|---|---|
| W06-01 contracts, events, flag | H | R01-7, R01-22, R01-48, R01-54 | — |
| W06-02 mock OAuth screen | H | R01-6 | offers "X (mock)"; NEAR Auth does not list X (R01-4) |
| W06-03 `loginSocial` mock | H | R01-7 | — |
| W06-04 name derivation | H | R01-8 | reserved list lacks `res`, `deed`, `bounty`; `-1` vs `-2` suffix |
| W06-05 `createNamedAccount` mock | H | R01-9 | — |
| W06-06 guest → social upgrade | H | R01-10 | `core.social_identity` needs a migration (R01-55) |
| W06-07 returning login, new device | — | R01-11 | D-10's portability goal not in H (OWNER_TASKS still open) |
| W06-08 colony sub-account | H | R01-13 | acceptance "guest with 2 colonies" vs DM-10 (one live colony) |
| W06-09 key store | H | R01-16 | target table not in DATA_MODEL §4.4 nor in code (R01-55) |
| W06-10 relayer mock + allow-list | H | R01-27, R01-29, R01-45 | allow-list covers no account-key actions (Q-01-5) |
| W06-11 nonces | H | R01-30, R01-45 | — |
| W06-12 first gasless `storage_deposit` | H | R01-31, R01-50 | — |
| W06-13 `GET /v1/near/health` | H | R01-47 | — |
| W06-14 `/dev/chain` account views | H | R01-47 | — |
| W06-15 login UI | H | R01-1, R01-43 | — |
| W06-16 Pilot ID chip | H | R01-49 | — |
| W06-17 Settings → Account + claim stub | — | R01-22 | `409 not_available_yet` not in PROTOCOL §8 code list |
| W06-18 NEP-413 verifier (hidden) | — | R01-24..26, R01-54 | acceptance names no endpoint; PROTOCOL has `/auth/near/challenge` + `/verify` |
| W06-19 error model | H | R01-45, R01-53 | codes differ from landed `errors.ts` and PROTOCOL (Q-01-16) |
| W06-20 pending / failed / retry UX | H | R01-44 | — |
| W06-21 copy lint | — | R01-43 | **W06 DoD requires W06-21 green, but it is not H** |
| W06-22 identity + relayer contract suites | H | R01-35 | `--port` usage vs code (Q-06-11) |
| W06-23 analytics funnel | — | — | — |
| W06-24 telemetry | — | — | — |
| W06-25 dev console mock commands | H | R01-47 | — |
| W06-26 mobile acceptance | — | — | D-22 phone scope not in H |
| W06-27 README F5 row + env docs | — | R01-34 | the mock/real table itself is generated by W25-26 (W23-44 H2); W06-27 only adds the F5 row and env docs |
| W06-28 e2e + scenario + flag off | H | R01-48 | — |
| W23-01 / 02 real-mode env, network matrix | H2 | R01-14, R01-34 | env names vs code (Q-06-11) |
| W23-03 production KEK | H2 | R01-17 | — |
| W23-04 owner accounts + relayer/minter keys | H2 | R01-15 | does not say who creates `{name}.*` (Q-01-1) |
| W23-07 / 08 relayer alerts, spend cap | — | R01-32, R01-33 | **real relayer (H2) runs without alert or cap** |
| W23-09 provider decision | H2 | R01-3, R01-4 | MP §0 already "locks" NEAR Auth; criteria still name HOT |
| W23-10 real `IdentityPort` | H2 | R01-2, R01-9 | "relayer-funded" creation vs root-only creation (NEAR §2); MPC key derivation (Q-06-7) |
| W23-11 client real login | H2 | R01-12 | — |
| W23-12 identity suite on real | H2 | R01-35 | — |
| W23-13 wallet link on real chain | — | R01-24 | — |
| W23-14 real claim | — | R01-19, R01-20, R01-56 | keeps an FC key; D-18 / W21-15 drop it; wallet selector unnamed |
| W23-15 real relayer | H2 | R01-27..30 | — |
| W23-16 relayer suite + cost report | H2 | R01-35 | — |
| W15-03 / 04 / 18 / 23, W23-26 / 27 director + NPC keys | H / — | R01-36..39 | allowance basis and unit (Q-04-1) |
| W15-02, W23-28 Guild float | H / — | R01-51, R01-52 | 2 NPCs (W15-02) vs 3 funded (W23-28): owner 04 |
| W21-15 / 16 mock claim; W22-27 mercs | — | R01-20, R01-40 | — |
| W25-31 submission form | H | registry (payout wallet) | — |
| *(none)* | | R01-41, R01-42 | Agent API key model has no issue (Pivot §8 asks to add Bet A rows to W13/W15/W25) |

Rules with no issue: who signs named-account creation (Q-01-1), `{colony}` label derivation (Q-01-8), the director key after claim (Q-01-11), guest access to chain actions (Q-01-13), wallet connector (Q-01-21).

## 8. Open questions

| # | Question | Proposed default (only if a repo doc proposes one) |
|---|---|---|
| Q-01-1 | Who signs creation of `{name}.terraagent.near`? NEAR §2: root creates sub-accounts and the app holds no root key; W23-10: created at login, "relayer-funded"; OWNER_TASKS: a `colonies.terraagent.*` parent with an online key in a near-gateway store (pre-D-24, possibly stale) | none |
| Q-01-2 | With NEAR Auth, are accounts created under `terraagent.near` or the provider's parent, and who holds the key (MPC-derived per identity, 06 R06-25, vs our KEK store, R01-16)? Same question as Q-06-7 / Q-06-8 from the provider side If an MPC network signs for the player ([X4], R06-25), can the app still create and key `{colony}.{name}` sub-accounts and keep the D-18 claim? OWNER_TASKS still names `colonies.terraagent.testnet` and a pre-D-24 near-gateway store. Needs a new decision before W23-10 (absorbs Q-06-7). | none; fallback R01-5 |
| Q-01-3 | Record the provider: MP §0 locks NEAR Auth, W23-09 and OWNER_TASKS still open (06 R06-20/21) | record as D-37 (Review C9) |
| Q-01-4 | W06-02 mocks "X"; NEAR Auth's docs do not list X ([X4], R06-22). Mock Apple / email instead? | none |
| Q-01-5 | Claim (`add_key` / `delete_key`), director key add/revoke and sub-account creation act on the account itself, which is not in the relayer allow-list (R01-29). Relayed with an extended list, or signed and paid another way? | none |
| Q-01-6 | Closed → Q-04-1 (director allowance basis and unit) | — |
| Q-01-7 | Key storage: `chain.near_colony_account` vs `chain.near_account` (R01-55). Where is the **player** account's encrypted key? `core.social_identity` has no key column; `IdentityKind` is `DEVICE | NEAR`. Code: neither key table nor `core.social_identity` is in `shared/db/prisma/`, and `mock_chain_access_key` (W15-03) is not in `mock-chain.prisma` | W06 adds a migration (owner of the name: DATA_MODEL) |
| Q-01-8 | What is the `{colony}` label (colony id, name, slug)? Length budget in §5 | none |
| Q-01-9 | Reserved names: add `res`, `deed`, `bounty`, `colonies`, `npc`, `dev-a`, `dev-b` (siblings under the root)? One suffix scheme for reserved and collision? | none |
| Q-01-10 | Which name feeds W06-04: the generated `displayName` ("Colony Vega-7", DATA_MODEL), the provider name, or the email local part? | none |
| Q-01-11 | **Claim (owner of the conflict, R01-20).** Scope: player account, every colony account, or both? Residual key: one FC key (NEAR §2, W23-14) or none (D-18, W21-15)? Does the director key survive? Which key creates the next colony sub-account after a rocket move (NEAR-54)? Can an FC key that cannot attach a deposit still move cargo into the verifier (Q-06-17, function-call key semantics)? | NEAR §2 (FC key kept) until the owner decides |
| Q-01-12 | "At launch" (D-18, NEAR §16): product launch or rocket launch? Can a player claim before settling? | none |
| Q-01-13 | Can a guest colony (no chain account until upgrade, W06-08) export cargo or place orders, or does the Trade Hub force login? | none |
| Q-01-14 | W06-08 acceptance "guest with 2 colonies" vs DM-10 "at most one live colony" | none |
| Q-01-15 | Device B holds a guest with a colony and logs in with an identity that already owns a player: merge, discard or refuse? | none |
| Q-01-16 | One error model: W06-19 `NEAR_NAME_TAKEN` vs landed `NEAR_ACCOUNT_EXISTS`; landed `NEAR_UNAVAILABLE` vs PROTOCOL `near_unavailable` vs NEAR §1 p4 `market_unavailable`; landed `NEAR_MOCK_INJECTED_FAILURE`; W10-10 `NEAR_UNAUTHORIZED_MINTER` (not in `errors.ts`); W15-01 `director_key_missing` / `director_key_revoked` / `allowance_exhausted` vs `NEAR_ALLOWANCE_EXHAUSTED`; W06-17 `409 not_available_yet` | add every code to `errors.ts` ("add codes here, never inline", code comment) |
| Q-01-17 | Hackathon relayer guardrails: W23-07/08 untagged while W23-15/16 are H2; outside agents add spend (rate limits → Q-04-17; Q-06-14) Also rollback (W23-42, post-hackathon) while real funds move (absorbs Q-06-14). | Q-06-14: fresh DB, manual daily balance check |
| Q-01-18 | Closed → Q-04-16 (Agent API credential, parent account, deny list) | — |
| Q-01-19 | Dev network split (NEAR §12, W23-02, 06 R06-53): identity on testnet, cargo / intents on mainnet. Which account holds mainnet cargo for a testnet Pilot ID? W23-24 uses dev colonies | none |
| Q-01-20 | D-10 is still Proposed in the DECISIONS index; is portability by social login (W06-07) enough without a wallet link (OWNER_TASKS "still open")? | none |
| Q-01-21 | Which wallet connector does the NEP-413 link, claim and staking UI use (W23-14 "real wallet selector", W20-22 mock modal)? Absorbs Q-06-20 | Post-hackathon; pick with W23-14 (default from closed Q-06-20) |

## 9. Grill questions

**W06**
- W06-04 / 05: show the test for a name that collides with `res` and with a reserved word; which suffix wins, `-1` or `-2`?
- W06-08: what string is `{colony}`, and what does the test do with a 32-char pilot name on `.testnet`?
- W06-09 / 06: neither `chain.near_colony_account` nor `core.social_identity` is in the merged `shared/db/prisma/` schema, so W06 needs a migration. Which issue owns it, and which table holds the player key (Q-01-7)?
- W06-10: is `storage_deposit` on `res.*` the only relayed action in W06? Which issue relays account-key actions (Q-01-5)?
- W06-19: `NEAR_NAME_TAKEN` or the landed `NEAR_ACCOUNT_EXISTS` (409)? Map `NEAR_UNAVAILABLE` and `NEAR_MOCK_INJECTED_FAILURE` to which toast? When is a name error thrown if W06-05 always suffixes?
- W06-18: implement PROTOCOL §8's `POST /auth/near/challenge` and `/auth/near/verify`, or a new path?
- W06-21: the DoD needs it green but it is not H — tag it H, or drop it from the DoD?
- W06-02: keep "X (mock)" when the real provider does not list X?

**W23 (F5 H2)**
- W23-09: is the decision already made by MP §0? If yes, close W23-09 with a D-37 row and the custodial fallback trigger date (mainnet whitelist, Review §7).
- W23-10: which account signs `create_account` for `{name}.terraagent.near`, and is that key online? Does NEAR Auth's MPC key (Q-06-7) replace W06-09's key store for the player account?
- W23-15 / 16: who watches the relayer balance during judging and the season if W23-07 / 08 stay untagged?
- W23-14: after claim, list `view_access_key_list` for the colony account: full access (player), FC (app), director key — yes or no (Q-01-11)? Which wallet connector (Q-01-21)?
- Start date: D6 (Review §5 change 2, Pivot §4) or after the D10 gate (D-27, HACKATHON_CUT)? Cited, not re-argued (Q-06-13).

**W15 / W22 / W25 / Pivot**
- W15-03 vs W23-26: one allowance unit, or two keys (gas allowance on chain, token budget in app)? Asked in Q-04-1.
- W22-27: are mercenary keys scoped like Guild keys (`intents.near` + `res.*`), or do they need `bounty.*`?
- W25-31: which mainnet account is the prize wallet, and is it kept apart from `relayer` / `minter`?
- Bet A: which W13 / W15 / W25 issue defines the agent's credential and deny list (Q-04-16)? See [`./04-…`](./04-agents-and-communication.md) and [`./07-…`](./07-gaps-and-grooming.md).
