# 04 — Agents and communication (F3 Guild, F4 director, channels, Agent API)

> **Status:** 2026-10-31, grooming reference, pass 2 (legend, precedence, abbreviations: [`README.md`](./README.md)). Sources: NEAR.md §2, §7, §8; W15 (every row); W09, W18, W16, W08, W02, W03, W10, W13, W23 rows cited below; units §3, §4, §6.2; CONTINUITY §4, §5, §5a, §8; AI_ORCHESTRATOR (`AI`) §1–§7, §15; DATA_MODEL; PROTOCOL; D-09, D-16, D-17, D-19, D-26, D-27, D-31; MP §0, §3–§6; Review; Pivot; Balance; WP; `docs/hackathon/public/{media-plan,landing-brief}.md`. Owned here: director allowance (Q-04-1), Guild float (R04-5, R04-50..52), agent deny list (Q-04-16), Guild LLM strategy (Q-04-8). Pointers: order rules and Negotiate → [`03`](./03-markets-trading-rules.md); keys and custody → [`01`](./01-accounts-keys-relayer.md); access-key semantics (Q-06-17) and mixed real/mock (Q-06-18) → [`06`](./06-near-tools-and-adapters.md); treasury, bounties, deed → [`05`](./05-deed-staking-treasury-bounties.md); mint exceptions → [`02`](./02-mining-cargo-mint-authority.md).

**Terminology.** In the hackathon cut the F4 "director" is the sim `autotrade` system (W15-21, D-31), not the W16 AI director, which is not in the cut (HACKATHON_CUT). NEAR §2, NEAR-81 and DATA_MODEL still say "AI director" (R04-54).

## 1. Purpose

- **F3 Orbital Guild:** two app-run NPC traders with their own (mock) wallets dock at a planet on a schedule, quote both sides of every pair from a deterministic pricing core, and are the only cross-planet route (NEAR-70..73). They are the counterparty that is always there, the price signal that reacts to player trades, and the track-09 "NPC merchants with wallets" answer (MP §1).
- **F4 colony director:** a capped key on the colony account lets the colony trade inside player-set `autoTrade` limits while the player is away, and report it (NEAR-80, NEAR-81, D-17).
- **Communication:** every channel between robots, colonies, the Guild, the planet and outside agents, with where it runs (sim, app push, signed on-chain). Most of it is sim; only trades touch the chain.
- **Agent API / MCP (proposed):** external AI agents playing a colony through the existing commands (Pivot Bet A).

## 2. Actors and accounts

| Actor | Account | Signs with | Pays gas | Holds | Source |
|---|---|---|---|---|---|
| Guild NPC (Kestrel, Osprey) | `guild-N.npc.terraagent.near` (mock: `guild-N.npc.terraagent.mock`) | function-call keys for `intents.near` and `res.*` (design; semantics → Q-06-17) | relayer (→ 01 R01-27) | cargo inventory, NEAR float | NEAR §2, NEAR-70, W15-05 |
| Colony director (sim `autotrade` + market module) | the colony account `{colony}.{name}.terraagent.near` | the director key: a separate function-call / intents key with an allowance | relayer | nothing of its own; spends colony cargo | NEAR §2, NEAR-80, W15-18, W15-21 |
| Colony (player present) | same colony account | the per-colony app-held key | relayer | cargo in orbit | NEAR §2 (→ 01 R01-16) |
| HQ Drone | none (sim entity) | — | — | — | UO-HQ-05 |
| AI director (`ai` module, W16) | none | — (posts `ai.directive` commands) | — | — | AI-09, D-09 |
| Planet orchestrator (proposed) | none | — | — | — | MP §4.1 |
| External agent (proposed) | a colony sub-account created "as F5 does for humans" | custodial keys; trades "under the director allowance" | relayer | — | Pivot Bet A |

## 3. Rules

**F3 Guild**

| # | Rule | Status | Source |
|---|---|---|---|
| R04-1 | Guild NPCs are app-run agents with their own sub-account wallets and function-call keys; they hold cargo and NEAR and sign their own intents as market makers | Decided | NEAR-70 · W15-03 (H), W15-05 (H) |
| R04-2 | Hackathon roster: 2 NPCs, Kestrel and Osprey, with home routes, as data (`data/guild.ts`) | Planned | W15-02 (H) |
| R04-3 | NPC keys are scoped to `intents.near` and `res.*`; the contract suite asserts receiver scoping. Whether one function-call key can name two receivers → Q-06-17 | Decided | NEAR §2 · W15-04 (H) |
| R04-4 | Seed cargo is minted by `minter` without sim stock, idempotent `opId = guild-seed:{npc}:{resourceKey}`: an exception to mint authority; implements R02-31 (→ Q-02-13) | Planned | W15-05 (H) |
| R04-5 | NPC wallets are seeded from the owner treasury with a small NEAR float and capped so a bug cannot drain the treasury (number: R04-50..52) | Decided | NEAR-73 |
| R04-6 | Deterministic seeded visit schedule per NPC; `chain.guild_visit` rows; `guild.arrived` / `guild.departed` to that planet's players; "en route" between planets; `scheduleExtraVisit(planetId)` for W22-12 | Planned | NEAR-72 · W15-09 (H) |
| R04-7 | While docked: one bid and one ask per pair on that planet's books, signed with the NPC key, sizes from inventory (capped); cancel all on departure; never trade with another Guild NPC | Planned | NEAR-70 · W15-08 (H) |
| R04-8 | Pricing is deterministic, in the app: the NPC mid drifts with its inventory and the planet's last 24 h of settled trades; the spread widens when inventory is thin (formula: R04-53) | Decided | NEAR-71 |
| R04-9 | `refPrice` = the planet's 24 h VWAP from the W13 price board, falling back to the data default | Planned | W15-06 (H) |
| R04-10 | Spread: base 4 %, widened up to 15 % on the side where inventory < 25 % of target | Planned | W15-02 (H), W15-06 (H) |
| R04-11 | Quotes per sub-resource (`ResourceKey`, D-34), T1 pairs from day one; NPCs also sell T2/T3 the colony cannot mine, with smaller targets and higher prices | Planned | W15 note, W15-02 (H) |
| R04-12 | Curated offers: top 6 (best price per pair and side, "fills now" amounts) in `guild.arrived`; `market.acceptGuildOffer` crosses instantly through W13 settlement; stale id → `offer_expired` with the new price | Planned | W15-11 (H) |
| R04-13 | After every Guild fill, update the inventory cache and re-quote within 1 s | Planned | W15-07 (H+) |
| R04-14 | Inventory caps and the NEAR float cap are enforced before quoting; per-NPC kill switch `guild.disable <npc>` + admin endpoint | Planned | W15-12 (H+) |
| R04-15 | Cross-planet carry: inventory travels with the ship; with one planet the route loops back | Planned | NEAR-72, D-19 · W15-10 (—) |
| R04-16 | Track 09: merchant pricing rules in one readable file and each merchant's reasoning in a tooltip (`reason` on every offer) | Proposed | Review §3.1, §5 change 1 · no issue, Q-04-5 |
| R04-17 | Off-planet sink: the Guild sells 10 % of its stock per docked visit (a decay row standing in for carry) | Proposed | Balance §7.2, §8 · Q-04-4 |
| R04-18 | Guild T2 restock: +300 per T2 sub-resource per NPC per day | Proposed | Balance §7.2, §8 · Q-04-4, Q-02-13 |
| R04-19 | Counteroffer: the Guild re-quotes once, with a reason, when a player bids inside its spread | Proposed | Review §3.2, Pivot Bet A · Q-04-6 |
| R04-20 | Optional LLM layer (`ai` module, same budget) picks routes and stockpile goals about once an hour; `GuildStrategyPort` with a deterministic default | Decided | NEAR-71 · W15-13 (—), W16-21 (—) |
| R04-21 | Guild strategy prompt returns `offers` with `spread_pct` 4.5–12 and a `priority`, on NEAR AI Cloud, attestation shown in the Guild panel or "Planetary Log" | Proposed | MP §0, §4, §4.3 · Q-04-8 |
| R04-22 | Attested reasoning: verify the response signature against the attested signing address in-app; do not say "verifiable" until the check is green | Proposed | Pivot Bet C, Review §7 · Q-04-8 (storage → Q-06-16) |

**F4 director, autoTrade, away**

| # | Rule | Status | Source |
|---|---|---|---|
| R04-23 | `POST /v1/near/director-key` adds a function-call / intents key to the colony account; revoke deletes it (W15-18: `DELETE`, `revoked_at` set; PROTOCOL: `POST` add/revoke); `director.status` shows allowance and spent | Decided | NEAR §2, NEAR-80 · W15-03 (H), W15-18 (H); verb → Q-04-12 |
| R04-24 | Allowance basis and unit: "the away trading budget" (NEAR-80, NEAR §2, W15 Goal, AI §15 #8, WP §3, landing `director`) vs the autoTrade per-session caps per token (W15-18, W15-03/04, demo "600 metals") vs one `allowance numeric` (DATA_MODEL `chain.director_key`) vs "0.1 NEAR" (W23-26); AW-20 says autoTrade limits are separate from the away budget | Conflict | → Q-04-1 |
| R04-25 | The director signs only within `autoTrade` limits; one checker `withinAutoTrade` (W09-13) runs in the sim on director orders and again in the market module before matching; over-limit → `autotrade_limit`. The limits are enforced by the server; whether the key enforces anything → Q-06-17 | Decided | NEAR-81, AW-13 · W09-13 (H), W15-20 (H) |
| R04-26 | autoTrade limits per sub-resource: sell above X % of the family's storage, buy below a floor, max per trade, max per away session, min stock floor; partners `guild` / `truce partners` / `anyone` | Planned | W15-19 (H) · spec gap (AW-13 lists fewer fields), Q-04-2 |
| R04-27 | Director loop (away, or dev `away.simulate`): the sim evaluates surplus/shortage every 60 s and emits `directorOrderRequested` (D-31: a game rule); the market module only signs with the director key and places (Guild first when partner = guild); allowance decremented on settle (timing → R04-60) | Planned | NEF F4, NEAR-81 · W15-21 (H) |
| R04-28 | Allowance spent or key revoked → loop stops for that resource, `directorAllowanceExhausted` once, notified as the CT-36 kind `away_budget_exhausted` (same kind as W09-11's `awayBudgetExhausted`) | Planned | CT-36 · W15-22 (H) |
| R04-29 | Revoke during a pending match → the trade is rejected | Planned | W15-30 (H+) |
| R04-30 | Away budget: player-set % per resource; defaults 40 % per automated directive, 60 % of away-start stock per session; defense and repair never capped. Not enforced in H | Decided | AW-20, D-17 · W09-11 (—), W09-14 (—) |
| R04-31 | Hard offline mode: an away colony can be eliminated; away rules stop automation from gambling, they do not guarantee survival | Decided | D-17, CONTINUITY §4 · W09-19 (H+) |
| R04-32 | Away automation MUST NOT do AW-10..15 (demolish, raid without opt-in, launch, trade outside autoTrade, change account- or chain-related settings, T3 / over-budget projects). In H only the allow list (W09-09) and `withinAutoTrade` (W09-13) run; the deny table and its rejection log are untagged | Decided | AW-10..15 · W09-09 (H), W09-10 (—), W09-12 (—) · Q-04-12 |
| R04-33 | Digest: opened on away with a baseline, events folded (lists capped at 20), flushed with snapshots, sent in `welcome.away`, kept 7 d; `trades` lists `{with, gave, got}` | Decided | CT-30..33 · W09-15/16/17 (H) |
| R04-34 | Each director trade adds `digest.directorTrade` ("Director sold 300 metals to the Guild"), else in the HUD event log | Planned | W15-24 (—) · Q-04-11 |
| R04-35 | Notifications: Web Push + Telegram; 8 kinds incl. `truce_offered`, `trade_offer` (only outside autoTrade), `away_budget_exhausted`; none while connected; idempotent per `(colonyId, eventId, channel)` | Decided | CT-35..38 · W09-20/21 (H), W09-22/24 (—) |

**Communication between robots, colonies and agents**

| # | Rule | Status | Source |
|---|---|---|---|
| R04-36 | Inside a colony everything is sim: lanes, dispatch with earmarks, precedence `system > player > hq > ai > auto`, HQ goals broken down deterministically by the rule engine (flow in §4) | Decided | UO-L, UO-D, UO-P, UO-G-02 · W02-13..16, W03-12/13, W08-16/17/21/23..25 (H) |
| R04-37 | The HQ is the colony's diplomat: a Negotiate goal creates trade offers within give/want bounds and budget, or a truce offer; needs neighbour contact (+ Trade Hub T1 for trades); open offers by HQ tier 1/3/6. Offers vs orders and the stale NEAR §7 link → Q-03-20 | Decided | UO-HQ-05, units §4.6 · W08-20 (—), W13-26 (—) |
| R04-38 | Truces: planet-local sim state between HQs, no NEAR saga; contact + both HQs alive + no damage in 10 min; notice 10 min; Oathbreaker 24 h; AI may propose/accept while away, never cancel | Decided | UO-DIP-01..06, D-16 · W18-01, W18-11..17, W18-20 (—) |
| R04-39 | First `neighborContact` at ≥ S2, a Guild visit, or S5 unlocks the Trade Hub (and Negotiate) | Planned | units §6.2, SIMULATION §9 · W10-03 (H) |
| R04-40 | The market module is the message bus: it matches and settles as `token_diff` intents (→ 03 R03-29, R03-59) | Decided | NEAR-61, D-26 · W13 note |
| R04-41 | AI directives: `DirectiveV1` validated, clamped (trade give ≤ 20 % of stock, raid removed while away without opt-in), posted as `ai.directive` with `commandId = requestId`; the sim is the authority; failure → rules continue. W16 is not in the cut | Decided | AI-01..12 · W16-01..13 (—) |
| R04-42 | "Wild directives" (`mass_export`, `terra_focus_sector`, `defensive_buildup`, `trade_push`) the player can accept or override | Proposed | MP §4.2 · Q-04-14 |
| R04-43 | Planet directives (fauna spawn, den chance, disaster, yield modifier) from an LLM orchestrator; Review replaces them with nest rules (field map in §5) | Proposed | MP §4.1; Review C1, C2, §5 change 5 · Q-04-15 |

**Agent API / MCP (Pivot Bet A)**

| # | Rule | Status | Source |
|---|---|---|---|
| R04-44 | Operations over the existing command stream: `foundColony`, `brief` (the ≤ 1 200-char brief, AI §5.2), `queue`, `placeOrder`, `acceptGuildOffer`, `counterOffer`, `vote`, `receipts` (one per trade) | Proposed | Pivot Bet A |
| R04-45 | Seats come from the W01-05 dev-seat flow (`pl_dev`, then `pl_dev_2`), no lobby | Proposed | Pivot Bet A · W01-05 (H) for humans |
| R04-46 | `RULES.md`, two scripted reference agents, README step 1 local and offline (`?host=local`), step 2 the live sector's MCP | Proposed | Pivot Bet A, Review §3.2 |
| R04-47 | Deny list: without a human an agent cannot spend beyond its allowance, move the player's NEAR, claim the account, or stake; "enforced by the key, not by a prompt" depends on 06's key semantics | Proposed | WP §3, media-plan diagram 3, landing `director` · Q-04-16 |
| R04-48 | Rate limits per account for the API | Gap | Pivot §7 vs D-25, AI-15 · Q-04-17 |
| R04-49 | Track requirements it answers: 07 = negotiate (one counteroffer with reasoning), pay through NEAR Intents, one receipt per task, a key-custody checkpoint; 05 = per-agent sub-accounts, a coordinator (the market module), `RULES.md` before code, a scripted no-LLM simulation mode, a live page (the price board) | Proposed | Review §3.2, Pivot §5 |

**Rules added in pass 2 (ids appended)**

| # | Rule | Status | Source |
|---|---|---|---|
| R04-50 | NEAR float cap "5 NEAR" (per NPC or in total: not stated) | Planned | W15-02 (H); enforcement W15-12 (H+) |
| R04-51 | 5 NEAR per NPC, 10 NEAR total, real float, kill switch promoted to H; MP §0 instead locks the "safest" float (no NEAR pairs, float unused for trading) | Proposed | Pivot Bet B; MP §0 · → Q-03-15 |
| R04-52 | Number of funded NPCs: W23-28's real run "funds 3 Guild NPCs" vs W15-02's 2 | Conflict | → Q-04-24 |
| R04-53 | Formula: `mid = refPrice × (target / inventory)^k`, clamped; returns bid/ask per pair | Planned | W15-06 (H) · spec gap (NEAR-71 has no formula) |
| R04-54 | Who signs: NEAR §2, NEAR-81 and DATA_MODEL say the AI director uses the key; W15-21 makes the decision a sim rule and only the market module signs | Conflict | → Q-04-1 |
| R04-55 | Votes: the media plan puts "votes" inside the agent's allowance, but the key is scoped to `intents.near` and `res.*` (NEAR §2), not DAO receivers | Conflict | media-plan diagram 3 vs NEAR §2 · → Q-04-21 |
| R04-56 | Bet A step 1 "an offline local agent founds a colony": W00-55's local host reports `host_unavailable` for accounts, NEAR, notifications, progression and LLM, and runs the engine in a browser worker an `npx` MCP process cannot reach | Conflict | Pivot Bet A vs W00-55 (H) · → Q-04-22 |
| R04-57 | Economy fast-forward page (`/dev/market/fastforward?days=7`, Model B, 336 slots in 60 s, Guild reason strings): track 09 "a week of trading in about a minute", track 05 "no-LLM simulation mode" | Proposed | Balance §9.3, Review §3.1, §3.2 · no issue, Q-04-5 |
| R04-58 | Agent ↔ agent on-chain: external agents, directors and Guild NPCs meet only as makers and takers in the planet matcher; direct agent-to-agent offers are open (→ Q-03-20) | Planned | W13-09, W13-11 (H), W15-08 (H) |
| R04-59 | Guild coverage of the five-planet season (Pivot: 5 dev planets): 2 NPCs, a schedule tuned for one planet, carry untagged | Gap | Pivot §2 season, Balance §7.4, W15-10 (—) · Q-04-23 |
| R04-60 | Allowance decrement: W15-03 decrements on every signed intent; W15-21 decrements on settle | Conflict | → Q-04-20 |

## 4. Flows

**In-colony coordination (all sim, no chain).** HQ Drone lands, terraforms the Hub site from its power cell and builds the Hub (UO-HQ-06, W01) → the player's menus add entries to four lanes (Construction, Terraform, Units, HQ goals; W03-12 H) → an HQ goal is broken into `hq`-tagged orders by the rule engine within the goal budget (UO-G-01/02, W08-16/17 H) → the rule engine scores needs and adds `auto` orders, automating a lane one stage after it is taught (W08-23..25 H) → dispatch every 10 ticks scans in precedence order, starts the first startable entry, picks the nearest idle eligible worker, lowest tier first (UO-D-01/03, W02-15/16 H) → an entry starved ≥ 60 s earmarks its shortfall, ≤ 80 % of storage (UO-D-02, W03-13 H) → payment on start (UO-Q-01). Failure paths: `waiting(storage)` never earmarks; `lane_full` drops the oldest `auto`; `worker_tier_locked` above the worker's tier.

**Guild visit (W15 demo 1–4, 9).** Scheduler reaches arrive time → `chain.guild_visit` row → pricing core computes bid/ask per pair → maker loop places quotes signed by the NPC key → `guild.arrived {shipId, planetId, offers[6], departAt}` → toast "Guild trader Kestrel has docked — 6 offers" → Guild tab with Accept and countdown → Accept → one contract settles with the NPC account as counterparty → `guildTradeSettled`, `progress.guildContact +1` (W15-25 H) → (H+) re-quote within 1 s → at `departAt` all quotes cancelled, `guild.departed`.
- Stale offer id → `offer_expired` with the new price (W15-11).
- Inventory or float over cap → that side's quote is withheld (W15-12, H+; in H nothing enforces it, Q-04-7).
- Kill switch → that NPC's quotes vanish within 1 s (W15-12, H+).
- Chain unreachable → `market_unavailable`, the planet keeps running (NEAR §1 p4, → 03 R03-33).

**Director trade (W15 demo 5–8).** `setAutoTrade` → `POST /v1/near/director-key` → "Allowance 600 metals · spent 0" → away (W09 presence after 60 s, or `away.simulate on`) → every 60 s the sim checks surplus/shortage → `withinAutoTrade` passes → `directorOrderRequested` → market module re-checks, signs with the director key, places (Guild first) → settle → allowance decremented, `directorTrade`, `director.status` "spent 300 / 600" → return → digest line.
- Over limit → `autotrade_limit` in sim or matcher (W15-20). Allowance exhausted → loop stops for that resource, `directorAllowanceExhausted` once → `away_budget_exhausted` (W15-22).
- Revoked → next trade skipped `director_key_revoked`; revoke during a pending match → rejected (W15-30, H+). No key → `director_key_missing` (W15-01).

**Truce (W18 demo 4–6, post-hackathon).** Negotiate goal → `diplomacy.proposeTruce` → `recent_hostility` if damage in the last 10 min, `oathbreaker` if marked → `truceOffered` (notification `truce_offered` if offline, W18-17) → `respondTruce` within 10 min, else expires → active: `truce_active` rejects raids → cancel → `truceNotice` 10:00 → `truceEnded`, Oathbreaker 24 h. Away: the director may accept; a cancel directive → `away_policy` (W18-15).

**AI directive (W16, post-hackathon).** Sim event → trigger (60 s hysteresis) → gate (kill switch, 300 s / 120 s / 150 a day, token budget, in-flight) → provider → validate → clamp → staleness → `ai.directive` → sim applies under away policy. Every failure → an outcome code, the rule engine continues (AI §7).

## 5. Numbers

| Value | Source | Status |
|---|---|---|
| Guild NPCs: 2 (Kestrel, Osprey); W23-28 funds 3 | W15-02 (H); W23-28 (—) → Q-04-24 (= R04-52) | Conflict |
| Base spread 4 %; thin-side widening up to 15 % below 25 % of target | W15-02, W15-06 (H) | Planned |
| Dock 12 min; gap 20–40 min (seeded) → Guild present ≈ 29 % of the time | W15-02 (H); Balance §7.4 | Planned |
| Dock 15 min; gap 10–20 min; two NPCs offset | Balance §7.4, §8 | Proposed |
| Inventory cap 5 000 per sub-resource per NPC | W15-02 (H) | Planned |
| Inventory cap 10 000 / target 3 000 per sub-resource per NPC | Balance §8 | Proposed |
| Target inventory, `k`, clamp bounds: no numbers in the plan (Model B assumed target 2 500) | W15-02, W15-06; Balance §7.2 | Gap |
| `k` = 1.0; clamp 0.25×–4× | Balance §7.2, §8 | Proposed |
| Off-planet sale 10 % per visit; T2 restock +300 / T2 sub-resource / NPC / day; T2 ref 4× (metals, bio), 5× (minerals), T3 12× | Balance §8 | Proposed |
| NEAR float: "small", capped | NEAR-73 | Decided |
| NEAR float cap 5 NEAR (scope unstated) | W15-02 (H) | Planned |
| 5 NEAR per NPC, 10 NEAR total, real | Pivot Bet B | Proposed |
| Curated offers per dock: 6 | W15-11 (H) | Planned |
| Re-quote after a fill ≤ 1 s | W15-07 (H+) | Planned |
| Guild LLM strategy ≤ 1 call per NPC per hour | NEAR-71, W15-13 (—) | Decided |
| Orchestrator calls "every 5–15 min or on events" | MP §4 | Proposed |
| Director loop period 60 s | W15-21 (H) | Planned |
| Demo allowance 600 metals; max per trade 300; keep ≥ 200; sell above 80 % | W15 demo step 5 | Planned |
| Away budget 40 % per directive, 60 % per session; defense/repair uncapped | AW-20, CONTINUITY §8 | Decided |
| `AWAY_AFTER_S` 60; digest retention 7 d; ≤ 20 items per list; `under_attack` debounce 10 min | CONTINUITY §8, CT-31, CT-36 | Decided |
| HQ open trade offers T1/T2/T3: 1 (≤ 250 units) / 3 (≤ 900) / 6 (≤ 3 500) | UO-HQ table | Decided |
| Truce 2/6/24/72 h capped by HQ tier (T1 ≤ 6 h, T2 ≤ 24 h, T3 ≤ 72 h); active 1/2/4; offer expiry 10 min; notice 10 min; Oathbreaker 24 h; no damage in last 10 min | UO-DIP-01, -02, -04 | Decided |
| AI per colony 300 s / 120 s / 150 calls a day; 20 M tokens a day; 20 s timeout; trade give ≤ 20 % of stock (player cap 50 %) | AI-03, AI-04, AI §6.3, D-09 | Decided |

**Master-plan AI and den fields (all out of chain scope; disposition per field).**

| MP field | Value | Disposition | Status |
|---|---|---|---|
| §4.1 `fauna_spawn_modifier` | 0.5–2.5 (MP §5 says ×0.6–1.8) | → Balance §6 `nest.spawnModifier` 0.6–1.8; the two MP ranges disagree | Proposed |
| §4.1 `new_den_chance` 0–0.35; "habitat_pressure > 55 → more fauna" | — | → Balance §6 `nest.angerPerLivingTile`, raid chance +0.3 %/point (max 40 %); no den creation | Proposed |
| §4.1 `disaster` + `disaster_intensity` 0.4–1.6; `global_yield_modifier` 0.75–1.25 | — | no sim consumer in the cut (Review §2) (Q-04-15) | Gap |
| §4.1–§4.3 `reason`; §4 "Planetary Log" | one sentence | no surface or issue; Guild reason → R04-16 (Q-04-15) | Gap |
| §4.2 `directive` enum, `intensity` 0.4–1.0, `duration_minutes` 25–100 | — | no `DirectiveV1` action (Q-04-14) | Proposed |
| §4.3 `offers` amount 150–400, `spread_pct` 4.5–12, `priority` rebalance/accumulate/widen_spread | — | conflicts with NEAR-71 (LLM picks routes/goals only) (Q-04-8) | Proposed |
| §5 base spawn 8–14 min; modifier ×0.6–1.8; wave 4–12; HP 80–140 / dmg 12–22 | — | → SIMULATION §7.6 nests (1 Skitter per 900 ticks), raids `2 + threatStage`, Skitter 120 HP / 8 DPS (Review C2) | Proposed |
| §5 habitat radius 10; anger +1.5 per Living tile; max dens 3 | — | → Balance §6 rows (`angerPerLivingTile`, `maxOnPlanet` 3) | Proposed |
| §5 destroy cost 400 M + 250 Min + army time; destroy effect +25 pressure | — | → Balance §6: cost is an army; keep +25 global pressure | Proposed |
| On-chain touchpoints | — | `clear_nest` bounty R05-50/52; deed "dens destroyed" R05-5; Den Hunter R05-18; MP §6 C "meteor/fauna shield vote": W22-10 has `meteor_shield`, no fauna shield (Q-05-21) | Gap |

## 6. On-chain vs app vs sim

| State | Lives in | Truth | Source |
|---|---|---|---|
| Guild cargo and NEAR balances | mock chain (`mock_chain_*`) during the hackathon; real path needs W23-19 (cargo, H2), W23-22 (intents, H2), W23-26 (agent wallet, —), W23-28 (NPC funding, —). With Intents real and AgentWallet mock, Guild and director orders cannot settle on real books → R06-68, Q-06-18 | chain (mock) | NEAR §1a, W15-05 |
| Guild inventory cache, quotes | app (market module, `chain.market_order`) | derived from chain balances | W15-07, W15-08 |
| `chain.guild_npc`, `chain.guild_visit` | app Postgres | app | W15-05, W15-09 |
| Director key + allowance spent | mock `mock_chain_access_key`; `chain.director_key` (`allowance`, `spent`) | chain (mock) for the key, app for the row | W15-03, W15-18, DATA_MODEL |
| autoTrade limits, away budget, autopilot mode | sim colony state (snapshot) | sim | W15-19, W09-01 |
| HQ goals, lanes, truces, Oathbreaker | sim | sim | UO-G, UO-DIP-06 |
| Digest | `world.planet_event_digest` | app | CT-30 |
| AI decisions, budgets | `ai.*` tables | app | AI-10 |

**Communication channels**

| From → to | Channel | Carrier | Signed by | Status | Source |
|---|---|---|---|---|---|
| HQ / rule engine → workers | lanes, dispatch, `hq` / `auto` orders | sim | — | Planned | UO-D, W02-16, W03-12, W08-16/17 (H) |
| AI module → own colony | `ai.directive` command | sim (in-process command) | — | Planned | AI-09, W16-13 (—) |
| Colony → neighbour | `neighborContact` event → Trade Hub unlock | sim | — | Planned | SIMULATION §9, W10-03 (H) |
| Colony HQ ↔ colony HQ | Negotiate goal → market orders | on-chain (mock) settlement | colony keys | Planned | UO-HQ-05, W08-20, W13-26 (—) |
| Colony HQ ↔ colony HQ | truce propose / respond / cancel, notice, Oathbreaker | sim | — | Planned | UO-DIP, W18-01, W18-11..15 (—) |
| Colony ↔ colony, agent ↔ agent | order book, price-time matching; no direct offers (Q-03-20) | app bus + on-chain (mock) | colony / director / NPC keys | Planned | D-26, W13-09, W13-11 (H) |
| Guild → planet's players | `guild.arrived` / `guild.departed` | app push (connected clients only; no CT-36 kind) | — | Planned | W15-09 (H) |
| Guild → planet book | maker quotes, fills | app bus + on-chain (mock) | NPC key | Planned | W15-08 (H) |
| Colony → Guild | `market.acceptGuildOffer` | command + on-chain (mock) | colony key + NPC key | Planned | W15-11 (H) |
| Colony → Guild | counteroffer | — | — | Proposed | Pivot Bet A · Q-04-6 |
| Director (sim) → market module | `directorOrderRequested` | in-process event | — | Planned | W15-21 (H) |
| Market module → book (for director) | director order | on-chain (mock) | director key | Planned | W15-21 (H) |
| Server → player | `director.status` | app push | — | Planned | W15-18 (H) |
| Server → returning player | `welcome.away` digest | app push | — | Planned | W09-16 (H) |
| Server → away player | 8 notification kinds | external push: mock notifier in H, Web Push / Telegram untagged | — | Planned | W09-20/21 (H), W09-22/24 (—) |
| Incoming trade offer → player / AI | `trade_offer` notification, `trade.offer_received` trigger | none in H | — | Gap | CT-36, AI §3 · Q-04-10 |
| Colony → planet | treasury vote (→ 05 R05-38) | on-chain (mock DAO) | colony key | Planned | W22-03 (H) (→ 05 R05-38) |
| Planet → colonies | orchestrator directives / nest pressure rows | sim | — | Proposed | MP §4.1, Balance §6 · Q-04-15 |
| Planet A ↔ planet B | Guild carry | on-chain (mock) | NPC key | Planned | W15-10 (—), D-19 |
| LLM → Guild | strategy plan via `GuildStrategyPort` | app (port) | — | Planned | W15-13, W16-21 (—) |
| LLM → Guild panel | attested reasoning per quote | app (port) | NEAR AI Cloud attestation | Proposed | Pivot Bet C |
| External agent → colony | Agent API / MCP | command stream + on-chain (mock) | custodial colony / director key | Proposed | Pivot Bet A |

## 7. Wave map

- **W15 card.** Deps: W13 (books, matching, settlement, price board), W09 (W09-13 `withinAutoTrade`), via W13 also W10 and W06; hooks W09, W11, W16, W08. `@hack` steps: 1, 2 (toast and Guild tab, no ship or VFX), 3, 5–8, 9 (quotes vanish, no carry), 10 (W15-34). DoD gates: `e2e/w15.spec.ts` and all earlier suites pass; `?scenario=w15` loads; `TA_WAVES=..14` removes Guild ships, tab and Away autoTrade while W13 markets work and director keys stay unused in the DB; the agent-wallet contract suite passes on the mock; tag `wave-15`.
- **W15 H:** 01, 02, 03, 04, 05, 06, 08, 09, 11, 16, 17, 18, 19, 20, 21, 22, 23, 25, 28, 34 · **H+:** 07, 12, 14, 15, 30 · **—:** 10, 13, 24, 26, 27, 29, 31, 32, 33.
- **W09 cited:** H: 01, 09, 13, 15, 16, 17, 20, 21 · H+: 19 · —: 10, 11, 12, 14, 22, 24.
- **W02 / W03 / W08 / W10 / W13 / W01 / W00 cited:** W02-13..16, W03-12, W03-13, W08-16, 17, 21, 23..25 (H); W08-20 (—); W10-03 (H); W13-09, W13-11 (H); W13-26 (—); W01-05 (H); W00-55 (H).
- **W18 cited (all —):** 01, 11..17, 20. **W16 cited (all —):** 01..13, 21. **W23 cited:** W23-19, W23-22 (H2); W23-26, W23-28 (—).

| Rules | Issues | H | Gap |
|---|---|---|---|
| R04-1..12, 50, 53 | W15-01..06, 08, 09, 11 | H | `target`, `k`, clamp have no numbers (Q-04-3) |
| R04-13, 14 | W15-07, W15-12 | H+ | float cap unenforced in H (Q-04-7) |
| R04-15, 20 | W15-10, W15-13, W16-21 | — | — |
| R04-16..19, 57 | none | — | **no issue** (Q-04-4, 5, 6) |
| R04-21, 22 | none (Review §5 change 7, Pivot Bet C) | — | **no issue**; D-37/D-38 not recorded |
| R04-23..28, 60 | W15-03, 18..22, W09-13 | H | allowance basis, unit, decrement (Q-04-1, Q-04-20) |
| R04-29 | W15-30 | H+ | — |
| R04-30, 32 | W09-09 (H); W09-10, 11, 12, 14 (—) | H / — | deny table and budget unenforced in H (Q-04-12) |
| R04-33, 35 | W09-15..17, 20, 21 | H | real channels — |
| R04-34 | W15-24 | — | demo step 7 is `@hack` (Q-04-11) |
| R04-36, 39, 58 | W02, W03, W08, W10-03, W13-09/11 rows above | H | — |
| R04-37, 38, 41 | W08-20, W13-26, W18-*, W16-* | — | colony↔colony is contact + order book only in H |
| R04-42, 43, 59 | none | — | **no issue** |
| R04-44..49, 55, 56 | none (Pivot §8: "add the Bet A/B/C issues to W13, W15, W25") | — | **no issue** |
| R04-51, 52 | W23-28 | — | Q-04-24, Q-03-15 |

## 8. Open questions

| # | Question | Proposed default |
|---|---|---|
| Q-04-1 | **Director allowance basis, unit, signer** (absorbs Q-01-6, Q-04-18). Basis: "away trading budget" (NEAR-80, NEAR §2, W15 Goal line, AI §15 #8) vs autoTrade per-session caps (W15-18); AW-20 keeps them separate. Unit: per token (W15-03, W15-04) vs NEAR (W23-26 "0.1 NEAR") vs one `allowance numeric` (DATA_MODEL). Signer: "AI director" (NEAR §2, NEAR-81, DATA_MODEL) vs sim + market module (W15-21). If W15-18 wins, outward copy must change: WP §3 ("allowance is the player's away budget"), landing `director` section, media plan beat/diagram 3 | W15-18 basis; per-token allowance stored per resource (DATA_MODEL change); server-enforced (→ Q-06-17); rewrite NEAR-80/81 and the copy |
| Q-04-2 | AW-13 lists max per trade, per session, min floor, partners (truce / anyone); W15-19 adds sell-above-%, buy-below-floor and partner `guild`. `truce partners` needs W18 (not in the cut) | Write W15-19's set into AW-13; hide `truce partners` with W18 off |
| Q-04-3 | `target`, `k` and clamp bounds have no numbers, yet W15-29 tests "clamp bounds" | Balance §8 (target 3 000, `k` 1, 0.25×–4×) as W15-02 rows |
| Q-04-4 | The sink and T2 restock need code, not just W00-59 overrides; which wave owns them? Without them prices sit at the floor from hour 6 (Balance §7.2, Review §7). Restock mints → Q-02-13 | Two S rows in W15, tagged H |
| Q-04-5 | Track-09 pack: pricing file + reason tooltip + fast-forward page have no issue; W15-01's `guild.arrived {offers}` has no `reason`; W15-32 (≤ 10-line README) is untagged; Balance §9.3 proposes one M issue in W15 | Add `reason` to W15-01; one M row in W15 (H) for the page that doubles as the pricing file (Review §5 change 1, ≈ 3 units) |
| Q-04-6 | Counteroffer: trigger, count, reason text, contract? Pivot says "W15-07 promoted + one rule"; W15-07 is re-quote after fills | One W15 row after W15-07 |
| Q-04-7 | The float cap is H data but only W15-12 (H+) enforces it; Bet B wants a real float with W15-12 at H | Promote W15-12 if any NEAR pair goes real (→ Q-03-15) |
| Q-04-8 | **Guild LLM strategy, one owner.** Provider: Z.ai (D-09) or NEAR AI Cloud (Review C1, D-37 unrecorded). Home: W16-21 hook (—) or a new W15 row. Budget: W16-07/08 gate and W16-15 `ai_decision` row are untagged, so an H+ call has no budget gate or decision row. Authority: offers and `spread_pct` (MP §4.3) or routes and stockpile goals (NEAR-71). Cadence: hourly (W15-13) vs 5–15 min (MP §4). Attestation check and failure display (Q-06-5, Q-06-16 point here) | New W15 row (H+) with a minimal budget gate + decision row; LLM sets goals only, hourly; NEAR AI Cloud behind `LlmProviderPort`, Z.ai fallback |
| Q-04-9 | Closed → Q-04-8 | — |
| Q-04-10 | `trade_offer` (CT-36) and `trade.offer_received` (AI §3): nothing in H emits a directed offer; W13-26 (—) places orders; `DirectiveV1` v1 has `tradeOffer`, v2 (W16-01) names `marketOrder` | Drop from the H routing table (→ Q-03-20) |
| Q-04-11 | W15 demo step 7 (digest line) is `@hack` but W15-24 is untagged | Tag W15-24 H, or render from `directorTrade` in the event log |
| Q-04-12 | In H only W09-09 and W09-13 run; budget accounting W09-11, deny table W09-10, rejection log W09-12 and panel W09-14 are untagged although D-17 makes them MVP. Commands differ: PROTOCOL `setAutopilot {aiDirector, awayRaids}` + `setAwayBudget` vs W09-01 `setAutopilot {mode, awayRaids, awayBudget}`. Revoke verb: PROTOCOL `POST … (add/revoke)` vs W15-18 `DELETE` | Accept for the hackathon and say so in the README; use W09-01 and W15-18 shapes in PROTOCOL |
| Q-04-13 | Offline players get no Guild-arrival notification (not a CT-36 kind) | Accept |
| Q-04-14 | MP §4.2 wild directives match no `DirectiveV1` action; "accept/override" conflicts with apply-as-command (AI-09, AI-12) | Drop for the hackathon (W16 out) |
| Q-04-15 | Planet directives: no issue implements MP §4.1 or Balance §6's nest rows; `disaster` and `global_yield_modifier` have no consumer; no "Planetary Log" surface | Nest rows as data in the wave that owns nests; drop the rest |
| Q-04-16 | Agent deny list (owned here; absorbs Q-01-18's list part): is WP §3's list (spend beyond allowance, move NEAR, claim, stake) the rule? How does an agent colony use a key defined for away mode? What credential does the agent present (credential part absorbed from Q-01-18, owned here) | WP §3 list + AW-14 class; server-enforced (→ Q-06-17) |
| Q-04-17 | API rate limits: D-25 / AI-15 say none beyond cost budgets; Pivot §7 names outside traffic as a risk. Relayer spend side → Q-01-17 | Gap |
| Q-04-18 | Closed → Q-04-1 | — |
| Q-04-19 | W15 names W09-13 a hard dependency and a wave opens only after its dependencies are in `main` (CLAUDE.md), but W15 lands on D10 and W09 on D12 (HACKATHON_CUT day plan; D-27 value order puts W09 after W15). HACKATHON_SCHEDULE runs W09-13 (slot 21) before W15-19/20 (slots 22–23) only at issue level | Land W09-13 as a W15 pre-step, or move W09 before W15 |
| Q-04-20 | Allowance decrement on sign (W15-03) or on settle (W15-21)? Both → double count; on settle → concurrent orders can overrun | Reserve on sign, commit on settle, release on fail |
| Q-04-21 | Does the agent allowance cover votes (media plan) when the key cannot call a DAO (NEAR §2)? | Votes go through the colony key, outside the allowance (→ 05 R05-38) |
| Q-04-22 | Bet A step 1 cannot run as written (W00-55): is step 1 "a scripted agent against the local app" (needs `npm run dev`, not offline), or does W00-55 gain a local MCP bridge? | Step 1 against the local app with mock adapters; fix Pivot and README wording |
| Q-04-23 | 2 NPCs for 5 season planets: how often does each planet see a dock, and does the sink stand in for carry? | Balance §7.4 offset schedule per planet; re-run Model B for five planets |
| Q-04-24 | W23-28 funds 3 Guild NPCs, W15-02 seeds 2 | 2, matching W15-02; fix W23-28 |
| Q-04-25 | Closed → Q-05-21 (fauna shield project kind; 05 owns the treasury). Default carried there: drop, or widen `meteor_shield` to fauna | — |

## 9. Grill questions

- **W15:** Does W15 wait for W09 or pull W09-13 in as a pre-step (Q-04-19)? Final numbers for target, `k`, clamp, caps, schedule (plan vs Balance §8)? Who adds the sink, restock, reason string, pricing page and counteroffer rows, at which tag? Is step 4 (price reaction) out of `@hack` while the brief asks for prices from stock and demand? W15-12 before any real float? Allowance basis, unit and decrement timing (Q-04-1, Q-04-20)? 2 or 3 NPCs (Q-04-24)?
- **W09:** Does the hackathon away run without budget accounting or deny table (Q-04-12)? Which notification kinds can fire in H? Who renders the director digest line (W15-24 —)?
- **W08 / W13:** Negotiate is contract-only (W08-20 —) and W13-26 is —: is "the HQ is the diplomat" visible anywhere in the demo?
- **W16:** Is the Guild strategy (W16-21) the only LLM path, on which provider, with which budget gate (Q-04-8)?
- **W18:** Confirm truces and `truce partners` are post-hackathon; does Scenario C (MP §6, "temporary truce proposal") leave the demo?
- **W23:** Do W23-26/28 go real if Bet B does (→ Q-06-18 mixed mode)? How does W23-27 run W15-04's per-token cases against a real key (Q-04-1)?
- **W00 / W25 (Bet A):** Can README step 1 run offline given W00-55 (Q-04-22)? Which wave owns the API module and MCP package? Deny list, rate limits, seat cap per agent, the receipts table?
