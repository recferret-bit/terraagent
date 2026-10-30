# W05 — Shape the Land

> **Track:** Gameplay (G) · **Flag:** `W05` · **Scenario:** `scenarios/w05-shape-the-land.ts` · **Tag:** `wave-05` · **Depends on:** W03
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §4.5 (`UO-TF-01..10`), §5.1 · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §2, §3.1, §3.3 (Hydro), §3.7 (Hazard Shield) · [`SIMULATION.md`](../../spec/SIMULATION.md) §7.5 (`SIM-G-TER`), §7.6, §10 (`SIM-GEN`) · [`textures-shaders-lighting-spec.md`](../../visuals/textures-shaders-lighting-spec.md) · D-33 (three planet types), D-34 (resource tiers), D-35 (numbers are data rows, tunable with W00-59)
> **Resources (D-34):** op costs in `M` / `Min` / `W` shorthand (e.g. Level 2 Min, Fill 10 M + 5 Min) read through the D-34 T1 rule: `metals.t1` / `minerals.t1` / `bio.water`.
> **Owned paths:** `shared/sim/src/systems/{terraform,territory,weather,hazards}/`, `shared/sim/src/gen/terrain-mix.ts`, `shared/sim/src/data/terraform.ts`, `frontend/game/features/{terraform,territory,weather}/`, terrain look in `frontend/render/visuals/terrain/` (bind only: terrain shader mask, `Liquids.ts`), weather VFX binding of `frontend/render/lighting/LightningStrikeSystem.ts`, new archetypes `frontend/render/kitbash/archetypes/units/terraformer.ts` and `frontend/render/kitbash/archetypes/buildings/{lightning-rod,hydro}.ts`, resource tiers `shared/sim/src/systems/resource-tiers/`, `shared/sim/src/data/resource-tiers.ts`, `frontend/game/features/resource-tiers/`, `scenarios/w05-{tiers,desert,ocean}.ts`.
> **Soft dependencies:** stage numbers (unlocks, meteor floor) ← W08; Deep Reclaim playable with W17's T2 workers; meteor breach consumer ← W14.

## Goal

The colony can **reshape and claim land**:
- the Terraform drone and every terrain op beyond W01's Grade / Clear / Break;
- linked prep on any terrain;
- Living land with Terraform % and its bonuses;
- territory beacons with frozen borders;
- weather, lightning and meteors that create new terrain work;
- terraformed land unlocks the T2/T3 sub-resources of the extractors on it (D-34): colony Terraform % ≥ 30 / 70 and a terraformed ring around the deposit.

All three planet types (`temperate`, `desert`, `ocean`; D-33) generate with their terrain mix; the hackathon demo stays on `temperate`.

## Demo story (e2e `e2e/w05.spec.ts`)

1. Open `/play.html?scenario=w05`: S4 colony (Reclaim / Irrigate / Seed and the Beacon unlock at S4), `temperate`, a shallow lake and a crater near the Hub.
2. Units menu → order a Terraformer → it appears.
3. Construction menu → place a Quarry on the slope + crater footprint → the ghost shows the prep bill (Level ×2, Fill ×1, Grade ×4: time, E, M/Min). Confirm → the construction shows `waiting(site: 0/4 tiles prepared)` and a linked terraform order runs. The building starts at 4/4.
4. Terraform menu → brush **Reclaim** over 6 shallow-water tiles → they turn Flat, then Prepared after Grade.
5. Terraform menu → brush **Irrigate → Seed** over 10 Prepared tiles → they turn Living. The HUD shows `Terraform 10 / 412 (2.4 %)`, and a unit on Living tiles moves 10 % faster.
6. Build a Territory Beacon T1 → R 8 is claimed on completion and the border expands.
7. Run `spawnColony <q> <r>` in the dev console next to the border → the border is frozen and is never overwritten.
8. Destroy the beacon (`damage <entity> 100` in the dev console) → its tiles show a 60 s revert countdown (`warp 10` to speed it up), then revert.
9. Run `startStorm` in the dev console → lightning hits a pylon (300 HP). Build a Lightning Rod and the next strike within R 10 is intercepted.
10. Run `meteor <q> <r>` in the dev console → radius-2 damage, radius-1 tiles become Hole, and a 30 % chance reveals a new deposit.
11. Queue a terraform order, then run `time night` → terraform ops pause first (`waiting(power)`) and resume at `time day`.
12. Open `/play.html?scenario=w05-desert` → the terrain-class shares match the D-33 `desert` column (rock ≈ 12 %, water ≈ 1 %: exact shares are (e2e only); by eye, mostly rock and sand with almost no water) and the terrain renders with the existing `dune` look. `/play.html?scenario=w05-ocean` → water ≈ 35 %, forest ≈ 30 %, the existing `oceanForest` look.
13. Open `/play.html?scenario=w05-tiers` (Terraform 31 %, the Metals Extractor ringed by Living tiles) → the Metals chip's tier breakdown shows `metals.t2` income (30 % of that Extractor's output); a second Extractor on unterraformed ground stays T1 only.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–5, 11, 13. `W05-33` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Resource tiers in the demo (D-34):** T1 everywhere, plus one T2 unlock on the Metals Extractor in the seeded `w05-tiers` scenario (step 13, W05-34). Reaching 30 % Terraform by hand takes too long for a live demo, so the scenario seeds it. T3, Bio tiers (W03-30, W05-35) and the tier-unlock indicator (W05-36) are stretch or later.
- **Deferred:** Territory Beacon and border reverts (steps 6–8), storms, lightning and meteors (steps 9–10), the `desert` and `ocean` planet types (step 12; D-27 / D-33: the demo is `temperate` only), Hydro, Deep Reclaim, the Terraformer archetype (an existing robot stands in), op VFX.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Terraformer drone: Hub T1+, 14 s, 50/30/5/10, supply 1, −2.5 E/s + op energy, terraform 1.0× | W05-02 |
| 2 | Level (Slope → Flat, 8 s, 60 E, 2 Min) | W05-03 |
| 3 | Fill (Hole → Flat, 10 s, 100 E, 10 M + 5 Min) | W05-04 |
| 4 | Reclaim (Shallow → Flat, 14 s, 200 E, 20 M + 10 Min) | W05-05 |
| 5 | Deep Reclaim (Deep → Shallow, 28 s, 400 E, 40 M + 20 Min, **T2 workers only**): implemented here, playable when W17 adds T2 workers | W05-06 |
| 6 | Irrigate (15 `bio.water`, ×2 on `desert`) and Seed (10 `bio.water` + 5 `minerals.t1`) → Living; a footprint on Living reverts it to Prepared | W05-07 |
| 7 | Op energy: drawn over work time, grows with rate, on the Hub component, shed group 1, pause keeps progress (`UO-TF-02`) | W05-08 |
| 8 | Area orders split over ≤ 8 workers (`UO-L-04`) | W05-08 |
| 9 | Linked prep for every terrain class, prep bill on the ghost, cancel cascades, does not count toward the Terraform lane limit (`UO-TF-03`) | W05-09, W05-20 |
| 10 | Terraform % (excludes unreclaimed Deep Water and walls), Living bonuses +10 % move, +5 % adjacent extractors (`UO-TF-06/07`) | W05-10 |
| 11 | Hydro Power Station T1 on Prepared tiles next to water; loses power if its last water neighbour is reclaimed (`UO-TF-10`) | W05-11 |
| 12 | Territory Beacon T1 (R 8): claim on completion, anchors, frozen border, 600-tick grace revert, unpowered beacon claims nothing new and takes +25 % damage (`SIM-G-TER`) | W05-12, W05-13 |
| 13 | Weather: storms (`temperate` mean 45 min / 3 min; `desert` sandstorm mean 90 min, solar −50 %; `ocean` storms ×1.5 frequency, D-33) | W05-14 |
| 14 | Lightning (storms only): every ~200 ticks, pylons weighted ×4, 300 HP; Hazard Shield & Lightning Rod T1 intercepts within R 10 | W05-15 |
| 15 | Meteors: not before S2 + 10 min (fallback: colony age ≥ 12 min until W08), radius 2, 400 HP falloff, radius 1 → Hole, 30 % new deposit, breach hook for W14 (`UO-T-07`, `UO-TF-04`) | W05-16 |
| 16 | Generator: `desert` and `ocean` terrain mixes and deposit richness (D-33), lakes with shallow rims and deep centres, slopes, craters (§4.5 table). The `temperate` mix and the spawn guarantee `UO-TF-09` already ship in W01-06 / W01-07 / W01-33 | W05-17 |
| 17 | Tile-state deltas batched | W05-19 |
| 18 | Terraform menu with all ops, area brush, locked Deep Reclaim tooltip | W05-20 |
| 19 | Territory rendering: colony colours, frozen border marks, reverting tiles, beacon radius preview | W05-21 |
| 20 | Terraform % HUD and Living overlay | W05-22 |
| 21 | Tile-state visuals: Irrigated, Living (existing `uTerraformMap` mask), shallow/deep water (existing `Liquids.ts`), hole decals; Prepared pad from W01-21 | W05-23, W05-24 |
| 22 | Archetypes: Terraformer (new), Beacon T1 (bind existing `building.claimBeacon`), Lightning Rod T1 (new), Hydro T1 (new) | W05-25, W05-26 |
| 23 | VFX: terraform ops, lightning (existing `LightningStrikeSystem`), meteors, storm haze | W05-27, W05-28 |
| 24 | Achievements: Stone Mason (Level/Fill counted here; Clear/Break in W01), Hydro Engineer, Green Thumb | W05-29 |
| 25 | Analytics: first terraform op, first Living tile, first beacon, first meteor | W05-30 |
| 26 | Dev console: meteor, storm, terrain set, colony spawn | W05-31 |
| 27 | Tests: op state machine, border property test (the spawn-guarantee property test is W01-33) | W05-32 |
| 28 | Resource tier gate (D-34): T2 at colony Terraform ≥ 30 % + ≥ 50 % Irrigated/Living in the deposit ring, T3 at ≥ 70 % + ≥ 50 % Living; yield split 70/30 and 50/30/20 | W05-34 |
| 29 | Bio tiers: gene-stock (`bio.t3`) from Harvesters on Living ground once T3 is open (the Bio T2 source is W03-30's Petroleum Well) | W05-35 |
| 30 | Tier-unlock indicator: family chips and extractor panel show the gate progress and the active tiers | W05-36 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W05-01 | Contracts & data: Terraformer unit row; op rows `level, fill, reclaim, deepReclaim (minWorkerTier 2), irrigate, seed`; Territory Beacon T1, Hydro T1, Hazard Shield & Lightning Rod T1 rows; events `tileStateChanged`, `territoryClaimed`, `borderFrozen`, `territoryReverting`, `lightningStrike`, `meteorImpact`, `stormStarted/Ended`, `tierUnlocked {family, tier}`; resource-tier data rows (thresholds, ring size, splits; D-34); flag `W05` | contract | M | H | W03-01 | `TA_WAVES=..05` → the menu data lists 6 new ops; `..04` → only Grade/Clear/Break | `UO-TF`, econ §3.1 | TA-14.1 |
| W05-02 | Terraformer drone in sim: printed at the Hub, terraform lane only, rate 1.0×, drain 2.5 + op energy | sim | S | H | W05-01 | Order a Terraformer → it spawns and takes the next Terraform-lane entry | §5.1 | TA-06.6 |
| W05-03 | Level op: Slope → Flat, 8 s, 60 E, 2 Min | sim | S | H | W05-02 | Brush Level on a slope → after 8 s at 1.0× the tile is Flat and 2 Min are spent | `UO-TF` | TA-14.3 |
| W05-04 | Fill op: Hole → Flat, 10 s, 100 E, 10 M + 5 Min | sim | S | H | W05-02 | Fill a crater tile → Flat; the stock drops by 10 M / 5 Min | `UO-TF` | TA-14.3 |
| W05-05 | Reclaim op: Shallow water → Flat, 14 s, 200 E, 20 M + 10 Min; units can no longer swim-slow through it | sim | S | H | W05-02 | Reclaim 1 shallow tile → Flat after 14 s; passability becomes 1.0× | `UO-TF` | TA-14.3 |
| W05-06 | Deep Reclaim op: Deep → Shallow, 28 s, 400 E, 40 M + 20 Min, eligible only for worker tier ≥ 2 (HQ T2, Multitask T2). Unit-tested with a scenario-granted T2 worker. Visible but locked in the menu ("needs a T2 worker — Second Tier") until W17 is on | sim | S |  | W05-02 | Scenario `w05-t2` with a test T2 worker → Deep → Shallow; a normal colony gets `worker_tier_locked` | `UO-TF-10`, units §9 Q11, D-16 | TA-14.3 |
| W05-07 | Irrigate (15 `bio.water`, ×2 on `desert`) and Seed (10 `bio.water` + 5 `minerals.t1`) → Living; placing a footprint on Living reverts those tiles to Prepared | sim | M | H | W05-02 | Irrigate then Seed 1 tile → Living; build over it → Prepared again and Terraform % drops | `UO-TF-04` | TA-14.3 |
| W05-08 | Op energy and areas: energy/tile drawn evenly over work time × rate on the Hub component; group-1 shedding pauses ops (progress kept, `waiting(power)`); area order splits tiles over ≤ 8 workers | sim | M | H | W05-02, W03-07 | Run Reclaim at night with a deficit → the op pauses at 43 % and resumes at dawn from 43 % | `UO-TF-02`, `UO-L-04` | TA-14.3 |
| W05-09 | Linked prep on any terrain: register the W05 ops (Level, Fill, Reclaim, Deep Reclaim) in W01-15's missing-op table; the single linked order, `site n/m` wait, cancel cascade and lane exemption stay W01-15's | sim | S | H | W05-03..07, W01-15 | Place on 2 slope + 1 hole + 1 flat → one linked order (Level ×2, Fill, Grade ×4); cancel → both disappear | `UO-TF-03` | TA-14.3 |
| W05-10 | Terraform %: Living ÷ owned (excluding unreclaimed Deep Water and Ridge/Moat). Living bonuses: +10 % ground move speed, +5 % output to adjacent extractors | sim | S | H | W05-07 | 10 Living of 412 owned → 2.4 %; an extractor next to Living reads +5 % | `UO-TF-06/07` | TA-14.3 |
| W05-11 | Hydro Power Station T1 (2×3, +39 gross): footprint Prepared and adjacent to Shallow or Deep water; turns off (`offline: no water`) if its last water neighbour is reclaimed; the ghost warns before such a reclaim | sim | M |  | W05-05 | Reclaim the last lake tile next to a Hydro → the warning shows; confirm → Hydro goes offline | `UO-TF-10`, econ §3.3 | TA-06.5 |
| W05-12 | Territory Beacon T1: on completion claims R 8 (unclaimed → own, own → add anchor, foreign → frozen, never overwritten); unpowered beacon claims nothing new and takes +25 % damage | sim | M | H+ | W05-01 | Build a beacon next to a foreign border → foreign tiles stay foreign; `borderFrozen` fires once | `SIM-G-TER`, econ §2 | TA-06.3 |
| W05-13 | Anchor removal: tiles with zero anchors revert after 600 ticks unless re-anchored; `territoryReverting` with countdown | sim | S |  | W05-12 | Destroy a beacon → its exclusive tiles revert 60 s later; rebuild within 60 s → no revert | econ §2.2 | TA-06.3 |
| W05-14 | Weather: storm scheduler per planet type (`temperate` mean 27 000 ticks, 1 800 duration; `desert` sandstorm mean 54 000, solar −50 %; `ocean` frequency ×1.5 = mean 18 000, D-33); storms do not change the wind factor (B13 default); all numbers are data rows | sim | S |  | W03-09 | `startStorm` on `desert` → solar output halves for the storm's duration | SIM §7.6 | TA-06.8 |
| W05-15 | Lightning during storms: a strike every ~200 ticks ± jitter on own territory, pylons weighted ×4, 300 HP. Hazard Shield & Lightning Rod T1 (1×1, R 10) intercepts strikes in range | sim | M |  | W05-14 | Storm with a rod covering 3 pylons → strikes in R 10 hit the rod (0 damage); outside it they damage pylons | SIM §7.6, econ §3.7 | TA-06.8 |
| W05-16 | Meteors: mean 36 000 ticks per planet, not before S2 + 10 min (until W08 is on: colony age ≥ 12 min), radius 2, 400 HP at the centre with linear falloff, radius-1 tiles → Hole, 30 % chance of a new deposit; emits `meteorImpact {tiles}` used by W14's breach | sim | M |  | W05-04 | `meteor 40 22` → buildings in R 2 take damage; centre tiles become Hole | `UO-T-07`, `UO-TF-04` | TA-06.8 |
| W05-17 | Generator: add the `desert` and `ocean` types to the W01-06 generator with the D-33 mixes (`desert`: rock 12 %, water 1 %, Metals and Minerals deposit richness +15 %; `ocean`: water 35 % = shallow 20 % + deep 15 %, forest 30 %, rock 5 %, Bio (oil) deposits +20 %, Metals −15 %; full shares in SIMULATION §9), coherent lakes (shallow rim, deep centre), slope bands and crater clusters for all three types; the W01-07 spawn guarantee must still hold on both new types; the client maps `desert → dune` and `ocean → oceanForest` (existing looks) | sim | M |  | W01-06, W01-07 | Generate 1 000 `desert` and 1 000 `ocean` seeds → class shares within ±3 % of the D-33 targets and every spawn slot passes the W01-07 predicates | §4.5 mix table, `UO-TF-09`, `SIM-GEN` | TA-06.2, TA-14.3 |
| W05-19 | Tile sync for large brushes: the W01-08 `t` tile ops (terrain, prep, owner) are batched, capped and chunked when one order changes many tiles | sim | S | H | W05-01 | Brush 200 tiles → the client receives them in ≤ 3 deltas; payload ≤ 8 KB | PROTOCOL deltas | TA-07.6 |
| W05-20 | Terraform menu: all ops with icons and costs, area brush (rect + hex radius), prep bill on construction ghosts, locked Deep Reclaim tooltip, cancel area | client | M | H | W05-09 | Hover a sloped ghost → the bill lists Level ×2 + Grade, total E and time; the Deep Reclaim chip reads "needs T2 worker" | `UO-M`, `UO-TF-03` | TA-11.8, TA-14.8 |
| W05-21 | Territory extras: reverting tiles pulse with a countdown, beacon radius preview on its ghost (borders and the frozen hatch come from W01-30) | client | S |  | W05-12, W01-30 | Place a beacon ghost → an R 8 hex ring preview appears; a destroyed beacon's tiles pulse | CLIENT §8 | TA-11.5 |
| W05-22 | Terraform HUD: `Terraform n / m (x %)` meter, `L` toggles the Living mode of W01-27's tile-state overlay, Living move-speed hint on hover | client | S | H | W05-10, W01-27 | Seed a tile → the meter updates within 1 s | `UO-TF-06` | TA-11.7 |
| W05-23 | Irrigated and Living terrain look: drive a per-tile mask from tile state, reusing the `uTerraformMap` DataTexture + `terraformedLush` colour + frontier ring of the existing `createTerraformingTerrainMaterial` (`frontend/render/visuals/TerrainAndWaterShaders.ts`) inside the live terrain shader (`frontend/render/visuals/terrain/terrainShader.ts`); Irrigated adds wet darkening; the Prepared pad comes from W01-21 | visual | S | H | W01-21 | Toggle tile states in the playground terrain view → Prepared, Irrigated and Living are distinct in iso and top views | Pillar 3, texture skill | TA-14.9 |
| W05-24 | Terrain visuals per tile class: drive the existing shallow→deep tint of `Liquids.ts` `createWater` from Shallow/Deep tiles, hole/crater decals (slope shading already exists in the terrain shader) | visual | S | H+ | W01-08 | Scenario `w05` → the lake's shallow rim reads lighter than its deep centre, and crater tiles show a hole decal | shader skill | TA-14.9 |
| W05-25 | Kitbash: Terraformer drone (≥ 7 parts, grading-blade silhouette breaker, op animation states) | visual | M | H+ | — | `?inspect=robot.terraformer` → 4-view audit passes, minY 0, < 3.5 k tris | Pillar 1 | TA-14.9 |
| W05-26 | Kitbash: bind the existing `building.claimBeacon` (1×1 obelisk) as Territory Beacon T1; new Hazard Shield & Lightning Rod T1 (1×1) and Hydro Power Station T1 (2×3, water intake facing the lake) | visual | M | H+ | — | `?inspect=building.lightningRod` and `?inspect=building.hydro` → 4-view audit and `validate:models` pass (0/0), minY 0, < 3.5 k tris; a built beacon renders as `claimBeacon` | Pillar 1 | TA-14.9 |
| W05-27 | Terraform op VFX for the W05 ops: level sweep, fill pour, reclaim pumping spray, irrigation mist, seeding sprouts (Grade/Break/Clear VFX come from W01-22) — built on `render/visuals/terrain/Particles.ts` and the descent `GroundFX` | visual | M |  | W05-20, W01-22 | Run each op in the scenario → each shows its own effect, and the effect stops when the op pauses | VFX | TA-14.9 |
| W05-28 | Weather VFX: wire the existing `LightningStrikeSystem` (`frontend/render/lighting/`, `strikeAt` / `update`) to `lightningStrike` events; meteor streak + impact flash; storm haze / sandstorm particles via the existing `frontend/render/visuals/terrain/Particles.ts` | visual | S |  | W05-15, W05-16 | `startStorm` + `meteor` → bolts and a meteor render, with ≤ 1 ms frame cost on desktop | lighting skill | TA-14.9 |
| W05-29 | Progression events: emit W01-31's `obstacleRemoved {op, count}` (one event kind, no `opCompleted`) for the W05 ops `level`, `fill`, `reclaim`, `deepReclaim`, `seed`; the progression publisher maps op → family (Stone Mason: clear/break/level/fill; Hydro Engineer: reclaim/deepReclaim; Green Thumb: seed → Living), so Clear/Break are counted once, by W01-31 | sim | S | H | W05-07, W01-31 | Seed 3 tiles → the progression bus logs 3 `obstacleRemoved {op: 'seed'}` | player-profile §3 | — |
| W05-30 | Analytics: `first_terraform_op`, `first_living_tile`, `first_beacon`, `meteor_seen` | client | S |  | W05-22 | First Seed → one `first_living_tile` row | CLIENT §10 | — |
| W05-31 | Dev console: `meteor <q> <r>`, `startStorm`, `setTerrain <q> <r> <class>`, `spawnColony <q> <r>`, `grantT2Worker` (tests only) | server | S | H+ | W00-40 | `spawnColony` next to the border → a second colony appears with its own Hub and border | PRODUCT_WAVES §3 | — |
| W05-32 | Tests: op state-machine unit tests, border-collision property test (random beacon orders never overwrite foreign tiles); the spawn-guarantee property test is W01-33 | test | S | H+ | W05-09, W05-12 | `npm test -w @terra/sim -- terraform territory` → green | `UO-TF`, `SIM-G-TER` | TA-06.3 |
| W05-34 | Resource tier gate (D-34): per extractor, T2 opens when the colony's Terraform % ≥ 30 and ≥ 50 % of the tiles within 2 of its footprint are Irrigated or Living; T3 when Terraform % ≥ 70 and ≥ 50 % of that ring is Living; yield split 70 % T1 / 30 % T2 (T2 open) and 50 / 30 / 20 (T3 open), Mk tier only scales the rate; ring ratio cached and refreshed on `tileStateChanged`; `tierUnlocked` event; colony view exposes the gates and each extractor's ring %; thresholds, ring size and splits are data rows (D-35, tunable with W00-59); ships scenario `w05-tiers` | sim | M | H | W05-10, W02-08, W03-11 | Load `?scenario=w05-tiers` → see the ringed Metals Extractor's income split 70 % `metals.t1` / 30 % `metals.t2` while the Extractor on unterraformed ground stays 100 % `metals.t1` | D-34, `UO-TF-06` | — |
| W05-35 | Bio tiers: a Harvester working Living ground in a colony with T3 open credits the T3 share of the W05-34 split as gene-stock (`bio.t3`), the rest as `bio.biomass`; W03-30's Petroleum Well reads the same gate for `bio.t2` | sim | S |  | W05-34, W02-12, W03-30 | In a scenario at Terraform 72 % put a Harvester on Living tiles → see `bio.t3` income at 20 % of its yield | D-34 | — |
| W05-36 | Tier-unlock indicator: the family chips' tier breakdown marks T2/T3 locked or open with the colony gate ("Terraform 24 % / 30 %"), the extractor info panel shows its ring % and active tiers, and a `tierUnlocked` toast; vanilla DOM panel on the design system (D-36) | client | S | H+ | W05-34, W02-26 | Load `?scenario=w05-tiers` and click the ringed Extractor → see "T2 active · ring 64 % / 50 %" and the Metals chip mark T2 open | D-34, CLIENT §8 | — |
| W05-33 | Wave e2e + scenarios `w05-shape-the-land`, `w05-desert` and `w05-ocean` (both land with W05-17; `w05-tiers` comes from W05-34) + tag `wave-05` | test | M | H | all W05 | `npm run e2e -- --waves ..05` → the demo passes, earlier suites still pass | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w05.spec.ts` passes, and so do all earlier wave suites.
- All scenarios load (`w05-tiers`; `w05-desert` and `w05-ocean` once W05-17 lands).
- With `TA_WAVES=..04`, the Terraformer, the new ops, beacons, weather and meteors are absent, and W01's Grade / Clear / Break still works.
- Deep Reclaim stays locked until W17.
- Tag `wave-05` is created.

## Notes

- **Deep Reclaim** is fully built and tested here, but it is gated by worker tier, not by wave. It becomes playable the moment W17 adds HQ T2 and Multitask T2, with no extra code. Its unlock stage (S5) is enforced only when W08 is on.
- **Meteor timing** uses the stage engine when W08 is on. Otherwise it falls back to colony age.
