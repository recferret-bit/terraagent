# W08 — Stages & HQ Goals

> **Track:** Autonomy (P) · **Flag:** `W08` · **Tag:** `wave-08` · **Scenario:** `scenarios/w08-stages-goals.ts` · **E2E:** `e2e/w08.spec.ts`
> **Depends on waves:** W02 (spine). Stage rows for later stages light up as their producer waves land (W03, W05, W07, W14, W17, W19, W21). Rows whose wave flag is off are hidden. Optional: W07 (W08-18's Defend Area / Clear Nest breakdown uses W07-01's units and nests).
> **Specs:** [units spec](../../game/units-orders-and-progression-spec.md) §4.6 (`UO-G-*`), §6 (`UO-LC-*`, stage table, `UO-T-*`), §7 row 8 · [SIMULATION](../../spec/SIMULATION.md) §8 (`SIM-R-01..06`) · [CONTINUITY](../../spec/CONTINUITY.md) `AW-06`, `AW-20` · D-16, D-27
> **Owned paths:** `shared/sim/src/systems/{progression,goals,rule-engine}/`, `shared/sim/src/data/{stages,goals}.ts`, `shared/contracts/src/{commands,events}/{progression,goals}.ts`, `frontend/game/features/{stages,goals,priorities}/` (the stage track and goals panel plug into the existing HUD `frontend/game/ui/hud.ts` through the W00-27 feature registry), `backend/app/src/progression/stage-*` + `prisma/progression-stage.prisma` (account `maxStage` only; the rest of `progression/` is W12's)

## Goal

The colony teaches itself. A data-driven **stage engine** (S0–S10) unlocks content one mechanic at a time, using triggers, minimum dwell times and safety overrides. Each stage offers a one-click **suggestion card**, which queues an **HQ goal**. The HQ breaks goals into budgeted orders. The **rule-engine autopilot** follows the player's priority sliders and only automates lanes the player has already learned.

## Demo story (e2e)

1. Open `/play.html?scenario=w08` (a fresh colony at S0) → see the stage track at **S0 Landfall** and a suggestion card "Establish Colony".
2. Accept the card (or add it from the HQ Goals menu) → see the goal "Establish Colony" in the HQ Goals panel with a progress bar, and the HQ preparing the Hub site.
3. The Hub completes → see the toast "S1 First Light", plus Harvester, Metals Extractor and Solar becoming un-greyed in the menus. Locked items show "Unlocks at S2: extractor + generator complete · 2 min".
4. Dev console `warp 20` until the extractor and generator are done and 2 min have passed → see S2. Dwell is enforced: dev console `stage skip-dwell` is needed to go faster.
5. Autopilot panel: move the **expansion** slider to 80, then run `autopilot next` in the dev console → see the suggestion change toward beacons. At S2 the autopilot only *suggests* power builds (`UO-LC-05`); at S3 it starts adding `auto` orders.
6. Dev console `stage trigger <override>` with the S3 fauna override (`help stage` lists the names) → the S3 override fires before the dwell ends; see "S3 First Contact".
7. Open `/me.html` in the same browser → the **Ascendant** progress counter moves (W12 consumer; "coming soon" if W12 is off).
8. Run `TA_WAVES=..07 npm run dev:restart` and reload `/play.html?scenario=w08` (or add `&waves=..07`) → no stage track, no goals panel, no sliders; the colony still plays.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1 (add "Establish Colony" from the HQ Goals menu instead of a suggestion card), 2–4, 5 (the autopilot's suggestion is read with the dev console `autopilot next`, since suggestion cards are H+), 8. `W08-33` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** suggestion cards, the fauna override (step 6), Ascendant (step 7), Defend/Clear/Expand/Tech Up goal breakdowns, autopilot limits test.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Spec item | Issues |
|---|---|---|
| 1 | Stage table S0–S10 as data (trigger, dwell, teaches, units, buildings/orders, target time, suggested goal, wave tag) | W08-01, W08-02 |
| 2 | Trigger evaluation + minimum dwell (`UO-LC-02`) | W08-03, W08-04 |
| 3 | Safety override: fauna within 15 tiles → S3 (`UO-LC-04`). The S8 air override is W19-14; Hub T2 orderable after 8 min in S4 is W17-02 | W08-05 |
| 4 | `unlockStage` per account, inherited by new colonies (`UO-LC-06`) | W08-06, W08-07 |
| 5 | `threatStage` per colony from gating buildings (`UO-T-06`), exposed to raids, meteors and the newcomer shield | W08-08, W08-09 |
| 6 | `stage_locked` rejection for commands above `unlockStage` | W08-10 |
| 7 | Menus show locked next-stage items greyed out with the unlock condition (`UO-M`) | W08-11 |
| 8 | Stage track HUD, stage toast, unlock reveal | W08-12, W08-13 |
| 9 | Suggestion cards per stage (`UO-G-03`) | W08-14, W08-15 |
| 10 | HQ goal queue, limit 2 / 3 / 5 by HQ tier, status, progress | W08-16, W08-21 |
| 11 | Goal breakdown: Establish Colony, Grow Economy, Secure Power | W08-17 |
| 12 | Goal breakdown: Defend Area, Clear Nest (gated by W07; "fortify" by W14) | W08-18 |
| 13 | Goal breakdown: Expand Toward, Terraform Zone, Tech Up (earmark saving) | W08-19 |
| 14 | Goal contracts for Negotiate, Build Army, Raid Colony, Prepare Rocket (bodies in W13 / W17 / W18 / W21) | W08-20 |
| 15 | Goal budgets (`UO-G-01`) on top of the away budget (`AW-20`) | W08-22 |
| 16 | Rule-engine utility AI: needs, slider weighting, floors, deterministic site selection (`SIM-R-01..03, 05`) | W08-23, W08-24 |
| 17 | "Learn by hand, then automate": suggest-only until one stage after a lane is introduced (`UO-LC-05`) | W08-25 |
| 18 | Autopilot limits: completes S0–S4 alone, tier upgrades need the player (`UO-LC-07`). Hub auto-placement is W01-18 | W08-26 |
| 19 | Canonical priority sliders `economy, expansion, defense, power, terraform` (units spec §7 row 8) | W08-01, W08-27 |
| 20 | Stage-scaled threat inputs for raids (`UO-T-01..03`) and meteors (`UO-T-07`), used by W05 / W07 | W08-09 |
| 21 | Ascendant achievement events | W08-28 |
| 22 | Analytics `stage_reached` funnel (CLIENT §10.3, AC-08) | W08-29 |
| 23 | Stage lint: ≤ 1 mechanic and ≤ 2 unit types per stage (`AC-05`) | W08-31 |
| 24 | AC-03: an unattended colony reaches S4 alone and holds there | W08-32 |
| 25 | Dev console: set stage, skip dwell, force trigger, add goal | W08-30 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W08-01 | Contracts: stage, goal and priority commands and events, flag `W08` | contract | M | H | W02-01 | Import `@terra/contracts`, parse `queueGoal`, `cancelGoal`, `reorderGoal`, `acceptSuggestion`, `setPriorities{economy,expansion,defense,power,terraform}`, and events `stageReached`, `stageUnlocked`, `suggestionOffered`, `goalProgress`, `goalDone` → valid samples pass, unknown keys fail (strict) | §4.6, §7 row 8 | TA-14.5, TA-06.7 |
| W08-02 | Data table `stages.ts`: table shape + trigger DSL and the S0–S4 rows (dwell, unlock lists, suggested goal, `wave` tag); S5–S7 rows are W17-16's, S8–S10 W19-15's | data | M | H | W08-01 | `compileData()` with `TA_WAVES=..08` → S0–S4 rows are present, S5+ rows are absent; snapshot test equals the §6.2 table | §6.2 | TA-14.1 |
| W08-03 | Sim: trigger evaluator (built X, owns Y, unit count, time since stage), once per game second per colony | sim | M | H | W08-02 | Unit test: colony with a completed extractor + generator after 2 min → `stageReached S2` event exactly once | `UO-LC-02` | TA-14.5 |
| W08-04 | Sim: dwell timers, persisted in the snapshot, scaled correctly by coarse `dt` | sim | S | H | W08-03 | Restore a snapshot mid-dwell → the remaining dwell continues; with coarse `dt=5` the stage fires within 1 s of the same game time | `UO-LC-02`, `SIM-D-03` | TA-14.5 |
| W08-05 | Sim: stage-override mechanism + the fauna override (fauna within 15 tiles → S3); the S8 air override is W19-14's | sim | S |  | W08-03 | Dev-spawn a skitter 12 tiles from the Hub at S2 → S3 starts before the dwell ends | `UO-LC-04` | TA-14.5 |
| W08-06 | Sim: `unlockStage` on the colony, set from `spawnColony.unlockStage`, raised by `stageReached` | sim | S | H | W08-03 | Spawn with `unlockStage=5` → S0–S5 items are unlocked at once while `threatStage` stays 0 | `UO-LC-06` | TA-14.5 |
| W08-07 | Server: per-account `maxStage` (table `player_stage` in `prisma/progression-stage.prisma`), raised from `stageReached`, passed to `spawnColony` | server | S | H+ | W08-06 | Reach S3 on planet A, start a colony on planet B → B's colony spawns with `unlockStage=3` | `UO-LC-06` | TA-14.5 |
| W08-08 | Sim: `threatStage` = highest stage whose gating building the colony owns; recomputed on build and destroy | sim | S | H | W08-02 | Destroy the colony's only Factory T1 at S4 → `threatStage` drops to 2 within one step | `UO-T-06` | TA-14.5 |
| W08-09 | Sim: threat API `threatOf(colony)` (raid start floor, size, composition table, meteor floor) for the W05/W07 schedulers | sim | S | H | W08-08 | Unit test: `threatOf` at S3 + 4 min → `raidsAllowed=false`; at S3 + 6 min → size 5; S2 + 9 min → `meteorsAllowed=false` | `UO-T-01..03, 07` | TA-14.5 |
| W08-10 | Sim: command validator rejects items above `unlockStage` with `stage_locked` | sim | S | H | W08-06 | Send `placeBuilding robotics_factory` at S2 → `cmd.reject {code:'stage_locked', unlocksAt:'S3'}` | `SIM-C-02` | TA-14.5 |
| W08-11 | Client: menus show next-stage items greyed out with the unlock condition tooltip (menu registry reads the stage table) | client | M | H | W08-02 | Open the Construction menu at S1 → Builder, Pylon and Depot are greyed with "Unlocks at S2: extractor + generator · 2 min" | `UO-M` | TA-14.8 |
| W08-12 | Client: stage track HUD (11 segments, current stage, next condition, dwell countdown) | client | M | H | W08-03 | At S1 with 1:20 dwell left → the track shows S1 lit, S2 pending, and "1:20" counting down | §6.2 | TA-11.7 |
| W08-13 | Client: stage-reached toast + unlock reveal panel listing new units, buildings and orders | client | S | H | W08-12 | Reach S2 → a toast "S2 The Grid" appears, and its panel lists Builder, Pylon, Capacitor, Wind, Depot, Quarry, Water, Petroleum Well | §6.2 | TA-14.8 |
| W08-14 | Sim: suggestion engine (offers the stage's suggested goal once; re-offers after dismiss + 5 min) | sim | S | H+ | W08-03, W08-16 | Reach S2 → `suggestionOffered{goal:'secure_power'}` once; dismiss → offered again 5 min later | `UO-G-03` | TA-14.6 |
| W08-15 | Client: suggestion card (accept, dismiss, keyboard and touch) | client | S | H+ | W08-14 | Click Accept on "Secure Power" → the card closes and the goal appears in HQ Goals | `UO-G-03` | TA-14.8 |
| W08-16 | Sim: HQ goal model (queue per colony, limit 2 / 3 / 5 by HQ tier, status, params, progress, budget) | sim | M | H | W08-01 | Queue 3 goals with an HQ T1 → the 3rd is rejected `goal_limit`; after HQ T2 refit it is accepted | `UO-G-*`, `UO-HQ` table | TA-14.6 |
| W08-17 | Sim: breakdown for Establish Colony, Grow Economy, Secure Power (`hq`-tagged orders) | sim | M | H | W08-16 | Accept "Secure Power target +10 E/s at night" at S2 → `hq` orders for Wind/Capacitor appear and the goal is done after one night held | §4.6 | TA-14.6 |
| W08-18 | Sim: breakdown for Defend Area and Clear Nest (needs W07 units; "fortify" option needs W14) | sim | M |  | W08-16, W07-01 | With W07 on, accept "Clear Nest" → idle Recon rally and attack the nest; with W07 off the goal is not offered | §4.6 | TA-14.6 |
| W08-19 | Sim: breakdown for Expand Toward, Terraform Zone, Tech Up (earmarks stock until the upgrade is affordable) | sim | M |  | W08-16 | Accept "Tech Up to Hub T2" at S4 + 8 min → stock is earmarked and shown in the HUD; the Hub upgrade order starts when affordable | §4.6, `UO-D-02` | TA-14.6 |
| W08-20 | Contracts + no-op stubs for Negotiate, Build Army, Raid Colony, Prepare Rocket (bodies land in W13 / W17 / W18 / W21) | sim | S |  | W08-16 | With those waves off → the goals are hidden; `queueGoal raid_colony` → `wave_disabled` | §4.6 | TA-14.6 |
| W08-21 | Client: HQ Goals menu (list, add with params, reorder by drag, cancel, progress bar, budget used/limit) | client | M | H | W08-16 | Add "Grow Economy: metals 3/s" → it appears with a progress bar; drag it above another goal → order persists after reload | `UO-M`, §4.6 | TA-14.8 |
| W08-22 | Sim: goal budgets (`UO-G-01`), stacked under the away budget (`AW-20`); defense and repair exempt | sim | S |  | W08-16 | A goal with a 30 % budget never spends more than 30 % of current stock in a test with 100 orders | `UO-G-01`, `AW-20` | TA-14.6 |
| W08-23 | Sim: rule-engine needs scoring (energy, storage, supply, extraction, defense, expand, repair) in bp; the `rocket` need is W21-17's | sim | M | H | W02-01 | Unit test table: a night forecast deficit gives `energy ≥ 6 000 bp`; storage at 90 % gives `storage ≥ 5 000 bp` | `SIM-R-01, 02` | TA-06.7 |
| W08-24 | Sim: slider weighting, repair/defense floor 8 000 bp, deterministic site selection | sim | M | H | W08-23 | Same seed + inputs → identical `auto` orders over 10 runs; `defense=0` still repairs at 8 000 bp | `SIM-R-03, 05` | TA-06.7 |
| W08-25 | Sim: lane automation turns on one stage after the lane's stage; before that, the rule engine emits suggestions only | sim | S | H | W08-23 | At S2 the power need is high → only a suggestion is emitted; at S3 → an `auto` order for Wind is queued | `UO-LC-05` | TA-14.5 |
| W08-26 | Sim: autopilot limits — the rule engine never orders a tier upgrade without a player order or a Tech Up goal (Hub auto-placement is W01-18) | sim | S | H+ | W08-24, W01-18 | Unattended colony warped to S4 + 30 min → no Hub T2 upgrade order is ever queued | `UO-LC-07`, §6.2 S0 | TA-14.5 |
| W08-27 | Client: priority sliders panel (5 canonical, step 10, sum shown) → `setPriorities` | client | S | H | W08-01 | Drag expansion to 80 → `setPriorities` acked and the slider state survives a reload | §7 row 8 | TA-11.7 |
| W08-28 | Server: emit progression events for **Ascendant** (`maxStage` with max semantics) to the progression bus | server | S |  | W08-07 | Reach S5 → the progression bus receives `{family:'tech-ascendant', max:5}`; with W12 on, the Bronze tier unlocks | Profile spec §3 #10 | TA-15.1 |
| W08-29 | Analytics: `stage_reached{stage, seconds}`, `suggestion_accepted`, `goal_created{type}` | client | S |  | W08-13 | Reach S2 with consent on → one `stage_reached` row with the stage time in the analytics table | CLIENT §10.3, AC-08 | TA-14.7 |
| W08-30 | Dev console: `stage set <n>`, `stage skip-dwell`, `stage trigger <override>`, `goal add <type> <params>`, `autopilot next` (top need, and whether it becomes a suggestion or an `auto` order) | client | S | H | W08-03, W08-16, W08-25 | Type `stage set 4` → the colony shows S4 and all S0–S4 items are unlocked | PRODUCT_WAVES §3 | — |
| W08-31 | Test: stage lint (≤ 1 mechanic, ≤ 2 unit types per stage; every row has trigger, dwell, suggested goal) | test | S |  | W08-02 | `npm test stages-lint` passes; adding a third unit to S3 in a fixture fails with a named error | `AC-05`, `UO-LC-01` | TA-14.7 |
| W08-32 | Test: unattended scenario (no input, autopilot only) reaches S4 and holds there for 2 h of game time | test | M |  | W08-26 | `npm run scenario unattended -- --hours 3` → the report shows S4 reached and no Hub T2 order | `AC-03` (as restated), `UO-LC-07` | TA-14.7 |
| W08-33 | Wave e2e + seed scenario `w08-stages-goals` + tag `wave-08` | test | M | H | all W08 | `npm run e2e -- --waves ..08` → the demo story passes, and every earlier wave suite passes | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w08.spec.ts` passes, and `npm run e2e -- --waves ..07` still passes.
- `?scenario=w08` loads a fresh colony at S0 with the stage track visible.
- `TA_WAVES=..07` hides the stage track, goals, suggestions and sliders; commands return `wave_disabled`.
- Tag `wave-08` is created.
- Every row of units spec §6.1, §6.2 and §4.6 that is owned here maps to an issue above.
