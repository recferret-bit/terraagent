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
> - [`CLIENT.md`](../../spec/CLIENT.md) §3, §8 (Terrain)
> - [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) §4.1
> - D-10, D-16, D-24, D-25, D-31, D-33, D-34, D-36
>
> **Owned paths:**
> - `shared/sim/src/systems/{landing,terraform-basic,construction,territory-claim}/`
> - `shared/sim/src/data/{terrain,ops-basic,hq,hub}.ts`
> - `shared/sim/src/gen/**`
> - `backend/app/src/modules/{auth,home}/`
> - `frontend/game/features/{landfall,terraform-basic,hub-placement,hud-min}/`
> - prototype play flow it replaces: `frontend/game/app/{Game,Gameplay,colonyLayout,groundPick}.ts`, `frontend/game/ui/{menu,hud}.ts`, `frontend/game/descent/**`
> - `frontend/render/planets/hex/**` terrain classes (after W00-28)
> - existing kitbash archetypes `building.commandHub` (`frontend/render/kitbash/archetypes/buildings/hub.ts`) and `robot.hero` (`.../units/robots.ts`): validator fixes, scaffold
> - `scenarios/w01-landfall.ts`
>
> **Already there (2026-10-30), client-only:** the drop-pod descent cinematic (`frontend/game/descent/`, `@terra/render/descent`), the `robot.hero` and `building.commandHub` archetypes (both currently fail the validator: about 12.7 k and 11.5 k triangles against the 3.5 k budget), the RTS camera, the orbital world-picker menu, hero click-to-move, a decorative seeded starter colony and a HUD with static numbers. Under D-31 none of that is game logic. This wave puts the rules in `@terra/sim` and drives these existing views from the sim state. The generator, prep ops, territory and building rules do not exist yet.

## Goal

The first real minute of the game, end to end:
1. A guest opens the game and is seated on a dev planet.
2. A drop pod lands.
3. The HQ drone terraforms the Hub site, paying energy from its own power cell.
4. The HQ drone builds the Command Hub, which claims territory.

The colony survives a server restart. Everything lands as a shippable app: no lobby yet (W11), no economy beyond the starting cargo (W02), no stages (W08).

**Planet type (D-33).** `PlanetType = 'desert' | 'ocean' | 'temperate'`, one-to-one with the existing looks `dune`, `oceanForest`, `forestRock` (`frontend/render/planets/PlanetSpec.ts`). This wave generates only **`temperate`** (SIMULATION §5 `planetType`); the `desert` and `ocean` generators are post-hackathon rows (W05-17). On screen, `temperate` uses the existing `forestRock` look (`PLANET_SPECS.forestRock`: palette, sky, pine/boulder scatter, water). The play page maps the sim type to the render kind (`planetType → PlanetKind`, all three entries); the sim never sees render kinds.

**Resources (D-34).** Stock is kept per sub-resource (`ResourceKey`, 10 keys: `metals.t1..t3`, `minerals.t1..t3`, `bio.water`, `bio.biomass`, `bio.t2`, `bio.t3`); only T1 exists in this wave. The `M/Min/Pet/W` cost shorthand in this file reads through the D-34 tier rule: a T1 item pays M → `metals.t1`, Min → `minerals.t1`, Pet → `bio.biomass`, W → `bio.water`. Energy is grid power, not a stock.

**How the hex grid is drawn (CLIENT §8 Terrain).** The sim's hex tiles are the only terrain truth. The terrain mesh is built from them in 32×32-tile chunks (W00-28), 2 m per tile, with the existing terrain and water shaders. Flat and Prepared tiles are level, so buildings sit at `minY 0`. Slope, Rock and Hole tiles get render-only relief, water tiles sit under the existing water plane, and Forest and Rock tiles carry the existing scatter props. Thin hex edge lines show the grid. The noise heightfield in `planets/surface` stays for the landing page, the playground and the prototype.

## Demo story (`e2e/w01.spec.ts`)

1. Open `/play.html` in a private window (fresh profile, no `?scenario`) → **see** the orbital boot splash while guest login happens silently, then the hand-over to the colony view (`/me/home = ACTIVE` on the dev planet) with no click.
2. **See** the existing descent cinematic bring the drop pod down onto the spawn slot and the HQ drone deploy. The HUD shows the stock (Metals 600, Minerals 350, Bio 400 = water 200 + biomass 200) and the HQ cell at `800 / 800 E`.
3. Open the Construction menu → **see** only "Command Hub". Hover a site → **see** a ghost footprint (3×3) with a prep bill (tiles, seconds, E, yields). Confirm.
4. **See** the HQ walk to the site and Grade, Clear and Break tiles one by one. Tiles change Wild → Prepared, and the cell bar drains. Rock and forest tiles yield +10 `metals.t1` / +5 `bio.biomass`.
5. **See** construction start once all 9 tiles are Prepared: the queue shows `waiting(site: 9/9)` → `in_progress`. The stock drops by `200/100/50/50`, and the Hub completes about 20 s later (dev console `warp 10` shortens the wait).
6. **See** the territory ring (R 10) appear in the colony colour. The HUD shows storage cap 500 per family and supply 0/10.
7. Run `npm run dev:restart` → **see** "Reconnecting…", then the same colony with its Hub and prepared tiles.
8. Open `/play.html?scenario=w01` in a new private window and touch nothing for 60 s (dev console `warp 10` makes it 6 s) → **see** the Hub auto-placed on the lowest-prep-cost site and built (`UO-LC-07`).

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–7. In step 2 the existing descent cinematic plays on the client (W01-38) and the HQ appears at its slot; syncing the touchdown to the server's slot and `hqLanded` tick is stretch W01-23. `W01-37` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** Hub auto-placement (step 8; stretch H+ W01-18), terraform VFX, touch controls (the touch pass of this demo is W24-35), analytics, the spawn property test.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Guest auth: device secret, access/refresh JWT, logout (D-10, PROTOCOL §8) | W01-02 |
| 2 | WS `hello` with JWT; `ready {home}` | W01-03 |
| 3 | `/v1/me/home` (NEW → ACTIVE via dev planet auto-seat; lobby is W11) | W01-04, W01-05 |
| 4 | Temperate generator (`type: 'temperate'`): hex radius 56, value-noise terrain classes and mix, deposits with richness (`SIM-GEN`, §4.5 mix table) | W01-06 |
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
| 17 | Terrain classes drawn on the sim's hex chunks with the existing `forestRock` look, and the Prepared pad material | W01-20, W01-21 |
| 18 | Terraform-op VFX (grade dust, break debris, clear chips) | W01-22 |
| 19 | Existing descent cinematic synced to the sim's landing (`hqLanded`) | W01-23 |
| 20 | Existing `robot.hero` (HQ) and `building.commandHub` brought to a validator pass; work animation; construction scaffold | W01-24, W01-25 |
| 21 | Selection, move order through the sim (replaces the prototype's client-side click-to-move), HQ panel (HP, cell bar, current job) | W01-26 |
| 22 | Terraform menu v1 (single tile + area brush) and tile-state overlay | W01-27 |
| 23 | Construction menu v0 (Command Hub only) + Hub placement ghost with prep bill | W01-28 |
| 24 | Minimal HUD from the sim view (replaces the static resource numbers): stock, cell, colony name, game clock, reject toasts | W01-29 |
| 25 | Territory border rendering | W01-30 |
| 26 | Achievement events: Landfall, Groundbreaker, Stone Mason (Clear/Break) | W01-31 |
| 27 | Analytics: `guest_created`, `first_welcome`, `first_command`, `hub_built` | W01-32 |
| 28 | Property tests: spawn guarantee over 1 000 seeds (AC-10), never build on unprepared tiles (AC-09) | W01-33, W01-34 |
| 29 | Dev console commands for W01 | W01-35 |
| 30 | Touch: tap select, tap-to-move, brush and placement in phone landscape (D-22), with W24's gestures; checked by W24-35's touch-emulation pass of this demo | W24-35 |
| 31 | Boot flow on `/play.html`: orbital splash → guest auth → `/me/home` → existing descent → colony view; retires the prototype's world picker and decorative colony online (CLIENT §3.2, `CL-01`, `CL-13`) | W01-38 |
| 32 | Wave e2e + scenario + tag | W01-37 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W01-01 | Contracts & data: commands `placeBuilding`, `enqueueTask{terraform {op: grade\|clear\|break, tiles}}`, `cancelTask`, `moveUnit`; events `colonyFounded`, `hqLanded`, `tilePrepared`, `obstacleRemoved`, `buildingCompleted`; rows (wave `W01`): terrain classes, ops Grade/Clear/Break, HQ T1, Command Hub T1, starting kit; `ResourceKey` (the 10 D-34 stock keys; only the T1 keys are granted in W01); reject codes `site_blocked`, `terrain_unbuildable`, `not_own_territory` | contract | M | H | W00-08, W00-16 | Run `npm run gen` → see the new kinds in `CommandKind`; with `..00` the rows compile out | `UO-TF` §4.5, econ §3.1 | TA-14.1 |
| W01-02 | Guest auth: `POST /v1/auth/guest` (device secret, httpOnly refresh cookie), `/auth/refresh`, `/auth/logout`; `core.player`, `core.auth_session` | server | M | H | W00-09, W00-11 | Call `POST /v1/auth/guest` with a new device secret → see a `player` row created, the access token in the body and the refresh token only in an httpOnly cookie | D-10, PROTOCOL §8 | TA-04.2 |
| W01-03 | WS `hello` verifies the access JWT (replaces the dev session token); `ready {playerId, home}`; `reauth` | server | S | H | W01-02, W00-22 | Send `hello` with an expired token → see close `4003 forbidden` | WS-10, LB-02 | TA-04.2 |
| W01-04 | `GET /v1/me/home` minimal: `NEW` → auto-seat on the dev planet → `ACTIVE {colony, planet}`; `ELIMINATED`/`PLANET_ENDED` stubs | server | S | H | W01-02 | Call `/me/home` as a new guest → see `ACTIVE` with a colony id | CLIENT §3.2 | TA-04.4 |
| W01-05 | Dev planet seat assignment: one shared `pl_dev` (capacity 5), free spawn slot → `system.spawnColony`; when full, create `pl_dev_2` (the real lobby comes in W11) | server | S | H | W01-04, W01-07 | Log in 6 guests → see 5 on `pl_dev` and the 6th on `pl_dev_2` | MATCHMAKING (stub) | TA-05.4 |
| W01-06 | Temperate generator: hex radius 56, value noise on the `gen` stream; terrain classes Flat/Forest/Rock/Slope/Hole/Shallow/Deep with the §4.5 Temperate mix; metal, mineral and oil deposits (oil = the `bio.t2` source of D-34) with richness 9 000–12 000 bp and the per-type richness modifier as a data row (`temperate`: Minerals +15 %, D-33); golden test | sim | M | H | W00-21 | Generate seed `golden-1` twice → see byte-identical grids and a class mix within ±2 % of the table | SIM-GEN, §4.5 mix | TA-06.2 |
| W01-07 | Spawn slots and guarantee: `capacity` slots on a radius-32 ring with ±3 jitter; within r4 only Flat/Forest/Rock/Deposit, ≥ 60 % Flat, ≤ 3 non-Flat per 3×3; metals within r8 plus a free 2×2; three deposit kinds within r12 | sim | M | H | W01-06 | Generate 100 seeds → see every slot satisfy all guarantee predicates | `UO-TF-09`, SIM-GEN | TA-06.2 |
| W01-08 | Tile model in sim: `grid.terrain`, `grid.prep` (`wild/flat/prepared/irrigated/living/ridge/moat`), `grid.owner`, `grid.explored`; ground movement multipliers per class; delta `t` ops for tile changes | sim | S | H | W00-14, W00-24 | Change a tile's prep in a test → see one `t` op in the next delta | §4.8 passability, SIM-S | TA-14.3 |
| W01-09 | Landing system: `system.spawnColony` creates the drop pod at the slot with cargo `metals.t1 600, minerals.t1 350, bio.biomass 200, bio.water 200`; after the pod phase (data row `podDescentS`, default 6 s, wave `W01`) it deploys the HQ, then the pod becomes an inert prop; `hqLanded` event | sim | S | H | W01-01, W01-07 | Spawn a colony → see the pod at tick 0, the HQ at about 6 s, and stock `metals.t1 600, minerals.t1 350, bio.biomass 200, bio.water 200` | §6.4 S0 | TA-06.6 |
| W01-10 | HQ T1 unit: HP 900, speed 1.6 t/s, radius 0.6, view 9, work rate 1.5×, 0 supply, no grid draw; move command; HQ panel fields | sim | S | H | W01-01 | Order the HQ to a tile 16 away → see it arrive after about 10 s | `UO-HQ` table T1 | TA-06.6 |
| W01-11 | HQ power cell: 800 E capacity, 3 E/s self-recharge, 20 E/s fast recharge within 6 tiles of a powered Hub (counted as grid load in shed group 3); terraform energy is paid from the cell only | sim | S | H | W01-10 | Drain the cell to 0 → see Grade continue at the 3 E/s trickle (≈ 6.7 s per tile) | `UO-HQ-06` | TA-14.2 |
| W01-12 | Hex pathfinding: A\* over passable tiles with terrain multipliers, budget 2 000 node expansions per planet per step, FIFO `pathQueue` overflow | sim | M | H | W01-08 | Queue 50 paths at once → see none exceed the budget per step and all resolve within 3 s | SIM-T-02 | TA-06.6 |
| W01-13 | Ops Grade/Clear/Break: per-tile time (3/5/6 s at 1.0×), energy (20/30/60 E) drawn evenly over the work, lump yields (+5 `bio.biomass` forest, +10 `metals.t1` rock), state transitions Forest/Rock → Flat → Prepared; Deposit tiles keep their deposit when graded; own-territory rule with the Hub exception | sim | M | H | W01-08, W01-11 | Grade 1 Flat tile with the HQ (1.5×) → see 2 s of work, 20 E from the cell, tile `prepared` | §4.5 ops table, `UO-TF-02`, `UO-TF-05` | TA-14.3 |
| W01-14 | Command Hub placement validation: 3×3 footprint, inside the map, not foreign-owned, no Deep Water; unclaimed tiles allowed only for a Hub (`UO-TF-05`); only one Hub; placement by HQ only | sim | S | H | W01-13 | Place a Hub on a foreign-owned tile → see `cmd.reject not_own_territory` | `UO-TF-05`, `UO-L-03` | TA-14.3 |
| W01-15 | Linked prep: placing on unprepared tiles creates one linked terraform order covering every missing op; construction shows `waiting(site: n/m)`; cancelling the construction cancels its prep; linked prep does not count toward lane limits | sim | M | H | W01-14 | Place the Hub on 6 Flat + 3 Rock → see one linked order with 6 Grade + 3 Break + 3 Grade sub-jobs and the count climb to 9/9 | `UO-TF-03`, `UO-Q-04` | TA-14.3 |
| W01-16 | Hub construction: paid on start (`200/100/50/50`), progress `buildTime / Σrate` (30 s at 1.0× → 20 s with the HQ), cancel in progress refunds 75 %, `buildingCompleted` | sim | S | H | W01-15 | Cancel the Hub at 50 % → see 75 % of the cost refunded and the prepared tiles kept | `UO-Q-01/02`, econ §3.1 | TA-06.4 |
| W01-17 | Hub effects on completion: claim R 10 (unclaimed → own, same owner → anchor, foreign → frozen), storage cap 500 per family (Metals, Minerals, Bio; D-34), supply cap 10, Founder Core field `+8 E/s` (power system lands in W02), `colonyFounded` | sim | S | H | W01-16 | Complete the Hub next to a neighbour's border → see the shared border unchanged and the rest of R 10 owned | econ §2.1, `SIM-G-TER` | TA-06.3 |
| W01-18 | Hub auto-placement: if no Hub order 60 s after landing, pick the lowest prep-cost valid site within the guarantee radius and order it (source `auto`) | sim | S | H+ | W01-15 | Load the scenario and wait 60 s → see a Hub order appear and complete without input | `UO-LC-07`, S0 | TA-14.5 |
| W01-19 | Restart survival: snapshot carries tiles, HQ cell, linked orders, construction progress; reconnect restores the view | test | S | H+ | W01-16, W00-29 | Restart mid-construction → see construction resume from the snapshot's progress | SIM-H-06 | TA-07.6 |
| W01-20 | Terrain classes on the hex chunks of W00-28, reusing the existing `forestRock` look: Forest → pine scatter, Rock → boulder clusters and spires (`@terra/render/visuals/terrain/Scatter.ts`), Shallow/Deep → the existing water plane (`Liquids.ts`), Slope → render-only relief, Hole → crater dip (new); Flat level; palette and sky from `PLANET_SPECS.forestRock`; scatter per tile, so a cleared tile drops its props (phone LOD is W24-20) | visual | M | H | W00-28, W01-06 | Load seed `golden-1` → see every class visibly distinct in the iso view and in a playground audit screenshot | CLIENT §8 Terrain, `procedural-texture-synthesis`, Pillar 3 | TA-14.9 |
| W01-21 | Prepared-ground pad material: foundation hex plates via `procedural-texture-synthesis` + terrain blend via `shader-texture-tuning`; Wild → Prepared transition — extend the existing terrain shader (`frontend/render/visuals/terrain/terrainShader.ts`) and `ProceduralTextureRegistry`, no second terrain material | visual | M | H | W01-20 | Grade a tile → see it switch to the pad look with a 0.4 s blend | AGENTS Pillars 3, D-16 | TA-14.9 |
| W01-22 | Terraform-op VFX: Grade dust ring, Break debris, Clear wood chips, HQ work beam; pooled particles built on the existing `createParticles` (`@terra/render/visuals/terrain/Particles.ts`) | visual | S |  | W01-21 | Run all three ops → see the matching VFX, with ≤ 1 extra draw call per effect type | AGENTS Pillar 1/3 | TA-14.9 |
| W01-23 | Sync the existing descent cinematic (`frontend/game/descent/`, `@terra/render/descent/dropRig`, `ship.dropPod`) to the sim: aim it at the colony's spawn slot and fit its timeline (authored 35 s, scaled through `duration`) so touchdown and the hero walk-out land on the server's `hqLanded` tick (the sim's `podDescentS` from W01-09 is authoritative) | visual | S | H+ | W01-09, W01-38 | Spawn a colony → see the pod touch down on its slot and the HQ step out at the server's `hqLanded` tick | §6.4 S0, D-31 | — |
| W01-24 | Fix the existing `robot.hero` archetype (the HQ) to a validator pass: cut it from about 12.7 k to < 3.5 k triangles, fix `ANIM_DETACH` and degenerate triangles, keep `minY 0`; add a work pose to the walk animation via `aPartAnim` | visual | M | H | W01-10 | Open `/playground.html?inspect=robot.hero&validate=1` → see 0 errors and 0 warnings in all 4 views | AGENTS Pillar 1/4, CLAUDE.md model rules | TA-14.9 |
| W01-25 | Fix the existing `building.commandHub` archetype to a validator pass (about 11.5 k → < 3.5 k triangles, `CABLE_CLIPS`, degenerate triangles) and add construction scaffold stages (0/33/66/100 %) as a shader uniform, not a separate mesh | visual | M | H | W01-16 | Build the Hub in game → see the scaffold stages 0/33/66/100 % on the validator-clean model | AGENTS Pillar 1, CLIENT §8 Entities | TA-14.9 |
| W01-26 | Client selection and orders: click or tap to select the HQ; right-click or tap to move sends `moveUnit`, replacing the prototype's client-side click-to-move in `frontend/game/app/Gameplay.ts` (keep its ground pick and target marker); HQ panel with HP, cell bar, current job, queue count | client | M | H | W00-28, W01-10 | Select the HQ and right-click a tile → see it walk there and the panel show `moving` | CLIENT §8, D-31 | TA-11.6 |
| W01-27 | Terraform menu v1: Grade/Clear/Break with single-tile and area brush; one brush stroke = one order; ops not valid for a tile are skipped and counted; tile-state overlay toggle | client | M | H | W01-13 | Brush a 4×4 area of mixed terrain → see one order covering the needed ops and the overlay showing progress | `UO-M` Terraform row | TA-11.8 |
| W01-28 | Construction menu v0 (one entry, "Command Hub") + Hub placement ghost: 3×3 footprint tinted valid/invalid with the reason, prep bill (tiles per op, seconds at HQ rate, E, yields), confirm/cancel; rotation not needed for 3×3 | client | M | H | W01-15 | Hover over a rock cluster → see the bill update live and the ghost turn red on foreign land with "not your territory" | `UO-TF-03`, `UO-M` | TA-11.8 |
| W01-29 | Minimal HUD (vanilla DOM panel classes on `frontend/game/ui/` + Faction Plate CSS, D-36) from the sim view, replacing the prototype's static resource numbers in `frontend/game/ui/hud.ts`: stock per family (Metals, Minerals, Bio; T1 only in W01) with the family cap, HQ cell bar, colony name, game clock, `cmd.reject` toasts with readable texts | client | S | H | W01-26 | Place the Hub without enough resources (dev `grant -1000`) → see a toast "Waiting: Metals 0/200" | CLIENT §8, `UO-Q-03` | TA-11.7 |
| W01-30 | Territory border rendering: owned tiles outlined in the colony colour, a hatch pattern for colour-blind mode, frozen borders thicker — an overlay on the existing terrain material/viewport (`frontend/render/`), colony colours from the globe territories (`render/planets/globe/`) | client | S | H | W01-17 | Complete the Hub → see the R 10 outline appear | econ §2 | TA-11.6 |
| W01-31 | Progression events: `colonyFounded` (Landfall), `tilePrepared {count}` (Groundbreaker), `obstacleRemoved {op, count}` (Stone Mason) carrying `playerId`, batched per step onto the event bus | server | S | H | W01-17, W00-13 | Prepare 9 tiles → see 9 counted in `tilePrepared` events on the bus (W12 consumes) | profile spec §3 families 1–3 | TA-15.1 |
| W01-32 | Analytics: `guest_created`, `first_welcome`, `first_command`, `hub_built {ms_since_welcome}` via `track()` | client | S |  | W00-44 | Play through the demo → see the four events in `core.analytics_event` | CLIENT §10.3 | — |
| W01-33 | Spawn guarantee property test over 1 000 seeds; Hub site worst case ≤ 360 E and ≤ 60 s of HQ work (AC-10) | test | S |  | W01-07, W01-13 | Run `spawn-guarantee.property.spec.ts` → see 1 000/1 000 pass and the worst case reported | `UO-TF-09`, AC-10 | TA-14.3 |
| W01-34 | Property test: no structure ever starts construction on a tile not Prepared/Living (random command logs) (AC-09) | test | S | H | W01-16 | Run the property test with 500 random logs → see zero violations | `UO-TF-01`, AC-09 | TA-14.3 |
| W01-35 | Dev console commands: `grant <res> <n>` (`<res>` is a `ResourceKey`, e.g. `metals.t1`), `cell <E>`, `reveal`, `seed <s>` (regenerate the dev planet), `tp <q> <r>` (teleport selected), `land` (respawn colony) | client | S | H | W00-40 | Type `cell 0` → see the HQ cell empty and Grade slow to the trickle rate | PRODUCT_WAVES §3 | — |
| W01-38 | Boot flow on `/play.html` (CLIENT §3.2): show the existing orbital menu stage (`frontend/game/ui/menu.ts`) as the boot splash ("Contacting orbit…") while guest auth and `/me/home` run; `ACTIVE` → join the planet, play the existing descent cinematic only while the `welcome` state still has this colony's pod descending (no `hqLanded` yet), so a reload after landing skips it, then hand over to the sim-driven colony view; the world/seed picker and DEPLOY stay only for `?host=local`, and the decorative colony (`colonyLayout.ts`) is no longer shown online | client | M | H | W01-03, W01-04, W00-25, W00-28 | Open `/play.html` on a fresh profile → see the splash, the descent and then the colony view on `pl_dev` without any click | CLIENT §3.2, `CL-01`, `CL-13` | TA-11.1 (part: auth bootstrap) |
| W01-37 | Wave e2e `e2e/w01.spec.ts` (demo steps 1–8) + scenario `w01-landfall` (fresh colony at the drop moment; second variant with the auto-placement timer) + tag `wave-01` | test | S | H | all above | Run `npm run e2e -- --waves ..01` → see W00 and W01 suites pass; then tag `wave-01` | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w01.spec.ts` and `e2e/w00.spec.ts` pass.
- `?scenario=w01` loads at the drop moment.
- With `?waves=..00`, there is no landing, no HQ and no Construction/Terraform menu, and the planet is the flat W00 planet.
- Online, `/play.html` no longer shows the prototype's world picker, decorative colony or static HUD numbers. They remain only with `?host=local` (picker) or with `TA_WAVES` below W01 (the full prototype flow).
- AC-09 and AC-10 property tests are green. `robot.hero` and `building.commandHub` pass `npm run validate:models` (0 errors, 0 warnings) and the playground audit.
- Tag `wave-01` is created.

## Notes

- **Rescoped in the 2026-10-30 layout review** against the existing prototype. W01-23 shrank from M to S: the descent cinematic exists, so only syncing it to the sim remains. W01-24 grew from S to M: `robot.hero` exists but is about 3.6 times over the triangle budget. W01-25 now fixes the existing `building.commandHub` instead of building it. W01-26 and W01-29 now drive the existing click-to-move and HUD from the sim. W01-20 reuses the existing terrain look on the sim's hex chunks. The Construction menu of demo step 3 is now part of W01-28.
- **Added W01-38** (boot flow). Demo step 1 needs it, and no issue covered the client side of guest auth and `/me/home` or the fate of the prototype's orbit menu. The full home routing (`NEW`/`QUEUED`, picker) stays in W11-21.
