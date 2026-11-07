# W13 — Markets (F2, mock): owner check

[W13 wave](../waves/W13-markets.md) · About 55–65 minutes (steps 1–8 ≈ 15 min, operator/economy 9–10 ≈ 15 min, waves-off 11 ≈ 5 min, regions 12 ≈ 10 min, trading page and bot API 13–15 ≈ 20 min).

Everything here is **mock**: mock USDC/NEAR, a mock `intents.near` verifier, mock cargo tokens. No real money, no real chain. Economic numbers (fees aside) are uncalibrated fixtures; cash eligibility is **false** in W13 (LED-18).

## Before you start

- Worktree `/Users/ferretrec/work/TerraAgent-wt/w13`, branch `wave/w13-markets`. The main checkout is untouched.
- Ports (`infra/.env.worktree`, `TA_PORT_BASE=4300`): **client `<client>` = http://127.0.0.1:5473**, **app `<app>` = http://127.0.0.1:4301**. Database `terra_wave_w13_markets` (freshly reset and seeded before hand-over).
- Start: in the worktree run `npm run dev` (migrations apply on start). Stop: **Ctrl+C** in that terminal.
- Fresh numbers: the scenario funds A and B **up to** 600 water / 20 mock USDC each time a w13 planet is seated. After several demo runs A may hold more water than 600, or B more USDC than 20. For the exact numbers below, run `npm run db:reset && npm run db:migrate && npm run db:seed` with the stack stopped, then start it again.
- **Two players:** A in one browser window, B in a **second browser profile** (or a private window). Each player name may only be open once.
- **In-game dev console:** click the game, press **`` ` ``** (the key under Esc), type a command, press **Enter**, **Esc** to close. This is not the browser DevTools console.
- **Trade Hub panel:** click **your Trade Hub** in the 3D view. It is the 2×2 building just east of your Command Hub (A: tile −6,1; B: tile 10,1). The bottom bar shows **TRADE HUB**. Click **SHOW DETAILS** if it is collapsed, then the **MARKET** tab. The in-game Market tab is a compact quick-trade panel: **OPEN FULL TRADING PAGE** button at the top (opens `/trade.html?planet=<planetId>` in a new tab; that page holds every order, the stall-fee editor, candles, analytics and API keys), the pair picker (short list, mock USDC / NEAR), **BEST BID / BEST ASK / LAST / 24H**, a 5-level depth, the ticket (**ADVANCED** is collapsed), **MY OPEN ORDERS**, **LAST FILLS** (5) and, at the bottom, the read-only stall fee and your **IN ORBIT** resources.
- **Market launcher bar** (bottom right, above the stats box): **SUPPLY & TRADE · SHOW · BOARD · CONTRACTS** (**BOARD** opens `/trade.html?planet=<planetId>#board` in a new tab; **CONTRACTS** is the small in-game list of the last 5 contracts). It sits below the Trade Hub panel; close the Trade Hub panel (**CLOSE**) to reach it.
- Reference: [DEV_TOOLS.md → W13 markets and economy tooling](../../dev/DEV_TOOLS.md#w13-markets-and-economy-tooling-d-44), [ECONOMY_OPERATOR.md](../../dev/ECONOMY_OPERATOR.md), [ECONOMY_REVIEW.md](../../dev/ECONOMY_REVIEW.md).

## Steps

1. **Two colonies, labelled mock balances.**
   - **Where:** window A: <http://127.0.0.1:5473/play.html?scenario=w13&as=a>. In A's dev console run `planet b`; it prints a link `…/play.html?join=<planetId>&as=b`. Open that link in the **second profile** (B).
   - **See:** A plays **Port A** (colony 0), B plays **Port B** (colony 1). Both Trade Hubs show **ONLINE**. In A's Trade Hub → **IN ORBIT → Bio → Water 600**. Every USDC amount in the MARKET tab is labelled *mock USDC*. Balances (raw check, use the planet id printed by `planet b`): <http://127.0.0.1:4301/v1/market/PLANET_ID?as=a> → `balances: {"bio.water":"600"}`, `?as=b` → `{"USDC":"20000000"}` (6 decimals).

2. **A opens Market, picks water/USDC and checks the stall fee (1 %).**
   - **How:** A: Trade Hub → **MARKET**. Pair picker: base **Water (T1)**, quote **mock USDC**. Scroll to the bottom: the stall section shows **Stall fee (read-only) 1.00 %**. Editing the fee moved to the trade page: open **OPEN FULL TRADING PAGE** and use its stall-fee editor (0.50 %, then back to 1.00 %, the maximum).
   - **See:** in-game: read-only **1.00 %** and your **IN ORBIT** list. On the trade page: "Stall fee set to 0.50 % for new orders." then "... 1.00 % ..." (the trade page owns this step now).

3. **A offers 300 water for 10 USDC, TTL 1 h.**
   - **How:** A's ticket: **SELL**, Amount **300**, Total price **10**, open **ADVANCED** and set Expires in **1 h**, **PLACE ORDER**.
   - **See:** the preview says "You give 300 … You receive 10.00 mock USDC · Policy version bootstrap-1". Within a second the ask appears in the depth: price **0.0333**, amount **300**, orders **1**. Under **MY OPEN ORDERS**: **OPEN 0/300**. In-orbit water now shows 300 reserved (REST `reserved: {"bio.water":"300"}`; the order pins `stallFeeBp 100`).

4. **B previews and buys: buyer pays 10.20, seller gets 10, stall and platform 0.10 each.**
   - **How:** B: click B's Trade Hub → **MARKET**, pair **Water / mock USDC** (B sees A's ask). Quick-trade ticket: **BUY**, Amount **300**, Total price **10** (expiry **ADVANCED**, default 15 min; to pick **1 h** open **ADVANCED**).
   - **See (preview):** You receive **300**, Notional **10.00**, Platform fee **0.10**, Max stall fee **0.10**, Network cost **0 (mock, no gas)**, **Total maximum spend 10.20 mock USDC**. Click **PLACE ORDER**.
   - **See (fill, ~1–3 s):** both windows toast **"Contract signed: 300 water for 10.00 USDC at Port A (1 % fee)"**; the ask disappears from both depths; **BOARD/CONTRACTS → CONTRACTS** lists the trade (last 5; **LAST FILLS** in the Market tab shows it too). Balances (REST): B `USDC 9.80`, `bio.water 300`; A `USDC 10.10` (10.00 sale + 0.10 stall fee: A owns the stall); A's realized stall fees (**0.10 mock USDC**) are shown on the trade page, not in the hub.
   - **Explorer:** <http://127.0.0.1:5473/dev/chain/> → **RECEIPTS**: one `Intents.execute_intents` receipt whose op id is `trade:tr_…` (one atomic batch for all legs). (The explorer's balance views show the cargo ledger, not the verifier; check the verifier balances with the REST snapshot above: B `USDC 9800000`, A `USDC 10100000`.)

5. **Price board.**
   - **How:** close A's Trade Hub panel, click **BOARD** in the launcher bar: it opens `/trade.html?planet=<planetId>#board` in a new tab; find **bio.water / USDC** there. (The in-game price board panel was removed.)
   - **See:** last price **0.0333** (gross execution price), volume **300**, label **INSUFFICIENT DATA** with reason `insufficient_data` (one trade, 2 counterparties: below the 3-trade / 3-counterparty minimum, so it can't set a reference price or drive bot bids). Other pairs show **INSUFFICIENT DATA** too. `market.seed here bio.water/USDC` (dev console) adds a labelled **FIXTURE** bot; its fills never count as organic.

6. **Partial fills and the resting buy (e2e checks the exact numbers).**
   - **How:** A sells **200 water for 4 USDC**. B buys **100 for 2** twice (two separate orders).
   - **See:** A's order is partially filled after the first lot, then FILLED. Each lot costs B **2.04** (2.00 + 0.02 + 0.02), the same as one 200-unit fill split in two. Then B places a **BUY 100 for 2** first (it rests), and A sells into it: B (the buyer) still pays the fees.
   - (e2e asserts the exact atomic amounts: `npm run e2e -- --waves 13 -g "6\."`.)

7. **Cancel releases the reservation exactly once.**
   - **How:** B places **BUY 50 for 1** (nobody sells), then **Cancel** in My orders.
   - **See:** order **CANCELLED**; B's reserved USDC drops by exactly **1.02** (1.00 + 0.01 + 0.01) back to free. A second click does nothing.

8. **Injected settlement failure.**
   - **How:** A's dev console: `near.mock.fail intents 1`. A sells **10 water for 1**, B buys **10 for 1**.
   - **See:** no toast, no balance change, both reservations stay locked: the trade is **UNKNOWN** (quarantined), not released. Then run `near.mock.fail intents 0`. Within ~30 s the reconciler settles it: exactly **one** "Contract signed: 10 water …" toast, one trade in Contracts.
   - Definite failures (rollback and re-match) and "restart after execute, before FINAL → one trade only" are covered by backend integration tests, not a dev route: (e2e/integration only) `npx vitest run --config tests/vitest.integration.config.ts backend/app/test/market/settlement-recovery.int.spec.ts backend/app/test/market/settlement.int.spec.ts`.

9. **Operator economy panel: clone, edit, validate, compare, activate, roll back.**
   - **Where:** <http://127.0.0.1:5473/dev/chain/?tab=economy>. Click **USE DEV TOKENS**.
   - **How:** open **baseline@1** → **CLONE** (a DRAFT appears, e.g. baseline@2). Set **market.policy.platformFeeBp** to **99999** → **SAVE**: the field shows `out_of_bounds: 99999 not in [0, 1000]`. Set it to **80** → **SAVE**, **DIFF** (`market.policy.platformFeeBp bp 100 → 80`), **VALIDATE**, **APPROVE**, tick sandbox, **ACTIVATE** → "Active version is now baseline@2".
   - **See:** a new order's preview pins platform fee **0.80 %** (e.g. 10 USDC → platform 0.08), while orders already open keep **1 %**. **ROLLBACK** → "Active version is now baseline@1"; history shows SUPERSEDED/ACTIVE.
   - **Seeded comparison (terminal):** `npm run economy -- schema --json | head` and see [ECONOMY_OPERATOR.md](../../dev/ECONOMY_OPERATOR.md) for `profile clone/patch/validate`, `simulate --manifest …`, `experiment status`, `compare`, `recommend` (JSON only; `recommend` never activates; `cashApproval` is always `false`).

10. **Recurring prestige project, transport recipe, experiments.**
    - **How:** the Survey Array needs a T2 input the scenario colony lacks, so in A's dev console first `grant minerals.t2 20`, then `project survey_array`. Open the dock **QUEUE** tab.
    - **See:** the queue shows **project.survey_array** in progress; over ~30 s stock falls progressively (60 metals, 40 minerals, 30 water, 8 minerals T2 in total; no cash reward). Queue it again → it costs again. Without the grant it waits on minerals T2 (that is the trade motivation: buy it on the market).
    - **Transport:** Trade Hub → **EXPORT TO ORBIT** 100 Water: stock water 900 → **800** and biomass 200 → **198** (transport recipe: 2 biomass per started 100 units), in orbit 600 → **700**; Chain Explorer shows a `CargoToken.mt_mint` receipt `cargo-export:col_0:1`. The 2 biomass is consumption; the 100 water is a representation transfer.
    - **Experiments (terminal, ~1 min):** `npx tsx scripts/economy/run-experiment.ts --manifest tests/economy/acceptance/stress-manifest.json --out tests/economy/artifacts/owner-stress` → exit **0**; open `tests/economy/artifacts/owner-stress/summary.json` (per-resource flows reconcile with drift 0; fee contribution reported as *simulated*, never revenue). Details: [ECONOMY_REVIEW.md](../../dev/ECONOMY_REVIEW.md).

11. **Later waves off.**
    - **How:** stop the stack (Ctrl+C), then `TA_WAVES=..12 npm run dev`. Open <http://127.0.0.1:5473/play.html?scenario=w10&as=off-a>.
    - **See:** the Trade Hub has **no MARKET tab**, there is **no Supply & trade bar**, and <http://127.0.0.1:4301/v1/market/pl_x> answers **403 `wave_disabled`**. Stop it and start normally (`npm run dev`): the trades from steps 4–8 are still listed for the w13 planet.

12. **Regional scarcity and logistics (owner revision of 2026-11-04).**
    - **Where:** close the A and B windows first (a player name may only be open once), then open <http://127.0.0.1:5473/play.html?scenario=w13r&as=a> (desert planet, **Dune Works** = you, plus **Crystal Ridge** with 400 crystals (`minerals.t3`) and **Iron Guard** with a depot).
    - **How:** launcher bar → **SHOW** (Supply & trade).
    - **See:** **Regional abundance** chips like *Minerals T3 SCARCE*, *Minerals T1 ABUNDANT*; **Shopping basket and surplus** with reasons and **BUY/SELL** buttons (they prefill the MARKET order form; they never submit); a **Logistics** section: Load, Capacity **K 100**, congestion **×M**, next-window bill.
    - Dev console: `spawn builder -13 5 20` → after the next supply window (≈ 60 s) Load and the bill rise. Build a **Supply Depot** (BUILD tab) → capacity rises and the bill drops. `reserve on` → reserved units stop billing; `reserve off` redeploys them (activation cost 1 water + 1 metals each, 10 s delay).

13. **Trading page `/trade.html` (all orders, only your own orbital cargo).**
    - **Where:** the root hub <http://127.0.0.1:5473/> has a new card **06 · Trade**; click it (or open <http://127.0.0.1:5473/trade.html?as=a&planet=PLANET_ID&pair=bio.water/USDC>, planet id from `planet b` in step 1; without `?as=` you are sent to the mock login and back). Keep window A's game open so the colony stays seated; for B use `?as=b` in a private window.
    - **How:** A: pair **Water / mock USDC**. In the **Balances** panel read the in-orbit list. Place a **SELL** of 20 water for 1 mock USDC with the ticket (preview shows notional 1.00, no fee for the seller), then click **SUGGEST** (it only fills the ticket; with no "your unit cost" it says `no_unit_cost`). Open **All orders**: the ask appears with an actor badge and TTL; filter **Asks**. In B's window the same table shows the ask without "YOURS". Run `market.seed here bio.water/USDC` in A's dev console: the table shows 10 extra rows, all with the dashed **FIXTURE** badge. In **Stall fee** set 0.50 %, **APPLY**, then back to 1.00 %.
    - **See:** A's balances list only A's cargo (e.g. Water 600 minus reserved 20); B's page never shows A's 600 water. Placing the order is accepted within seconds and appears in **My orders** (Open) and in A's in-game Trade Hub under **MY OPEN ORDERS**. Typing 1.5 % in the stall editor shows "outside the allowed range (0.00 % to 1.00 %)". At phone width (resize the window to 390 px) the order tables become cards, no sideways scrolling. The hub's **OPEN FULL TRADING PAGE** and **BOARD** both land here (`#board` scrolls to the price board).
    - **Check:** `curl "http://127.0.0.1:4301/v1/trade/balances?as=a"` → `inOrbit["bio.water"] = {free, reserved, total}`; the same call with `?as=b` has no water of A's. `curl http://127.0.0.1:4301/v1/trade/book/PLANET_ID/bio.water%2FUSDC/orders` lists every resting order and never contains an account, owner or player id.

14. **Bots trade through the API (keys, allowances, idempotency, kill switch).**
    - **Where:** trade page → **Bot / API keys**, signed in as A.
    - **How:** **Create key** with scopes read + trade, max open orders 2, max order 5 mock USDC, daily budget 50. Copy the secret (shown once). In a terminal: `KEY=ta_bot_…`, `API=http://127.0.0.1:4301/v1`, then `curl -s $API/trade/balances -H "authorization: Bearer $KEY"`; place `curl -s -XPOST $API/trade/orders -H "authorization: Bearer $KEY" -H 'idempotency-key: chk-1' -H 'content-type: application/json' -d '{"side":"sell","resource":"bio.water","amount":20,"price":{"token":"USDC","amount":"1000000"},"ttlS":3600}'` (run it twice: the second answer has the same `requestId`, one order). Without the `idempotency-key` header: `idempotency_key_required`. A 100-water order for 6 USDC: `max_order_notional`. Ask for a quote: `curl -s "$API/trade/agent/quote?resource=bio.water&ownUnitCost=500000&transportPerUnit=0&keep=50" -H "authorization: Bearer $KEY"` (deterministic bid/ask with reason codes; the LLM never types a price). From B's page BUY the 20 water: the bot's fill reaches FINAL and `curl -s $API/trade/fills -H "authorization: Bearer $KEY"` lists it. Back on the trade page click the key's **kill switch**, then repeat the POST with a new idempotency key; then **Revoke**.
    - **See:** the key panel's budget meter moves (today X of 50, N open orders); after the kill switch the POST answers `kill_switch` and resting orders of the key are cancelled; after revoke every call answers `unauthorized`/`key_revoked`. The trade between A's key and B is **organic** only if the two owners differ (see 15); the board's **BOT SHARE** chip shows the bot's volume share.

15. **Organic prices, fixtures and failures (dev console or curl).**
    - **How:** after steps 4 and 14 the board row for bio.water/USDC shows the classification of each trade source. Only fills between a player or a bot and a different owner's player or bot count towards the reference price (VWAP needs ≥ 3 trades, 10 units, 3 counterparties). Seed fixtures (`market.seed`), faucet funding and subsidy quotes never count. Inject a settlement fault: `near.mock.fault {"kind":"fail_after","times":1}` in the dev console (or `curl -XPOST $APP/v1/dev/commands/near.mock.fault -H 'content-type: application/json' -d '{"kind":"fail_after","times":1}'`), place a crossing pair, then `near.mock.fault {"kind":"reset"}`.
    - **See:** the fixture rows keep the dashed badge and the board stays `insufficient_data` until three organic trades by different owners exist; during the fault the trade is `UNKNOWN` with funds locked (never credited twice) and after the reset exactly one FINAL trade appears (as in step 8).

## Automated checks (green on this branch)

- `npm run typecheck`, `npm run lint`, `npm run check:structure`, `npm run build` (only the chunk-size warning).
- `npm test`: **434 files / 2732 tests** (3 skipped). One run showed a single timing flake in `test/ws/commands.spec.ts` that passed on rerun. Includes the exchange unit/property suite (`shared/sim/test/exchange`, `backend/app/src/market/settlement/batch.exchange.spec.ts`: **202 tests**).
- `npm run test:integration` (Postgres + the DB-backed mock chain): **64 files / 344 tests**, of which `backend/app/test/exchange` is the exchange suite (happy paths, matching corners, concurrency, fault injection, allowance rails, board); run it alone with `TA_PORT_BASE=<p> TA_DB_NAME=<db> npm run test:integration -- backend/app/test/exchange`.
- `npm run test:contract`: 29/29 (mock `IntentsPort`).
- `npm run test:parity`: 3 cases pass on both hosts (`w00-empty`, `w03-supply`, `w13r-logistics`).
- `npm run e2e -- --waves ..13 --workers=1` → **82 passed**, 6 skipped (pre-existing W00/W01/W06/W08/W12 skips), ~18 min on a loaded machine; the W13 suite alone is **18/18** (~6 min: `npm run e2e -- --waves 13`), including `@hack 9d` (trade API as human + bot key) and `@hack 9e` (`/trade.html`).

## Known limitations (see `docs/questions-and-limitations/economy-ledger.md` LED-20…LED-30)

- Defaults taken on open questions: total-quote prices, whole-unit resource atoms, sim-first commands (LED-20); matcher/fee/AON rules (LED-21); registry bounds are not owner-approved (LED-22).
- The in-game Market tab is the simplified quick-trade panel; the full tools (all orders, board, keys, stall editor) live on `/trade.html`. Supply & trade is still a dev-grade HUD panel; the launcher bar is the entry point (LED-28).
- Bots/agents (D-45, LED-29): the organic rule is a default I took, the daily budget is a spend cap, the API rate limit is per process, all-or-nothing is decided by the account (claimed = AON, custodial = partial), and bot demand is not verified to be consumed. Test-suite residuals: LED-30.
- Per-sector regions need W11; the region story uses one desert region with stock fixtures (LED-26).
- Calibration, real demand evidence and cash gates remain open (LED-18/19).

## When you're done

All good → from the main checkout: **`npm run wave -- land 13`** (re-runs the gates, merges into `main`, tags `wave-13`, pushes, removes the worktree and branch). Something wrong → tell the wave lead the step number and what you saw.
