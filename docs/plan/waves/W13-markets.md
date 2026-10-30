# W13 — Markets (F2, mock)

> **Note for W13-02:** the market rules below (partial fills, taker pays the fee, no self-trade, over-cap refund on a failed mint) are **proposed here and not yet in any spec**. W13-02 *writes* them into `docs/spec/NEAR.md` (lead-owned file, via the lead pre-step), unless the owner objects.

> **Track:** Economy/NEAR (E) · **Flag:** `W13` · **Tag:** `wave-13` · **Scenario:** `scenarios/w13-markets.ts` · **E2E:** `e2e/w13.spec.ts`
> **Depends on waves:** W10 (Trade Hub, cargo in orbit, `CargoTokenPort`), via W06 (colony accounts, keys, relayer). The Negotiate-goal hook plugs into W08 when it is on. The market map layer is rendered by W04 when it is on.
> **Specs:** [`NEAR.md`](../../spec/NEAR.md) §1a, §6 (`NEAR-60..65`), §12 (`MARKET_FEE_BP_MAX`), §14, §15 · [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) F2, §2 · [`PROTOCOL.md`](../../spec/PROTOCOL.md) `market.*`, `market.book`, `market.trade` · [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) `chain.market_order`, `chain.intent_trade` · [`SIMULATION.md`](../../spec/SIMULATION.md) `market.reserve/release/settled` · [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §4.6 Negotiate goal · [`CLIENT.md`](../../spec/CLIENT.md) §8a, §8b (Market layer) · [`player-profile-and-achievements-spec.md`](../../game/player-profile-and-achievements-spec.md) (Merchant, Port Authority) · D-19, D-25, D-26, D-30
> **Owned paths:** `backend/app/src/market/**`, `backend/app/src/near/intents/**`, `backend/app/src/near/infrastructure/adapters/mock/intents*`, `backend/app/src/near/__contract__/intents.contract.ts`, `shared/contracts/src/{commands,events}/market.ts`, `shared/sim/src/systems/trade/market-*.ts`, `frontend/game/features/market/**`, `scenarios/w13-*.ts`, `e2e/w13.spec.ts`. Uses from W00 without owning: `IntentsPort` (W00-30), mock base (W00-32), outbox + relay (W00-37), contract harness (W00-38).

## Goal

Every Trade Hub is a **market stall** whose owner sets a fee (0–3 %). Players place buy and sell **orders** for cargo, priced in another resource or (open in beta) in NEAR or USDC. The server's market module is the **message bus**: it matches orders by price-time priority and settles each match as a batch of **`token_diff` intents** (maker, taker, fee leg) that must sum to zero, executed on the mock `IntentsPort`. Players see contracts, prices and earnings. They never see intents.

**Design decisions taken in this wave** (spec gaps, recorded in W13-02):
- **Partial fills are allowed.** Colony keys are custodial until claimed (D-18), so the server signs a fill-sized `token_diff` at match time. A claimed account (W21/W23) gets all-or-nothing orders.
- **The taker pays the fee.** The fee leg is taken from the taker's received token and goes to the owner of the stall where the **maker** order was listed.
- **Self-trade prevention.** Orders from the same colony never match each other. The older order stays and the incoming one rests.

**Resources (D-34):** every tradable sub-resource (`ResourceKey`, 10 keys) is its own market pair against each quote token (another `ResourceKey`, NEAR or USDC). T1 pairs trade from day one, and a colony can buy T2/T3 with T1 before it can mine them. Energy is not tradable. In the steps below, "water" is `bio.water` and "metals" is `metals.t1`.

## Demo story (the e2e in words)

1. Open `?scenario=w13` → two logged-in colonies (A and B, two browser contexts) on one planet, each with an online Trade Hub T1 and cargo in orbit: A has 600 water, B has 400 metals.
2. A opens their Trade Hub → **Market** tab → sets the stall fee to **1 %**.
3. A places **sell 300 water for 120 metals** (TTL 1 h) at A's stall → the order appears in the book, and A's "Cargo in orbit" shows 300 water reserved.
4. B places **buy 300 water for 120 metals** → match. Both see a toast **"Contract signed: 300 water for 120 metals at A's Port (1 % fee)"**. Balances: B +297 water, A +120 metals, and A's stall earns 3 water in fees. `/dev/chain` shows one `execute_intents` batch with 3 legs that sum to zero per token.
5. The price board shows the last price (0.4 metals per water), 24 h volume and a sparkline. The global map Market layer (if W04 is on) shows the price tag at A's hub.
6. B places a partial buy of 100 water at a higher price against A's order of 200 → a partial fill of 100, with 100 left on the book.
7. A cancels the rest → the order disappears, and the reserved cargo is freed.
8. Set the mock Intents failure rate to 1.0 and match two new orders → settlement fails, both orders go back to the book, the reservations stay correct, and a "Contract failed, order returned" toast shows.
9. Restart with `TA_WAVES=..12` → the Market tab is gone, and market commands are rejected `wave_disabled`.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 3–9 (step 2 uses the default fee from `data/market.ts`). `W13-35` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** stall-owner fee controls (step 2), quote tokens beyond NEAR, the map Market layer, the Negotiate-goal hook, matcher unit tests (stretch W13-31).
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

- [x] Market commands, module commands, push and events, errors (on W00-30's `IntentsPort`) — W13-01
- [x] Decisions on partial fills, fee payer and self-trade (recorded) — W13-02
- [x] Market config: `MARKET_FEE_BP_MAX`, TTL options, min size, price tick, open-order limit — W13-03
- [x] `MockIntentsAdapter`: verifier ledger, `deposit` (mt_transfer_call semantics), `withdraw`, `simulate` (sum to zero, balances, deadline, nonce), `execute` (atomic) — W13-04, W13-05
- [x] Intents contract suite — W13-06
- [x] `IntentsPort.signTokenDiff` in the mock adapter: NEP-413 `token_diff` signing with custodial colony keys — W13-07
- [x] Order book per planet per pair, price-time priority, persisted in `chain.market_order` — W13-08
- [x] `market.placeOrder`: validation (own Trade Hub T1 online, `NEAR-63`), auto-deposit to verifier, reserve, store signed order — W13-09
- [x] Sim `market.reserve` / `market.release` / `market.settled` mirror in the HUD — W13-10
- [x] Matching engine with partial fills and self-trade prevention — W13-11
- [x] Fee leg (stall owner, 0–3 %), zero-sum batch builder — W13-12
- [x] Settlement via relayer → `IntentsPort.execute`, `chain.intent_trade`, `market.settled`, `market.trade` push; failure → back to book or expire (`NEAR-62`) — W13-13, W13-14
- [x] Cancellation and TTL expiry jobs — W13-15
- [x] Withdraw path: import auto-withdraws from verifier; in-orbit = account + verifier balances — W13-16
- [x] NEAR / USDC quote tokens (open in beta, `NEAR-65`) via mock verifier balances + dev faucet — W13-17
- [x] Price board aggregation (last, 24 h volume, VWAP, 1 h candles) — W13-18
- [x] `GET /v1/market/{planetId}`, `market.book` (debounced) and `market.trade` pushes — W13-19
- [x] Market tab UI: book depth, place order form, my orders + cancel — W13-20, W13-21
- [x] Stall owner fee slider + earnings — W13-22
- [x] Price board UI — W13-23
- [x] "Contract signed …" toasts, contracts list, history rows — W13-24
- [x] Market map-layer data feed for W04 — W13-25
- [x] Negotiate-goal hook (trade side) for W08 — W13-26
- [x] Achievement progress events: Merchant, Port Authority — W13-27
- [x] Analytics — W13-28 · Telemetry — W13-29 · Dev console — W13-30
- [x] Matcher unit tests (priority, partial, fee, zero-sum, self-trade) — W13-31
- [x] Mobile acceptance — W13-32 · Docs — W13-33 · Perf — W13-34 · E2E — W13-35

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W13-01 | Contracts: commands `market.placeOrder {side, resource: ResourceKey, amount, price:{token, amount}, ttlS, stallId}`, `market.cancelOrder {orderId}`, `market.setHubFee {bp}`; module-only `market.reserve/release/settled {tradeId, deltas}`; pushes `market.book`, `market.trade`; events `tradeSettled`, `feeEarned`; errors `no_trade_hub`, `hub_offline`, `insufficient_cargo`, `fee_out_of_range`, `order_limit`, `order_too_small`, `market_unavailable`, `NEAR_INTENT_DIFF_NOT_ZERO`; flag `W13`. `IntentsPort` (`deposit`, `signTokenDiff`, `simulate`, `execute`, `withdraw`) is W00-30's, not redefined | contract | M | H | W10-01, W00-30 | `npm run contracts:check` → market commands are in `CommandKind` and the module-only ones are flagged | PROTOCOL market, NEAR §1a, NEAR-60..65 | TA-10.10 (part) |
| W13-02 | Design note in `docs/spec/NEAR.md` follow-up (via the lead): partial fills with server-signed fill diffs for custodial accounts and all-or-nothing for claimed accounts; the taker pays the fee to the maker's stall owner; self-trade prevention | docs | S | H | — | The note is merged, and NEAR-61 links to it | NEAR-60, NEAR-61, D-18 | — |
| W13-03 | Market config in `data/market.ts` + env: `MARKET_FEE_BP_MAX=300`, TTL options (15 min, 1 h, 6 h, 24 h), min order 10 units, price tick 0.001, max 20 open orders per colony | data | S | H | W13-01 | `compileData` exposes the config; placing an order of 5 units → `order_too_small` | NEAR §12 | — |
| W13-04 | `MockIntentsAdapter` ledger on the W00-32 mock base: `mock_chain_intents_balance (account, tokenId)` with token ids `nep245:res.terraagent.mock:<ResourceKey>` (one per sub-resource, D-34), `native:near`, `nep141:usdc.mock`; `deposit` debits the `CargoTokenPort` balance and credits the verifier (mt_transfer_call semantics); `withdraw` does the reverse; binding `NEAR_ADAPTER_INTENTS` | server | M | H | W10-10, W13-01, W00-32 | Deposit 300 water → the cargo account balance drops by 300 and the verifier balance shows `nep245:…:water = 300`; withdraw 100 → the account is back to +100 | NEAR-55, §1a table | TA-10.10 (part) |
| W13-05 | `MockIntentsAdapter.simulate` and `.execute`: verify NEP-413 signatures, nonces (replay → error), deadlines, per-token sum to zero (`NEAR_INTENT_DIFF_NOT_ZERO`), sufficient balances; `execute` applies the whole batch atomically or nothing; latency and failure injection | server | M | H | W13-04, W13-07 | Execute a batch whose water legs sum to +1 → the whole batch is rejected and no balance changes; a valid batch moves all legs in one DB transaction | NEAR-61, NEAR-62 | TA-10.10 (part) |
| W13-06 | Contract suite `intents.contract.ts` on the W00-38 harness: zero-sum enforced, an insufficient balance fails the whole batch, a replayed nonce is rejected, an expired deadline is rejected, deposit/withdraw round-trips; runs on the mock in CI; W23-23 runs this same suite against the real adapter (mainnet, `simulate` only) | test | M | H | W13-05, W00-38 | `npm run test:contract -- --port intents` → all cases pass against the mock | NEAR §1a rule 5, NEAR-64 | — |
| W13-07 | `MockIntentsAdapter.signTokenDiff(colonyAccount, diff, deadline, nonce)`: build the real-shaped NEP-413 payload and sign it with the decrypted custodial colony key (W06-09 key store), plus a verify helper; W23-22's real adapter reuses the payload builder | server | S | H | W06-09, W13-01, W13-04 | Unit test: sign a diff → the verify helper accepts it, and changing one amount makes verification fail | NEAR-60 | — |
| W13-08 | Order book model: per planet and pair `(ResourceKey, quoteToken)` (one book per sub-resource, D-34), bids and asks with price-time priority; persistence in `chain.market_order` (state OPEN / PARTIAL / FILLED / CANCELLED / EXPIRED, `filled`, `stall_id`, `fee_bp` snapshot); rebuilt from the DB on boot | server | M | H | W13-01 | Insert orders at the same price in two different times → the book lists them oldest first; restart the app → the same book is rebuilt | NEAR-61, DATA_MODEL `chain.market_order` | TA-10.10 (part) |
| W13-09 | `market.placeOrder` flow: own colony; an online Trade Hub T1 owned by the maker (`NEAR-63`); stall = any online Trade Hub on the planet (default own); amounts within config; auto-deposit the sell side into the verifier through the W00-37 outbox (`opId = market-deposit:{orderId}`); store the order; ack | server | M | H | W13-04, W13-08, W13-03, W00-37 | A colony without a Trade Hub places an order → `no_trade_hub`; with one → the order appears with state OPEN, and the verifier holds the deposited amount | NEAR-60, NEAR-63 | TA-10.10 (part) |
| W13-10 | Sim: `market.reserve` / `market.release` / `market.settled` keep a per-colony `reservedInOrbit` mirror for the HUD; settled deltas update the in-orbit mirror; no sim stock changes | sim | S | H | W13-01 | Place a 300-water sell → the colony's `reservedInOrbit.water = 300`; after the fill it is 0 and in-orbit metals +120 | SIMULATION market.* | — |
| W13-11 | Matching engine: on each new order, cross against the opposite side by price-time priority; partial fills for custodial accounts; all-or-nothing for claimed accounts; skip same-colony orders (self-trade prevention); execution price = maker price | server | M | H | W13-08, W13-02 | Unit scenario: ask 200 @0.40 and bid 100 @0.45 → one fill of 100 @0.40, with 100 left on the ask; a same-colony bid never matches | NEAR-61 | — |
| W13-12 | Batch builder: per fill create maker diff, taker diff and fee leg (`fee_bp` of the taker's received token → the stall owner's colony account); assert per-token sum to zero before submission; sign each colony leg (W13-07); expose a `registerFeeLeg` extension point (W22-07 plugs the treasury leg into it) | server | M | H | W13-11, W13-07 | The demo trade at 1 % → legs: A −300 water / +120 metals, B +297 water / −120 metals, stall owner +3 water; the per-token sum is 0 | NEAR-61 | — |
| W13-13 | Settlement: a `trade` handler on the W00-37 outbox (`opId = trade:{tradeId}`) submits the batch through `RelayerPort` → `IntentsPort.execute`; on final write `chain.intent_trade` (FINAL), update order fills, send `market.settled` to both sims, push `market.trade` | server | M | H | W13-12, W06-10, W00-37 | Kill the app after `execute` but before writing FINAL, then restart → the trade is recorded once, and no second execute happens | NEAR-62, rule 6 | TA-10.10 (part) |
| W13-14 | Settlement failure: on execute failure (after retries) mark the trade FAILED, return both orders to the book (or EXPIRED if past TTL), send `market.release`, push "Contract failed, order returned" | server | S | H | W13-13 | With the mock failure rate 1.0, match two orders → both orders are back as OPEN, and no balances moved | NEAR-62, PROTOCOL failure table | — |
| W13-15 | Cancellation and expiry: `market.cancelOrder` (owner only) and a TTL sweep job every 30 s; cancelled or expired orders leave the deposited cargo in the verifier, shown as free in-orbit cargo | server | S | H | W13-09 | Cancel an open order → state CANCELLED, and the HUD reservation drops to 0; an order with a 15-min TTL disappears after time warp ×100 | NEAR-60 TTL | — |
| W13-16 | In-orbit balance = cargo account + free verifier balance; `cargo.import` auto-withdraws from the verifier first when the account balance is short (outbox `opId = market-withdraw:{importSeq}`) | server | S | H | W13-04, W10-13 | After selling, import 100 metals that sit only in the verifier → one withdraw and one burn appear in `/dev/chain`, and stock +100 | NEAR-52, NEAR-55 | — |
| W13-17 | Quote tokens NEAR and USDC (open in beta): mock verifier balances, a 2-decimal display, dev faucet `faucet near\|usdc <amt>`; prices shown in that token | server | S | H+ | W13-04 | Faucet 10 NEAR to B and place "buy 100 metals for 2 NEAR" against A's ask → the trade settles in NEAR | NEAR-65, D-26 | — |
| W13-18 | Price board aggregation per planet and pair: last price, 24 h volume, VWAP, 1 h OHLC candles from `chain.intent_trade`; it also feeds the W15 Guild pricing | server | S | H | W13-13 | After 3 trades → `GET /v1/market/{planetId}/board` returns last, volume and VWAP that match a hand calculation | NEAR-71 input | — |
| W13-19 | API and pushes: `GET /v1/market/{planetId}` (book snapshot + board); `market.book` push debounced to 1 Hz per pair; `market.trade` on each settlement | server | S | H | W13-08, W13-18 | Place 5 orders within 1 s → the client receives one `market.book` push containing all 5 | PROTOCOL market pushes | — |
| W13-20 | Client: Market tab in the Trade Hub panel: pair picker (grouped Metals / Minerals / Bio, then tier), order-book depth (top 10 per side), last trades list; live via pushes | client | M | H | W13-19, W10-20 | Open the Market tab during the demo → the ask from step 3 appears within 1 s, and it disappears after the fill | CLIENT §8a F2 | TA-14.8 (part) |
| W13-21 | Client: place-order form (side, resource, amount, price token incl. NEAR/USDC, price, TTL), preview line ("You give 300 water, you get 120 metals, fee paid by buyer"), my open orders with Cancel | client | M | H | W13-20 | Submit the form → the order shows under "My orders"; Cancel removes it | NEAR-60 | — |
| W13-22 | Client: stall owner controls: fee slider 0–3 % (`market.setHubFee`), earnings summary (today and all time per token) | client | S | H+ | W13-20 | Set the fee to 1 % → the stall chip on the hub shows "1 %", and after the demo trade earnings show "+3 water" | NEAR-61 fee | — |
| W13-23 | Client: new in-game price board panel: last price, 24 h change, volume, sparkline of 1 h candles per pair (the landing's "08 Road to market" board lives in `frontend/landing/` and is not reused: apps never import each other) | client | S | H | W13-19 | After 3 trades → the sparkline shows 3 points, and the last price matches the last trade | NEAR §6 | — |
| W13-24 | Client: contract toasts "Contract signed: X for Y at <Stall> (n % fee)", contract-failed toast, a Contracts list (last 20), and `history.trade` rows to the event log and player history (W12) | client | S | H | W13-13, W13-14 | Complete step 4 → both players see the exact toast text, and the Contracts list shows the trade | near-economy F2 "Players see" | — |
| W13-25 | Market layer data feed for the global map (W04 renders it): `GET /v1/market/{planetId}/stalls` → stall positions, fee and best bid/ask per pair | server | S |  | W13-19 | With W04 on → the map Market layer shows a price tag at A's hub; with W04 off the endpoint still answers | CLIENT §8b Market layer | — |
| W13-26 | Negotiate-goal hook (trade side): `marketOrdersForGoal(goal)` places and refreshes orders within the goal's give/want bounds and budget; called by the W08 goal engine when `W08` is on | server | S |  | W13-09 | Unit test: a Negotiate goal "sell up to 500 water for ≥ 0.35 metals" → the hook places one ask at 0.35 for 500, and never exceeds the goal budget | units §4.6 Negotiate | — |
| W13-27 | Progression events: `progress.merchant` (+1 per settled trade per participating colony's player) and `progress.portAuthority` (+fee units earned by the stall owner), consumed by W12 | server | S | H | W13-13 | After the demo → W12's Facts show merchant +1 for A and B, and portAuthority +3 for A | achievements Merchant, Port Authority | — |
| W13-28 | Analytics: `order_placed`, `order_cancelled`, `trade_settled`, `trade_failed`, `hub_fee_set`, `market_tab_opened` | client | S |  | W13-21 | Run the demo story → those events are recorded with pair, side and amount | CLIENT §10 | — |
| W13-29 | Telemetry: `market_orders_open{planet}`, `market_trades_total{planet,maker_kind}`, `intent_batch_failed_total{reason}`, `market_match_latency_seconds` | server | S |  | W13-13 | After the demo → `/metrics` shows `market_trades_total{maker_kind="player"} ≥ 2` | NEAR §14 | — |
| W13-30 | Dev console: `market.seed <planet> <pair>` (creates a counterparty bot colony with orders for solo testing), `market.clear <planet>`, `faucet near\|usdc <amt>`; failure injection uses W06-25's `near.mock.fail intents <rate>` | server | S | H | W13-09, W06-25 | In a solo scenario run `market.seed here bio.water/metals.t1` → a book with 5 bids and 5 asks appears | PRODUCT_WAVES §3 | — |
| W13-31 | Matcher and batch unit tests: price-time priority, partial fills, all-or-nothing for claimed accounts, fee rounding (floor, remainder to maker), zero-sum assertion, self-trade prevention | test | M | H+ | W13-11, W13-12 | `npm test -- market-matcher` → all cases pass, including a 1 % fee on 7 units (fee 0, no dust) | NEAR §15 | — |
| W13-32 | Mobile acceptance: the Market tab works in phone landscape (book collapses to the best 5 levels, form as a sheet) | client | S |  | W13-21 | Run the e2e at 844 × 390 with touch → steps 2–7 pass | D-22 | — |
| W13-33 | Docs: README "mock vs real" row F2 (`IntentsPort` = mock); `ENVS.md`: `NEAR_ADAPTER_INTENTS`, `MARKET_FEE_BP_MAX`; a note that the real adapter is mainnet-only with `dry: true` first (W23) | docs | S |  | W13-06 | README lists `IntentsPort` as "mock", and `ENVS.md` has both vars | NEAR-64, D-27 | — |
| W13-34 | Perf: matching 1 000 resting orders + 100 incoming per second on one planet ≤ 5 ms p99 per match, off the sim threads | test | S |  | W13-11 | `npm run bench -- market-match` → p99 ≤ 5 ms | ARCHITECTURE perf | — |
| W13-35 | Wave e2e `e2e/w13.spec.ts` (demo story 1–9 with two browser contexts) + seed scenario `w13-markets` (two logged-in colonies with Trade Hubs and in-orbit cargo) + tag `wave-13` | test | M | H | W13-01…W13-34 | `npm run e2e -- --waves ..13` → W00–W13 suites pass | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w13.spec.ts` passes, and every earlier wave's e2e still passes.
- `?scenario=w13` loads; `TA_WAVES=..12` hides the Market tab and rejects market commands (`wave_disabled`). Orders stay in the DB untouched.
- The Intents contract suite passes on the mock. No restart ever executes a batch twice.
- Tag `wave-13` created.
