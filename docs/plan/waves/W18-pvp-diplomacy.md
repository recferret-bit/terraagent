# W18 — PvP & Diplomacy

> **Track:** Gameplay (G) · **Flag:** `W18` · **Tag:** `wave-18` · **Scenario:** `tests/scenarios/w18-pvp-diplomacy.ts` (5 colonies on one planet, with the shield states and armies below) · **E2E:** `tests/e2e/w18.spec.ts`
> **Depends on waves:** W07 (battle v1, combat units, `attackMove`), W11 (persistent sector worlds and elimination accounting), W09 (away policy, notification routing, the `colonyCritical` / `colonyEliminated` events). Integrates with landed W04 (shield map layer), W08 (HQ goals), and W16 (AI director truce/raid policy). W14 (Fortify), W17 (Tier 2), W19 (Tier 3), and W24 (Mobile) are POSTPONED — W18 runs 100% on Tier 1 (`S0–S4`, `robot.recon`, T1 turrets, T1 Basic Hub, T1 HQ reprint).
> **Specs:** [units spec](../../game/units-orders-and-progression-spec.md) `UO-W-08`, `UO-T-05`, `UO-HQ-04`, `UO-TF-05`, `UO-DIP-01..06`, AC-06, AC-12, AC-13 · [SIMULATION](../../spec/SIMULATION.md) §7.7 · [CONTINUITY](../../spec/CONTINUITY.md) `AW-11`, `AW-13`, §5a · [MATCHMAKING](../../spec/MATCHMAKING.md) `MM-05` · D-17, D-28, D-31
> **Owned paths:** `shared/sim/src/systems/{pvp,elimination,diplomacy}/`, `shared/sim/src/data/diplomacy.ts`, `shared/contracts/src/{commands,events}/{pvp,diplomacy}.ts`, `frontend/game/features/{raid,diplomacy,colony-status}/`, the ruin variant in `frontend/render/visuals/UnifiedColonyMaterial.ts`

## Goal

Colonies on the same planet can fight and make peace. Players raid each other with army groups, newcomers are shielded, a colony can be pushed to `critical` and eliminated, the HQ can be reprinted, and HQ drones negotiate truces with a notice period and an Oathbreaker mark. Every rule lives in `@terra/sim` (D-31); the server only forwards events to the lobby and the notifier.

## Demo story (e2e)

1. Open `/play.html?scenario=w18`: A at S4 with a Tier-1 `robot.recon` army, B at S4 without a shield. HQ Goals menu → Raid Colony on B. → The army attack-moves into B's territory and turrets engage. Combat units next to B's depot siphon resources into A.
2. Open colony C in a second profile (from A's tab, dev console `planet c` prints the join link `/play.html?join=<planet id>&as=c`), aged 1 h at S3. → The Raid Colony goal is greyed with "newcomer shield: 5 h left" and the command is rejected `raid_protected`. (Dev console `setShield <h>` changes the shield.)
3. In B's tab (join link from `planet b`) run `killHq` in the dev console. → B's Hub reprints the HQ (90 s, top of the Units lane). Run `killHub`. → B becomes `critical` with a 10-min re-establish timer. Kill the re-printed HQ too (`killHq`). → B is eliminated, its buildings become ruins, and W11-16 updates living/present counts once while retaining the founded seat under the provisional persistent-world reclaim policy (MATCHMAKING §0, WE-33).
4. From A, open Negotiate on D and offer a 6 h truce; D (join link from `planet d`) accepts in its Diplomacy panel. → A's attack-move into D's territory is rejected `truce_active`, and neither colony's units fire at the other's.
5. A cancels the truce in Negotiate. → A 10-min notice starts while the truce still holds, and A's HQ card shows "Oathbreaker 24 h".
6. D, now away (`presence away`) with AI allowed, receives a truce offer from E (`offerTruce <colony> <h>` in E's console). → The director accepts it (W16 on; with W16 off the `offerTruce` console command + an `ai.directive` fixture stands in).
7. Run `TA_WAVES=..17 npm run dev:restart` and reload `/play.html?scenario=w18` → no raid or truce UI; a Hub loss only makes the colony critical.

## Features covered

| Spec item | Issues |
|---|---|
| Raid task / Raid Colony goal (`enqueueTask raid`, attack-move into foreign territory, pathing to gates) (`UO-W-08`, SIM §7.7) | W18-02, W18-03, W18-04 |
| Siphon at foreign Depot / Hub, 1 unit/s per sub-resource held (D-34), capped by attacker storage (proposed) | W18-05 |
| Newcomer shield until `threatStage ≥ S4` or 6 h; ends on own raid (`UO-T-05`, AC-06) | W18-06 |
| `raid_protected` / `truce_active` / `recent_hostility` / `oathbreaker` rejection codes | W18-01, W18-06, W18-11 |
| HQ reprint at Basic Hub (Tier-1 cost/time, top of Units lane) (`UO-HQ-04`) | W18-07 |
| Colony critical (Hub destroyed, 10 min to rebuild, auto goal "Re-establish"), Hub-site exception for unclaimed tiles (`UO-HQ-04`, `UO-TF-05`) | W18-08 |
| Elimination: both destroyed or timer ends → ruins (owner −1, 1 % HP/s decay), tile grace revert, `colonyEliminated` | W18-09 |
| Elimination accounting: W11-16 consumes `colonyEliminated` idempotently; living counts drop but founded seats stay held pending WE-33; e2e step 3 asserts it (W18-10 dropped) | W18-29 |
| Truces `UO-DIP-01` requirements (contact, both HQs alive, no damage in 10 min) | W18-11 |
| `UO-DIP-02` terms (2/6/24/72 h, capped by HQ tier; active truces 1/2/4; offer expiry 10 min) | W18-12 |
| `UO-DIP-03` effects (no auto-target, raid/attack-move rejected; optional gate hook dormant while W14 is postponed) | W18-13 |
| `UO-DIP-04` breaking (10-min notice, Oathbreaker 24 h, visible mark) | W18-14 |
| `UO-DIP-05` away: AI may propose/accept, never cancel; cancel is player-only | W18-15 |
| `UO-DIP-06` planet-local state, no NEAR saga | W18-01 |
| AI raid opt-in per colony, default off (D-17, `AW-11`): the setting and the deny rule are W09-01/W09-10/W09-14; this wave routes `raid` through them | W18-16 |
| Events consumed by W09 notifications (kinds already routed by W09-21): `underAttack`, `colonyCritical`, `colonyEliminated`, `truceOffered` | W18-17 |
| Achievement events: Warlord (PvP kills), Diplomat (truces kept to term) | W18-18 |
| Client: raid targeting UI, truce panel, Oathbreaker badge, critical banner + timer, ruins look | W18-19 … W18-23 |
| Kitbash/VFX: ruin variant (desaturated, cracked) | W18-22 |
| Analytics: `raid_started`, `colony_eliminated`, `truce_signed`, `truce_broken` | W18-24 |
| Dev console: `killHq`, `killHub`, `setShield`, `offerTruce` | W18-25 |
| Mobile/touch for the truce panel and raid target pick | W18-26 |
| Sim tests: shield (AC-06), truce no-damage (AC-12), away cancel (AC-13) | W18-27, W18-28 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W18-01 | Contracts: `raid` task, `diplomacy.proposeTruce/respondTruce/cancelTruce`, events `raidStarted/Repelled`, `truceOffered/Signed/Notice/Ended` (`colonyCritical` / `colonyEliminated` are reused from W09-01), reject codes `raid_protected`/`truce_active`/`recent_hostility`/`oathbreaker`, truce state schema; flag `W18` | contract | M | H | W07-01, W09-01 | Run `npm test -w @terra/contracts` → the new kinds parse strictly, and with `TA_WAVES=..17` a `raid` command is rejected `wave_disabled` | SIM §4, PROTOCOL, `UO-DIP` | TA-06.11, TA-14.6 |
| W18-02 | Sim: raid task — select idle combat units, form army group, path to target colony | sim | M | H | W18-01 | Enqueue raid on colony B → all idle combat units of A get a group id and move toward B | SIM §7.7 | TA-06.11 |
| W18-03 | Sim: extend W07-12's `attackMove` to targets inside a foreign colony's territory (engage that colony's units and buildings on the way, stop at the target) | sim | S | H | W18-02, W07-12 | Attack-move to a tile in B → units stop to kill a B turret on the path, then continue | `UO-W-08` | TA-06.11 |
| W18-04 | Sim: raid pathing into foreign colonies targets spotted frontier defenses and depots/hubs around terrain/structures (optional gate-pathing hook stays dormant while W14 is postponed) | sim | S | H | W18-03 | Raid a foreign colony → army paths to its spotted frontier structure / depot | `UO-W-08` | TA-06.11 |
| W18-05 | Sim: siphon from foreign Depot/Hub at 1 unit/s per sub-resource B holds (`ResourceKey`, D-34; data row), attacker family-cap-limited | sim | S | H | W18-03 | Park 2 Recons beside B's depot for 10 s → A gains 20 of each sub-resource B holds, B loses 20 | SIM §7.7 | TA-06.11 |
| W18-06 | Sim: newcomer shield `raidProtectedUntil` (S4 or 6 h in Tier-1 vertical slice), dropped on own raid; reject `raid_protected` | sim | S | H | W18-02 | Raid a 1 h S3 colony → `cmd.rejected raid_protected`; that colony raids someone → its shield ends | `UO-T-05` | TA-14.5 |
| W18-07 | Sim: Tier-1 HQ reprint at Basic Hub (200 metals.t1 / 100 minerals.t1 / 50 bio.water / 50 bio.biomass, 60 s), jumps queues (data-driven table; T2/T3 tiers dormant while W17/W19 are postponed) | sim | M | H | W18-01 | Kill HQ (dev) → Units lane shows "HQ reprint" first; after 60 s the HQ reappears at the Hub | `UO-HQ-04` | TA-14.2 |
| W18-08 | Sim: colony critical on Hub loss — 10 min timer, auto goal "Re-establish", Hub placement allowed on unclaimed tiles | sim | M | H | W18-07 | Destroy Hub → colony state `critical`, banner timer 10:00, HQ can place a new Hub on unclaimed land | `UO-HQ-04`, `UO-TF-05` | TA-06.11 |
| W18-09 | Sim: elimination → ruins (owner −1, 1 % HP/s decay, anchors removed with grace), `colonyEliminated` | sim | M | H | W18-08 | Destroy Hub and HQ → colony `eliminated`, buildings turn neutral and lose 1 % HP/s, tiles revert after grace | SIM §7.7 | TA-06.11 |
| W18-11 | Sim: truce offer — requirements (contact, HQs alive, no hostility 10 min), reject `recent_hostility` | sim | M | H | W18-01 | Propose a truce 2 min after a skirmish → `recent_hostility`; after 10 min → offer created | `UO-DIP-01` | TA-14.6 |
| W18-12 | Sim: truce terms — lengths 2/6/24/72 h capped by HQ tier, active caps 1/2/4, offer expiry 10 min | sim | S | H | W18-11 | HQ T1 offers 24 h → rejected; 6 h accepted; a second active truce at T1 → rejected | `UO-DIP-02` | TA-14.6 |
| W18-13 | Sim: truce effects — no auto-target between partners; raid/attack-move into partner territory rejected `truce_active` | sim | M | H | W18-12 | With a truce, partner units pass in range of turrets → no shots; attack-move into partner → rejected | `UO-DIP-03`, AC-12 | TA-14.6 |
| W18-14 | Sim: cancel → 10-min notice (truce holds), Oathbreaker 24 h (no proposing), expiry gives no mark | sim | S | H | W18-13 | Cancel a truce → `truceNotice` with 10:00; after it, `truceEnded`; canceller has `oathbreakerUntil = +24 h` | `UO-DIP-04` | TA-14.6 |
| W18-15 | Sim/away policy: AI may propose/accept while away, never cancel (adds truce rules to W09-10's `awayPolicy` deny table) | sim | S | H | W18-14, W09-10 | Away colony with AI on gets an offer → accepted; directive "cancel truce" → rejected `away_policy` | `UO-DIP-05`, AC-13 | TA-08.6 |
| W18-16 | Sim: route AI-issued `raid` tasks through W09-10's `awayPolicy` (`AW-11`, the `awayRaids` setting of W09-01/W09-14); player raids stay exempt | sim | S | H | W18-02, W09-10 | Away with `awayRaids=false`, an AI directive `raid` → rejected `away_policy`; with `awayRaids=true` → the raid starts | D-17, `AW-11` | TA-08.6 |
| W18-17 | Server: map PvP/diplomacy events to the `NotificationKind`s W09-21 already routes (`under_attack`, `colony_critical`, `colony_eliminated`, `truce_offered`) | server | S | H | W18-09, W18-14, W09-21 | Raid an offline player's colony → the mock notifier holds one `under_attack` row within 60 s | D-17, CONTINUITY §5a `CT-36` | TA-08.7 |
| W18-18 | Achievement progress events: `warlord` (enemy units destroyed in PvP), `diplomat` (truce kept to term, never broken by you) | sim | S | H | W18-03, W18-14 | Kill 10 PvP units → progression receives 10 `warlord` increments; truce expires on term → `diplomat` +1 | player spec §3 | — |
| W18-19 | Client: raid targeting — Raid Colony goal card, target colony picker, attack-move cursor into foreign land | client | M | H | W18-03 | Pick colony B in the goal card → army highlights and a red path line to B appears | units §4.6 | TA-14.8 |
| W18-20 | Client: truce panel in HQ card — offer (length chips), incoming offers with timer, active truces, notice countdown, Oathbreaker badge | client | M | H | W18-14 | Offer 6 h to D → D sees a card with Accept/Decline and a 10:00 expiry | `UO-DIP` | TA-14.8 |
| W18-21 | Client: critical banner + re-establish timer + HQ reprint progress in Units lane | client | S | H | W18-08 | Destroy Hub → red banner "Colony critical 9:59" and Re-establish goal card | `UO-HQ-04` | TA-14.8 |
| W18-22 | Visual: ruin variant (desaturate, cracks, decay alpha) as a mode of the existing unified colony material (`frontend/render/visuals/UnifiedColonyMaterial.ts`), so every kitbash building gets it; `?ruin=1` toggle in the playground | visual | S | H | — | Open `/playground.html?inspect=building.solar&ruin=1` → the model renders desaturated and cracked in all 4 views | Pillar 3 | — |
| W18-23 | Client: shield layer on the global map (registers with W04-15's layer registry) + shield chip on the colony card (icon + hours left) | client | S | H | W18-06, W04-15 | Hover a shielded colony on the global map → "Newcomer shield 5 h" | `UO-T-05` | — |
| W18-24 | Analytics: `raid_started`, `colony_eliminated`, `truce_signed`, `truce_broken` | client | S | H | W00-44 | Run the demo → 4 events recorded | CLIENT §10 | — |
| W18-25 | Dev console: `killHq`, `killHub`, `setShield <h>`, `offerTruce <colony> <h>` | client | S | H | W00-40 | `killHub` → colony goes critical immediately | PRODUCT_WAVES §3 | — |
| W18-26 | Touch: truce panel and raid picker usable in phone landscape | client | S |  | W18-19, W18-20 | On 844×390, accept a truce by tap → works without hover | D-22 | — |
| W18-27 | Tests: shield property (AC-06), truce no-damage (AC-12), away never cancels (AC-13), elimination timer | test | M | H | W18-06, W18-13, W18-15 | `npm run test -w @terra/sim -- pvp` → all four specs pass | AC-06, AC-12, AC-13 | TA-13.x |
| W18-28 | Test: raid → siphon → repel flow with deterministic seed; ruins decay | test | S | H | W18-05, W18-09 | Unit test asserts resource deltas and ruin HP after 100 s | SIM §7.7 | — |
| W18-30 | Route PvP raid groups and foreign-territory attackMove through W07 moveGroup flow-field slots, combatApproachBand, and spotting gate | sim | S | H | W18-02, W18-03, W07-08, W07-12 | Enqueue Raid Colony on B with 6 units → raid group marches via moveGroup flow-field slots, stops at footprintAttackRange of spotted B structures, and respects truce/shield gates | D-43, SIM §7.7, UO-W-08 | — |
| W18-31 | Integrate W11 R=48 isolated founding sector and cross_sector_disabled guard into PvP raid targeting and w18-pvp-diplomacy scenario | sim | S | H | W18-02, W11-41, W11-04 | Boot w18-pvp-diplomacy → rival colonies co-seat inside the active R=48 founding sector; cross-sector raid orders reject with cross_sector_disabled | W11 handoff, SIM §7.7 | — |
| W18-32 | Route W18 AI-issued raids and away truce responses through W16 checkDirectorActionPermission, aggression skill adapter, and SectorAdvisor threat scoring | sim | S | H | W18-15, W18-16, W16-34, W16-38 | AI directive proposes raid with awayRaids=false or truce cancel while away -> rejected by checkDirectorActionPermission; enabled W18 + awayRaids=true permits eligible raid targets and truce accept | AI §4, §6, UO-DIP-05, AW-11 | — |
| W18-33 | Wire W09 AlertRouter (under_attack/colony_critical/colony_eliminated/truce_offered), AwayDigestStore attack/loss folding, and awayPolicy into W18 PvP and truces | server | S | H | W18-09, W18-15, W18-16, W18-17, W09-10, W09-15, W09-19, W09-21 | Raid an away colony and offer a truce -> AlertRouter debounces under_attack and routes truce_offered/colony_critical/colony_eliminated to MockNotifier, and AwayDigestStore records the raid and losses on rejoin | CT-30..38, AW-11, UO-DIP-05, W09 handoff | — |
| W18-29 | Wave e2e `tests/e2e/w18.spec.ts` + scenario `w18-pvp-diplomacy` + tag `wave-18` | test | M | H | all W18 | `npm run e2e -- --waves ..18` → the demo story passes (incl. the seat-refill check of step 3), and every earlier suite passes | PRODUCT_WAVES §3 | — |

## Wave DoD

- `tests/e2e/w18.spec.ts` and all earlier suites pass.
- The scenario loads.
- With the flag off: no raid or truce commands and no shield UI. A Hub loss only makes the colony critical; there is no elimination, ruins or reprint.
- AC-06, AC-12 and AC-13 pass.
- Tag `wave-18` is created.

## W12 progression integration gate (revised)

Follow [Progression persistence and delivery](../../spec/PROGRESSION_ENGINE.md). Publish diplomacy, victory and raid facts from authoritative outcomes, with match/raid IDs.

Acceptance: producer-to-profile persistence, replay/restart, concurrent inputs, threshold boundaries, independent queue retries and disabled-wave behavior are covered by unit and PostgreSQL integration tests. New achievement conditions use catalogue configuration; new event semantics use registered producers. Keep earned achievements and lifetime statistics across colony transitions. ME opens in a new tab from authenticated landing/selection only; the hub's W12 mock is explicit.

## Vertical Slice Testing, Full-Game Integration & Mock/Real Switch Gates

1. **Tier-1 Vertical Slice Scope (`S0–S4` Only):**
   - `W14` (walls/gates), `W17` (Tier 2), `W19` (Tier 3), and `W24` (Mobile) are **POSTPONED**. All PvP raids, depot siphoning, newcomer shields, HQ reprints, colony critical/elimination transitions, and diplomacy truces operate 100% on Tier-1 units (`robot.recon`, `worker`), Tier-1 buildings (`building.hq`, `building.hub.basic`, `building.turret.laser`, T1 storage/extractors), and Tier-1 resources (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`).
2. **Unit & Integration Test Matrix (Positive / Negative / Corner):**
   - **Unit (`*.spec.ts`):** newcomer shield expiration (by stage, 6 h clock, or initiating an offensive raid), foreign-territory `attackMove` & W07 `moveGroup` flow-field integration (`W18-30`), depot siphon rates & storage-cap clamping, truce eligibility (`recent_hostility` within 10 min, both HQs alive), 10-min truce cancellation notice + 24 h `Oathbreaker` mark, and `W09` away policy (`awayRaids=false` blocks AI raids, AI may accept/propose truces but never cancel).
   - **Integration (`*.int.spec.ts`):** multi-colony `SimHost` + `PlanetHost` full raid → HQ kill → Basic Hub HQ reprint → Hub kill → `colonyCritical` (10 min timer) → `colonyEliminated` → ruin decay (1% HP/s) → `W11` persistent sector living-count update (`W18-29`) and `W09` `under_attack`/`colony_critical`/`colony_eliminated`/`truce_offered` notifications (`W18-17`).
3. **Full Game Integration + Online Server E2E (`tests/e2e/w18.spec.ts`):**
   - Multi-browser-context Playwright E2E against the live NestJS server + Postgres + `PlanetHost` worker + WS diff stream + `?host=local` parity + `TA_WAVES=..17` flag-off check.
