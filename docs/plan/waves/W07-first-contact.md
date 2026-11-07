# W07 — First Contact (hive fauna + battle v1)

> **Track:** Gameplay (G) · **Flag:** `W07` · **Scenario:** `tests/scenarios/w07-first-contact.ts` · **Tag:** `wave-07` · **Depends on:** W03
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §5.2, §5.4 (`UO-C-00..08`), §5.5, §5.6, §6.3 (`UO-T-01..04`), §3.3 (`UO-S`), §3.2 (`UO-HQ-03`) · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §3.5 (DCA), §3.6 (Factory), §3.7 (turrets) · [`SIMULATION.md`](../../spec/SIMULATION.md) §7.6, §7.7, §9 · [`CLIENT.md`](../../spec/CLIENT.md) §8b · D-28, D-33, D-34, D-35 · [`OWNER_TASKS.md`](../OWNER_TASKS.md) B2, B4, B7–B11
> **Balance (D-35):** every battle number here (HP, damage, rates, ranges, view radii, stance radii, raid timers, nest density) is a data row in `shared/sim/src/data/{weapons,combat-units,fauna}.ts`, tunable at runtime with W00-59's `tune` (e.g. `tune weapons.autocannon_t1.dmg 11`). Where the specs left a number open, the accepted OWNER_TASKS defaults B2, B4, B7–B11 are the starting rows. Building and unit costs (`M/Min/Pet/W`) read through the D-34 T1 rule (`metals.t1` / `minerals.t1` / `bio.biomass` / `bio.water`).
> **Owned paths:** `shared/sim/src/systems/{combat,projectiles,fauna,raids,factory,supply,vision,units}/`, `shared/sim/src/units/movement/{groupMarch,slots}.ts`, `shared/sim/src/grid/flowField.ts`, `shared/sim/src/data/{weapons,combat-units,fauna}.ts`, `shared/contracts/src/commands/{attack-move,attack-target,set-rally,set-stance,move-group,dev-faunamode,dev-godmode,dev-spawnhive,dev-spawnraid,dev-spawnunit}.ts`, `shared/sim/test/duels.spec.ts`, `frontend/game/features/{combat,combat-tuning,army,range-rings,units-menu,devtools-w07,landfall}/`, `frontend/render/{animation/insects,combat,motion}/`, archetypes in `frontend/render/kitbash/archetypes/buildings/tech.ts` (bind existing `turret`, `roboticsFactory`, `droneArray`; new `building.laserTower`) and `frontend/render/kitbash/archetypes/units/{recon,bugs,hives,ambientNests,robots,nature}.ts` (`robot.recon` six-wheel Armored Scout, three insect species and their organic hives). Also owns the fauna directive contracts/codec integration (`DIFF_FORMAT=2`, `SIM_VERSION=3`, `faunaMotionSeed.ts`, `projectileQueue.ts`, `stancePatch.ts`), backend checkpoint delivery, `frontend/playground/` hive-life + firing-range + group-march fixtures, pooled combat/liquid particle presets (`presetsCombat.ts`, `presetsLiquid.ts`), and workspace bug/hive/animation skills (`procedural-bug-3d`, `procedural-hive-3d`, `procedural-insect-animation`).
> **Soft dependencies:** stage numbers (`threatStage`, S3 floor, Laser Tower unlock) ← W08; minimap alert pings ← W04-12; box select ← W04-23.

> **Fauna revision (2026-11-04):** [Hive fauna contract](../../game/fauna-hives-spec.md) governs neutral/passive life, colony-scoped aggression, three species and hives, deterministic directives, shared planet skins and playground delivery. It supersedes the old single-Skitter proximity-aggro design. All requirements below are planned, not implemented.

## Goal

The colony meets **neutral, hive-based insect fauna** and fights back with the **battle v1** system:
- black ant melee hordes, armored blue beetle tanks and green acid spitters, each with its own hive;
- passive hive life and aggressive attack waves, with no simulated food/building economy;
- plain HP and plain damage (blue armor is plating + durability; see the balance question in GP-80);
- projectiles judged when their flight time ends;
- lasers, rockets and AoE;
- evasive units;
- view and spotting.

Also in this wave:
- the Robotics Factory T1, the Recon drone, Autocannon and Laser Tower turrets;
- the supply cap with Drone Control Arrays;
- army orders (stance, rally, attack-move);
- range and view rings, projectile and impact visuals.

## Demo story (e2e `tests/e2e/w07.spec.ts`)

1. Open `/play.html?scenario=w07`: an S3 colony with power and three passive species-specific hives at least 30 tiles away. Walk past them: bugs forage, rest and tend their hives; neither side auto-attacks. Inspect the black ant, blue beetle and green spitter in the playground hive-life scenes.
2. Construction menu → build a Robotics Factory T1 → the Units menu shows an Army section. Order 3 Recon → they roll out to the rally flag.
3. Order another Recon at supply 10/10 → rejected `supply_cap` (toast). Build a Drone Control Array → the cap reads 18 and the order proceeds.
4. Build an Autocannon and a Laser Tower (Laser Tower T1 unlocks at S3, B7 default) → selecting each shows its weapon range ring and view ring. Hold `Alt` → rings for every own unit.
5. Wait for the raid (dev console `warp 10` shortens it, or run `spawnRaid 5`) (species-specific residents within the threat-point budget) → `underAttack` fires and an alert ping shows on the screen edge (and on the minimap when W04 is on).
   - Turrets fire: tracers for bullets, a beam for the laser.
   - HP bars appear on damaged units and buildings.
   - Dead ants are removed and counted.
6. In the dev console run `spawnUnit demoArtillery`, and move a Recon in front of the ants → the shells **miss** the evasive Recon and explode at the aim point with an AoE decal (`hitDebug on` draws aim points and hit circles). Shells at a stationary ant → hit.
7. Explicitly attack a passive hive: it becomes aggressive toward your colony only. Select the Recon and order an attack on the hive → they destroy it (HP 1 500); its replenishment and future waves stop. `nestDestroyed` fires (toast / event log).
8. Repel a raid (`spawnRaid 3`) with no building lost → `raidRepelled` fires and Unbreached progress +1 (on `/me.html` when W12 is on).
9. Reconnect a second browser during a wave: hive identity, cohort, HP and acid impacts agree; the network sends directives and sparse corrections, not every bug transform each tick. Save/reload repeats the same decisions.
10. Destroy a building with `damage <entity> 100` in the dev console → collapse VFX, then the tile shows a Prepared pad.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–9. `W07-32` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** building collapse rubble VFX (`W07-23`, step 10; insect hit/death presentation and Prepared-pad transition are implemented, `RN-66`), Factory (`4×3` vs `3×3`) and DCA (`2×2` vs `1×1`) model footprint refits (`W07-24` partial; dedicated `building.laserTower` and six-wheel `robot.recon` Armored Scout are implemented, `RN-66`), the CI duel harness (`W07-26`, `GP-81`), and analytics (`W07-28`, post-hackathon). The three bugs, three organic hives, GPU-instanced swarm renderer, hive-life + shooting-gallery + group-march playground scenes, `F6` Combat Lab (`combat-tuning`), `moveGroup` flow-field slot march, replay checks and fauna bandwidth/perf measurement are shipped in the slice.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Plain HP/damage: no armor or multipliers; death removes the unit; a destroyed building leaves Prepared ground (`UO-C`, `UO-TF-04`) | W07-02 |
| 2 | HQ self-preservation below 40 % HP (`UO-HQ-03`) | W07-02 |
| 3 | Common unit 1 tile = 2 m; all ranges and speeds in tiles (`UO-C-00`) | W07-01 |
| 4 | Projectiles: flight time, one-time lead aim, stored impact event, no flight or collision sim, hit check at impact (`UO-C-03`) | W07-03 |
| 5 | AoE: 50 % to other enemies within `aoe`, missed shells explode, no friendly fire | W07-04 |
| 6 | Lasers instant; melee bite = range-1 laser (`UO-C-02`) | W07-05 |
| 7 | Evasive units change heading every 0.5 s while engaging (seeded PRNG) (`UO-C-04`) | W07-06 |
| 8 | Layers `hitsGround` / `hitsAir`; Autocannon hits air (`UO-C-01`) | W07-07 |
| 9 | View and spotting: shared colony view, fire only on spotted targets (`UO-C-06`) | W07-08 |
| 10 | Targeting: nearest hittable in range, lowest id tie, sticky target, min range (`UO-C-07`) | W07-09 |
| 11 | Robotics Factory T1: Units lane production, factory speed, rally | W07-10 |
| 12 | Supply: DCA T1 +8 and army unit supply costs on W02-10's Hub +10 cap and `supply_cap` (`UO-S-01`) | W07-11 |
| 13 | Stances Hold / Defend area / Hunt, attack-move, rally | W07-12 |
| 14 | Recon (evasive, bullet 7 × 2/s, range 4, view 10), Autocannon T1 (bullet 9 × 2/s, range 8, hits air), Laser Tower T1 (laser 6 × 4/s, range 9, ground + air) | W07-13 |
| 15 | Three neutral insect species + species-specific hives; passive life, provocation, bounded aggressive waves | W07-14 |
| 16 | Stage-scaled raids: not before S3 + 5 min, threat budget `min(12, 2 + threatStage + thermalCount)`, every 10 min, chance `10 % + 5 % × thermal` (`UO-T-01..04`) | W07-15 |
| 17 | Events: `underAttack` (debounce 600), `raidStarted`, `raidRepelled`, `buildingDestroyed`, `unitDestroyed`, `nestDestroyed` (SIM §9) | W07-16 |
| 18 | Projectile and hit deltas over WS | W07-17 |
| 19 | Army UI: Factory queue, supply meter, rally flag | W07-18 |
| 20 | Selection and orders: stance buttons, attack-move (`A` + click), right-click attack | W07-19 |
| 21 | HP bars, under-attack pings | W07-20 |
| 22 | Range rings: weapon, min, view; `Alt`; enemy hover red; turret ghost (`UO-C-08`, CLIENT §8b) | W07-21 |
| 23 | Projectile VFX: tracers, shell arcs, rocket trails, laser beams, impact flash, AoE decal, miss explosions | W07-22 |
| 24 | Death and destruction VFX | W07-23 |
| 25 | Archetypes: bind existing Factory (`roboticsFactory`), Autocannon (`turret`, twin barrels + recoil), DCA (`droneArray`); new Laser Tower T1; three insects and their species-specific hives, six-leg gaits and attack states; Recon re-skin of `robot.combat` | W07-24, W07-25, W07-34 |
| 26 | Duel harness in CI: ground-triangle rows of §5.5 with Recon + dev `demoTank` / `demoArtillery` (`AC-04`; real Tank/Artillery rows in W17-26, air rows in W19-27) | W07-26 |
| 27 | Achievements: Exterminator, Nest Breaker, Unbreached | W07-27 |
| 28 | Analytics | W07-28 |
| 29 | Dev console: raids, spawns, god mode, hit-debug lines, demo artillery | W07-29 |
| 30 | Perf: 200 units + 50 projectiles within the tick budget | W07-30 |
| 31 | Unit tests: impact check, AoE, layers, evasive | W07-31 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W07-01 | Contracts & data: weapon rows (bullet/shell/rocket/laser: dmg, rate, range, minRange, projSpeed, aoe, arc, hitsGround, hitsAir); unit rows Recon (+ dev-only `demoArtillery`, `demoTank`); Factory T1, Autocannon T1, Laser Tower T1 (`unlock: 'S3'`, B7 default), DCA T1, blackAnt, blueBeetle, greenSpitter and their hives; commands `setStance`, `setRally`, `attackMove`, `attackTarget` (`buildUnit` and the `supply_cap` reject are W02-01's); events `projectileFired`, `projectileImpact`, `unitDestroyed`, `buildingDestroyed`, `underAttack`, `raidStarted`, `raidRepelled`, `nestDestroyed`; flag `W07` | contract | M | H | W03-01 | `TA_WAVES=..07` → `compileData` lists 4 weapon kinds and the new rows; all distances are stored in tiles | `UO-C-00..02`, §5.2 | TA-14.1 |
| W07-02 | HP and damage core: plain damage, unit death removal, building destruction → Prepared tile, HQ retreat + self-repair 1 %/s below 40 % HP | sim | M | H | W07-01 | Dev-damage the HQ to 35 % → it drops its job and returns to the Hub; destroy a depot → its tiles read Prepared | `UO-C`, `UO-HQ-03`, `UO-TF-04` | TA-14.4 |
| W07-03 | Projectile events: on fire `t = dist / speed`, `aim = pos + vel × t`, push `{impactAt, aim, dmg, aoe, shooter, target}` to an impact queue ordered by tick; at impact hit iff target alive and `dist(target, aim) ≤ aoe + radius` | sim | M | H | W07-02 | Fire a 4-tile/s shell at a stationary dummy 8 tiles away → impact after exactly 2.0 s → hit | `UO-C-03` | TA-14.4 |
| W07-04 | AoE: other enemies within `aoe` of the aim take 50 %; missed shells explode at the aim point; no friendly fire | sim | S | H | W07-03 | Shell at a group of 4 dummies 1 tile apart, aoe 1.5 → the centre takes 90, neighbours within 1.5 take 45, own units take 0 | `UO-C-03` | TA-14.4 |
| W07-05 | Lasers: instant hit in range; melee bite modelled as a range-1 laser firing the species data-row cadence and damage (B11 default, data row) | sim | S | H | W07-02 | Laser Tower vs a ant in range → damage is applied in the same tick, every shot hits | `UO-C-02` | TA-14.4 |
| W07-06 | Evasive behaviour: while engaging, evasive units pick a new heading every 0.5 s (PRNG `combat`) and keep moving, strafing around their target | sim | S | H | W07-03 | A Recon under slow-shell fire for 20 s → shells miss (≥ 80 % misses) | `UO-C-04` | TA-14.4 |
| W07-07 | Layers: weapons respect `hitsGround` / `hitsAir`; units skip targets they cannot hit; Autocannon and Laser Tower flagged `hitsAir`; Recon and HQ weapons are ground-only (B4 default, data rows) | sim | S | H | W07-01 | An air-only test weapon next to a ground ant never fires; a Laser Tower fires at both a ant and an air test dummy | `UO-C-01` | TA-14.4 |
| W07-08 | View and spotting: per-colony shared view set from unit, building and beacon view radii (buildings: footprint radius + 4 tiles, Hub and Beacon T1: + 6; B2 default, data rows), updated every 5 ticks; weapons fire only at spotted targets | sim | M | H | W07-01 | A dev artillery at range 14 with no spotter does not fire; add a Recon within view of the target → it fires | `UO-C-06` | TA-14.4 |
| W07-09 | Targeting and min range: nearest hittable in range, tie → lowest id, sticky until dead or out of range; units inside min range back off | sim | S | H | W07-08 | Two ants equidistant → the lower id is shot first and the target is kept after the other moves closer | `UO-C-07` | TA-14.4 |
| W07-10 | Robotics Factory T1: Units-lane production of army units (factory 1.0×), 5-slot local buffer, least-loaded factory dispatch, units walk to the rally flag | sim | M | H | W07-01 | Queue 3 Recon → they are produced one after another (14 s each) and gather at the rally point | econ §3.6, `UO-D-04` | TA-06.6 |
| W07-11 | Army supply: DCA T1 +8 cap (1×1, −5 E/s, shed group 4) and supply costs for army units, on top of W02-10's Hub +10 cap and `supply_cap` check; cap shown in the colony view | sim | S | H | W07-10, W02-10 | At 10/10 → `buildUnit` is rejected `supply_cap`; after a DCA completes, 18 is the cap | `UO-S-01`, econ §3.5 | TA-06.6 |
| W07-12 | Stances (Hold, Defend area with an 8-tile leash, Hunt with a 15-tile search radius; B9 defaults, data rows), `attackMove` (engage anything on the way), `attackTarget`, `setRally` | sim | M | H | W07-09 | Hunt-stance Recon → it seeks the nearest spotted hostile within 15 tiles and ignores passive fauna; Hold → it fires but never moves | §5.4, `UO-M` | TA-14.4 |
| W07-13 | Combat stats in play: Recon (HP 240, speed 3.0, radius 0.4, bullet 7 × 2/s, r 4, view 10), Autocannon T1 (bullet 9 × 2/s, r 8, hits air), Laser Tower T1 (laser 6 × 4/s, r 9), turret draw and shed group 4; no Autocannon ammo drain and no Laser +12 E/s firing spike in battle v1 (B10 default) | sim | S | H | W07-05, W07-07 | `compileData` snapshot test matches §5.2 values exactly | §5.2 | TA-14.4 |
| W07-14 | Hive simulation: species-owned homes, seeded placement, passive neutrality, colony-scoped provocation, resident population caps, cosmetic life intents; normal unit runner/pathfinding | sim | M | H | W07-05 | Walk past three hives → no attack; damage one → only that hive targets your colony; blocked entrances do not burst-spawn | Hive fauna contract | — |
| W07-15 | Bounded hive waves: scheduled S3 grace/thermal roll, 3-wave episodes, cooldown, species threat-point costs, living resident dispatch, target loss/return and hive destruction | sim | M | H | W07-14, W03-10 | Each species sends a distinct wave; bounds hold across repeated damage, hive death, unreachable targets and colony elimination | Hive fauna contract | — |
| W07-16 | Combat events: `underAttack` (debounce 60 s per colony), `raidStarted`, `raidRepelled` (all raiders dead; `unbreached` flag if no own building was lost), `buildingDestroyed`, `unitDestroyed`, `nestDestroyed` | sim | S | H | W07-15 | A raid repelled with 0 buildings lost → `raidRepelled {unbreached: true}` is emitted once | SIM §9 | TA-06.8 |
| W07-17 | Combat sync: projectile/impact events and authoritative HP/death confirmations; integrate fauna directive replay and sparse corrections without duplicating effects | sim | M | H | W07-03, W07-33 | Two clients agree on acid impacts and deaths; ≤15 KB/s in the specified 50-unit encounter | Hive fauna contract | — |
| W07-18 | Army UI: Units-menu Army section (Recon; dev units hidden), Factory queue with progress, supply meter `used / cap`, rally-flag placement | client | M | H | W07-10, W07-11 | Order 2 Recon → the Factory queue shows them with progress bars and supply reads 2/10 | `UO-M` | TA-11.8 |
| W07-19 | Army orders: click / shift-click select own combat units (extends W01-26; box select comes from W04-23 when it lands), stance buttons, `A` + click attack-move, right-click attack target, order-feedback markers (touch long-press is W24-12) | client | M | H | W07-12 | Shift-click 3 Recon, press `A`, click the nest → move markers appear and the units attack-move | CLIENT §8 | TA-11.8 |
| W07-20 | HP bars (shown when damaged or selected, colony-coloured), under-attack alert pings on the screen edge (minimap pings come from W04-12 when W04 is on), combat event log entries | client | S | H | W07-16 | Damage a building → its HP bar appears; an off-screen attack shows an edge ping | CLIENT §8 | TA-11.7 |
| W07-21 | Range and view rings: one instanced ring mesh with a dash shader; weapon (solid orange), min (dashed red), view (dashed white 40 %); `Alt` for all own units; enemy hover red; turret ghost range | client | M | H | W07-13 | Select the Autocannon → an 8-tile ring (16 m) and a 9-tile view ring render; `Alt` shows every unit's rings in one draw call | `UO-C-08`, CLIENT §8b | TA-14.10 |
| W07-22 | Projectile VFX: bullet tracers, shell parabolic arcs, rocket smoke trails, laser beams held 0.1 s; impact flash + AoE ground decal; miss explosions at the aim point; the client never decides hits — pooled; reuse `frontend/render/visuals/terrain/Particles.ts`, the descent `Flames`/`Streaks` shaders for rocket trails and the existing bloom (emissive ≥ 3) | visual | M | H | W07-17 | Run the demo-artillery step → visible arcs, misses explode beside the Recon, and hits match server `projectileImpact` | CLIENT §8b | TA-14.10 |
| W07-23 | Death and destruction VFX: unit explosion + debris, building collapse into rubble that fades to the Prepared pad, ant death animation — reuse `Particles.ts` and the descent `GroundFX` dust ring | visual | S | H+ | W07-02 | Destroy a depot → rubble for ~3 s, then the Prepared pad | VFX | TA-14.9 |
| W07-24 | Kitbash: bind existing `building.roboticsFactory` (Factory T1), `building.droneArray` (DCA T1) and `building.turret` (Autocannon T1: twin barrels + recoil already there) to their data rows; footprint mismatches (Factory model 4×3 vs data 3×3, DCA model 2×2 vs data 1×1) are resolved by refitting the models to the data footprints (B8 default); new `building.laserTower` T1 (emitter head, beam-origin socket) built from the turret kit | visual | M | H+ | — | `npm run validate:models -- building.laserTower building.roboticsFactory building.droneArray building.turret` → 0 errors / 0 warnings; playground 4-view audit passes, minY 0, < 3.5 k tris | Pillar 1 | TA-14.9 |
| W07-25 | Three bug + three hive kitbash archetypes: black ant horde, blue armored beetle, green acid spitter; shared planet visual registry; six-leg GPU gaits, body reaction and attack sockets | visual | M | H | W07-01 | All six catalog entries pass numeric validation with zero errors/warnings and four views in all biomes; distinct silhouettes, grounded, <3.5k tris each | Hive fauna contract | — |
| W07-26 | Duel harness in CI: port `docs/game/tools/battle_duels.py` to `shared/sim/test/duels.spec.ts` on the real combat systems; assert the 3 ground-triangle rows of §5.5 (Tank/Recon, Artillery/Tank, Recon/Artillery) at equal cost and equal supply with Recon and the dev-only `demoTank` / `demoArtillery` rows (§5.2 stats); W17-26 swaps in the real units and W19-27 adds the air rows | test | M | H+ | W07-03..07, W07-13 | `npm test -w @terra/sim -- duels` → the 3 ground rows reproduce (counter wins with ≥ 50 % surviving); changing `demoTank` speed to 3 fails the Artillery > Tank row | `AC-04`, §5.5 | TA-14.7 |
| W07-27 | Progression events: `faunaKilled` (Exterminator), `nestDestroyed` (Nest Breaker), `raidRepelled {unbreached}` (Unbreached) | sim | S | H | W07-16 | Clear a nest → the bus logs `nestDestroyed` and N `faunaKilled` | player-profile §3 | — |
| W07-28 | Analytics: `first_combat_unit`, `first_raid`, `first_raid_repelled`, `first_nest_cleared`, `first_building_lost` | client | S |  | W07-20 | Repel the first raid → one `first_raid_repelled` row | CLIENT §10 | — |
| W07-29 | Dev fauna controls: species hive spawn, mode/target changes and bounded raid injection through normal authoritative commands; retain godMode, spawnUnit and hitDebug; update DEV_TOOLS | server | M | H | W00-40, W07-15 | Commands validate species/target and are dev-only; injected waves use the same combat and movement pipeline | Hive fauna contract | — |
| W07-30 | Fauna perf and bandwidth: 200 units, 50 projectiles, 6 hives; bounded population/path work, instanced bugs, sparse motion wire updates | test | M | H | W07-08, W07-33, W07-34 | Measure tick p99, vision ≤0.5 ms and ≤15 KB/s per client in 50-unit fight; report bootstrap separately | Hive fauna contract | — |
| W07-31 | Combat + fauna tests: passive targeting, provocation, waves, acid impact, no friendly fire, species budgets, population bounds, orphan resolution and disabled flag | test | M | H | W07-03..15 | Tests exercise actual systems and fail on neutral auto-fire, duplicated cohorts or missing deaths | Hive fauna contract | — |
| W07-32 | Wave e2e + scenarios `w07-first-contact`, `w07-stress` + tag `wave-07` | test | M | H | all W07 | `npm run e2e -- --waves ..07` → the demo passes and earlier suites still pass | PRODUCT_WAVES §3 | TA-13.3 |
| W07-33 | Versioned fauna directives + checkpoints: shared sim decisions/RNG, contract and codec capability, backend bounded replay log, reconnect/restart, browser and local-host replay | contract | M | H | W07-14, W07-16 | Equal accepted inputs → equal decisions; reordered/duplicate/gapped directives recover; restart mid-wave preserves RNG and impacts; no per-tick fauna transform stream | Hive fauna contract | — |
| W07-34 | Playground hive-life scenes: each species and mixed encounter, seed/mode/pause/step/reset, passive activities and acid preview, registry selection for all planets | client | M | H | W07-25, W07-22 | Six individual models and four hive-life fixtures work; render quality/culling cannot change sim decisions; document new URL controls | Hive fauna contract | — |
| W07-35 | Fauna integration parity: two browsers + server + local host, terrain changes, late directives, reconnect, predict=0, W07-only/later waves off, snapshot compatibility | test | M | H | W07-33, W07-34 | Mid-wave reconnect/restart matches decisions, member IDs, targets and HP; missing log checkpoint recovers without duplication | Hive fauna contract | — |

## Wave DoD

- `tests/e2e/w07.spec.ts` passes, and so do all earlier wave suites.
- The duel harness is green in CI.
- With `TA_WAVES=..06`, there is no fauna, combat UI, Factory or turret, and the colony is peaceful.
- All seven [fauna delivery gates](../../game/fauna-hives-spec.md#5-delivery-gates) pass, including live backend/browser parity, six models and playground hive-life scenes.
- Reconcile W08 `systems/progression/threat.ts` legacy Skitter/Brute composition with the species threat-budget registry; W17 Brute and W19 Drifter remain later extensions.
- Tag `wave-07` is created after the owner lands the wave.

## Notes

- **Shells and rockets** have no regular player unit until W17 (Tank, Artillery) and W19 (Fighter, Bomber). They are exercised here with dev-only `demoArtillery` / `demoTank` and by the duel harness.
- **Laser Tower T1** unlocks at S3 (B7 default, accepted 2026-10-30): its data row carries `unlock: 'S3'` and the units-spec stage table (§6.2) is corrected from S7 to S3, so the `@hack` e2e holds with W08 on without a scenario grant.
- **Open numbers** are settled by the OWNER_TASKS B-defaults (B2 view radii, B4 air targeting, B8 footprints, B9 stance radii, B10 no ammo/laser spike, B11 bite cadence). They are data rows; the owner retunes them in playtests with W00-59 (D-35).
- **Stage-dependent numbers** (`threatStage`, S3 + 5 min) fall back to building-derived values when W08 is off. They switch to the stage engine when W08 is on, with no change in this wave's code (read through `progression.threatStage()`).

## W08 follow-up: executable progression and priorities

Register Defend Area and Clear Nest executors; make defense priority affect protection and test actual combat completion.

Mandatory landing criteria: [Progression, tutorial goals and priorities contract](../W08-PROGRESSION-CONTRACT.md). Add a real accept → orders → progress → completion owner check, blocked/resume and reload tests, relevant slider low/high decision tests, and a later-waves-off test. Unimplemented goals stay unavailable; stage previews do not authorize gameplay.
