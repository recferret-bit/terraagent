# W15 — Guild & Agents (F3 + F4, mock)

> **D-44 revision:** [ECONOMY](../../spec/ECONOMY.md) governs database-configured policies, finite funded budgets, post-fill re-quotes, eligible reference prices, atomic allowance reservations and simulation gates. No exclusive Guild cross-planet route or unbacked real cargo minting. These are planned requirements.

> **D-45 revision (2026-11-07):** W13 now owns the bot trading API (`/v1/trade/*`, command source `'bot'`, allowances, kill switch, idempotency, rate limits: W13-58..60), the deterministic need/value quote library (`shared/sim/src/systems/trade/agent/`, W13-61), the organic-fill rule (W13-62), scripted trader bots (W13-66) and the emulated NEAR chain with fault injection (W13-65). W15 does **not** rebuild any of it: Guild NPCs are one kind of agent on that same bot API and library (service-owned keys, actor kind `npc`, so their fills are never organic), differing only in funding, schedule, ships and the director key.

> **Track:** Economy/NEAR (E) · **Flag:** `W15` · **Tag:** `wave-15` · **Scenario:** `tests/scenarios/w15-guild-agents.ts` · **E2E:** `tests/e2e/w15.spec.ts`
> **Depends on waves:** W13 (order books, matching, settlement, price board, bot API and allowances W13-58..60, quote library W13-61, scripted traders W13-66, emulated chain W13-65), W09 (W09-13's `autoTrade` limits contract and `withinAutoTrade`, used by this wave's autoTrade rows). Through W13 it also needs W10 and W06.
> **Cross-wave hooks** (they work without these waves, using the dev console):
> - W09 (beyond the hard W09-13 dependency above): presence/away state, away budget, digest, notifications.
> - W11: more than one planet, for cross-planet routes.
> - W16: LLM strategy.
> - W08: rule-engine priorities.
>
> **Specs:**
> - [`NEAR.md`](../../spec/NEAR.md) §1a, §2 (director key), §7 (`NEAR-70..73`), §8 (`NEAR-80..81`), §14, §15
> - [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) F3, F4
> - [`CONTINUITY.md`](../../spec/CONTINUITY.md) `AW-13`, `AW-20`, `CT-36`
> - [`PROTOCOL.md`](../../spec/PROTOCOL.md): `market.acceptGuildOffer`, `guild.arrived`, `setAutoTrade`, `setAwayBudget`, `POST /v1/near/director-key`
> - [`DATA_MODEL.md`](../../spec/DATA_MODEL.md): `chain.guild_npc`, `chain.guild_visit`, `chain.director_key`
> - [`CLIENT.md`](../../spec/CLIENT.md) §8a
> - [`player-profile-and-achievements-spec.md`](../../game/player-profile-and-achievements-spec.md) (Guild Contact)
> - Decisions: D-17, D-19, D-26, D-30
>
> **Owned paths:**
> - server: `backend/app/src/market/guild/**`, `backend/app/src/near/{agent-wallet,director-key}/**`, `backend/app/src/near/infrastructure/adapters/mock/agent-wallet*`, `backend/app/src/near/__contract__/agent-wallet.contract.ts`
> - contracts: `shared/contracts/src/{commands,events}/{guild,autotrade}.ts`
> - sim: `shared/sim/src/systems/trade/autotrade.ts` (the director's trade decisions, D-31)
> - client: `frontend/game/features/{guild,autotrade}/**`
> - kitbash: `frontend/render/kitbash/archetypes/units/guild.ts` (`ship.guildTrader` = a Guild livery variant of the existing `ship.carrier`, not a new hull)
> - tests: `tests/scenarios/w15-*.ts`, `tests/e2e/w15.spec.ts`
> - uses from W00 without owning: `AgentWalletPort` (W00-30), mock base (W00-32), outbox (W00-37), contract harness (W00-38)

## Goal

**Orbital Guild** NPC traders are agents with their own (mock) NEAR wallets:
- They fly a schedule between planets and dock at Trade Hubs.
- They quote both sides of every market through the W13 need/value quote library (their policy rows are Guild data, not a second pricing core) and place orders through the W13 bot API path, so prices react to what players and other bots do.
- They provide cross-planet transport alongside unrestricted external cargo transfers/imports (D-44).

The colony **director** gets its own capped key (allowance = the trading share of the away budget). It **autoTrades** within player-set limits while the player is away, prices through the same W13 quote library (an LLM, see W16, sets strategy only and never a free price) and reports what it did. All of this runs on mock `AgentWalletPort` and `IntentsPort`.

**Resources (D-34):** Guild targets, caps, quotes and autoTrade limits are per sub-resource (`ResourceKey`): one bid and one ask per W13 pair, Tier-1 pairs (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`) in the vertical slice (T2/T3 sub-resources stay disabled while W17/W19 are postponed). In the steps below, "metals" is `metals.t1` and "water" is `bio.water`; Guild numbers are versioned database profile fields; dev tune is sandbox-only (D-44).

## Demo story (the e2e in words)

1. Open `/play.html?scenario=w15` → a solo logged-in colony at S2 with a Trade Hub. Storage: 1 400 / 1 500 metals, 200 water; the remaining family space is sufficient for the demo. The Guild has 2 NPCs; Guild ship "Kestrel" is due in 30 s.
2. Dev console `warp 10` (or `guild.summon kestrel`) → the **Guild ship lands** at orbit with landing VFX. A toast "Guild trader Kestrel has docked — 6 offers" appears, and the Trade Hub panel shows a **Guild** tab with offers and a "departs in 12:00" countdown.
3. The Trade Hub panel's book now shows Guild bids and asks around the mid price. Accept **"Buy 200 metals for 70 water"** → preview 70 water plus 0.7 platform and 0.7 stall fees, total 71.4 water (exact cargo token units); contract settled with the NPC account `guild-1.npc.terraagent.mock` (visible in `/dev/chain/`).
4. Sell 600 metals into the Guild bid → the next Guild quote for metals drops (inventory up, price down) and the spread widens on the thin side.
5. Open **Settings → Away**:
   - set autoTrade "sell metals above 80 % storage, max 300 per trade, max 600 per away session, keep ≥ 200; partners: Guild";
   - **enable the director key** → the status shows "Allowance 600 metals · spent 0" and a Revoke button.
6. Dev console `away.simulate on`, then `warp 20` until storage fills → the director sells 300 metals to the Guild; the allowance shows "spent 300 / 600".
7. Dev console `away.simulate off` → the digest line **"While you were away: Director sold 300 metals to the Guild."** appears (W09 digest when on; otherwise in the event log).
8. Tap **Revoke** → the key status shows "Revoked", and the next away trade is skipped with reason `director_key_revoked`.
9. Dev console `warp 100` past the 12 min departure (or `guild.depart kestrel`) → the ship lifts off, its quotes vanish from the book, and with W11 on it arrives at a second planet carrying its cargo.
10. Exhaust the configured Guild cash budget, submit concurrent bids, then restart: exposure remains bounded and bids pause. Make references stale: cash bids pause; explicit funded bootstrap quotes remain labeled subsidy and never count as organic (D-45). Check the Guild's key shows in the W13 bot-API allowance view and its kill switch cancels its quotes. Compare and replay the integrated W13 stress report.
11. Run `TA_WAVES=..14 npm run dev:restart` and reload `/play.html?scenario=w15` → no Guild ship, no Guild tab, no Away autoTrade section. Player markets from W13 still work.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–11 (including Guild ship arrival toast, `ship.guildTrader` docking VFX, quotes, director key + `autoTrade`, cross-planet carry across W11 worlds, and funded-policy budget guards). `W15-34` tags these steps `@hack`.
- **In H (full vertical slice):** All 33 issues (`W15-01..30, W15-32..34`) are in `H`; only mobile touch (`W15-31`) is deferred with postponed `W24`.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

- [ ] Contracts: guild and autoTrade commands/pushes/events, errors; `keyStatus` added to W00-30's `AgentWalletPort` — W15-01
- [ ] Guild roster and economic config (spreads, inventory caps, schedule, funding caps `NEAR-73`) — W15-02
- [ ] `MockAgentWalletAdapter`: sub-accounts, limited keys with allowance accounting, revoke — W15-03
- [ ] Agent-wallet contract suite — W15-04
- [ ] Guild NPC provisioning: sub-accounts, stock-backed/purchased real cargo; labeled mock fixtures, NEAR float, `chain.guild_npc` — W15-05
- [ ] Guild bindings for the W13 quote library: Guild profile parameters, thin-side spread widening (`NEAR-71`); no second pricing implementation — W15-06, W15-07
- [ ] Market-maker loop: an agent on the W13 bot API path quotes both sides on docked planet books with the NPC key; withdraw on depart (`NEAR-70`) — W15-08
- [ ] Visit scheduler + `chain.guild_visit` + `guild.arrived` / `guild.departed`; cross-planet carry, a cross-planet transport service alongside external cargo imports (`NEAR-72`) — W15-09, W15-10
- [ ] Curated Guild offers + `market.acceptGuildOffer` — W15-11
- [ ] Funding guardrails on top of W13-59 allowances: global/per-NPC funding and kill switch (`NEAR-73`) — W15-12
- [ ] Optional strategy hook `GuildStrategyPort` (deterministic default; LLM in W16, strategy only, never a free price) — W15-13
- [ ] Guild ship (livery variant of `ship.carrier`) + landing/takeoff VFX + docked marker — W15-14, W15-15
- [ ] Guild tab UI, arrival toast, countdown — W15-16, W15-17
- [ ] Director key `POST /v1/near/director-key` add/revoke, `chain.director_key` (`NEAR-80`) — W15-18
- [ ] autoTrade limits model + `setAutoTrade` command (`AW-13`) — W15-19
- [ ] autoTrade policy: W09-13's `withinAutoTrade` checked in the sim and re-checked in the market module (`NEAR-81`) — W15-20
- [ ] Director trading loop while away: the sim decides (surplus sell / shortage buy within limits), the market module signs with the director key and places; allowance decrement — W15-21
- [ ] Allowance exhausted → stop + `directorAllowanceExhausted` event, notified by W09 as `away_budget_exhausted` (`CT-36`) — W15-22
- [ ] Settings → Away: autoTrade limits UI, director key status, revoke — W15-23
- [ ] Digest items for director trades — W15-24
- [ ] Achievement progress event: Guild Contact — W15-25
- [ ] Analytics — W15-26 · Telemetry (`guild_inventory`, Guild PnL) — W15-27 · Dev console — W15-28
- [ ] Tests: pricing, policy, allowance — W15-29, W15-30
- [ ] Mobile acceptance — W15-31 · Docs — W15-32 · Perf — W15-33 · E2E — W15-34

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W15-01 | Contracts: extend W00-30's `AgentWalletPort` (`createSubAccount`, `addLimitedKey(allowance)`, `revokeKey`) with `keyStatus` and the port error `NEAR_ALLOWANCE_EXHAUSTED`; commands `market.acceptGuildOffer {offerId}`, `setAutoTrade {limits}`; pushes `guild.arrived {shipId, planetId, offers, departAt}`, `guild.departed`, `director.status`; events `guildTradeSettled`, `directorTrade`, `directorOrderRequested`, `directorAllowanceExhausted`; errors `offer_expired`, `director_key_missing`, `director_key_revoked`, `allowance_exhausted`, `autotrade_limit`; flag `W15` | contract | M | H | W13-01, W00-30 | `npm run contracts:check` → the new commands are in `CommandKind`, and `AgentWalletPort.keyStatus` compiles | NEAR §1a, NEAR-70..81, PROTOCOL | TA-10.11 (part) |
| W15-02 | Versioned database Guild policies through W13 profile registry: roster/routes, targets, spreads, inventory/cash/per-order/global exposure and daily loss/spend ceilings, reference eligibility/staleness and kill switch. Seed mock defaults; real cash policy starts disabled pending calibration | data | S | H | W15-01, W13-38 | `compileData` exposes the roster, and changing the spread in data changes quotes without a code change (pricing test) | NEAR-71, NEAR-72, NEAR-73 | — |
| W15-03 | MockAgentWalletAdapter with persistent per-token principal reservations/consumption plus separate gas allowance; signing does not spend principal. Reserve at placement, consume on final settlement, release unused funds idempotently | server | M | H | W06-10, W15-01, W00-32 | 600 allowance: reserve 300, settle 200, cancel 100 leaves spent 200 and available 400; restart/revoke races preserve totals | NEAR §2, NEAR-80 | TA-10.11 (part) |
| W15-04 | Contract suite `agent-wallet.contract.ts` on the W00-38 harness: sub-account naming, allowance decrement, exhaustion → stable `NEAR_ALLOWANCE_EXHAUSTED`, revoke, receiver scoping (only `intents.near` and `res.*`); W23-27 runs this same suite against the real adapter | test | S | H | W15-03, W00-38 | `npm run test:contract -- --port agent-wallet` → all cases pass against the mock | NEAR §1a rule 5 | — |
| W15-05 | Idempotent Guild provisioning with explicit funding allocation IDs and one service-owned W13 bot-API key per NPC (actor kind `npc`). Mock grants labeled fixtures; bootstrap sessions labeled subsidy; real treasury cargo must be purchased or stock-backed exported. Seed quote cash within per-NPC/global budgets, no silent refill | server | S | H | W15-03, W10-10, W13-04, W00-37 | Boot twice creates one allocation; no unaccounted cargo source or reset of spend/loss counters | NEAR-70, NEAR-73 | TA-10.11 (part) |
| W15-06 | Guild parameter binding for the W13-61 need/value quote library (reuse it, do not reimplement): Guild epsilon/clamps/k, fee/transport-aware spreads, thin-side widening, cash/inventory-aware sizes, stale/thin-market cash-bid pause, eligible reference history from W13-62 | server | S | H | W15-02, W13-61, W13-62 | Guild inventory/cash/staleness fixtures produce bounded quotes through the W13 library (same functions as the scripted bots); Guild, fixture, subsidy and same-owner fills never set an organic reference | NEAR-71 | — |
| W15-07 | Serialize inventory updates and re-quote/cancel after fills within 1 s; recheck cash, inventory and loss reservations before new bids | server | S | H | W15-06, W15-08 | Sell 600 metals into a Guild bid → the next metals bid is lower than before (e2e step 4) | NEAR-71, near-economy F3 "prices respond" | — |
| W15-08 | Funded market-maker loop while docked, as an agent on the W13 bot API path (command source `'bot'`, actor kind `npc`, single-request `/v1/trade/overview/:planetId` book discovery, and `market-lifecycle` open-order slot release on fill/cancel/expiry): place only inventory/cash-backed quotes passing W13-59 allowances plus atomic local/global budgets; cancel on departure/kill; no Guild-to-Guild matches | server | M | H | W15-06, W13-09, W13-11, W13-59, W13-60, W15-12 | During a dock → the book shows `guild` maker orders on both sides for each resource pair; after departure, none | NEAR-70 | — |
| W15-09 | Visit scheduler: deterministic schedule per NPC (seeded), `chain.guild_visit` rows (arrive, depart, planet), `guild.arrived` / `guild.departed` pushes to that planet's players, and an "en route" state between planets; exposes `scheduleExtraVisit(planetId)` (W22-12's `guild_subsidy` uses it) | server | M | H | W15-05 | Time warp through two visits → two `guild_visit` rows with arrive < depart, and the client receives arrived then departed | NEAR-72 | TA-10.11 (part) |
| W15-10 | Cross-planet carry: the NPC inventory travels with the ship, so cargo bought on planet A is sold on planet B. With a single planet (W11 off), the route loops back to the same planet after the interval | server | S | H | W15-09 | With W11 on and 2 planets, buy metals from the Guild on A → on B the Guild ask for metals is backed by that inventory (inventory audit test) | NEAR-72, D-19 | — |
| W15-11 | Curated Guild offers: top 6 offers for the docked planet (best price per pair and side, "fills now" amounts) in `guild.arrived`; `market.acceptGuildOffer` crosses instantly against the NPC quote through the W13 settlement path; `offer_expired` after re-quote | server | S | H | W15-08 | Accept an offer → one contract settles with the NPC account as counterparty; accepting a stale offer id → `offer_expired` with the new price | PROTOCOL `market.acceptGuildOffer` | — |
| W15-12 | Guild funding guardrails layered on W13-59 allowances (which already own per-key open-order, notional, daily spend/loss, pair, price-band, idempotency, rate-limit and kill-switch mechanics; not rebuilt): persistent atomic per-NPC/global funding and inventory budgets, rolling exposure; price uncertainty pauses cash bids; the Guild kill switch uses W13's and reconciles pending settlement; operator-only explicit top-up allocations | server | M | H | W15-05, W15-06, W13-59 | Concurrent quotes and restart cannot exceed funded exposure; depleted budgets pause; top-up never occurs automatically | NEAR-73 | — |
| W15-13 | `GuildStrategyPort` (route choice and stockpile goals): `DeterministicGuildStrategy` default; an `LlmGuildStrategy` slot wired to `LlmProviderPort` behind W16, at most 1 call per NPC per hour within the AI budget; output is strategy only (route, stockpile goals, specialisation, risk) and the W13-61 library sets every price, so a free price is rejected | server | S | H | W15-09 | With W16 off → the deterministic strategy is used, and no LLM calls are logged; the unit test swaps in a fake strategy and the route changes | NEAR-71 optional LLM | — |
| W15-14 | Bind the existing `ship.carrier` archetype as the Guild ship: register `ship.guildTrader` as a variant (scale ≈ 0.35, Guild livery material swap, a few added cargo-pod greebles) instead of modelling a new hull; validator 0 errors / 0 warnings | visual | S | H | — | Open `/playground.html?inspect=ship.guildTrader` → the audit passes (minY 0.000, < 3.5k tris) | AGENTS.md pillars 1, 4 | — |
| W15-15 | VFX: Guild ship descent to a planet dock spot near the busiest Trade Hub, docked idle bob, takeoff on departure; minimap/global-map marker (blue, W04 data hook) — reuse the descent rig (`@terra/render/descent/dropRig.ts`, `CameraRig`) and `Flames` | visual | S | H | W15-14, W15-09 | Time warp to arrival → the ship descends in ≤ 3 s and stays docked; on departure it lifts off; with W04 on, a blue ship icon is on the minimap while docked | CLIENT §8b minimap dots | — |
| W15-16 | Client: arrival toast "Guild trader Kestrel has docked — 6 offers" (tap opens the Trade Hub panel), departure toast | client | S | H | W15-09 | Arrival in the demo → the toast appears once and opens the Guild tab when tapped | CLIENT §8a F3 | — |
| W15-17 | Client: Guild tab in the Trade Hub panel: curated offers with Accept, depart countdown, Guild quotes highlighted in the W13 book ("Guild" badge) | client | M | H | W15-11, W13-20 | Open the Guild tab while docked → 6 offers and a countdown; Accept shows the contract toast | CLIENT §8a F3 | TA-14.8 (part) |
| W15-18 | Director key API: `POST /v1/near/director-key` (add, allowance = the autoTrade per-session caps converted to per-token allowances) and `DELETE` (revoke); `chain.director_key` rows; `director.status` push (allowance, spent) | server | M | H | W15-03 | `POST` → `chain.director_key` with the allowance from the limits; `DELETE` → `revoked_at` set, and `director.status` shows "revoked" | NEAR-80 | TA-10.11 (part) |
| W15-19 | Shared autoTrade limits plus regional/logistics forecasts: reserve horizon/floor, surplus after queues and service windows, inclusive buy/max sell limits, outstanding reservations and session budgets; compare produce/buy/haul/depot/reserve under player authorization | sim | S | H | W15-01, W09-13, W13-52, W13-53 | Limits persist and are discoverable from schema; unavailable partners/features reject without bypass | AW-13, D-17 | TA-08.6 (part) |
| W15-20 | Policy check in two places, both calling W09-13's `withinAutoTrade` (no second checker): the sim on director-originated orders, and the market module again before matching (`NEAR-81`); an over-limit order is rejected with `autotrade_limit` | server | S | H | W15-19, W15-21, W09-13 | A director order of 400 with max-per-trade 300 → rejected `autotrade_limit` in both the sim and the matcher unit tests | NEAR-81, AW-13 | — |
| W15-21 | Shared sim shortage/surplus decision (the W13-61 `potentialBuy`/quote functions, not a second implementation) uses actual recipe/production forecasts and outstanding orders; server signs/places only within reserved fee-inclusive budgets; final settlement consumes allowance | sim | M | H | W15-18, W15-19, W13-13, W13-42 | In demo step 6 → exactly one 300-metal sell to the Guild, and `director.status` shows spent 300 / 600 | F4, NEAR-81 | TA-08.6 (part) |
| W15-22 | Exhaustion and revoke: allowance spent or key revoked → the loop stops for that resource, emits `directorAllowanceExhausted` (W09 notifies it as kind `away_budget_exhausted`, `CT-36`; W09-11's `awayBudgetExhausted` stays the sim's away-budget event), and logs the skipped reason | server | S | H | W15-21 | Lower the allowance to 300 and repeat step 6 → after one trade the loop stops, and the event `directorAllowanceExhausted` is emitted once | CT-36, AW-20 | — |
| W15-23 | Client: Settings → Away (autoTrade section): limits editor for active Tier-1 resources (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`; T2/T3 hidden while W17/W19 are postponed), partners selector, director key toggle with status "Allowance X · spent Y", and one-tap Revoke | client | M | H | W15-18, W15-19 | Complete step 5 in the UI → the limits persist across reload, and Revoke flips the status to "Revoked" | CLIENT §8a F4 | TA-11 (part) |
| W15-24 | Digest items: each director trade adds `digest.directorTrade` ("Director sold 300 metals to the Guild"), rendered by W09's digest when on, else in the HUD event log | server | S | H | W15-21 | In step 7 → the exact line appears in the digest (W09 on) or the event log (W09 off) | near-economy F4 "Players see" | TA-08.3 (part) |
| W15-25 | Progression event `progress.guildContact` (+1 per settled trade with a Guild NPC per player), consumed by W12 | server | S | H | W15-11 | After step 3 → W12's Facts show guildContact +1 | achievements Guild Contact | — |
| W15-26 | Analytics: `guild_docked_seen`, `guild_offer_accepted`, `autotrade_configured`, `director_key_enabled`, `director_key_revoked`, `director_trade_executed` | client | S | H | W15-23 | Run the demo story → all six events are recorded | CLIENT §10 | — |
| W15-27 | Persisted metrics: inventory/cash, realized and conservatively valued PnL, outstanding exposure, subsidy allocations, reference quality and rejected quote reasons; experiment pipeline reuses the same metrics | server | S | H | W15-08, W15-21 | After the demo → `/metrics` shows Kestrel's metals inventory changed by the traded amounts | NEAR §14 | — |
| W15-28 | Dev console: `guild.summon <npc>` (dock now), `guild.depart <npc>`, `guild.setInventory <npc> <res> <amt>`, `guild.disable <npc>`, `away.simulate on\|off`, `director.allowance <amt>` | server | S | H | W15-09, W15-21 | `guild.summon kestrel` → the ship docks within 3 s and quotes appear | PRODUCT_WAVES §3 | — |
| W15-29 | Pricing/integrated experiments (run on the W13-44 runner with W13-66 scripted bots and humans on the same books; Guild policies added): regional specialists, local/remote suppliers, growing army logistics, depot loss, reserve cycling, self-supply vs buy, plus thin prices/output/buyer-budget/new-colony shocks and restart | test | M | H | W15-07, W15-12, W13-48 | Replayable stress artifacts prove loss/exposure caps and report economic gates without fabricated demand | NEAR §15 `guild-pricing.spec.ts` | — |
| W15-30 | Allowance and policy races: concurrent outstanding orders, partial fill/cancel, final failure vs unknown outcome, restart, revoke before and after irreversible submission, fee-inclusive limits | test | S | H | W15-20, W15-22 | `npm test -- director-key autotrade-policy` → all pass, including the revoke race | NEAR §15 `director-key.int.spec.ts` | — |
| W15-31 | Mobile acceptance: Guild tab, arrival toast and Settings → Away work in phone landscape with touch | client | S |  | W15-17, W15-23 | Run the e2e at 844 × 390 with touch → steps 2–8 pass | D-22 | — |
| W15-32 | Docs: README "mock vs real" row F3/F4 (`AgentWalletPort` = mock); `ENVS.md`: `NEAR_ADAPTER_AGENT_WALLET`, `GUILD_ENABLED`, `GUILD_NPC_COUNT`; a short "How the Guild prices" section for judges | docs | S | H | W15-04 | README lists `AgentWalletPort` as "mock" and explains pricing in ≤ 10 lines | D-27, near-economy F3 | — |
| W15-33 | Perf: 2 NPCs quoting on 60 planets' books (when W11 is on) re-quote within 1 s of a fill and use < 5 % of one core | test | S | H | W15-08 | `npm run bench -- guild-60-planets` → p99 re-quote ≤ 1 s, CPU < 5 % | ARCHITECTURE capacity | — |
| W15-34 | Wave e2e `tests/e2e/w15.spec.ts` (demo story 1–11; Guild quotes appear in the same W13 book and `/trade.html` depth as bots and humans) + seed scenario `w15-guild-agents` (solo colony at S2 with a Trade Hub, near-full metals storage, low water, 2 NPCs, a dock in 30 s) + tag `wave-15` | test | M | H | W15-01…W15-33 | Demo and funded-policy owner checks pass; W13 experiment reports include real Guild policies, held-out seeds and loss-limit assertions | PRODUCT_WAVES §3 | — |

## Wave DoD

- `tests/e2e/w15.spec.ts` passes, and every earlier wave's e2e still passes.
- `?scenario=w15` loads.
- `TA_WAVES=..14` turns off the Guild ships, the Guild tab and the Away autoTrade section. W13 player markets keep working. Director keys stay in the DB but are not used.
- The agent-wallet contract suite passes on the mock.
- Guild quoting reuses the W13 bot API path and quote library (no duplicate pricing, allowance or kill-switch code); Guild fills are never organic.
- Tag `wave-15` created.

## W08 follow-up: executable progression and priorities

Route Guild supply/assistance proposals through the same goal and priority policy.

Mandatory landing criteria: [Progression, tutorial goals and priorities contract](../W08-PROGRESSION-CONTRACT.md). Add a real accept → orders → progress → completion owner check, blocked/resume and reload tests, relevant slider low/high decision tests, and a later-waves-off test. Unimplemented goals stay unavailable; stage previews do not authorize gameplay.

## W12 progression integration gate (revised)

Follow [Progression persistence and delivery](../../spec/PROGRESSION_ENGINE.md). Publish guild-contact facts from confirmed guild interactions.

Acceptance: producer-to-profile persistence, replay/restart, concurrent inputs, threshold boundaries, independent queue retries and disabled-wave behavior are covered by unit and PostgreSQL integration tests. New achievement conditions use catalogue configuration; new event semantics use registered producers. Keep earned achievements and lifetime statistics across colony transitions. ME opens in a new tab from authenticated landing/selection only; the hub's W12 mock is explicit.

## Vertical Slice Testing, Full-Game Integration & Mock/Real Switch Gates

1. **Tier-1 Vertical Slice Scope (`S0–S4` Only):**
   - `W17`/`W19` (Tier 2/3) and `W24` (Mobile) are **POSTPONED**. Orbital Guild NPCs (`kestrel`, `vanguard`) and Colony Director autoTrade operate on the 4 Tier-1 tradable resources (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`) against `USDC` / `NEAR` / barter on the W13 order books and across W11 persistent worlds (`W15-10`).
2. **Unit & Integration Test Matrix (Positive / Negative / Corner):**
   - **Unit & Contract (`agent-wallet.contract.ts`, `guild-pricing.spec.ts`):** `AgentWalletPort` contract suite (idempotent sub-account creation, limited function-call key allowance, debit, `NEAR_ALLOWANCE_EXHAUSTED`, revoke), W13-61 quote library parameter binding for Guild NPCs, and `withinAutoTrade` dual-layer policy check (positive, negative: `autotrade_limit`, `offer_expired`, Guild-to-Guild match prevention, free LLM price rejection; corner: exact allowance exhaustion at 0 remaining, stale reference price pause, departure mid-fill).
   - **Integration (`director-key.int.spec.ts`):** concurrent director orders, partial fill/cancel allowance reservation & release, revoke race before/after settlement submission, and server restart persistence of NPC inventory/cash/loss caps and `W16-21` `GuildStrategyPort` integration.
3. **Full Game Integration + Online Server E2E (`tests/e2e/w15.spec.ts`):**
   - End-to-end wiring from `shared/sim` shortage/surplus autoTrade evaluator → `backend/app` Guild scheduler, market maker loop (on W13 bot API path), and director key service → `frontend/game` Guild ship descent/dock VFX (`ship.guildTrader`), Trade Hub Guild tab, Away autoTrade settings, and W09 digest items, verified by online Playwright E2E against the live backend (`w15-guild-agents` scenario + `/trade.html` visibility + `TA_WAVES=..14` flag-off check).
4. **100% Working Mocked Mode + `NEAR_MODE` Switch:**
   - Runs 100% mocked by default (`NEAR_MODE=mock` / `NEAR_ADAPTER_AGENT_WALLET=mock` via `MockAgentWalletAdapter` in Postgres) and switches cleanly to real NEAR testnet (`NEAR_MODE=testnet` / `NEAR_ADAPTER_AGENT_WALLET=testnet` in `W23-26..28`) using the exact same `AgentWalletPort` contract suite.
