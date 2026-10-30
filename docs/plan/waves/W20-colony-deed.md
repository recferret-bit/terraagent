# W20 — Colony Deed & Staking (F6, mock)

> **Track:** Economy/NEAR (E) · **Flag:** `W20` · **Scenario:** `scenarios/w20-colony-deed.ts` · **Tag:** `wave-20`
> **Depends on waves:** W06 (identity, colony accounts, `IdentityPort`/`RelayerPort` mocks, dev chain explorer), W01 (colony founding), W00 (ports foundation, `chain_outbox`, contract-suite harness). Deed fields from other waves appear only when those waves are on: W05 (terraform %), W08 (stage), W13 (trade volume), W14 (walls), W18 (truces, eliminated status), W21 (settled).
> **Specs:** [`NEAR.md`](../../spec/NEAR.md) §1a, §2, §9 (`NEAR-90..93`), §12–§15 · [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) F6 · [`CLIENT.md`](../../spec/CLIENT.md) §8a · [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) §4.4.1 (`chain.deed`, `chain.staking_position`) · [`PROTOCOL.md`](../../spec/PROTOCOL.md) (F6 row) · D-18, D-25, D-26, D-30.

## Goal

Every colony owns a **living Colony Deed** (dynamic NEP-171 NFT, mocked). The deed is minted when the colony is founded and updated as the colony grows. It can be shared as a card. Once the colony is **Settled**, the deed becomes the home for **own-NEAR staking** (mock pool), with no gameplay effect from the staked amount.

## Demo story (wave e2e)

1. Load `?scenario=w20` → a colony at S4 with terraform progress → open **Colony menu → Deed** → see the deed card with name, planet, stage, Terraform % and a "Recorded on NEAR (mock)" receipt.
2. Dev console `terraform.add 10%` → within the debounce window (time warp) → the card shows the new Terraform %, and the metadata history gains a version.
3. Click **Share** → the public page `/deed/<tokenId>` opens with the OG image of the card.
4. Try **Stake** on a non-settled deed → see "Available after your colony is Settled".
5. Dev console `deed.settle` (or a real W21 launch) → the card turns into a **Settled Deed** (gold frame) → the staking panel unlocks → "Account not claimed" → mock claim → pick a whitelisted pool, enter 1 NEAR, sign in the mock wallet → position shows 1 NEAR and rewards ticking.
6. Unstake → unbonding timer → withdraw → the balance returns.
7. Run with `TA_WAVES=..19` → no Deed menu, no deed mint, no `deed.*` pushes; existing deeds stay in the DB untouched.

## Owned paths

`backend/app/src/near/{deed,staking}/**`, `backend/app/src/near/infrastructure/adapters/mock/{deed,staking,nep171-base}*`, `backend/app/src/near/__contract__/{deed,staking}.contract.ts`, `client/src/features/deed/**`, `client/src/pages/deed/**` (public share page), `scenarios/w20-colony-deed.ts`, `e2e/w20.spec.ts`, `prisma/near-deed.prisma`.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 2, 7. `W20-28` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** the share page (step 3), staking and account claim (steps 4–6): staking needs Settled colonies from W21, which is post-hackathon.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | `DeedNftPort` / `StakingPort` contracts, errors, events, flag | W20-01 |
| 2 | Postgres mock NEP-171 adapter (real-shaped receipts, latency, failures), shared base with `BadgeNftPort` | W00-35 (shared base), W20-03 |
| 3 | Contract suites, shared by mock and real | W20-04, W20-13 |
| 4 | Deed minted at colony founding, idempotent via outbox (`NEAR-90`) | W20-05 |
| 5 | Dynamic metadata on milestones, debounced 10 min (`NEAR-91`) | W20-06, W20-07 |
| 6 | Deed image rendered from the colony snapshot (`NEAR-91`) | W20-08, W20-11 |
| 7 | Deed API (own + public) | W20-09 |
| 8 | Deed card UI, metadata history, share to X (CLIENT §8a) | W20-10, W20-12 |
| 9 | Deed status for eliminated / abandoned colonies | W20-14 |
| 10 | Settled Deed transition hook (`NEAR-92`, W21) | W20-15 |
| 11 | `StakingPort` mock: whitelisted pools, stake / unstake / rewards over game time (`NEAR-92`) | W20-16, W20-17 |
| 12 | Staking rules: settled + claimed account, own NEAR only (D-18) | W20-18, W20-19 |
| 13 | Staking read model `chain.staking_position` | W20-20 |
| 14 | Staking panel + mock wallet signer (the only wallet UI, CLIENT §8a) | W20-21, W20-22 |
| 15 | No pay-to-win (`NEAR-93`) | W20-23 |
| 16 | Mock chain explorer entries | W20-24 |
| 17 | Notifications / toasts on deed changes | W20-25 |
| 18 | Telemetry + analytics | W20-26 |
| 19 | Dev-console commands | W20-27 |
| 20 | Mobile / touch | W20-10, W20-21 (acceptance) |
| 21 | Wave e2e, scenario, tag | W20-28 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W20-01 | Contracts & data: `DeedNftPort` (`mint`, `updateMetadata`, `markSettled`, `ownerOf`, `get`), `StakingPort` (`listPools`, `stake`, `unstake`, `withdraw`, `position`, `rewards`), zod `DeedMetadataV1` (planet, colony, stage?, terraformBp?, walls?, tradeVolume?, truces?, rank?, status, settled, version, imageUrl), events `deedMinted`/`deedUpdated`/`deedSettled`, push `deed.updated`, error codes (`DEED_NOT_FOUND`, `DEED_NOT_SETTLED`, `ACCOUNT_NOT_CLAIMED`, `POOL_NOT_WHITELISTED`, `STAKE_INSUFFICIENT_BALANCE`), register flag `W20` | contract | M | H | W00-31, W06-01 | Run `npm run check` → contracts compile and the flag `W20` appears in the dev flag panel | NEAR §1a, §9 | TA-10.12 (part) |
| W20-03 | `MockDeedNftAdapter` on the base: collection `deed`, owner = colony account, `markSettled`, metadata versioning; binding in `near-infrastructure.module.ts` behind `NEAR_ADAPTER_DEED` (default `mock`) | server | S | H | W00-35, W20-01 | Set `NEAR_ADAPTER_DEED=typo` → app boots with the mock adapter (fail-closed) | NEAR §1a rule 3 | — |
| W20-04 | `DeedNftPort` contract suite (`describeNearPortContract('deed')`): mint idempotent, `ownerOf`, version increments, settled is one-way, errors are stable codes; runs vs mock in CI | test | M | H | W20-03 | `npm run test:contract -- deed` → suite green vs the mock | NEAR §1a rule 5, §15 | — |
| W20-05 | Mint the deed on `colonyFounded` through `chain_outbox` (`opId = deed-mint:{colonyId}`), retries with backoff, pending state | server | M | H | W20-03, W01-31 | Found a colony in the W01 scenario → a `chain.deed` row with a `mock:` tx appears within 2 s; kill the app mid-mint and restart → still exactly one deed | NEAR-90 | TA-10.12 (part) |
| W20-06 | Deed metadata projector: subscribe to milestone events (stage reached, Terraform % in 10 % steps, walls count steps, trade volume steps, truces signed, rank changes); missing producer waves leave fields absent | server | M | H | W20-05 | With W05 and W08 on, reach S3 → the projector queues an update containing `stage: 3`; with `TA_WAVES` excluding W14 → no `walls` field | NEAR-91 | — |
| W20-07 | Debounce and outbox the updates: at most one `updateMetadata` per colony per 10 min (coalesce latest), `opId = deed-meta:{colonyId}:{version}` | server | S | H | W20-06 | Trigger 5 milestones in 1 min (time warp ×1) → exactly 1 update is sent after 10 min, carrying the latest values | NEAR-91 | — |
| W20-08 | Deed image renderer: server-side SVG → PNG card (Faction Plate frame, colony name, planet, stage ribbon, Terraform % bar, hex territory thumbnail from snapshot); cached by `version`; `GET /v1/near/deed/{tokenId}/image.png` | server | M | H | W20-06 | Request the image twice for the same version → the second request is served from cache (< 20 ms) and the PNG is 1200 × 630 | NEAR-91 | — |
| W20-09 | Deed API: `GET /v1/near/deed` (own colonies' deeds, with history) and public `GET /v1/deeds/{tokenId}` (no auth, read-only fields only) | server | S | H | W20-05 | `curl /v1/deeds/<id>` without a token → 200 with metadata and no account secrets | PROTOCOL F6 row | — |
| W20-10 | Deed card UI: Colony menu → Deed; live preview, stats, status chip, metadata history timeline (version, date, change), receipt line "Recorded on NEAR (mock)" linking to the dev explorer; push `deed.updated` refreshes it live; textContent only | client | M | H | W20-09 | Open the Deed with the card visible, trigger a milestone via the console → the card updates without a reload; on a phone in landscape the card fits without horizontal scroll | CLIENT §8a | — |
| W20-11 | Deed visual art: Faction Plate frame variants (active, Settled gold, Eliminated grey), stage ribbon, hex thumbnail style; matches the badge art language (W12) | visual | S | H+ | W20-08 | Open `/playground.html?deedcard=1` → all 3 variants render side by side with no clipping | CLIENT §8a; design tokens | — |
| W20-12 | Share: public page `/deed/{tokenId}` (OG/Twitter meta with the rendered image) and a "Share on X" button with prefilled text and link | client | S | H+ | W20-08, W20-09 | Click Share → X intent opens with the deed URL; paste the URL into a card validator → the image preview shows | F6 "shareable" | — |
| W20-13 | `StakingPort` contract suite: whitelist enforced, stake/unstake/withdraw states, rewards non-negative and monotonic over time, errors stable | test | S |  | W20-16 | `npm run test:contract -- staking` → green vs the mock | NEAR §1a rule 5 | — |
| W20-14 | Deed status on elimination or departure without settlement: status `eliminated` (W18) or `abandoned`, and the final metadata update is forced past the debounce | server | S |  | W20-07 | Eliminate a colony via the console → the deed shows status `eliminated` within one outbox cycle | SIM §7.7 | — |
| W20-15 | Settled Deed hook: on `colonySettled` (W21) → `markSettled` via outbox (`opId = deed-settle:{colonyId}`), metadata `settled: true`, final image re-render; dev console `deed.settle <colony>` for testing without W21 | server | S |  | W20-07 | Run `deed.settle` → the card switches to the gold Settled variant and the staking panel becomes visible | NEAR-92, D-18 | TA-10.7 (part) |
| W20-16 | `MockStakingAdapter`: pools from `NEAR_STAKING_POOLS` (mock pools with names and APY 9 %), mock NEAR balances per account, stake / unstake (unbonding 4 epochs, about 2 game-days) / withdraw, rewards accrued over game time; binding `NEAR_ADAPTER_STAKING` | server | M |  | W20-01, W00-32 | Stake 1 mock NEAR and time-warp 1 game-day → rewards ≈ 1 × 0.09 / 365, with no payout from any game account | NEAR-92 | TA-10.7 (part) |
| W20-17 | Staking pool whitelist config: zod env `NEAR_STAKING_POOLS`, validation at boot, admin read endpoint | server | S |  | W20-16 | Boot with a malformed pool list → the app refuses to start with an env error naming `NEAR_STAKING_POOLS` | NEAR §12 | — |
| W20-18 | Staking service rules: only for a **settled** deed **and** a **claimed** colony account; amount from the player's own NEAR (mock wallet balance), never game funds; endpoints `POST /v1/near/stake`, `POST /v1/near/unstake`, `POST /v1/near/withdraw`, `GET /v1/near/staking` | server | M |  | W20-15, W20-16 | Stake on an unsettled deed → `DEED_NOT_SETTLED`; on a settled but unclaimed account → `ACCOUNT_NOT_CLAIMED` with a link to the claim flow | NEAR-92, D-18 | TA-10.7 (part) |
| W20-19 | Claim interplay for testing before W21/W23: dev console `account.claim --mock` marks the account claimed in the mock identity store; the real claim flow lives in W21 (mock) and W23 (real) | server | S |  | W20-18, W06-05 | Run `account.claim --mock` then stake → succeeds | D-18, NEAR §2 | — |
| W20-20 | Staking read model: `chain.staking_position` sync job (every 5 min and after each stake op) from `StakingPort.position`, marked "read model only" | server | S |  | W20-16 | Stake via the port directly (bypassing the API) → within 5 min the read model shows the position | DATA_MODEL `chain.staking_position` | — |
| W20-21 | Staking panel on the Settled Deed: pool picker (whitelist with APY), amount input, explicit copy "Real NEAR from your wallet — not game currency, no in-game bonus", position, rewards, unstake + unbonding countdown, withdraw | client | M |  | W20-18, W20-22 | Complete stake → unstake → withdraw on a phone in landscape → every step is reachable by touch, and the copy is visible before signing | CLIENT §8a, NEAR-93 | — |
| W20-22 | Mock wallet signer modal (NEP-413-shaped request: recipient, message, nonce) shared by staking (W20) and account claim (W21); approve / reject / timeout states | client | S |  | W20-01 | Click Reject in the modal → the stake request ends with "Cancelled in wallet" and no position | NEAR §3 | — |
| W20-23 | No pay-to-win test: property test — any staked amount (0 … 10⁶ NEAR) leaves the sim state of every colony byte-identical after N ticks | test | S |  | W20-18 | `npm run test -- staking-no-p2w` → passes for 50 random amounts | NEAR-93 | — |
| W20-24 | Dev chain explorer views for deeds (token, versions, settled flag) and staking (pools, positions), linked from the card receipt | client | S |  | W20-10, W06-14 | Click the receipt on the deed card → the explorer opens on that token's history | NEAR §1a rule 4 | — |
| W20-25 | Notifications: toast "Your Deed was updated: Terraform 40 %" on `deed.updated`; push or Telegram (via `NotifierPort`, W09) only on deed settled | client | S |  | W20-10, W09-21 (optional) | Trigger a milestone → toast shows once per update; with W09 off → toast only, no error | CONTINUITY §5a | — |
| W20-26 | Telemetry + analytics: metrics `near_tx_total{kind=deed_mint\|deed_update\|stake}`, `deed_updates_pending`, `staking_positions`; `track()` events `deed_viewed`, `deed_shared`, `stake_started`, `stake_completed`, `stake_cancelled`, `unstake_started`, `withdraw_completed` | server | S |  | W20-10, W20-21 | View, share and stake once → the analytics table holds those 4 events with colony and planet ids | NEAR §14, CLIENT §10 | — |
| W20-27 | Dev-console commands: `deed.show <colony>`, `deed.bump <field> <value>`, `deed.settle <colony>`, `deed.fail-rate <0..1>`, `stake.fund <account> <near>` | client | S |  | W20-15, W20-16 | Set `deed.fail-rate 1`, then found a colony → the deed stays pending with a retry badge; set it to 0 → it is minted on the next retry | PRODUCT_WAVES §3 | — |
| W20-28 | Wave e2e + scenario + tag: `scenarios/w20-colony-deed.ts` (S4 colony, milestones, mock-funded wallet); `e2e/w20.spec.ts` runs the demo story; all earlier e2e suites pass; flag-off check; tag `wave-20` | test | M | H | W20-01..27 | `npm run e2e -- --waves ..20` → green, including the flag-off step | PRODUCT_WAVES §3 | — |

**Issue count: 28.**

## Wave DoD

- `e2e/w20.spec.ts` and every earlier wave's e2e pass. `?scenario=w20` loads the demo state.
- `TA_WAVES=..19` hides the Deed menu, staking and pushes, while the `chain.deed` rows stay untouched.
- The `DeedNftPort` and `StakingPort` contract suites are green vs the mocks.
- Every `NEAR-90..93` rule maps to an issue above. Tag `wave-20` is created.

## Notes

- **Removed in the 2026-10-30 cross-check:** W20-02 (shared NEP-171 mock base). It moved to W00-35 so W12 badges and W20 deeds share one base; W20-03 builds the deed adapter on it.
