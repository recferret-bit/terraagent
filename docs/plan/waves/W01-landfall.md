# W01 — Landfall

> **Track:** Spine (lead) · **Flag:** `W01` · **Tag:** `wave-01` · **Scenario:** `scenarios/w01-landfall.ts` · **Depends on:** W00
>
> **Specs:**
> - [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md):
>   - §3.1 `UO-L-03/05`
>   - §3.2 `UO-HQ-01..03`, `UO-HQ-06`
>   - §4.5 `UO-TF-01..05`, `UO-TF-09`, terrain table
>   - §6.2 stage S0
>   - §6.4 S0 pacing
>   - `UO-LC-07` (auto-placement)
> - [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §1, §2.1, §3.1 (Hub T1)
> - [`SIMULATION.md`](../../spec/SIMULATION.md) §7.3, §7.5, §10 (`SIM-GEN`)
> - [`PROTOCOL.md`](../../spec/PROTOCOL.md) §4, §8 (`/auth/guest`, `/me/home`)
> - [`CLIENT.md`](../../spec/CLIENT.md) §3
> - [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) §4.1
> - D-10, D-16, D-24, D-25
>
> **Owned paths:**
> - `shared/sim/src/systems/{landing,terraform-basic,construction,territory-claim}/`
> - `shared/sim/src/data/{terrain,ops-basic,hq,hub}.ts`
> - `shared/sim/src/gen/**`
> - `backend/app/src/modules/{auth,home}/`
> - `client/src/features/{landfall,terraform-basic,hub-placement,hud-min}/`
> - kitbash archetypes `building.commandHub`, `robot.hero` (tuning)
> - `scenarios/w01-landfall.ts`

## Goal

The first real minute of the game, end to end:
1. A guest opens the game and is seated on a dev planet.
2. A drop pod lands.
3. The HQ drone terraforms the Hub site, paying energy from its own power cell.
4. The HQ drone builds the Command Hub, which claims territory.

The colony survives a server restart. Everything lands as a shippable app: no lobby yet (W11), no economy beyond the starting cargo (W02), no stages (W08).

**Planet type.** Only **Temperate**. Desert ships with the terrain-mix work of a later gameplay wave (proposed: W05).

## Demo story (`e2e/w01.spec.ts`)

1. Open `/play.html` on a fresh browser profile → **see** guest login happen silently, then the boot splash route to `/play` (`/me/home = ACTIVE` on the dev planet).
2. **See** the drop pod descend onto the spawn slot and the HQ drone deploy. The HUD shows the stock `600/350/200/200` and the HQ cell at `800 / 800 E`.
3. Open the Construction menu → **see** only "Command Hub". Hover a site → **see** a ghost footprint (3×3) with a prep bill (tiles, seconds, E, yields). Confirm.
4. **See** the HQ walk to the site and Grade, Clear and Break tiles one by one. Tiles change Wild → Prepared, and the cell bar drains. Rock and forest tiles yield +10 M / +5 Pet.
5. **See** construction start once all 9 tiles are Prepared: the queue shows `waiting(site: 9/9)` → `in_progress`. The stock drops by `200/100/50/50`, and the Hub completes about 20 s later.
6. **See** the territory ring (R 10) appear in the colony colour. The HUD shows storage cap 500 and supply 0/10.
7. Restart the app → **see** "Reconnecting…", then the same colony with its Hub and prepared tiles.
8. A second scenario run with no input for 60 s → **see** the Hub auto-placed on the lowest-prep-cost site and built (`UO-LC-07`).

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 3–7 (the HQ appears at its slot; the drop-pod descent of step 2 is stretch W01-23). `W01-37` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** Hub auto-placement (step 8), terraform VFX, touch controls, analytics, the spawn property test.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Guest auth: device secret, access/refresh JWT, logout (D-10, PROTOCOL §8) | W01-02 |
| 2 | WS `hello` with JWT; `ready {home}` | W01-03 |
| 3 | `/v1/me/home` (NEW → ACTIVE via dev planet auto-seat; lobby is W11) | W01-04, W01-05 |
| 4 | Temperate generator: hex radius 56, value-noise terrain classes and mix, deposits with richness (`SIM-GEN`, §4.5 mix table) | W01-06 |
| 5 | Spawn slots and spawn guarantee `UO-TF-09` (≥ 60 % Flat in r4; ≤ 3 non-Flat per 3×3; deposits within r8/r12) | W01-07, W01-33 |
| 6 | Tile model: `terrain`, `prep` states, ground passability multipliers (§4.8 table) | W01-08 |
| 7 | Drop pod landing + pod cargo `600/350/200/200` (§6.4 S0) | W01-09 |
| 8 | HQ T1: HP 900, speed 1.6, view 9, 1.5×, 0 supply, own power cell (`UO-HQ-01..03` basics, `UO-HQ-06`) | W01-10, W01-11 |
| 9 | Hex pathfinding (A\*, per-step budget 2 000 nodes) | W01-12 |
| 10 | Ops Grade / Clear / Break: time, energy per tile drawn over time, lump yields (`UO-TF-01..02`, §4.5) | W01-13 |
| 11 | Command Hub placement: 3×3, prepared-ground rule, unclaimed-tile exception (`UO-TF-05`), HQ-only (`UO-L-03`) | W01-14 |
| 12 | Linked prep orders, `waiting(site n/m)` (`UO-TF-03`, `UO-Q-04`) | W01-15 |
| 13 | Hub construction: pay on start, 30 s at 1.0× (20 s with HQ) (`UO-Q-01`, `UO-L-05`) | W01-16 |
| 14 | Hub effects: claim R 10, storage 500, supply 10, Founder Core field (used by W02) (`SIM-G-TER`) | W01-17 |
| 15 | Hub auto-placement after 60 s idle (`UO-LC-07`) | W01-18 |
| 16 | Snapshot survives restart with all W01 state | W01-19 |
| 17 | Terrain visuals per class and the Prepared pad material | W01-20, W01-21 |
| 18 | Terraform-op VFX (grade dust, break debris, clear chips) | W01-22 |
| 19 | Drop pod descent visual + HQ deploy | W01-23 |
| 20 | HQ visual (`robot.hero`) + work beam; Command Hub archetype + scaffold | W01-24, W01-25 |
| 21 | Selection, move order, HQ panel (HP, cell bar, current job) | W01-26 |
| 22 | Terraform menu v1 (single tile + area brush) and tile-state overlay | W01-27 |
| 23 | Hub placement ghost with prep bill | W01-28 |
| 24 | Minimal HUD: stock, cell, colony name, game clock, reject toasts | W01-29 |
| 25 | Territory border rendering | W01-30 |
| 26 | Achievement events: Landfall, Groundbreaker, Stone Mason (Clear/Break) | W01-31 |
| 27 | Analytics: `guest_created`, `first_welcome`, `first_command`, `hub_built` | W01-32 |
| 28 | Property tests: spawn guarantee over 1 000 seeds (AC-10), never build on unprepared tiles (AC-09) | W01-33, W01-34 |
| 29 | Dev console commands for W01 | W01-35 |
| 30 | Touch: tap select, tap-to-move, brush and placement in phone landscape (D-22) | W01-36 |
| 31 | Wave e2e + scenario + tag | W01-37 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W01-01 | Contracts & data: commands `placeBuilding`, `enqueueTask{terraform {op: grade\|clear\|break, tiles}}`, `cancelTask`, `moveUnit`; events `colonyFounded`, `hqLanded`, `tilePrepared`, `obstacleRemoved`, `buildingCompleted`; rows (wave `W01`): terrain classes, ops Grade/Clear/Break, HQ T1, Command Hub T1, starting kit; reject codes `site_blocked`, `terrain_unbuildable`, `not_own_territory` | contract | M | H | W00-08, W00-16 | Run `npm run gen` → see the new kinds in `CommandKind`; with `..00` the rows compile out | `UO-TF` §4.5, econ §3.1 | TA-14.1 |
| W01-02 | Guest auth: `POST /v1/auth/guest` (device secret, httpOnly refresh cookie), `/auth/refresh`, `/auth/logout`; `core.player`, `core.auth_session` | server | M | H | W00-09, W00-11 | Open the game on a new profile → see a `player` row created and the access token in memory, never in `localStorage` | D-10, PROTOCOL §8 | TA-04.2 |
| W01-03 | WS `hello` verifies the access JWT (replaces the dev session token); `ready {playerId, home}`; `reauth` | server | S | H | W01-02, W00-22 | Send `hello` with an expired token → see close `4003 forbidden` | WS-10, LB-02 | TA-04.2 |
| W01-04 | `GET /v1/me/home` minimal: `NEW` → auto-seat on the dev planet → `ACTIVE {colony, planet}`; `ELIMINATED`/`PLANET_ENDED` stubs | server | S | H | W01-02 | Call `/me/home` as a new guest → see `ACTIVE` with a colony id | CLIENT §3.2 | TA-04.4 |
| W01-05 | Dev planet seat assignment: one shared `pl_dev` (capacity 5), free spawn slot → `system.spawnColony`; when full, create `pl_dev_2` (the real lobby comes in W11) | server | S | H | W01-04, W01-07 | Log in 6 guests → see 5 on `pl_dev` and the 6th on `pl_dev_2` | MATCHMAKING (stub) | TA-05.4 |
| W01-06 | Temperate generator: hex radius 56, value noise on the `gen` stream; terrain classes Flat/Forest/Rock/Slope/Hole/Shallow/Deep with the §4.5 Temperate mix; metals/minerals/petroleum deposits with richness 9 000–12 000 bp; golden test | sim | M | H | W00-21 | Generate seed `golden-1` twice → see byte-identical grids and a class mix within ±2 % of the table | SIM-GEN, §4.5 mix | TA-06.2 |
| W01-07 | Spawn slots and guarantee: `capacity` slots on a radius-32 ring with ±3 jitter; within r4 only Flat/Forest/Rock/Deposit, ≥ 60 % Flat, ≤ 3 non-Flat per 3×3; metals within r8 plus a free 2×2; three deposit kinds within r12 | sim | M | H | W01-06 | Generate 100 seeds → see every slot satisfy all guarantee predicates | `UO-TF-09`, SIM-GEN | TA-06.2 |
| W01-08 | Tile model in sim: `grid.terrain`, `grid.prep` (`wild/flat/prepared/irrigated/living/ridge/moat`), `grid.owner`, `grid.explored`; ground movement multipliers per class; delta `t` ops for tile changes | sim | S | H | W00-14, W00-24 | Change a tile's prep in a test → see one `t` op in the next delta | §4.8 passability, SIM-S | TA-14.3 |
| W01-09 | Landing system: `system.spawnColony` creates the drop pod at the slot with cargo `600/350/200/200`; after the descent (6 s) it deploys the HQ, then the pod becomes an inert prop; `hqLanded` event | sim | S | H | W01-01, W01-07 | Spawn a colony → see the pod at tick 0, the HQ at about 6 s, and stock 600/350/200/200 | §6.4 S0 | TA-06.6 |
| W01-10 | HQ T1 unit: HP 900, speed 1.6 t/s, radius 0.6, view 9, work rate 1.5×, 0 supply, no grid draw; move command; HQ panel fields | sim | S | H | W01-01 | Order the HQ to a tile 16 away → see it arrive after about 10 s | `UO-HQ` table T1 | TA-06.6 |
| W01-11 | HQ power cell: 800 E capacity, 3 E/s self-recharge, 20 E/s fast recharge within 6 tiles of a powered Hub (counted as grid load in shed group 3); terraform energy is paid from the cell only | sim | S | H | W01-10 | Drain the cell to 0 → see Grade continue at the 3 E/s trickle (≈ 6.7 s per tile) | `UO-HQ-06` | TA-14.2 |
| W01-12 | Hex pathfinding: A\* over passable tiles with terrain multipliers, budget 2 000 node expansions per planet per step, FIFO `pathQueue` overflow | sim | M | H | W01-08 | Queue 50 paths at once → see none exceed the budget per step and all resolve within 3 s | SIM-T-02 | TA-06.6 |
| W01-13 | Ops Grade/Clear/Break: per-tile time (3/5/6 s at 1.0×), energy (20/30/60 E) drawn evenly over the work, lump yields (+5 Pet forest, +10 M rock), state transitions Forest/Rock → Flat → Prepared; Deposit tiles keep their deposit when graded; own-territory rule with the Hub exception | sim | M | H | W01-08, W01-11 | Grade 1 Flat tile with the HQ (1.5×) → see 2 s of work, 20 E from the cell, tile `prepared` | §4.5 ops table, `UO-TF-02`, `UO-TF-05` | TA-14.3 |
| W01-14 | Command Hub placement validation: 3×3 footprint, inside the map, not foreign-owned, no Deep Water; unclaimed tiles allowed only for a Hub (`UO-TF-05`); only one Hub; placement by HQ only | sim | S | H | W01-13 | Place a Hub on a foreign-owned tile → see `cmd.reject not_own_territory`; on unclaimed land → see it accepted | `UO-TF-05`, `UO-L-03` | TA-14.3 |
| W01-15 | Linked prep: placing on unprepared tiles creates one linked terraform order covering every missing op; construction shows `waiting(site: n/m)`; cancelling the construction cancels its prep; linked prep does not count toward lane limits | sim | M | H | W01-14 | Place the Hub on 6 Flat + 3 Rock → see one linked order with 6 Grade + 3 Break + 3 Grade sub-jobs and the count climb to 9/9 | `UO-TF-03`, `UO-Q-04` | TA-14.3 |
| W01-16 | Hub construction: paid on start (`200/100/50/50`), progress `buildTime / Σrate` (30 s at 1.0× → 20 s with the HQ), cancel in progress refunds 75 %, `buildingCompleted` | sim | S | H | W01-15 | Cancel the Hub at 50 % → see 75 % of the cost refunded and the prepared tiles kept | `UO-Q-01/02`, econ §3.1 | TA-06.4 |
| W01-17 | Hub effects on completion: claim R 10 (unclaimed → own, same owner → anchor, foreign → frozen), storage cap 500 each, supply cap 10, Founder Core field `+8 E/s` (power system lands in W02), `colonyFounded` | sim | S | H | W01-16 | Complete the Hub next to a neighbour's border → see the shared border unchanged and the rest of R 10 owned | econ §2.1, `SIM-G-TER` | TA-06.3 |
| W01-18 | Hub auto-placement: if no Hub order 60 s after landing, pick the lowest prep-cost valid site within the guarantee radius and order it (source `auto`) | sim | S |  | W01-15 | Load the scenario and wait 60 s → see a Hub order appear and complete without input | `UO-LC-07`, S0 | TA-14.5 |
| W01-19 | Restart survival: snapshot carries tiles, HQ cell, linked orders, construction progress; reconnect restores the view | test | S | H+ | W01-16, W00-29 | Restart mid-construction → see construction resume from the snapshot's progress | SIM-H-06 | TA-07.6 |
| W01-20 | Terrain visuals: render each class on the planet surface (forest props, rock clusters, slopes, hole craters, shallow/deep water) mapped to hex tiles; LOD for phones | visual | M | H | W00-28, W01-06 | Load seed `golden-1` → see every class visibly distinct in the iso view and in a playground audit screenshot | `procedural-texture-synthesis`, Pillar 3 | TA-14.9 |
| W01-21 | Prepared-ground pad material: foundation hex plates via `procedural-texture-synthesis` + terrain blend via `shader-texture-tuning`; Wild → Prepared transition | visual | M | H | W01-20 | Grade a tile → see it switch to the pad look with a 0.4 s blend | AGENTS Pillars 3, D-16 | TA-14.9 |
| W01-22 | Terraform-op VFX: Grade dust ring, Break debris, Clear wood chips, HQ work beam; pooled particles | visual | S |  | W01-21 | Run all three ops → see the matching VFX, with ≤ 1 extra draw call per effect type | AGENTS Pillar 1/3 | TA-14.9 |
| W01-23 | Drop pod descent: reuse `ship.dropPod` + `src/descent/fx` for a 6 s descent, landing dust, pod open, HQ deploy animation | visual | M | H+ | W01-09 | Spawn a colony → see the descent and the HQ step out at the server's `hqLanded` tick | — | — |
| W01-24 | HQ visual: `robot.hero` passes the playground 4-view audit (`minY 0`, < 3.5 k tris), walk + work animation via `aPartAnim` | visual | S | H | W01-10 | Open `/playground.html?inspect=robot.hero` → see the audit pass in all 4 views | AGENTS Pillar 1/4 | TA-14.9 |
| W01-25 | Command Hub T1 archetype `building.commandHub` (≥ 7 parts, silhouette breaker, 60/30/10 materials) + construction scaffold stages (0/33/66/100 %) | visual | M | H | W01-16 | Open `?inspect=building.commandHub` → see the audit pass; build in game → see the scaffold stages | AGENTS Pillar 1 | TA-14.9 |
| W01-26 | Client selection and orders: click or tap to select the HQ; right-click or tap to move; HQ panel with HP, cell bar, current job, queue count | client | M | H | W00-28, W01-10 | Select the HQ and right-click a tile → see it walk there and the panel show `moving` | CLIENT §8 | TA-11.6 |
| W01-27 | Terraform menu v1: Grade/Clear/Break with single-tile and area brush; one brush stroke = one order; ops not valid for a tile are skipped and counted; tile-state overlay toggle | client | M | H | W01-13 | Brush a 4×4 area of mixed terrain → see one order covering the needed ops and the overlay showing progress | `UO-M` Terraform row | TA-11.8 |
| W01-28 | Hub placement ghost: 3×3 footprint tinted valid/invalid with the reason, prep bill (tiles per op, seconds at HQ rate, E, yields), confirm/cancel; rotation not needed for 3×3 | client | M | H | W01-15 | Hover over a rock cluster → see the bill update live and the ghost turn red on foreign land with "not your territory" | `UO-TF-03`, `UO-M` | TA-11.8 |
| W01-29 | Minimal HUD (Faction Plate tokens): stock M/Min/Pet/W with cap, HQ cell bar, colony name, game clock, `cmd.reject` toasts with readable texts | client | S | H | W01-26 | Place the Hub without enough resources (dev `grant -1000`) → see a toast "Waiting: Metals 0/200" | CLIENT §8, `UO-Q-03` | TA-11.7 |
| W01-30 | Territory border rendering: owned tiles outlined in the colony colour, a hatch pattern for colour-blind mode, frozen borders thicker | client | S | H | W01-17 | Complete the Hub → see the R 10 outline appear | econ §2 | TA-11.6 |
| W01-31 | Progression events: `colonyFounded` (Landfall), `tilePrepared {count}` (Groundbreaker), `obstacleRemoved {op, count}` (Stone Mason) carrying `playerId`, batched per step onto the event bus | server | S | H | W01-17, W00-13 | Prepare 9 tiles → see 9 counted in `tilePrepared` events on the bus (W12 consumes) | profile spec §3 families 1–3 | TA-15.1 |
| W01-32 | Analytics: `guest_created`, `first_welcome`, `first_command`, `hub_built {ms_since_welcome}` via `track()` | client | S |  | W00-44 | Play through the demo → see the four events in `core.analytics_event` | CLIENT §10.3 | — |
| W01-33 | Spawn guarantee property test over 1 000 seeds; Hub site worst case ≤ 360 E and ≤ 60 s of HQ work (AC-10) | test | S |  | W01-07, W01-13 | Run `spawn-guarantee.property.spec.ts` → see 1 000/1 000 pass and the worst case reported | `UO-TF-09`, AC-10 | TA-14.3 |
| W01-34 | Property test: no structure ever starts construction on a tile not Prepared/Living (random command logs) (AC-09) | test | S | H | W01-16 | Run the property test with 500 random logs → see zero violations | `UO-TF-01`, AC-09 | TA-14.3 |
| W01-35 | Dev console commands: `grant <res> <n>`, `cell <E>`, `reveal`, `seed <s>` (regenerate the dev planet), `tp <q> <r>` (teleport selected), `land` (respawn colony) | client | S | H | W00-40 | Type `cell 0` → see the HQ cell empty and Grade slow to the trickle rate | PRODUCT_WAVES §3 | — |
| W01-36 | Touch controls: tap to select, tap a tile to move, two-finger pan, long-press-drag terraform brush, placement confirm button (phone landscape) | client | M |  | W01-27, W01-28 | Run the e2e in a 844×390 touch emulation → see the Hub placed and built with touch only | D-22, CLIENT §11 | TA-11.9 |
| W01-37 | Wave e2e `e2e/w01.spec.ts` (demo steps 1–8) + scenario `w01-landfall` (fresh colony at the drop moment; second variant with the auto-placement timer) + tag `wave-01` | test | S | H | all above | Run `npm run e2e -- --waves ..01` → see W00 and W01 suites pass; then tag `wave-01` | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w01.spec.ts` and `e2e/w00.spec.ts` pass.
- `?scenario=w01` loads at the drop moment.
- With `?waves=..00`, there is no landing, no HQ and no Construction/Terraform menu, and the planet is the flat W00 planet.
- AC-09 and AC-10 property tests are green. `robot.hero` and `building.commandHub` pass the playground audit.
- Tag `wave-01` is created.
