# W05 — Shape the Land

> **Track:** Gameplay (G) · **Flag:** `W05` · **Scenario:** `scenarios/w05-shape-the-land.ts` · **Tag:** `wave-05` · **Depends on:** W03
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §4.5 (`UO-TF-01..10`), §5.1 · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §2, §3.1, §3.3 (Hydro), §3.7 (Hazard Shield) · [`SIMULATION.md`](../../spec/SIMULATION.md) §7.5 (`SIM-G-TER`), §7.6, §10 (`SIM-GEN`) · [`textures-shaders-lighting-spec.md`](../../visuals/textures-shaders-lighting-spec.md)
> **Owned paths:** `shared/sim/src/systems/{terraform,territory,weather,hazards}/`, `shared/sim/src/gen/terrain-mix.ts`, `shared/sim/src/data/terraform.ts`, `client/src/features/{terraform,territory,weather}/`, terrain materials, the archetypes below.

## Goal

The colony can **reshape and claim land**:
- the Terraform drone and every terrain op beyond W01's Grade / Clear / Break;
- linked prep on any terrain;
- Living land with Terraform % and its bonuses;
- territory beacons with frozen borders;
- weather, lightning and meteors that create new terrain work.

Both planet types (Temperate, Desert) generate with their terrain mix.

## Demo story (e2e `e2e/w05.spec.ts`)

1. Load `?scenario=w05`: S2 colony, Temperate, a shallow lake and a crater near the Hub.
2. Units lane → order a Terraformer → it appears.
3. Place a Quarry on a slope + crater footprint → the ghost shows the prep bill (Level ×2, Fill ×1, Grade ×4: time, E, M/Min). Confirm → the construction shows `waiting(site: 0/4 tiles prepared)` and a linked terraform order runs. The building starts at 4/4.
4. Brush **Reclaim** over 6 shallow-water tiles → they turn Flat, then Prepared after Grade.
5. Brush **Irrigate → Seed** over 10 Prepared tiles → they turn Living. The HUD shows `Terraform 10 / 412 (2.4 %)`, and a unit on Living tiles moves 10 % faster.
6. Build a Territory Beacon T1 → R 8 is claimed on completion and the border expands.
7. Spawn a second colony via the dev console next to the border → the border is frozen and is never overwritten.
8. Destroy the beacon → its tiles show a 60 s revert countdown, then revert.
9. Start a storm with the dev console → lightning hits a pylon (300 HP). Build a Lightning Rod and the next strike within R 10 is intercepted.
10. Spawn a meteor → radius-2 damage, radius-1 tiles become Hole, and a 30 % chance reveals a new deposit.
11. Night falls while terraforming → terraform ops pause first (`waiting(power)`) and resume at dawn.
12. Generate a Desert planet with `?scenario=w05-desert` → more rock and craters, no forest, oasis water.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–5, 11, 12. `W05-33` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** Territory Beacon and border reverts (steps 6–8), storms, lightning and meteors (steps 9–10), Hydro, Deep Reclaim, the Terraformer archetype (an existing robot stands in), op VFX.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Terraformer drone: Hub T1+, 14 s, 50/30/5/10, supply 1, −2.5 E/s + op energy, terraform 1.0× | W05-02 |
| 2 | Level (Slope → Flat, 8 s, 60 E, 2 Min) | W05-03 |
| 3 | Fill (Hole → Flat, 10 s, 100 E, 10 M + 5 Min) | W05-04 |
| 4 | Reclaim (Shallow → Flat, 14 s, 200 E, 20 M + 10 Min) | W05-05 |
| 5 | Deep Reclaim (Deep → Shallow, 28 s, 400 E, 40 M + 20 Min, **T2 workers only**): implemented here, playable when W17 adds T2 workers | W05-06 |
| 6 | Irrigate (15 W, ×2 Desert) and Seed (10 W + 5 Min) → Living; a footprint on Living reverts it to Prepared | W05-07 |
| 7 | Op energy: drawn over work time, grows with rate, on the Hub component, shed group 1, pause keeps progress (`UO-TF-02`) | W05-08 |
| 8 | Area orders split over ≤ 8 workers (`UO-L-04`) | W05-08 |
| 9 | Linked prep for every terrain class, prep bill on the ghost, cancel cascades, does not count toward the Terraform lane limit (`UO-TF-03`) | W05-09, W05-20 |
| 10 | Terraform % (excludes unreclaimed Deep Water and walls), Living bonuses +10 % move, +5 % adjacent extractors (`UO-TF-06/07`) | W05-10 |
| 11 | Hydro Power Station T1 on Prepared tiles next to water; loses power if its last water neighbour is reclaimed (`UO-TF-10`) | W05-11 |
| 12 | Territory Beacon T1 (R 8): claim on completion, anchors, frozen border, 600-tick grace revert, unpowered beacon claims nothing new and takes +25 % damage (`SIM-G-TER`) | W05-12, W05-13 |
| 13 | Weather: storms (Temperate mean 45 min / 3 min; Desert sandstorm mean 90 min, solar −50 %) | W05-14 |
| 14 | Lightning (storms only): every ~200 ticks, pylons weighted ×4, 300 HP; Hazard Shield & Lightning Rod T1 intercepts within R 10 | W05-15 |
| 15 | Meteors: not before S2 + 10 min (fallback: colony age ≥ 12 min until W08), radius 2, 400 HP falloff, radius 1 → Hole, 30 % new deposit, breach hook for W14 (`UO-T-07`, `UO-TF-04`) | W05-16 |
| 16 | Generator: terrain mix per planet type (Temperate, Desert), lakes with shallow rims and deep centres, slopes, craters, spawn guarantee (`UO-TF-09`, §4.5 table) | W05-17, W05-18 |
| 17 | Tile-state deltas batched | W05-19 |
| 18 | Terraform menu with all ops, area brush, locked Deep Reclaim tooltip | W05-20 |
| 19 | Territory rendering: colony colours, frozen border marks, reverting tiles, beacon radius preview | W05-21 |
| 20 | Terraform % HUD and Living overlay | W05-22 |
| 21 | Tile-state visuals: Prepared pad, Irrigated, Living, shallow/deep water, hole, slope | W05-23, W05-24 |
| 22 | Archetypes: Terraformer, Beacon T1, Lightning Rod T1, Hydro T1 | W05-25, W05-26 |
| 23 | VFX: terraform ops, lightning, meteors, storm haze | W05-27, W05-28 |
| 24 | Achievements: Stone Mason (Level/Fill counted here; Clear/Break in W01), Hydro Engineer, Green Thumb | W05-29 |
| 25 | Analytics: first terraform op, first Living tile, first beacon, first meteor | W05-30 |
| 26 | Dev console: meteor, storm, terrain set, colony spawn | W05-31 |
| 27 | Tests: op state machine, border property test, 1 000-seed spawn guarantee | W05-32 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W05-01 | Contracts & data: Terraformer unit row; op rows `level, fill, reclaim, deepReclaim (minWorkerTier 2), irrigate, seed`; Territory Beacon T1, Hydro T1, Hazard Shield & Lightning Rod T1 rows; events `tileStateChanged`, `territoryClaimed`, `borderFrozen`, `territoryReverting`, `lightningStrike`, `meteorImpact`, `stormStarted/Ended`; flag `W05` | contract | M | H | W03-01 | `TA_WAVES=..05` → the menu data lists 6 new ops; `..04` → only Grade/Clear/Break | `UO-TF`, econ §3.1 | TA-14.1 |
| W05-02 | Terraformer drone in sim: printed at the Hub, terraform lane only, rate 1.0×, drain 2.5 + op energy | sim | S | H | W05-01 | Order a Terraformer → it spawns and takes the next Terraform-lane entry | §5.1 | TA-06.6 |
| W05-03 | Level op: Slope → Flat, 8 s, 60 E, 2 Min | sim | S | H | W05-02 | Brush Level on a slope → after 8 s at 1.0× the tile is Flat and 2 Min are spent | `UO-TF` | TA-14.3 |
| W05-04 | Fill op: Hole → Flat, 10 s, 100 E, 10 M + 5 Min | sim | S | H | W05-02 | Fill a crater tile → Flat; the stock drops by 10 M / 5 Min | `UO-TF` | TA-14.3 |
| W05-05 | Reclaim op: Shallow water → Flat, 14 s, 200 E, 20 M + 10 Min; units can no longer swim-slow through it | sim | S | H | W05-02 | Reclaim 1 shallow tile → Flat after 14 s; passability becomes 1.0× | `UO-TF` | TA-14.3 |
| W05-06 | Deep Reclaim op: Deep → Shallow, 28 s, 400 E, 40 M + 20 Min, eligible only for worker tier ≥ 2 (HQ T2, Multitask T2). Unit-tested with a scenario-granted T2 worker. Visible but locked in the menu ("needs a T2 worker — Second Tier") until W17 is on | sim | S |  | W05-02 | Scenario `w05-t2` with a test T2 worker → Deep → Shallow; a normal colony gets `worker_tier_locked` | `UO-TF-10`, D-16 Q11 | TA-14.3 |
| W05-07 | Irrigate (15 W, ×2 Desert) and Seed (10 W + 5 Min) → Living; placing a footprint on Living reverts those tiles to Prepared | sim | M | H | W05-02 | Irrigate then Seed 1 tile → Living; build over it → Prepared again and Terraform % drops | `UO-TF-04` | TA-14.3 |
| W05-08 | Op energy and areas: energy/tile drawn evenly over work time × rate on the Hub component; group-1 shedding pauses ops (progress kept, `waiting(power)`); area order splits tiles over ≤ 8 workers | sim | M | H | W05-02, W03-07 | Run Reclaim at night with a deficit → the op pauses at 43 % and resumes at dawn from 43 % | `UO-TF-02`, `UO-L-04` | TA-14.3 |
| W05-09 | Linked prep on any terrain: placement computes missing ops per footprint tile and creates one linked terraform order (same source/precedence, outside the lane limit); construction waits `site n/m`; cancelling the construction cancels the prep | sim | M | H | W05-03..07 | Place on 2 slope + 1 hole + 1 flat → one linked order (Level ×2, Fill, Grade ×4); cancel → both disappear | `UO-TF-03` | TA-14.3 |
| W05-10 | Terraform %: Living ÷ owned (excluding unreclaimed Deep Water and Ridge/Moat). Living bonuses: +10 % ground move speed, +5 % output to adjacent extractors | sim | S | H | W05-07 | 10 Living of 412 owned → 2.4 %; an extractor next to Living reads +5 % | `UO-TF-06/07` | TA-14.3 |
| W05-11 | Hydro Power Station T1 (2×3, +39 gross): footprint Prepared and adjacent to Shallow or Deep water; turns off (`offline: no water`) if its last water neighbour is reclaimed; the ghost warns before such a reclaim | sim | M |  | W05-05 | Reclaim the last lake tile next to a Hydro → the warning shows; confirm → Hydro goes offline | `UO-TF-10`, econ §3.3 | TA-06.5 |
| W05-12 | Territory Beacon T1: on completion claims R 8 (unclaimed → own, own → add anchor, foreign → frozen, never overwritten); unpowered beacon claims nothing new and takes +25 % damage | sim | M | H+ | W05-01 | Build a beacon next to a foreign border → foreign tiles stay foreign; `borderFrozen` fires once | `SIM-G-TER`, econ §2 | TA-06.3 |
| W05-13 | Anchor removal: tiles with zero anchors revert after 600 ticks unless re-anchored; `territoryReverting` with countdown | sim | S |  | W05-12 | Destroy a beacon → its exclusive tiles revert 60 s later; rebuild within 60 s → no revert | econ §2.2 | TA-06.3 |
| W05-14 | Weather: storm scheduler (Temperate mean 27 000 ticks, 1 800 duration; Desert sandstorm mean 54 000, solar −50 %); wind factor rises during storms | sim | S |  | W03-09 | `startStorm` on Desert → solar output halves for the storm's duration | SIM §7.6 | TA-06.8 |
| W05-15 | Lightning during storms: a strike every ~200 ticks ± jitter on own territory, pylons weighted ×4, 300 HP. Hazard Shield & Lightning Rod T1 (1×1, R 10) intercepts strikes in range | sim | M |  | W05-14 | Storm with a rod covering 3 pylons → strikes in R 10 hit the rod (0 damage); outside it they damage pylons | SIM §7.6, econ §3.7 | TA-06.8 |
| W05-16 | Meteors: mean 36 000 ticks per planet, not before S2 + 10 min (until W08 is on: colony age ≥ 12 min), radius 2, 400 HP at the centre with linear falloff, radius-1 tiles → Hole, 30 % chance of a new deposit; emits `meteorImpact {tiles}` used by W14's breach | sim | M |  | W05-04 | `meteor 40 22` → buildings in R 2 take damage; centre tiles become Hole | `UO-T-07`, `UO-TF-04` | TA-06.8 |
| W05-17 | Generator: terrain mix per type (Temperate 45/25/8/10/2/6/4; Desert 50/0/22/15/8/3/2), coherent lakes (shallow rim, deep centre), slope bands, crater clusters, deterministic by seed | sim | M | H | W01-06 | Generate 1 000 seeds per type → class shares stay within ±3 % of the targets | §4.5 mix table, `SIM-GEN` | TA-06.2, TA-14.3 |
| W05-18 | Spawn guarantee: within radius 4 only Flat/Forest/Rock/Deposit with ≥ 60 % Flat, ≤ 3 non-Flat per 3×3 window, and a metals deposit plus an open 2×2 site within radius 8 | sim | S | H | W05-17 | Test over 1 000 seeds per type → 100 % of spawn slots pass | `UO-TF-09` | TA-14.3 |
| W05-19 | Tile sync: terrain class, prep and owner changes ride the W00-24 diff in batched form, capped and chunked | sim | S | H | W05-01 | Brush 200 tiles → the client receives them in ≤ 3 deltas; payload ≤ 8 KB | PROTOCOL deltas | TA-07.6 |
| W05-20 | Terraform menu: all ops with icons and costs, area brush (rect + hex radius), prep bill on construction ghosts, locked Deep Reclaim tooltip, cancel area | client | M | H | W05-09 | Hover a sloped ghost → the bill lists Level ×2 + Grade, total E and time; the Deep Reclaim chip reads "needs T2 worker" | `UO-M`, `UO-TF-03` | TA-11.8, TA-14.8 |
| W05-21 | Territory extras: reverting tiles pulse with a countdown, beacon radius preview on its ghost (borders and the frozen hatch come from W01-30) | client | S |  | W05-12, W01-30 | Place a beacon ghost → an R 8 hex ring preview appears; a destroyed beacon's tiles pulse | CLIENT §8 | TA-11.5 |
| W05-22 | Terraform HUD: `Terraform n / m (x %)` meter, Living overlay toggle (`L`), Living move-speed hint on hover | client | S | H | W05-10 | Seed a tile → the meter updates within 1 s | `UO-TF-06` | TA-11.7 |
| W05-23 | Terrain materials for Irrigated (wet darkening) and Living (moss/grass via biome weathering in `createUnifiedColonyMaterial`), blended edges; the Prepared pad comes from W01-21 | visual | M | H | W01-21 | Toggle tile states in the playground terrain view → each state is distinct in iso and top views | Pillar 3, texture skill | TA-14.9 |
| W05-24 | Terrain visuals: shallow vs deep water (`shader-texture-tuning` hydro water), crater/hole decals, slope shading, Desert palette | visual | M | H+ | W05-17 | Desert scenario → no forest, rock and crater density is visibly higher, oasis water renders | shader skill | TA-14.9 |
| W05-25 | Kitbash: Terraformer drone (≥ 7 parts, grading-blade silhouette breaker, op animation states) | visual | M | H+ | — | `?inspect=robot.terraformer` → 4-view audit passes, minY 0, < 3.5 k tris | Pillar 1 | TA-14.9 |
| W05-26 | Kitbash: Territory Beacon T1 (spire, emissive ring), Hazard Shield & Lightning Rod T1, Hydro Power Station T1 (2×3, water intake facing the lake) | visual | M | H+ | — | Playground audit passes for all 3 | Pillar 1 | TA-14.9 |
| W05-27 | Terraform op VFX for the W05 ops: level sweep, fill pour, reclaim pumping spray, irrigation mist, seeding sprouts (Grade/Break/Clear VFX come from W01-22) | visual | M |  | W05-20, W01-22 | Run each op in the scenario → each shows its own effect, and the effect stops when the op pauses | VFX | TA-14.9 |
| W05-28 | Weather VFX: 3D jagged lightning bolts + pooled PointLight flash (`planetary-lighting-and-lightning`), meteor streak + impact flash + crater, storm haze / sandstorm particles | visual | M |  | W05-15, W05-16 | `startStorm` + `meteor` → bolts and a meteor render, with ≤ 1 ms frame cost on desktop | lighting skill | TA-14.9 |
| W05-29 | Progression events: `opCompleted {op}` (Stone Mason counts Level/Fill/Clear/Break; Hydro Engineer counts Reclaim/Deep Reclaim; Green Thumb counts Seed→Living) | sim | S | H | W05-07 | Seed 3 tiles → the progression bus logs 3 `livingCreated` | player-profile §3 | — |
| W05-30 | Analytics: `first_terraform_op`, `first_living_tile`, `first_beacon`, `meteor_seen` | client | S |  | W05-22 | First Seed → one `first_living_tile` row | CLIENT §10 | — |
| W05-31 | Dev console: `meteor <q> <r>`, `startStorm`, `setTerrain <q> <r> <class>`, `spawnColony <q> <r>`, `grantT2Worker` (tests only) | server | S | H+ | W00-40 | `spawnColony` next to the border → a second colony appears with its own Hub and border | PRODUCT_WAVES §3 | — |
| W05-32 | Tests: op state-machine unit tests, border-collision property test (random beacon orders never overwrite foreign tiles), spawn guarantee over 1 000 seeds per type | test | M | H+ | W05-12, W05-18 | `npm test -w @terra/sim -- terraform territory gen` → green | `UO-TF`, `SIM-G-TER` | TA-06.3 |
| W05-33 | Wave e2e + scenarios `w05-shape-the-land` and `w05-desert` + tag `wave-05` | test | M | H | all W05 | `npm run e2e -- --waves ..05` → the demo passes, earlier suites still pass | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w05.spec.ts` passes, and so do all earlier wave suites.
- Both scenarios load.
- With `TA_WAVES=..04`, the Terraformer, the new ops, beacons, weather and meteors are absent, and W01's Grade / Clear / Break still works.
- Deep Reclaim stays locked until W17.
- Tag `wave-05` is created.

## Notes

- **Deep Reclaim** is fully built and tested here, but it is gated by worker tier, not by wave. It becomes playable the moment W17 adds HQ T2 and Multitask T2, with no extra code. Its unlock stage (S5) is enforced only when W08 is on.
- **Meteor timing** uses the stage engine when W08 is on. Otherwise it falls back to colony age.
