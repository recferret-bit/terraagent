# W07 — First Contact (battle v1)

> **Track:** Gameplay (G) · **Flag:** `W07` · **Scenario:** `scenarios/w07-first-contact.ts` · **Tag:** `wave-07` · **Depends on:** W03
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §5.2, §5.4 (`UO-C-00..08`), §5.5, §5.6, §6.3 (`UO-T-01..04`), §3.3 (`UO-S`), §3.2 (`UO-HQ-03`) · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §3.5 (DCA), §3.6 (Factory), §3.7 (turrets) · [`SIMULATION.md`](../../spec/SIMULATION.md) §7.6, §7.7, §9 · [`CLIENT.md`](../../spec/CLIENT.md) §8b · D-28
> **Owned paths:** `shared/sim/src/systems/{combat,projectiles,fauna,raids,factory,supply,vision}/`, `shared/sim/src/data/{weapons,combat-units,fauna}.ts`, `shared/sim/test/duels.spec.ts`, `client/src/features/{combat,army,rings,projectiles}/`, archetypes below.

## Goal

The colony meets **hostile fauna** and fights back with the **battle v1** system:
- plain HP and plain damage;
- projectiles judged when their flight time ends;
- lasers, rockets and AoE;
- evasive units;
- view and spotting.

Also in this wave:
- the Robotics Factory T1, the Recon drone, Autocannon and Laser Tower turrets;
- the supply cap with Drone Control Arrays;
- army orders (stance, rally, attack-move);
- range and view rings, projectile and impact visuals.

## Demo story (e2e `e2e/w07.spec.ts`)

1. Load `?scenario=w07`: an S3 colony with power, a nest 30 tiles away, and the time warped to 5 min before the first raid.
2. Build a Robotics Factory T1 → the Units menu shows an Army section. Order 3 Recon → they roll out to the rally flag.
3. Order a 9th unit at supply 10/10 → rejected `supply_cap`. Build a Drone Control Array → the cap reads 18 and the order proceeds.
4. Build an Autocannon and a Laser Tower → selecting each shows its weapon range ring and view ring. `Alt` shows rings for every own unit.
5. A raid arrives (`2 + threatStage` skitters) → `underAttack` fires and its alert ping shows on the minimap.
   - Turrets fire: tracers for bullets, a beam for the laser.
   - HP bars appear on damaged units and buildings.
   - Dead skitters are removed and counted.
6. `spawnUnit demoArtillery` (dev only) fires shells at the evasive Recon → the shells **miss** and explode at the aim point with an AoE decal. Shells at a stationary skitter → hit.
7. Set the Recon to **Hunt** and attack-move them to the nest → they destroy the nest (HP 1 500). `nestDestroyed` fires.
8. A raid is repelled with no building lost → `raidRepelled` and Unbreached progress +1.
9. Destroy a building with the dev console → collapse VFX, then the tile shows a Prepared pad.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–8. `W07-32` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** collapse VFX (step 9), the Recon re-skin and new turret/factory archetypes (existing models stand in), the CI duel harness (the Python harness in `docs/game/tools/` stays the balance proof), perf.
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
| 12 | Supply: Hub +10, DCA T1 +8, unit supply cost, `supply_cap` (`UO-S-01`) | W07-11 |
| 13 | Stances Hold / Defend area / Hunt, attack-move, rally | W07-12 |
| 14 | Recon (evasive, bullet 7 × 2/s, range 4, view 10), Autocannon T1 (bullet 9 × 2/s, range 8, hits air), Laser Tower T1 (laser 6 × 4/s, range 9, ground + air) | W07-13 |
| 15 | Skitter fauna + nests (density, HP 1 500, spawn 1 / 900 ticks, max 6, aggro 6) | W07-14 |
| 16 | Stage-scaled raids: not before S3 + 5 min, size `2 + threatStage` (cap 12) + 1 per thermal, every 10 min, chance `10 % + 5 % × thermal` (`UO-T-01..04`) | W07-15 |
| 17 | Events: `underAttack` (debounce 600), `raidStarted`, `raidRepelled`, `buildingDestroyed`, `unitDestroyed`, `nestDestroyed` (SIM §9) | W07-16 |
| 18 | Projectile and hit deltas over WS | W07-17 |
| 19 | Army UI: Factory queue, supply meter, rally flag | W07-18 |
| 20 | Selection and orders: stance buttons, attack-move (`A` + click), right-click attack | W07-19 |
| 21 | HP bars, under-attack pings | W07-20 |
| 22 | Range rings: weapon, min, view; `Alt`; enemy hover red; turret ghost (`UO-C-08`, CLIENT §8b) | W07-21 |
| 23 | Projectile VFX: tracers, shell arcs, rocket trails, laser beams, impact flash, AoE decal, miss explosions | W07-22 |
| 24 | Death and destruction VFX | W07-23 |
| 25 | Archetypes: Factory T1, Autocannon T1, Laser Tower T1, DCA T1, Skitter nest, Recon re-skin, Skitter attack/death states | W07-24, W07-25 |
| 26 | Duel harness in CI with the §5.5 table (`AC-04`) | W07-26 |
| 27 | Achievements: Exterminator, Nest Breaker, Unbreached | W07-27 |
| 28 | Analytics | W07-28 |
| 29 | Dev console: raids, spawns, god mode, hit-debug lines, demo artillery | W07-29 |
| 30 | Perf: 200 units + 50 projectiles within the tick budget | W07-30 |
| 31 | Unit tests: impact check, AoE, layers, evasive | W07-31 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W07-01 | Contracts & data: weapon rows (bullet/shell/rocket/laser: dmg, rate, range, minRange, projSpeed, aoe, arc, hitsGround, hitsAir); unit rows Recon (+ dev-only `demoArtillery`, `demoTank`); Factory T1, Autocannon T1, Laser Tower T1, DCA T1, Skitter, nest; commands `buildUnit`, `setStance`, `setRally`, `attackMove`, `attackTarget`; events `projectileFired`, `projectileImpact`, `unitDestroyed`, `buildingDestroyed`, `underAttack`, `raidStarted`, `raidRepelled`, `nestDestroyed`; reject `supply_cap`; flag `W07` | contract | M | H | W03-01 | `TA_WAVES=..07` → `compileData` lists 4 weapon kinds and the new rows; all distances are stored in tiles | `UO-C-00..02`, §5.2 | TA-14.1 |
| W07-02 | HP and damage core: plain damage, unit death removal, building destruction → Prepared tile, HQ retreat + self-repair 1 %/s below 40 % HP | sim | M | H | W07-01 | Dev-damage the HQ to 35 % → it drops its job and returns to the Hub; destroy a depot → its tiles read Prepared | `UO-C`, `UO-HQ-03`, `UO-TF-04` | TA-14.4 |
| W07-03 | Projectile events: on fire `t = dist / speed`, `aim = pos + vel × t`, push `{impactAt, aim, dmg, aoe, shooter, target}` to an impact queue ordered by tick; at impact hit iff target alive and `dist(target, aim) ≤ aoe + radius` | sim | M | H | W07-02 | Fire a 4-tile/s shell at a stationary dummy 8 tiles away → impact after exactly 2.0 s → hit | `UO-C-03` | TA-14.4 |
| W07-04 | AoE: other enemies within `aoe` of the aim take 50 %; missed shells explode at the aim point; no friendly fire | sim | S | H | W07-03 | Shell at a group of 4 dummies 1 tile apart, aoe 1.5 → the centre takes 90, neighbours within 1.5 take 45, own units take 0 | `UO-C-03` | TA-14.4 |
| W07-05 | Lasers: instant hit in range; melee bite modelled as a range-1 laser | sim | S | H | W07-02 | Laser Tower vs a skitter in range → damage is applied in the same tick, every shot hits | `UO-C-02` | TA-14.4 |
| W07-06 | Evasive behaviour: while engaging, evasive units pick a new heading every 0.5 s (PRNG `combat`) and keep moving, strafing around their target | sim | S | H | W07-03 | A Recon under slow-shell fire for 20 s → shells miss (≥ 80 % misses) | `UO-C-04` | TA-14.4 |
| W07-07 | Layers: weapons respect `hitsGround` / `hitsAir`; units skip targets they cannot hit; Autocannon flagged `hitsAir` | sim | S | H | W07-01 | A Laser Tower ignores nothing; an air-only test weapon never targets a ground skitter | `UO-C-01` | TA-14.4 |
| W07-08 | View and spotting: per-colony shared view set from unit, building and beacon view radii, updated every 5 ticks; weapons fire only at spotted targets | sim | M | H | W07-01 | A dev artillery at range 14 with no spotter does not fire; add a Recon within view of the target → it fires | `UO-C-06` | TA-14.4 |
| W07-09 | Targeting and min range: nearest hittable in range, tie → lowest id, sticky until dead or out of range; units inside min range back off | sim | S | H | W07-08 | Two skitters equidistant → the lower id is shot first and the target is kept after the other moves closer | `UO-C-07` | TA-14.4 |
| W07-10 | Robotics Factory T1: Units-lane production of army units (factory 1.0×), 5-slot local buffer, least-loaded factory dispatch, units walk to the rally flag | sim | M | H | W07-01 | Queue 3 Recon → they are produced one after another (14 s each) and gather at the rally point | econ §3.6, `UO-D-04` | TA-06.6 |
| W07-11 | Supply cap: Hub +10, DCA T1 +8 (1×1, −5 E/s, shed group 4), unit supply cost, `supply_cap` rejection, cap shown in the colony view | sim | S | H | W07-10 | At 10/10 → `buildUnit` is rejected `supply_cap`; after a DCA completes, 18 is the cap | `UO-S-01`, econ §3.5 | TA-06.6 |
| W07-12 | Stances (Hold, Defend area, Hunt), `attackMove` (engage anything on the way), `attackTarget`, `setRally` | sim | M | H | W07-09 | Hunt-stance Recon → it seeks the nearest spotted fauna within 15 tiles; Hold → it fires but never moves | §5.4, `UO-M` | TA-14.4 |
| W07-13 | Combat stats in play: Recon (HP 240, speed 3.0, radius 0.4, bullet 7 × 2/s, r 4, view 10), Autocannon T1 (bullet 9 × 2/s, r 8, hits air), Laser Tower T1 (laser 6 × 4/s, r 9), turret draw and shed group 4 | sim | S | H | W07-05, W07-07 | `compileData` snapshot test matches §5.2 values exactly | §5.2 | TA-14.4 |
| W07-14 | Fauna: Skitter (HP 120, speed 2.0, bite 8 DPS), nests (1 per ~400 tiles outside R 25 of spawns, ×0.7 on Desert, HP 1 500, 1 spawn / 900 ticks, max 6 alive), aggro R 6, nest guard behaviour | sim | M | H | W07-05 | Generate a planet → nest count matches density ±10 %; walk a Recon into R 6 → skitters attack | §5.6, SIM §7.6 | TA-06.8 |
| W07-15 | Raids: first not before S3 + 5 min (until W08: Factory T1 completed + 5 min); every 10 min roll `10 % + 5 % × thermal`; size `2 + threatStage` (cap 12) + 1 per thermal (`threatStage` from W08, fallback S3); attackers path to the nearest colony structure | sim | M | H | W07-14, W03-10 | Time-warp past the first eligible roll with 2 thermals → the raid probability is 20 % (stats over 1 000 seeds) and the raid size is 5 + 2 | `UO-T-01..04` | TA-06.8 |
| W07-16 | Combat events: `underAttack` (debounce 600 ticks per colony), `raidStarted`, `raidRepelled` (all raiders dead; `unbreached` flag if no own building was lost), `buildingDestroyed`, `unitDestroyed`, `nestDestroyed` | sim | S | H | W07-15 | A raid repelled with 0 buildings lost → `raidRepelled {unbreached: true}` is emitted once | SIM §9 | TA-06.8 |
| W07-17 | Projectile sync: projectile records and `projectileFired` / `projectileImpact` events ride the W00-24 diff; with prediction on, the client engine fires its own projectiles for VFX and the server's events confirm hits; HP and target fields synced; bandwidth ≤ 15 KB/s in a 50-unit fight | sim | S | H | W07-03 | Watch the WS inspector during the demo raid → events arrive and bandwidth stays under the budget | PROTOCOL, CLIENT §8b | TA-07.6 |
| W07-18 | Army UI: Units-menu Army section (Recon; dev units hidden), Factory queue with progress, supply meter `used / cap`, rally-flag placement | client | M | H | W07-10, W07-11 | Order 2 Recon → the Factory queue shows them with progress bars and supply reads 2/10 | `UO-M` | TA-11.8 |
| W07-19 | Selection and orders: minimal box-select (the shared selection core W04-23 takes over when it lands), stance buttons, `A` + click attack-move, right-click attack target, order-feedback markers; touch: long-press for the order menu | client | M | H | W07-12 | Box-select 3 Recon, press `A`, click the nest → move markers appear and units attack-move | CLIENT §8 | TA-11.8 |
| W07-20 | HP bars (shown when damaged or selected, colony-coloured), under-attack alert pings on the screen edge and minimap, combat event log entries | client | S | H | W07-16 | Damage a building → its HP bar appears; an off-screen attack shows an edge ping | CLIENT §8 | TA-11.7 |
| W07-21 | Range and view rings: one instanced ring mesh with a dash shader; weapon (solid orange), min (dashed red), view (dashed white 40 %); `Alt` for all own units; enemy hover red; turret ghost range | client | M | H | W07-13 | Select the Autocannon → an 8-tile ring (16 m) and a 9-tile view ring render; `Alt` shows every unit's rings in one draw call | `UO-C-08`, CLIENT §8b | TA-14.10 |
| W07-22 | Projectile VFX: bullet tracers, shell parabolic arcs, rocket smoke trails, laser beams held 0.1 s; impact flash + AoE ground decal; miss explosions at the aim point; the client never decides hits | visual | M | H | W07-17 | Run the demo-artillery step → visible arcs, misses explode beside the Recon, and hits match server `projectileImpact` | CLIENT §8b | TA-14.10 |
| W07-23 | Death and destruction VFX: unit explosion + debris, building collapse into rubble that fades to the Prepared pad, skitter death animation | visual | S | H+ | W07-02 | Destroy a depot → rubble for ~3 s, then the Prepared pad | VFX | TA-14.9 |
| W07-24 | Kitbash: Robotics Factory T1 (3×3), Drone Control Array T1, Autocannon T1 (twin barrel, recoil anim), Laser Tower T1 (emitter, beam origin socket) | visual | M | H+ | — | Playground 4-view audit passes for all 4; minY 0; < 3.5 k tris | Pillar 1 | TA-14.9 |
| W07-25 | Kitbash: Recon re-skin of `robot.combat` (small, tall-legged, evasive look), Skitter nest (organic mound, spawn hole), Skitter attack/death anim states | visual | M |  | — | `?inspect=unit.recon` and `fauna.nest` pass the audit; skitter shows its attack anim in game | Pillar 1 | TA-14.9 |
| W07-26 | Duel harness in CI: port `docs/game/tools/battle_duels.py` to `shared/sim/test/duels.spec.ts` using the real combat systems; assert every §5.5 row at equal cost and equal supply (counter wins with ≥ 50 % surviving; AA vs Bomber at supply is flagged "weak", not failed) | test | M | H+ | W07-03..07 | `npm test -w @terra/sim -- duels` → the table reproduces; changing tank speed to 3 fails the Artillery > Tank row | `AC-04`, §5.5 | TA-14.7 |
| W07-27 | Progression events: `faunaKilled` (Exterminator), `nestDestroyed` (Nest Breaker), `raidRepelled {unbreached}` (Unbreached) | sim | S | H | W07-16 | Clear a nest → the bus logs `nestDestroyed` and N `faunaKilled` | player-profile §3 | — |
| W07-28 | Analytics: `first_combat_unit`, `first_raid`, `first_raid_repelled`, `first_nest_cleared`, `first_building_lost` | client | S |  | W07-20 | Repel the first raid → one `first_raid_repelled` row | CLIENT §10 | — |
| W07-29 | Dev console: `spawnRaid <n>`, `spawnUnit <id>` (incl. `demoArtillery`, `demoTank`), `spawnNest`, `godMode`, `hitDebug` (draws aim points and hit circles) | server | S | H | W00-40 | `hitDebug on` → aim points and `aoe + radius` circles are drawn for every projectile | PRODUCT_WAVES §3 | — |
| W07-30 | Perf: 200 units + 50 projectiles in flight + 6 nests within the per-planet tick budget (SIM §12); vision update ≤ 0.5 ms | test | S |  | W07-08 | Bench scenario `w07-stress` → the tick p99 stays within budget | SIM §12 | TA-13.5 |
| W07-31 | Unit tests: impact check (lead hit on a straight mover, evasive miss), AoE splash and no friendly fire, layer filtering, min range, sticky targeting, raid chance | test | M |  | W07-03..15 | `npm test -w @terra/sim -- combat raids` → green | `UO-C`, `UO-T` | TA-14.4 |
| W07-32 | Wave e2e + scenarios `w07-first-contact`, `w07-stress` + tag `wave-07` | test | M | H | all W07 | `npm run e2e -- --waves ..07` → the demo passes and earlier suites still pass | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w07.spec.ts` passes, and so do all earlier wave suites.
- The duel harness is green in CI.
- With `TA_WAVES=..06`, there is no fauna, combat UI, Factory or turret, and the colony is peaceful.
- Tag `wave-07` is created.

## Notes

- **Shells and rockets** have no regular player unit until W17 (Tank, Artillery) and W19 (Fighter, Bomber). They are exercised here with dev-only `demoArtillery` / `demoTank` and by the duel harness.
- **Stage-dependent numbers** (`threatStage`, S3 + 5 min) fall back to building-derived values when W08 is off. They switch to the stage engine when W08 is on, with no change in this wave's code (read through `progression.threatStage()`).
