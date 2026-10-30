# W06 — Invisible Chain (F5, mock)

> **Track:** Economy/NEAR (E) · **Flag:** `W06` · **Tag:** `wave-06` · **Scenario:** `scenarios/w06-invisible-chain.ts` · **E2E:** `e2e/w06.spec.ts`
> **Depends on waves:** W00 (ports foundation, mocks, outbox, contract-test harness, dev console). It works on top of W01's guest login; the colony sub-account hook needs W01's `colonyFounded` event.
> **Specs:** [`NEAR.md`](../../spec/NEAR.md) §1a, §2, §3, §4 · [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) F5 · [`PROTOCOL.md`](../../spec/PROTOCOL.md) (`POST /auth/social`, `POST /v1/near/claim`) · [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) `core.social_identity`, `chain.near_colony_account` · [`CLIENT.md`](../../spec/CLIENT.md) §8a · D-10, D-18, D-25, D-26, D-30
> **Owned paths:** `backend/app/src/near/{identity,relayer,keystore,chain-read}/**`, `backend/app/src/near/__contract__/{identity,relayer,chain-read}.contract.ts`, `client/src/features/identity/**`, `client/src/pages/dev-chain/**`, `scenarios/w06-*.ts`, `e2e/w06.spec.ts`

## Goal

A player can go from **guest → social login → a named account ("Pilot ID")**, and their first gameplay action that touches the chain runs **gasless through the relayer**. The player never sees wallet, gas or transaction wording. Everything runs on **mock adapters** (`IdentityPort`, `RelayerPort`, `ChainReadPort`) that are shaped like the real ones, so W23 can swap them without touching game code.

## Demo story (the e2e in words)

1. Open `/play.html?scenario=w06` → you land as a guest with a colony (W01 state). The HUD shows "Guest pilot".
2. Click **Save progress → Continue with Google (mock)** → the mock provider screen opens. Pick "test-pilot" → you return to the game with the same colony and the HUD shows **Pilot ID `test-pilot.terraagent.mock`**.
3. Open **Settings → Account** → you see the Pilot ID, the linked provider, active sessions, and "Take custody" (disabled, "coming later"). There are no wallet words.
4. Open `/dev/chain` (dev chain explorer) → you see the accounts `test-pilot.terraagent.mock` and `{colony}.test-pilot.terraagent.mock`, and one relayed `storage_deposit` meta-tx on `res.terraagent.mock` for the colony account, with a `mock:` hash, paid by `relayer`.
5. In a second browser, log in with the same mock identity → the same player and colony load.
6. Dev console `near.mock.fail relayer 1.0`, then trigger a relayed action → the UI shows a pending state, then a friendly "Couldn't save to orbit, retrying" with retry. Reset the failure rate → it succeeds.
7. Restart with `TA_WAVES=..05` → the login button and the Pilot ID disappear; guest play still works.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 2, 4, 6, 7. `W06-28` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** Settings → Account (step 3), returning login on a second device (step 5), the NEP-413 wallet link, copy lint, telemetry.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

- [x] Port contracts for `IdentityPort`, `RelayerPort`, `ChainReadPort` (zod in and out) — W06-01
- [x] Mock OAuth provider screen + signed mock token — W06-02
- [x] `IdentityPort.loginSocial` mock (verify token → subject) — W06-03
- [x] Named account creation `name.terraagent.mock` with naming rules and collision handling — W06-04, W06-05
- [x] Guest → social upgrade keeps player and colonies; session rotation — W06-06
- [x] Returning login on another device restores the same player (portability, D-10) — W06-07
- [x] Colony sub-account `{colony}.{name}` created on colony founding — W06-08
- [x] Key store: ed25519 keys, AES-256-GCM envelope under `NEAR_KEK` with `kek_version` (real-shaped even on mocks) — W06-09
- [x] `RelayerPort` mock: `DelegateAction` shape, receiver allow-list, nonce mutex + one retry, deterministic `mock:` hash, latency and failure injection — W06-10, W06-11
- [x] First gasless action (NEP-145 `storage_deposit` on the cargo contract for each colony account, needed by W10) through `chain_outbox` with a deterministic `opId` — W06-12
- [x] `ChainReadPort` mock: `receipt`, `explorerUrl` → `/dev/chain/tx/:hash`, `health` — W06-13
- [x] Dev chain explorer page (accounts, txs, balances) — W06-14
- [x] Login UI: guest-first, "Continue with …", no wallet wording — W06-15
- [x] Pilot ID in HUD and profile header — W06-16
- [x] Settings → Account (Pilot ID, providers, sessions, sign out, claim stub) — W06-17
- [x] NEP-413 wallet link: verifier with test vectors + challenge endpoint; UI hidden (optional, D-10) — W06-18
- [x] `POST /v1/near/claim` stub returning `not_available_yet` (real in W21/W23) — W06-17
- [x] Error codes as `CoreException` subclasses (`NEAR_PROVIDER_REJECTED`, `NEAR_NAME_TAKEN`, `NEAR_RELAY_FAILED`) mapped to toasts — W06-19
- [x] Pending / failed / retry UX for relayed actions — W06-20
- [x] Copy lint: no wallet / gas / transaction / seed-phrase words in player-facing strings (exceptions: claim and staking screens) — W06-21
- [x] Contract suites for the three ports run against the mocks in CI — W06-22
- [x] Analytics funnel — W06-23
- [x] Telemetry (`near_tx_total{kind=relay}`, `near_tx_pending`) — W06-24
- [x] Dev console commands for mocks — W06-25
- [x] Mobile / touch acceptance of login and settings (D-22) — W06-26
- [x] README "mock vs real" row for F5 + env docs — W06-27
- [x] Flag off hides login, Pilot ID and explorer — W06-28

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W06-01 | Contracts: `IdentityPort` (`loginSocial`, `createNamedAccount`, `claimAccount`), `RelayerPort` (`submitMetaTx`), `ChainReadPort` method schemas; `POST /v1/auth/social`, `POST /v1/near/claim` DTOs; events `account.created`, `relay.submitted/settled/failed`; register flag `W06` | contract | S | H | W00-31 | Run `npm run contracts:check` → all three port schemas compile, and `flags.list()` shows `W06` | NEAR §1a rules 1–7, PROTOCOL §5 | TA-10.8 (part), TA-10.9 (part) |
| W06-02 | Mock OAuth provider screen `/dev/mock-oauth` (provider "Google (mock)" and "X (mock)"): pick or type a test identity and return an HMAC-signed mock token. Available when the Identity adapter is `mock` | server | S | H | W06-01 | Open `/dev/mock-oauth?provider=google&return=/play.html` and pick "test-pilot" → redirected back with `#mock_token=…`, and the token verifies with the dev secret | NEAR §2 (provider TBD) | — |
| W06-03 | `MockIdentityAdapter.loginSocial(provider, token)`: verify the mock token and return `{provider, subject, email?}`; a bad or expired token throws `NEAR_PROVIDER_REJECTED` | server | S | H | W06-02 | `POST /v1/auth/social` with a valid mock token → `200 {accessToken, player, accountId}`; with a tampered token → `401 NEAR_PROVIDER_REJECTED` | NEAR §2, PROTOCOL `POST /auth/social` | TA-10.9 (part) |
| W06-04 | Name derivation for named accounts: lowercase `[a-z0-9-]`, 2–32 chars, derived from the display name, reserved list (`relayer`, `minter`, `guild-*`, `npc`, `admin`…) | server | S | H | W06-01 | Unit test: `"Test Pilot!"` → `test-pilot`, `"relayer"` → `relayer-1`, a 40-char name is truncated to 32 | NEAR §2 | — |
| W06-05 | `MockIdentityAdapter.createNamedAccount`: create `{name}.terraagent.mock` in `mock_chain_account`; on collision append `-2`, `-3`…; idempotent per `(provider, subject)` | server | S | H | W06-03, W06-04 | Two different subjects both asking for "test-pilot" → accounts `test-pilot.terraagent.mock` and `test-pilot-2.terraagent.mock`; repeating the first call returns the same account | NEAR §2 | TA-10.9 (part) |
| W06-06 | Guest → social upgrade: link `core.social_identity` to the current guest player, keep every colony, rotate the refresh token, and write `account.created` | server | M | H | W06-05, W01-02 | Found a colony as a guest, then log in socially → `GET /v1/me/home` returns the same colony id, and the old refresh token is revoked | DATA_MODEL `core.social_identity`, D-10 | TA-04.3 (part) |
| W06-07 | Returning social login on a new device: the same `(provider, subject)` resolves to the existing player and account; no duplicate player is created | server | S |  | W06-06 | Log in with "test-pilot" in a fresh browser profile → the same `playerId` and colony list as in the first browser | D-10 portability | TA-04.3 (part) |
| W06-08 | Colony sub-account `{colony}.{name}.terraagent.mock` created on `colonyFounded` (guest colonies get one at upgrade time); stored in `chain.near_colony_account` | server | S | H | W06-05, W06-09 | Upgrade a guest with 2 colonies → 2 colony sub-accounts appear in `/dev/chain`, each owned by the player account | NEAR §2 table | TA-10.9 (part) |
| W06-09 | Key store: generate ed25519 keys per player and colony; encrypt the secret with AES-256-GCM under `NEAR_KEK` and store `encrypted_secret` + `kek_version`; decrypt only inside the `near` module | server | M | H | W06-01 | Unit test: encrypt → decrypt round-trips; rotating `kek_version` still decrypts old rows; the DB row never contains a plaintext key (grep test) | NEAR §2 Keys | TA-10.1 (part, mock-safe) |
| W06-10 | `MockRelayerAdapter.submitMetaTx(DelegateAction)`: validate shape with zod; reject receivers not in the allow-list (`res.*`, `deed.*`, `bounty.*`, planet DAOs, `intents.near`); return a deterministic `mock:<sha256>` hash | server | S | H | W06-01 | Submit an action to `evil.near` → `NEAR_RELAY_RECEIVER_NOT_ALLOWED`; submit the same action twice → the same `mock:` hash | NEAR §4 | TA-10.9 (part) |
| W06-11 | Relayer nonce handling: per-signer async mutex + access-key nonce cache; one retry on mock `InvalidNonce`; latency (300–1 500 ms) and failure-rate injection read from the mock config | server | S | H | W06-10 | Fire 20 parallel relayed actions for one signer → all succeed with strictly increasing nonces; with failure rate 1.0 → each fails once, retries once, then reports `NEAR_RELAY_FAILED` | NEAR §1a rule 4, §4 | — |
| W06-12 | First gasless action: when a colony account is created, enqueue a NEP-145 `storage_deposit` on `res.terraagent.mock` in `chain_outbox` (`opId = storage-deposit:{colonyAccountId}`) in the same DB transaction; the outbox relay submits it through `RelayerPort` (the relayer pays) | server | S | H | W06-08, W06-10, W00-37 | Create an account, then kill and restart the app mid-relay → exactly one `storage_deposit` tx per colony account exists in `/dev/chain` | NEAR §1a rule 6 | — |
| W06-13 | ChainRead extras on the W00-33 mock: `explorerUrl(hash)` → `/dev/chain/tx/:hash`, `GET /v1/near/health` → `{ok, adapter:"mock"}` | server | S | H | W00-33, W06-01 | `GET /v1/near/health` → `{"ok":true,"adapter":"mock"}`; the receipt of a known `mock:` hash returns signer, receiver and status | NEAR §1a table | — |
| W06-14 | Explorer account views on the W00-39 page: player and colony accounts, per-account balances (empty until W10), tx detail; enabled in dev and when `NEAR_ALLOW_MOCK_IN_PROD=true` | client | S | H | W06-13, W00-39 | Open `/dev/chain` after W06-12 → the account list shows player + colony accounts, and clicking the tx opens a detail page with signer, receiver, `mock:` hash and status FINAL | NEAR §1a rule 4 | — |
| W06-15 | Login UI: guest-first entry; a "Save progress" plate opens provider choices ("Continue with Google / X"); a mock provider popup in dev; Faction Plate styling; no wallet words | client | M | H | W06-03 | Click **Save progress → Continue with Google (mock)** → the popup opens, and after picking an identity the HUD changes from "Guest pilot" to the Pilot ID without a page reload | CLIENT §8a, NEAR §1 principle 1 | TA-11.1 (part) |
| W06-16 | Pilot ID display: HUD identity chip and profile header show `name.terraagent.mock` as "Pilot ID" with a copy button; guests see "Guest pilot · Save progress" | client | S | H | W06-15 | Log in → the HUD chip reads "Pilot ID test-pilot.terraagent.mock", and copy puts it on the clipboard | CLIENT §8a | — |
| W06-17 | Settings → Account panel: Pilot ID, linked providers, active sessions with "sign out others", sign out, a "Take custody of your colony" button disabled with "coming later" (backed by the `POST /v1/near/claim` stub → `409 not_available_yet`) | client | M |  | W06-16 | Open Settings → Account → all five rows render; clicking "sign out others" ends the second browser's session on its next request | NEAR §2 claim, D-18 | — |
| W06-18 | NEP-413 wallet link (optional, hidden): challenge endpoint (32-byte nonce, 5 min, single use) + verifier `borsh(tag 2^31+413 …) → SHA-256 → ed25519` with test vectors; UI behind sub-flag `W06.walletLink`, off by default | server | M |  | W06-01 | Run `nep413.verifier.spec.ts` → valid vectors pass, while a tampered message, a reused nonce and a wrong network suffix fail | NEAR §3, §15 | TA-04.3, TA-10.2 (mock part) |
| W06-19 | Error model: `NEAR_PROVIDER_REJECTED`, `NEAR_NAME_TAKEN`, `NEAR_RELAY_FAILED`, `NEAR_RELAY_RECEIVER_NOT_ALLOWED` as `CoreException` subclasses with stable codes; the global filter maps them to HTTP status; the client maps them to toasts | server | S | H | W06-03, W06-10 | Force each error from the dev console → each shows its own player-friendly toast text, and the API returns its stable `errorCode` | NEAR §1a rule 4 | — |
| W06-20 | Pending / failed / retry UX for relayed actions: a spinner chip "Saving to orbit…", failure toast with Retry, success fades out; driven by `relay.settled/failed` pushes | client | S | H | W06-11, W06-12 | With mock latency 1 500 ms, trigger a relayed action → the chip shows for ~1.5 s, then disappears; with failure rate 1.0 → a Retry toast appears, and Retry succeeds after the rate is reset | NEAR §1a rule 4 | — |
| W06-21 | Copy lint: a test scans player-facing strings (i18n bundle + DOM text in e2e) for `wallet`, `gas`, `transaction`, `seed phrase`, `private key`; an allow-list covers claim and staking screens | test | S |  | W06-15, W06-17 | Add the word "wallet" to the login plate → `npm run test:copy` fails with the file and string | NEAR §1 principle 1 | — |
| W06-22 | Contract suites `identity.contract.ts`, `relayer.contract.ts`, `chain-read.contract.ts` using `describeNearPortContract`, run against the mocks in CI (the real run is W23) | test | M | H | W06-05, W06-10, W06-13 | `npm run test:contract -- --adapter mock` → all three suites pass, and CI shows them as a separate job | NEAR §1a rule 5 | TA-10.8 (part) |
| W06-23 | Analytics funnel: `login_started{provider}`, `login_completed{provider}`, `guest_upgraded`, `account_created`, `relay_failed{kind}` via first-party `track()` | client | S |  | W06-15 | Complete the demo story → the analytics table has those five events in order for the test player | CLIENT §10 | — |
| W06-24 | Telemetry: `near_tx_total{kind=relay,result}`, `near_tx_pending`, `near_rpc_latency_seconds{method}` (mock latency), exported on `/metrics` | server | S |  | W06-11 | Run 10 relayed actions → `/metrics` shows `near_tx_total{kind="relay",result="final"} 10` | NEAR §14 | — |
| W06-25 | Dev console commands: `near.mock.fail <port> <rate>`, `near.mock.latency <port> <minMs> <maxMs>`, `account.reset <player>`, `account.upgrade <provider> <subject>` | server | S | H | W06-11 | Type `near.mock.fail relayer 1` in the dev console → the next relayed action fails, and `near.mock.fail relayer 0` restores success | PRODUCT_WAVES §3 dev tools | — |
| W06-26 | Mobile acceptance: the login plate, provider popup and Settings → Account work in phone landscape (touch targets ≥ 44 px, popup becomes a full-screen sheet) | client | S |  | W06-15, W06-17 | Run the e2e at 844 × 390 with touch emulation → login and settings steps pass without horizontal scroll | D-22 | — |
| W06-27 | Docs: README "mock vs real" table row for F5 (`IdentityPort`, `RelayerPort`, `ChainReadPort` = mock), env vars `NEAR_ADAPTER_IDENTITY`, `NEAR_ADAPTER_RELAYER`, `NEAR_ADAPTER_CHAIN_READ`, `NEAR_KEK`, `MOCK_OAUTH_SECRET` | docs | S |  | W06-22 | Open README → the table lists the three ports as "mock", and every env var appears in `ENVS.md` with a default | NEAR §1a swap order, D-27 README | — |
| W06-28 | Wave e2e `e2e/w06.spec.ts` (demo story steps 1–7, including `TA_WAVES=..05` flag-off check) + seed scenario `w06-invisible-chain` (guest player with one founded colony at S1) + tag `wave-06` | test | M | H | W06-01…W06-27 | `npm run e2e -- --waves ..06` → W00–W06 suites pass; `?scenario=w06` loads a guest colony at S1 | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w06.spec.ts` passes, and every earlier wave's e2e still passes.
- `?scenario=w06` loads; `TA_WAVES=..05` hides login, Pilot ID, Account settings and `/dev/chain` with no errors.
- All three port contract suites pass against the mocks.
- No player-facing chain wording (W06-21 green).
- Tag `wave-06` created on the merge commit.
