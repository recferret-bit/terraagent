# W18 — PvP & Diplomacy

**Goal.** Colonies on the same planet can fight and make peace. Players raid each other with army groups, newcomers are shielded, a colony can be pushed to `critical` and eliminated, the HQ can be reprinted, and HQ drones negotiate truces with a notice period and an Oathbreaker mark.

**Demo story.**
1. Load the two-colony scenario: A at S6 with an army, B at S6 without a shield. Order Raid Colony on B. → The army attack-moves into B's territory and turrets engage. Combat units next to B's depot siphon resources into A.
2. Switch to colony C, aged 1 h at S3. → The Raid Colony goal is greyed with "newcomer shield: 5 h left" and the command is rejected `raid_protected`.
3. Kill B's HQ drone (dev). → B's Hub reprints the HQ (90 s, top of the Units lane). Destroy B's Hub. → B becomes `critical` with a 10-min re-establish timer. Destroy the re-printed HQ too. → B is eliminated, its buildings become ruins, and the seat-refill hook fires.
4. From A, open Negotiate on D and offer a 6 h truce. D accepts. → A's attack-move into D's territory is rejected `truce_active`, and neither colony's units fire at the other's.
5. A cancels. → A 10-min notice starts while the truce still holds, and A's HQ card shows "Oathbreaker 24 h".
6. D, now away with AI allowed, receives a truce offer from E. → The director accepts it.

**Depends on:** W07 (battle v1, combat units), W11 (planets with several colonies, seat refill window). Optional: W08 (HQ goals), W09 (away mode, notifications), W14 (gates as raid path targets), W16 (AI director accept).
**Track:** Gameplay (G). **Owned paths:**
- `shared/sim/src/systems/{pvp,elimination,diplomacy}/`
- `shared/sim/src/data/diplomacy.ts`
- `client/src/features/{raid,diplomacy,colony-status}/`

**Flag:** `W18` · **Scenario:** `scenarios/w18-pvp-diplomacy.ts` (5 colonies on one planet, with the shield states and armies above) · **Tag:** `wave-18`

## Features covered

| Spec item | Issues |
|---|---|
| Raid task / Raid Colony goal (`enqueueTask raid`, attack-move into foreign territory, pathing to gates) (`UO-W-08`, SIM §7.7) | W18-02, W18-03, W18-04 |
| Siphon at foreign Depot / Hub, 1 unit/s per resource, capped by attacker storage (proposed) | W18-05 |
| Newcomer shield until `threatStage ≥ S6` or 6 h; ends on own raid (`UO-T-05`, AC-06) | W18-06 |
| `raid_protected` / `truce_active` / `recent_hostility` / `oathbreaker` rejection codes | W18-01, W18-06, W18-11 |
| HQ reprint at Hub (cost/time per tier, top of Units lane, pauses T2+ construction) (`UO-HQ-04`) | W18-07 |
| Colony critical (Hub destroyed, 10 min to rebuild, auto goal "Re-establish"), Hub-site exception for unclaimed tiles (`UO-HQ-04`, `UO-TF-05`) | W18-08 |
| Elimination: both destroyed or timer ends → ruins (owner −1, 1 % HP/s decay), tile grace revert, `colonyEliminated` | W18-09 |
| Seat-refill hook on elimination (W11 owns the lobby rule MM-05 2 h window) | W18-10 |
| Truces `UO-DIP-01` requirements (contact, both HQs alive, no damage in 10 min) | W18-11 |
| `UO-DIP-02` terms (2/6/24/72 h, capped by HQ tier; active truces 1/2/4; offer expiry 10 min) | W18-12 |
| `UO-DIP-03` effects (no auto-target, raid/attack-move rejected) | W18-13 |
| `UO-DIP-04` breaking (10-min notice, Oathbreaker 24 h, visible mark) | W18-14 |
| `UO-DIP-05` away: AI may propose/accept, never cancel; cancel is player-only | W18-15 |
| `UO-DIP-06` planet-local state, no NEAR saga | W18-01 |
| AI raid opt-in per colony, default off (D-17, `AW-11`) | W18-16 |
| Events consumed by W09 notifications: `underAttack`, `colonyCritical`, `colonyEliminated`, `raidStarted/Repelled`, `truceOffered/Signed/Notice/Ended` | W18-17 |
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
| W18-01 | Contracts: `raid`, `attackMove` into foreign territory, `diplomacy.proposeTruce/respondTruce/cancelTruce`, events listed above, reject codes, truce state schema; flag `W18` | contract | M |  | W07-01 | `npm run contracts:check` → new kinds validate; `TA_WAVES=..17` rejects them with `wave_disabled` | SIM §4, PROTOCOL, `UO-DIP` | TA-06.11, TA-14.6 |
| W18-02 | Sim: raid task — select idle combat units, form army group, path to target colony | sim | M |  | W18-01 | Enqueue raid on colony B → all idle combat units of A get a group id and move toward B | SIM §7.7 | TA-06.11 |
| W18-03 | Sim: attack-move into foreign territory (engage hostiles on the way, stop at target) | sim | M |  | W18-02 | Attack-move to a tile in B → units stop to kill a B turret on the path, then continue | `UO-W-08` | TA-06.11 |
| W18-04 | Sim: closed-wall raid pathing targets nearest Wall Gate (works without W14: falls back to nearest structure) | sim | S |  | W18-03 | Raid a walled colony → path ends at its gate; without walls → at nearest building | `UO-W-08` | TA-06.11 |
| W18-05 | Sim: siphon from foreign Depot/Hub at 1 unit/s/resource, attacker cap-limited | sim | S |  | W18-03 | Park 2 Recons beside B's depot for 10 s → A gains 20 of each resource, B loses 20 | SIM §7.7 | TA-06.11 |
| W18-06 | Sim: newcomer shield `raidProtectedUntil` (S6 or 6 h), dropped on own raid; reject `raid_protected` | sim | S |  | W18-02 | Raid a 1 h S3 colony → `cmd.rejected raid_protected`; that colony raids someone → its shield ends | `UO-T-05` | TA-14.5 |
| W18-07 | Sim: HQ reprint at Hub (T1 200/100/50/50 60 s · T2 500/300/150/100 90 s · T3 1 200/800/400/300 150 s), jumps queues, pauses T2+ builds | sim | M |  | W18-01 | Kill HQ (dev) → Units lane shows "HQ reprint" first; after 60 s the HQ reappears at the Hub | `UO-HQ-04` | TA-14.2 |
| W18-08 | Sim: colony critical on Hub loss — 10 min timer, auto goal "Re-establish", Hub placement allowed on unclaimed tiles | sim | M |  | W18-07 | Destroy Hub → colony state `critical`, banner timer 10:00, HQ can place a new Hub on unclaimed land | `UO-HQ-04`, `UO-TF-05` | TA-06.11 |
| W18-09 | Sim: elimination → ruins (owner −1, 1 % HP/s decay, anchors removed with grace), `colonyEliminated` | sim | M |  | W18-08 | Destroy Hub and HQ → colony `eliminated`, buildings turn neutral and lose 1 % HP/s, tiles revert after grace | SIM §7.7 | TA-06.11 |
| W18-10 | Server: seat-refill hook — publish `colonyEliminated` to lobby (W11 applies 2 h window) | server | S |  | W18-09, W11-03 | Eliminate a colony on a 1 h-old recruiting planet → lobby marks one seat refillable | MM-05 | TA-05.7 |
| W18-11 | Sim: truce offer — requirements (contact, HQs alive, no hostility 10 min), reject `recent_hostility` | sim | M |  | W18-01 | Propose a truce 2 min after a skirmish → `recent_hostility`; after 10 min → offer created | `UO-DIP-01` | TA-14.6 |
| W18-12 | Sim: truce terms — lengths 2/6/24/72 h capped by HQ tier, active caps 1/2/4, offer expiry 10 min | sim | S |  | W18-11 | HQ T1 offers 24 h → rejected; 6 h accepted; a second active truce at T1 → rejected | `UO-DIP-02` | TA-14.6 |
| W18-13 | Sim: truce effects — no auto-target between partners; raid/attack-move into partner territory rejected `truce_active` | sim | M |  | W18-12 | With a truce, partner units pass in range of turrets → no shots; attack-move into partner → rejected | `UO-DIP-03`, AC-12 | TA-14.6 |
| W18-14 | Sim: cancel → 10-min notice (truce holds), Oathbreaker 24 h (no proposing), expiry gives no mark | sim | S |  | W18-13 | Cancel a truce → `truceNotice` with 10:00; after it, `truceEnded`; canceller has `oathbreakerUntil = +24 h` | `UO-DIP-04` | TA-14.6 |
| W18-15 | Sim/away policy: AI may propose/accept while away, never cancel (`AW-13/14` extension) | sim | S |  | W18-14, W09-09 | Away colony with AI on gets an offer → accepted; directive "cancel truce" → rejected `away_policy` | `UO-DIP-05`, AC-13 | TA-08.6 |
| W18-16 | Sim/server: AI raid opt-in per colony (default off), setting persisted; away raids rejected unless on | sim | S |  | W18-02, W09-09 | Away with opt-in off, AI directive raid → rejected `away_policy`; toggle on → raid starts | D-17, `AW-11` | TA-08.6 |
| W18-17 | Events to notify module: map PvP/diplomacy events to notification kinds with debounce | server | S |  | W18-09, W18-14, W09-21 | Raid an offline player's colony → mock notifier receives one "under attack" within 60 s | D-17, CONTINUITY §5a | TA-08.7 |
| W18-18 | Achievement progress events: `warlord` (enemy units destroyed in PvP), `diplomat` (truce kept to term, never broken by you) | sim | S |  | W18-03, W18-14 | Kill 10 PvP units → progression receives 10 `warlord` increments; truce expires on term → `diplomat` +1 | player spec §3 | — |
| W18-19 | Client: raid targeting — Raid Colony goal card, target colony picker, attack-move cursor into foreign land | client | M |  | W18-03 | Pick colony B in the goal card → army highlights and a red path line to B appears | units §4.6 | TA-14.8 |
| W18-20 | Client: truce panel in HQ card — offer (length chips), incoming offers with timer, active truces, notice countdown, Oathbreaker badge | client | M |  | W18-14 | Offer 6 h to D → D sees a card with Accept/Decline and a 10:00 expiry | `UO-DIP` | TA-14.8 |
| W18-21 | Client: critical banner + re-establish timer + HQ reprint progress in Units lane | client | S |  | W18-08 | Destroy Hub → red banner "Colony critical 9:59" and Re-establish goal card | `UO-HQ-04` | TA-14.8 |
| W18-22 | Visual: ruin material variant (desaturate, cracks, decay alpha) for any kitbash building | visual | S |  | — | Eliminate a colony → buildings render as ruins and fade over time; playground `?ruin=1` audit OK | Pillar 3 | — |
| W18-23 | Client: shield indicator on colony cards and minimap (shield icon + hours left) | client | S |  | W18-06, W04-05 | Hover a shielded colony on the global map → "Newcomer shield 5 h" | `UO-T-05` | — |
| W18-24 | Analytics: `raid_started`, `colony_eliminated`, `truce_signed`, `truce_broken` | client | S |  | W00-44 | Run the demo → 4 events recorded | CLIENT §10 | — |
| W18-25 | Dev console: `killHq`, `killHub`, `setShield <h>`, `offerTruce <colony> <h>` | client | S |  | W00-40 | `killHub` → colony goes critical immediately | PRODUCT_WAVES §3 | — |
| W18-26 | Touch: truce panel and raid picker usable in phone landscape | client | S |  | W24-11 | On 844×390, accept a truce by tap → works without hover | D-22 | — |
| W18-27 | Tests: shield property (AC-06), truce no-damage (AC-12), away never cancels (AC-13), elimination timer | test | M |  | W18-06, W18-13, W18-15 | `npm run test -w @terra/sim -- pvp` → all four specs pass | AC-06, AC-12, AC-13 | TA-13.x |
| W18-28 | Test: raid → siphon → repel flow with deterministic seed; ruins decay | test | S |  | W18-05, W18-09 | Unit test asserts resource deltas and ruin HP after 100 s | SIM §7.7 | — |
| W18-29 | Wave e2e `e2e/w18.spec.ts` + scenario `w18-pvp-diplomacy` + tag `wave-18` | test | M |  | all W18 | `npm run e2e -- --waves ..18` passes the demo; `TA_WAVES=..17` hides raid/truce UI | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w18.spec.ts` and all earlier suites pass.
- The scenario loads.
- With the flag off: no raid or truce commands and no shield UI. A Hub loss only makes the colony critical; there is no elimination, ruins or reprint.
- AC-06, AC-12 and AC-13 pass.
- Tag `wave-18` is created.
