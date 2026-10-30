# W18 — PvP & Diplomacy

> **Track:** Gameplay (G) · **Flag:** `W18` · **Tag:** `wave-18` · **Scenario:** `scenarios/w18-pvp-diplomacy.ts` (5 colonies on one planet, with the shield states and armies below) · **E2E:** `e2e/w18.spec.ts`
> **Depends on waves:** W07 (battle v1, combat units, `attackMove`), W11 (planets with several colonies, seat refill), W09 (away policy, notification routing, the `colonyCritical` / `colonyEliminated` events). Optional: W04 (map layer for shields), W08 (HQ goals), W14 (gates as raid path targets), W16 (AI director accept), W24 (touch).
> **Specs:** [units spec](../../game/units-orders-and-progression-spec.md) `UO-W-08`, `UO-T-05`, `UO-HQ-04`, `UO-TF-05`, `UO-DIP-01..06`, AC-06, AC-12, AC-13 · [SIMULATION](../../spec/SIMULATION.md) §7.7 · [CONTINUITY](../../spec/CONTINUITY.md) `AW-11`, `AW-13`, §5a · [MATCHMAKING](../../spec/MATCHMAKING.md) `MM-05` · D-17, D-28, D-31
> **Owned paths:** `shared/sim/src/systems/{pvp,elimination,diplomacy}/`, `shared/sim/src/data/diplomacy.ts`, `shared/contracts/src/{commands,events}/{pvp,diplomacy}.ts`, `frontend/game/features/{raid,diplomacy,colony-status}/`, the ruin variant in `frontend/render/visuals/UnifiedColonyMaterial.ts`

## Goal

Colonies on the same planet can fight and make peace. Players raid each other with army groups, newcomers are shielded, a colony can be pushed to `critical` and eliminated, the HQ can be reprinted, and HQ drones negotiate truces with a notice period and an Oathbreaker mark. Every rule lives in `@terra/sim` (D-31); the server only forwards events to the lobby and the notifier.

## Demo story (e2e)

1. Load `?scenario=w18`: A at S6 with an army, B at S6 without a shield. Order Raid Colony on B. → The army attack-moves into B's territory and turrets engage. Combat units next to B's depot siphon resources into A.
2. Switch to colony C, aged 1 h at S3. → The Raid Colony goal is greyed with "newcomer shield: 5 h left" and the command is rejected `raid_protected`.
3. Kill B's HQ drone (dev). → B's Hub reprints the HQ (90 s, top of the Units lane). Destroy B's Hub. → B becomes `critical` with a 10-min re-establish timer. Destroy the re-printed HQ too. → B is eliminated, its buildings become ruins, and the lobby frees the seat if the planet is under 2 h old (W11-16).
4. From A, open Negotiate on D and offer a 6 h truce. D accepts. → A's attack-move into D's territory is rejected `truce_active`, and neither colony's units fire at the other's.
5. A cancels. → A 10-min notice starts while the truce still holds, and A's HQ card shows "Oathbreaker 24 h".
6. D, now away with AI allowed, receives a truce offer from E. → The director accepts it (W16 on; with W16 off the dev console `offerTruce` + an `ai.directive` fixture stands in).
7. Set `TA_WAVES=..17` → no raid or truce UI; a Hub loss only makes the colony critical.

## Features covered

| Spec item | Issues |
|---|---|
| Raid task / Raid Colony goal (`enqueueTask raid`, attack-move into foreign territory, pathing to gates) (`UO-W-08`, SIM §7.7) | W18-02, W18-03, W18-04 |
| Siphon at foreign Depot / Hub, 1 unit/s per sub-resource held (D-34), capped by attacker storage (proposed) | W18-05 |
| Newcomer shield until `threatStage ≥ S6` or 6 h; ends on own raid (`UO-T-05`, AC-06) | W18-06 |
| `raid_protected` / `truce_active` / `recent_hostility` / `oathbreaker` rejection codes | W18-01, W18-06, W18-11 |
| HQ reprint at Hub (cost/time per tier, top of Units lane, pauses T2+ construction) (`UO-HQ-04`) | W18-07 |
| Colony critical (Hub destroyed, 10 min to rebuild, auto goal "Re-establish"), Hub-site exception for unclaimed tiles (`UO-HQ-04`, `UO-TF-05`) | W18-08 |
| Elimination: both destroyed or timer ends → ruins (owner −1, 1 % HP/s decay), tile grace revert, `colonyEliminated` | W18-09 |
| Seat-refill on elimination: W11-16 already consumes `colonyEliminated` from the bus (MM-05 2 h window); this wave's e2e step 3 asserts it (W18-10 dropped) | W18-29 |
| Truces `UO-DIP-01` requirements (contact, both HQs alive, no damage in 10 min) | W18-11 |
| `UO-DIP-02` terms (2/6/24/72 h, capped by HQ tier; active truces 1/2/4; offer expiry 10 min) | W18-12 |
| `UO-DIP-03` effects (no auto-target, raid/attack-move rejected; partners pass `openToPartners` gates when W14 is on) | W18-13 |
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
| W18-01 | Contracts: `raid` task, `diplomacy.proposeTruce/respondTruce/cancelTruce`, events `raidStarted/Repelled`, `truceOffered/Signed/Notice/Ended` (`colonyCritical` / `colonyEliminated` are reused from W09-01), reject codes `raid_protected`/`truce_active`/`recent_hostility`/`oathbreaker`, truce state schema; flag `W18` | contract | M |  | W07-01, W09-01 | Run `npm test -w @terra/contracts` → the new kinds parse strictly, and with `TA_WAVES=..17` a `raid` command is rejected `wave_disabled` | SIM §4, PROTOCOL, `UO-DIP` | TA-06.11, TA-14.6 |
| W18-02 | Sim: raid task — select idle combat units, form army group, path to target colony | sim | M |  | W18-01 | Enqueue raid on colony B → all idle combat units of A get a group id and move toward B | SIM §7.7 | TA-06.11 |
| W18-03 | Sim: extend W07-12's `attackMove` to targets inside a foreign colony's territory (engage that colony's units and buildings on the way, stop at the target) | sim | S |  | W18-02, W07-12 | Attack-move to a tile in B → units stop to kill a B turret on the path, then continue | `UO-W-08` | TA-06.11 |
| W18-04 | Sim: raid pathing into walled colonies calls W14-11's shared gate-pathing helper when W14 is on (no second gate pathfinder); with W14 off it falls back to the nearest structure | sim | S |  | W18-03 | Raid a walled colony → path ends at its gate; without walls → at nearest building | `UO-W-08` | TA-06.11 |
| W18-05 | Sim: siphon from foreign Depot/Hub at 1 unit/s per sub-resource B holds (`ResourceKey`, D-34; data row), attacker family-cap-limited | sim | S |  | W18-03 | Park 2 Recons beside B's depot for 10 s → A gains 20 of each sub-resource B holds, B loses 20 | SIM §7.7 | TA-06.11 |
| W18-06 | Sim: newcomer shield `raidProtectedUntil` (S6 or 6 h), dropped on own raid; reject `raid_protected` | sim | S |  | W18-02 | Raid a 1 h S3 colony → `cmd.rejected raid_protected`; that colony raids someone → its shield ends | `UO-T-05` | TA-14.5 |
| W18-07 | Sim: HQ reprint at Hub (T1 200/100/50/50 60 s · T2 500/300/150/100 90 s · T3 1 200/800/400/300 150 s), jumps queues, pauses T2+ builds | sim | M |  | W18-01 | Kill HQ (dev) → Units lane shows "HQ reprint" first; after 60 s the HQ reappears at the Hub | `UO-HQ-04` | TA-14.2 |
| W18-08 | Sim: colony critical on Hub loss — 10 min timer, auto goal "Re-establish", Hub placement allowed on unclaimed tiles | sim | M |  | W18-07 | Destroy Hub → colony state `critical`, banner timer 10:00, HQ can place a new Hub on unclaimed land | `UO-HQ-04`, `UO-TF-05` | TA-06.11 |
| W18-09 | Sim: elimination → ruins (owner −1, 1 % HP/s decay, anchors removed with grace), `colonyEliminated` | sim | M |  | W18-08 | Destroy Hub and HQ → colony `eliminated`, buildings turn neutral and lose 1 % HP/s, tiles revert after grace | SIM §7.7 | TA-06.11 |
| W18-11 | Sim: truce offer — requirements (contact, HQs alive, no hostility 10 min), reject `recent_hostility` | sim | M |  | W18-01 | Propose a truce 2 min after a skirmish → `recent_hostility`; after 10 min → offer created | `UO-DIP-01` | TA-14.6 |
| W18-12 | Sim: truce terms — lengths 2/6/24/72 h capped by HQ tier, active caps 1/2/4, offer expiry 10 min | sim | S |  | W18-11 | HQ T1 offers 24 h → rejected; 6 h accepted; a second active truce at T1 → rejected | `UO-DIP-02` | TA-14.6 |
| W18-13 | Sim: truce effects — no auto-target between partners; raid/attack-move into partner territory rejected `truce_active`; with W14 on, partner units pass Wall Gates whose `openToPartners` (W14-12) is set, and W14-16's toggle is shown | sim | M |  | W18-12 | With a truce, partner units pass in range of turrets → no shots; attack-move into partner → rejected | `UO-DIP-03`, AC-12 | TA-14.6 |
| W18-14 | Sim: cancel → 10-min notice (truce holds), Oathbreaker 24 h (no proposing), expiry gives no mark | sim | S |  | W18-13 | Cancel a truce → `truceNotice` with 10:00; after it, `truceEnded`; canceller has `oathbreakerUntil = +24 h` | `UO-DIP-04` | TA-14.6 |
| W18-15 | Sim/away policy: AI may propose/accept while away, never cancel (adds truce rules to W09-10's `awayPolicy` deny table) | sim | S |  | W18-14, W09-10 | Away colony with AI on gets an offer → accepted; directive "cancel truce" → rejected `away_policy` | `UO-DIP-05`, AC-13 | TA-08.6 |
| W18-16 | Sim: route AI-issued `raid` tasks through W09-10's `awayPolicy` (`AW-11`, the `awayRaids` setting of W09-01/W09-14); player raids stay exempt | sim | S |  | W18-02, W09-10 | Away with `awayRaids=false`, an AI directive `raid` → rejected `away_policy`; with `awayRaids=true` → the raid starts | D-17, `AW-11` | TA-08.6 |
| W18-17 | Server: map PvP/diplomacy events to the `NotificationKind`s W09-21 already routes (`under_attack`, `colony_critical`, `colony_eliminated`, `truce_offered`) | server | S |  | W18-09, W18-14, W09-21 | Raid an offline player's colony → the mock notifier holds one `under_attack` row within 60 s | D-17, CONTINUITY §5a `CT-36` | TA-08.7 |
| W18-18 | Achievement progress events: `warlord` (enemy units destroyed in PvP), `diplomat` (truce kept to term, never broken by you) | sim | S |  | W18-03, W18-14 | Kill 10 PvP units → progression receives 10 `warlord` increments; truce expires on term → `diplomat` +1 | player spec §3 | — |
| W18-19 | Client: raid targeting — Raid Colony goal card, target colony picker, attack-move cursor into foreign land | client | M |  | W18-03 | Pick colony B in the goal card → army highlights and a red path line to B appears | units §4.6 | TA-14.8 |
| W18-20 | Client: truce panel in HQ card — offer (length chips), incoming offers with timer, active truces, notice countdown, Oathbreaker badge | client | M |  | W18-14 | Offer 6 h to D → D sees a card with Accept/Decline and a 10:00 expiry | `UO-DIP` | TA-14.8 |
| W18-21 | Client: critical banner + re-establish timer + HQ reprint progress in Units lane | client | S |  | W18-08 | Destroy Hub → red banner "Colony critical 9:59" and Re-establish goal card | `UO-HQ-04` | TA-14.8 |
| W18-22 | Visual: ruin variant (desaturate, cracks, decay alpha) as a mode of the existing unified colony material (`frontend/render/visuals/UnifiedColonyMaterial.ts`), so every kitbash building gets it; `?ruin=1` toggle in the playground | visual | S |  | — | Open `/playground.html?inspect=building.solar&ruin=1` → the model renders desaturated and cracked in all 4 views | Pillar 3 | — |
| W18-23 | Client: shield layer on the global map (registers with W04-15's layer registry) + shield chip on the colony card (icon + hours left) | client | S |  | W18-06, W04-15 | Hover a shielded colony on the global map → "Newcomer shield 5 h" | `UO-T-05` | — |
| W18-24 | Analytics: `raid_started`, `colony_eliminated`, `truce_signed`, `truce_broken` | client | S |  | W00-44 | Run the demo → 4 events recorded | CLIENT §10 | — |
| W18-25 | Dev console: `killHq`, `killHub`, `setShield <h>`, `offerTruce <colony> <h>` | client | S |  | W00-40 | `killHub` → colony goes critical immediately | PRODUCT_WAVES §3 | — |
| W18-26 | Touch: truce panel and raid picker usable in phone landscape | client | S |  | W24-11 | On 844×390, accept a truce by tap → works without hover | D-22 | — |
| W18-27 | Tests: shield property (AC-06), truce no-damage (AC-12), away never cancels (AC-13), elimination timer | test | M |  | W18-06, W18-13, W18-15 | `npm run test -w @terra/sim -- pvp` → all four specs pass | AC-06, AC-12, AC-13 | TA-13.x |
| W18-28 | Test: raid → siphon → repel flow with deterministic seed; ruins decay | test | S |  | W18-05, W18-09 | Unit test asserts resource deltas and ruin HP after 100 s | SIM §7.7 | — |
| W18-29 | Wave e2e `e2e/w18.spec.ts` + scenario `w18-pvp-diplomacy` + tag `wave-18` | test | M |  | all W18 | `npm run e2e -- --waves ..18` → the demo story passes (incl. the seat-refill check of step 3), and every earlier suite passes | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w18.spec.ts` and all earlier suites pass.
- The scenario loads.
- With the flag off: no raid or truce commands and no shield UI. A Hub loss only makes the colony critical; there is no elimination, ruins or reprint.
- AC-06, AC-12 and AC-13 pass.
- Tag `wave-18` is created.
