# W15 — Guild & Agents (F3 + F4, mock)

> **Track:** Economy/NEAR (E) · **Flag:** `W15` · **Tag:** `wave-15` · **Scenario:** `scenarios/w15-guild-agents.ts` · **E2E:** `e2e/w15.spec.ts`
> **Depends on waves:** W13 (order books, matching, settlement, price board), W09 (W09-13's `autoTrade` limits contract and `withinAutoTrade`, used by this wave's autoTrade rows). Through W13 it also needs W10 and W06.
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
> - tests: `scenarios/w15-*.ts`, `e2e/w15.spec.ts`
> - uses from W00 without owning: `AgentWalletPort` (W00-30), mock base (W00-32), outbox (W00-37), contract harness (W00-38)

## Goal

**Orbital Guild** NPC traders are agents with their own (mock) NEAR wallets:
- They fly a schedule between planets and dock at Trade Hubs.
- They quote both sides of every market from a deterministic pricing core, so prices react to what players do.
- They are the **only cross-planet trade route**.

The colony **director** gets its own capped key (allowance = the trading share of the away budget). It **autoTrades** within player-set limits while the player is away, and reports what it did. All of this runs on mock `AgentWalletPort` and `IntentsPort`.

**Resources (D-34):** Guild targets, caps, quotes and autoTrade limits are per sub-resource (`ResourceKey`): one bid and one ask per W13 pair, T1 pairs from day one; NPCs also sell T2/T3 sub-resources the colony cannot mine yet. In the steps below, "metals" is `metals.t1` and "water" is `bio.water`; Guild numbers are data rows, tunable with W00-59 (D-35).

## Demo story (the e2e in words)

1. Open `?scenario=w15` → a solo logged-in colony at S2 with a Trade Hub. Storage: 1 400 / 1 500 metals, 20 water. The Guild has 2 NPCs; Guild ship "Kestrel" is due in 30 s.
2. Time warp → the **Guild ship lands** at orbit with landing VFX. A toast "Guild trader Kestrel has docked — 6 offers" appears, and the Trade Hub panel shows a **Guild** tab with offers and a "departs in 12:00" countdown.
3. The book now shows Guild bids and asks around the mid price. Accept **"Buy 200 metals for 70 water"** → instant contract settled with the NPC account `guild-1.npc.terraagent.mock` (visible in `/dev/chain`).
4. Sell 600 metals into the Guild bid → the next Guild quote for metals drops (inventory up, price down) and the spread widens on the thin side.
5. Open **Settings → Away**:
   - set autoTrade "sell metals above 80 % storage, max 300 per trade, max 600 per away session, keep ≥ 200; partners: Guild";
   - **enable the director key** → the status shows "Allowance 600 metals · spent 0" and a Revoke button.
6. Dev console `away.simulate on`, then time warp until storage fills → the director sells 300 metals to the Guild; the allowance shows "spent 300 / 600".
7. `away.simulate off` → the digest line **"While you were away: Director sold 300 metals to the Guild."** appears (W09 digest when on; otherwise in the event log).
8. Tap **Revoke** → the key status shows "Revoked", and the next away trade is skipped with reason `director_key_revoked`.
9. Time warp past departure → the ship lifts off, its quotes vanish from the book, and with W11 on it arrives at a second planet carrying its cargo.
10. Restart with `TA_WAVES=..14` → no Guild ship, no Guild tab, no Away autoTrade section. Player markets from W13 still work.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 2 (arrival toast and Guild tab; no ship model or landing VFX), 3, 5–8, 9 (the quotes vanish on departure; no cross-planet carry), 10. `W15-34` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** the Guild ship model and its VFX (W15-14/15, H+), price reaction after fills (step 4), NPC guardrails, the strategy port, cross-planet carry.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

- [x] Contracts: guild and autoTrade commands/pushes/events, errors; `keyStatus` added to W00-30's `AgentWalletPort` — W15-01
- [x] Guild roster and economic config (spreads, inventory caps, schedule, funding caps `NEAR-73`) — W15-02
- [x] `MockAgentWalletAdapter`: sub-accounts, limited keys with allowance accounting, revoke — W15-03
- [x] Agent-wallet contract suite — W15-04
- [x] Guild NPC provisioning: sub-accounts, initial cargo minted by `minter`, NEAR float, `chain.guild_npc` — W15-05
- [x] Deterministic pricing core: inventory vs target, 24 h planet trades, thin-side spread widening (`NEAR-71`) — W15-06, W15-07
- [x] Market-maker loop: quote both sides on docked planet books with the NPC key; withdraw on depart (`NEAR-70`) — W15-08
- [x] Visit scheduler + `chain.guild_visit` + `guild.arrived` / `guild.departed`; cross-planet carry, the only cross-planet route (`NEAR-72`) — W15-09, W15-10
- [x] Curated Guild offers + `market.acceptGuildOffer` — W15-11
- [x] Funding guardrails and per-NPC kill switch (`NEAR-73`) — W15-12
- [x] Optional strategy hook `GuildStrategyPort` (deterministic default; LLM in W16) — W15-13
- [x] Guild ship (livery variant of `ship.carrier`) + landing/takeoff VFX + docked marker — W15-14, W15-15
- [x] Guild tab UI, arrival toast, countdown — W15-16, W15-17
- [x] Director key `POST /v1/near/director-key` add/revoke, `chain.director_key` (`NEAR-80`) — W15-18
- [x] autoTrade limits model + `setAutoTrade` command (`AW-13`) — W15-19
- [x] autoTrade policy: W09-13's `withinAutoTrade` checked in the sim and re-checked in the market module (`NEAR-81`) — W15-20
- [x] Director trading loop while away: the sim decides (surplus sell / shortage buy within limits), the market module signs with the director key and places; allowance decrement — W15-21
- [x] Allowance exhausted → stop + `directorAllowanceExhausted` event, notified by W09 as `away_budget_exhausted` (`CT-36`) — W15-22
- [x] Settings → Away: autoTrade limits UI, director key status, revoke — W15-23
- [x] Digest items for director trades — W15-24
- [x] Achievement progress event: Guild Contact — W15-25
- [x] Analytics — W15-26 · Telemetry (`guild_inventory`, Guild PnL) — W15-27 · Dev console — W15-28
- [x] Tests: pricing, policy, allowance — W15-29, W15-30
- [x] Mobile acceptance — W15-31 · Docs — W15-32 · Perf — W15-33 · E2E — W15-34

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W15-01 | Contracts: extend W00-30's `AgentWalletPort` (`createSubAccount`, `addLimitedKey(allowance)`, `revokeKey`) with `keyStatus` and the port error `NEAR_ALLOWANCE_EXHAUSTED`; commands `market.acceptGuildOffer {offerId}`, `setAutoTrade {limits}`; pushes `guild.arrived {shipId, planetId, offers, departAt}`, `guild.departed`, `director.status`; events `guildTradeSettled`, `directorTrade`, `directorOrderRequested`, `directorAllowanceExhausted`; errors `offer_expired`, `director_key_missing`, `director_key_revoked`, `allowance_exhausted`, `autotrade_limit`; flag `W15` | contract | M | H | W13-01, W00-30 | `npm run contracts:check` → the new commands are in `CommandKind`, and `AgentWalletPort.keyStatus` compiles | NEAR §1a, NEAR-70..81, PROTOCOL | TA-10.11 (part) |
| W15-02 | Data `data/guild.ts`: 2 NPCs for the hackathon (Kestrel, Osprey) with home routes; target inventory per sub-resource (`ResourceKey`, D-34; T2/T3 targets smaller and priced higher); base spread 4 %, thin-side widening up to 15 %; dock duration 12 min; interval between visits 20–40 min (seeded); inventory caps 5 000 per sub-resource; NEAR float cap 5 NEAR | data | S | H | W15-01 | `compileData` exposes the roster, and changing the spread in data changes quotes without a code change (pricing test) | NEAR-71, NEAR-72, NEAR-73 | — |
| W15-03 | `MockAgentWalletAdapter` on the W00-32 mock base (Postgres `mock_chain_access_key`): sub-account creation under a parent, function-call/intents keys with an allowance (per token amount) and receivers; every signed intent decrements the allowance; revoke deletes the key; `mock:` receipts; binding `NEAR_ADAPTER_AGENT_WALLET` | server | M | H | W06-10, W15-01, W00-32 | Add a key with a 600-metal allowance and sign a 300 trade → `keyStatus` shows spent 300; after revoke, signing fails with `director_key_revoked` | NEAR §2, NEAR-80 | TA-10.11 (part) |
| W15-04 | Contract suite `agent-wallet.contract.ts` on the W00-38 harness: sub-account naming, allowance decrement, exhaustion → stable `NEAR_ALLOWANCE_EXHAUSTED`, revoke, receiver scoping (only `intents.near` and `res.*`); W23-27 runs this same suite against the real adapter | test | S | H | W15-03, W00-38 | `npm run test:contract -- --port agent-wallet` → all cases pass against the mock | NEAR §1a rule 5 | — |
| W15-05 | Guild provisioning job (idempotent at boot): create `guild-N.npc.terraagent.mock` sub-accounts, mint the initial cargo through `minter` (W00-37 outbox, `opId = guild-seed:{npc}:{resourceKey}`), seed the NEAR float in the mock verifier, write `chain.guild_npc` | server | S | H | W15-03, W10-10, W13-04, W00-37 | Boot twice → each NPC exists once with seeded inventory, and `/dev/chain` shows one seed mint per resource | NEAR-70, NEAR-73 | TA-10.11 (part) |
| W15-06 | Pricing core (pure, deterministic): `mid = refPrice × (target / inventory)^k`, clamped; `refPrice` = the planet's 24 h VWAP from the W13 price board, falling back to the data default; spread = base, widened on the side where inventory < 25 % of target; returns bid/ask per pair, i.e. per sub-resource (D-34) | server | M | H | W15-02, W13-18 | Pricing test: inventory doubles → the mid drops by the expected factor; inventory at 10 % of target → the ask spread is 15 % | NEAR-71 | — |
| W15-07 | Pricing reacts to player trades: after every Guild fill, update the NPC inventory cache and re-quote within 1 s | server | S | H+ | W15-06, W15-08 | Sell 600 metals into a Guild bid → the next metals bid is lower than before (e2e step 4) | NEAR-71, near-economy F3 "prices respond" | — |
| W15-08 | Market-maker loop: while docked, keep one bid and one ask per pair on that planet's books, signed with the NPC's key (sizes from inventory, capped); cancel all quotes on departure; never self-trade with another Guild NPC | server | M | H | W15-06, W13-09, W13-11 | During a dock → the book shows `guild` maker orders on both sides for each resource pair; after departure, none | NEAR-70 | — |
| W15-09 | Visit scheduler: deterministic schedule per NPC (seeded), `chain.guild_visit` rows (arrive, depart, planet), `guild.arrived` / `guild.departed` pushes to that planet's players, and an "en route" state between planets; exposes `scheduleExtraVisit(planetId)` (W22-12's `guild_subsidy` uses it) | server | M | H | W15-05 | Time warp through two visits → two `guild_visit` rows with arrive < depart, and the client receives arrived then departed | NEAR-72 | TA-10.11 (part) |
| W15-10 | Cross-planet carry: the NPC inventory travels with the ship, so cargo bought on planet A is sold on planet B. With a single planet (W11 off), the route loops back to the same planet after the interval | server | S |  | W15-09 | With W11 on and 2 planets, buy metals from the Guild on A → on B the Guild ask for metals is backed by that inventory (inventory audit test) | NEAR-72, D-19 | — |
| W15-11 | Curated Guild offers: top 6 offers for the docked planet (best price per pair and side, "fills now" amounts) in `guild.arrived`; `market.acceptGuildOffer` crosses instantly against the NPC quote through the W13 settlement path; `offer_expired` after re-quote | server | S | H | W15-08 | Accept an offer → one contract settles with the NPC account as counterparty; accepting a stale offer id → `offer_expired` with the new price | PROTOCOL `market.acceptGuildOffer` | — |
| W15-12 | Guardrails: per-NPC inventory caps and NEAR float cap enforced before quoting; a per-NPC kill switch `guild.disable <npc>` (also an admin endpoint); `guild_npc_disabled` events | server | S | H+ | W15-08 | Push inventory over the cap with the dev console → that side's quote disappears; `guild.disable osprey` → Osprey's quotes vanish within 1 s | NEAR-73 | — |
| W15-13 | `GuildStrategyPort` (route choice and stockpile goals): `DeterministicGuildStrategy` default; an `LlmGuildStrategy` slot wired to `LlmProviderPort` behind W16, at most 1 call per NPC per hour within the AI budget | server | S |  | W15-09 | With W16 off → the deterministic strategy is used, and no LLM calls are logged; the unit test swaps in a fake strategy and the route changes | NEAR-71 optional LLM | — |
| W15-14 | Bind the existing `ship.carrier` archetype as the Guild ship: register `ship.guildTrader` as a variant (scale ≈ 0.35, Guild livery material swap, a few added cargo-pod greebles) instead of modelling a new hull; validator 0 errors / 0 warnings | visual | S | H+ | — | Open `/playground.html?inspect=ship.guildTrader` → the audit passes (minY 0.000, < 3.5k tris) | AGENTS.md pillars 1, 4 | — |
| W15-15 | VFX: Guild ship descent to a planet dock spot near the busiest Trade Hub, docked idle bob, takeoff on departure; minimap/global-map marker (blue, W04 data hook) — reuse the descent rig (`@terra/render/descent/dropRig.ts`, `CameraRig`) and `Flames` | visual | S | H+ | W15-14, W15-09 | Time warp to arrival → the ship descends in ≤ 3 s and stays docked; on departure it lifts off; with W04 on, a blue ship icon is on the minimap while docked | CLIENT §8b minimap dots | — |
| W15-16 | Client: arrival toast "Guild trader Kestrel has docked — 6 offers" (tap opens the Trade Hub panel), departure toast | client | S | H | W15-09 | Arrival in the demo → the toast appears once and opens the Guild tab when tapped | CLIENT §8a F3 | — |
| W15-17 | Client: Guild tab in the Trade Hub panel: curated offers with Accept, depart countdown, Guild quotes highlighted in the W13 book ("Guild" badge) | client | M | H | W15-11, W13-20 | Open the Guild tab while docked → 6 offers and a countdown; Accept shows the contract toast | CLIENT §8a F3 | TA-14.8 (part) |
| W15-18 | Director key API: `POST /v1/near/director-key` (add, allowance = the autoTrade per-session caps converted to per-token allowances) and `DELETE` (revoke); `chain.director_key` rows; `director.status` push (allowance, spent) | server | M | H | W15-03 | `POST` → `chain.director_key` with the allowance from the limits; `DELETE` → `revoked_at` set, and `director.status` shows "revoked" | NEAR-80 | TA-10.11 (part) |
| W15-19 | autoTrade limits model on top of W09-13's contract + `setAutoTrade` command (sim state per colony): per sub-resource (`ResourceKey`) — sell above % of its family's storage, buy below floor, max per trade, max per away session, min stock floor; partners `guild` / `truce partners` / `anyone` (truce partners require W18) | sim | S | H | W15-01, W09-13 | Send `setAutoTrade` with the demo limits → colony state holds them, and the HUD shows them after reload | AW-13, D-17 | TA-08.6 (part) |
| W15-20 | Policy check in two places, both calling W09-13's `withinAutoTrade` (no second checker): the sim on director-originated orders, and the market module again before matching (`NEAR-81`); an over-limit order is rejected with `autotrade_limit` | server | S | H | W15-19, W15-21, W09-13 | A director order of 400 with max-per-trade 300 → rejected `autotrade_limit` in both the sim and the matcher unit tests | NEAR-81, AW-13 | — |
| W15-21 | Director trading loop (runs while the colony is away; W09 presence or dev `away.simulate`): the sim `autotrade` system evaluates surplus and shortage per the limits every 60 s and emits `directorOrderRequested` (D-31: the decision is a game rule); the market module only signs it with the director key and places or refreshes the order on the planet book (Guild first when partner = guild); allowance decremented on settle | sim | M | H | W15-18, W15-19, W13-13 | In demo step 6 → exactly one 300-metal sell to the Guild, and `director.status` shows spent 300 / 600 | F4, NEAR-81 | TA-08.6 (part) |
| W15-22 | Exhaustion and revoke: allowance spent or key revoked → the loop stops for that resource, emits `directorAllowanceExhausted` (W09 notifies it as kind `away_budget_exhausted`, `CT-36`; W09-11's `awayBudgetExhausted` stays the sim's away-budget event), and logs the skipped reason | server | S | H | W15-21 | Lower the allowance to 300 and repeat step 6 → after one trade the loop stops, and the event `directorAllowanceExhausted` is emitted once | CT-36, AW-20 | — |
| W15-23 | Client: Settings → Away (autoTrade section): limits editor per sub-resource (grouped by family), partners selector, director key toggle with status "Allowance X · spent Y", and one-tap Revoke | client | M | H | W15-18, W15-19 | Complete step 5 in the UI → the limits persist across reload, and Revoke flips the status to "Revoked" | CLIENT §8a F4 | TA-11 (part) |
| W15-24 | Digest items: each director trade adds `digest.directorTrade` ("Director sold 300 metals to the Guild"), rendered by W09's digest when on, else in the HUD event log | server | S |  | W15-21 | In step 7 → the exact line appears in the digest (W09 on) or the event log (W09 off) | near-economy F4 "Players see" | TA-08.3 (part) |
| W15-25 | Progression event `progress.guildContact` (+1 per settled trade with a Guild NPC per player), consumed by W12 | server | S | H | W15-11 | After step 3 → W12's Facts show guildContact +1 | achievements Guild Contact | — |
| W15-26 | Analytics: `guild_docked_seen`, `guild_offer_accepted`, `autotrade_configured`, `director_key_enabled`, `director_key_revoked`, `director_trade_executed` | client | S |  | W15-23 | Run the demo story → all six events are recorded | CLIENT §10 | — |
| W15-27 | Telemetry: `guild_inventory{npc,resource}`, `guild_pnl{npc}` (in a reference token), `director_trades_total{result}`, `guild_quotes_active{planet}` | server | S |  | W15-08, W15-21 | After the demo → `/metrics` shows Kestrel's metals inventory changed by the traded amounts | NEAR §14 | — |
| W15-28 | Dev console: `guild.summon <npc>` (dock now), `guild.depart <npc>`, `guild.setInventory <npc> <res> <amt>`, `guild.disable <npc>`, `away.simulate on\|off`, `director.allowance <amt>` | server | S | H | W15-09, W15-21 | `guild.summon kestrel` → the ship docks within 3 s and quotes appear | PRODUCT_WAVES §3 | — |
| W15-29 | Pricing tests: inventory drift, VWAP fallback, spread widening, clamp bounds, determinism (same inputs → same quotes) | test | S |  | W15-06 | `npm test -- guild-pricing` → all pass | NEAR §15 `guild-pricing.spec.ts` | — |
| W15-30 | Policy and allowance tests: max per trade, per session, min floor, partner filter, allowance exhaustion, revoke race (revoke during a pending match → the trade is rejected) | test | S | H+ | W15-20, W15-22 | `npm test -- director-key autotrade-policy` → all pass, including the revoke race | NEAR §15 `director-key.int.spec.ts` | — |
| W15-31 | Mobile acceptance: Guild tab, arrival toast and Settings → Away work in phone landscape with touch | client | S |  | W15-17, W15-23 | Run the e2e at 844 × 390 with touch → steps 2–8 pass | D-22 | — |
| W15-32 | Docs: README "mock vs real" row F3/F4 (`AgentWalletPort` = mock); `ENVS.md`: `NEAR_ADAPTER_AGENT_WALLET`, `GUILD_ENABLED`, `GUILD_NPC_COUNT`; a short "How the Guild prices" section for judges | docs | S |  | W15-04 | README lists `AgentWalletPort` as "mock" and explains pricing in ≤ 10 lines | D-27, near-economy F3 | — |
| W15-33 | Perf: 2 NPCs quoting on 60 planets' books (when W11 is on) re-quote within 1 s of a fill and use < 5 % of one core | test | S |  | W15-08 | `npm run bench -- guild-60-planets` → p99 re-quote ≤ 1 s, CPU < 5 % | ARCHITECTURE capacity | — |
| W15-34 | Wave e2e `e2e/w15.spec.ts` (demo story 1–10) + seed scenario `w15-guild-agents` (solo colony at S2 with a Trade Hub, near-full metals storage, low water, 2 NPCs, a dock in 30 s) + tag `wave-15` | test | M | H | W15-01…W15-33 | `npm run e2e -- --waves ..15` → W00–W15 suites pass | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w15.spec.ts` passes, and every earlier wave's e2e still passes.
- `?scenario=w15` loads.
- `TA_WAVES=..14` turns off the Guild ships, the Guild tab and the Away autoTrade section. W13 player markets keep working. Director keys stay in the DB but are not used.
- The agent-wallet contract suite passes on the mock.
- Tag `wave-15` created.
