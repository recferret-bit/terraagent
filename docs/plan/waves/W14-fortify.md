# W14 — Fortify (terrain walls)

> **Track:** Gameplay (G) · **Flag:** `W14` · **Scenario:** `scenarios/w14-fortify.ts` · **Tag:** `wave-14` · **Depends on:** W05, W07
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §4.5 (Raise/Dig/Lower rows), §4.8 (`UO-W-01..09`, Wall Gate), §5.4 (`UO-C-05`), §6.3 (`UO-T-07/08`), `AC-14..16` · [`textures-shaders-lighting-spec.md`](../../visuals/textures-shaders-lighting-spec.md) · D-27 (demo unlock at S4), D-34, D-35 · [`OWNER_TASKS.md`](../OWNER_TASKS.md) B12
> **Balance (D-35):** wall op times, energy and costs, gate HP, the gate-in-line rule (≥ 2 neighbouring wall tiles, B12 default) and the siege timer are data rows in `shared/sim/src/data/walls.ts`, tunable at runtime with W00-59's `tune` (e.g. `tune walls.raiseRidge.energy 120`). Costs `M` / `Min` read through the D-34 T1 rule (`metals.t1` / `minerals.t1`); Dig Moat yields `minerals.t1`.
> **Owned paths:** `shared/sim/src/systems/{walls,nav,line-of-fire}/`, `shared/sim/src/data/walls.ts`, `frontend/game/features/walls/`, the Ridge/Moat terrain look in `frontend/render/visuals/terrain/` (reuses the `landform/ridge.ts` heightfield stamp), new archetype `frontend/render/kitbash/archetypes/buildings/wall-gate.ts` (`building.wallGate`).
> **Soft dependencies:** stage gating (S7, S4 in the demo) ← W08; partner gates ← W18; Drifter flock vs walls ← W19; away rebuild of breaches ← W09.

## Goal

**Reverse terraforming as defense:**
- **Ridges and Moats** are indestructible walls that no ground unit or creature can cross. Only air units and indirect fire reach past them.
- The **Wall Gate** is a destructible weak point.
- **Line of fire** follows the parapet rule.
- Pathing is wall-aware, and fauna besiege walled colonies.
- Meteors can breach walls.

## Demo story (e2e `e2e/w14.spec.ts`)

1. Load `?scenario=w14`: an S4 colony (demo build unlock), a Terraformer, Prepared ground around the core, a nest 25 tiles away, and an Autocannon inside the planned wall line.
2. Terraform → **Raise Ridge**, then drag a wall line around the core, leaving one gap → the ghost shows cost (15 M + 10 Min + 150 E per tile) and time.
3. Close the gap fully → the confirm plate warns "isolates Quarry #12" and the order is rejected `would_isolate`. Place a **Wall Gate** in the gap instead → accepted.
4. Dig a **Moat** segment on the far side → impassable, but turrets can fire across it.
5. `spawnRaid 6` → the skitters path to the **gate**, not through the ridge. Destroy the gate with the dev console → they pour through the breach.
6. Rebuild the gate, then remove it and lower one ridge tile with **Lower** (50 % refund) → reopened.
7. Remove the gate entirely → the next raid besieges the wall for 5 min, leaves, and counts as `raidRepelled`.
8. Parapet: the Autocannon standing directly behind the ridge fires over it at skitters outside. A Recon 3 tiles behind the ridge cannot (line of fire blocked). `demoArtillery` fires over the ridge.
9. `meteor` on a ridge tile → the ridge becomes Rock (a breach); skitters path through it; a repair re-raise is offered.
10. Terraform % is unchanged by wall tiles, and Great Wall progress counts raised tiles.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–7, 10. `W14-28` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** line of fire and the parapet (step 8), meteor breach (step 9), the Wall Gate archetype, wall VFX.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Raise Ridge: Prepared → Ridge, 12 s, 150 E, 15 M + 10 Min | W14-02 |
| 2 | Dig Moat: Prepared → Moat, 10 s, 120 E, +5 Min | W14-03 |
| 3 | Lower: Ridge/Moat → Prepared, 8 s, 60 E, Ridge refunds 50 % | W14-04 |
| 4 | Real walls: Ridge and Moat impassable to ground units and fauna; air ignores them; nav graph dirty + path-cache invalidation (`UO-W-01`) | W14-05 |
| 5 | Passability table: Forest 0.6×, Slope 0.7×, Rock/Hole/Shallow 0.5×, Deep impassable (§4.8 table): already in W01-08 (tile multipliers) and W01-12 (A\*) | — |
| 6 | Line of fire: direct ground→ground/structure shots blocked by a Ridge on the hex line; parapet exception (adjacent ridge doesn't block); Moats never block (`UO-W-02`) | W14-07 |
| 7 | Indirect fire (shells) and air shots never blocked (`UO-W-03`, `UO-C-05`) | W14-07 |
| 8 | Indestructible, owner-only, own territory only (`UO-W-04`) | W14-02..04 |
| 9 | `would_isolate`: flood fill at op start, gates open for own units, ≤ ~2 000 tiles (`UO-W-05`) | W14-08 |
| 10 | Meteor breach: Ridge → Rock, Moat → Hole, rebuild offered (`UO-W-06`, `UO-T-07`) | W14-09 |
| 11 | Fauna vs walls: target the nearest gate, otherwise besiege 5 min, leave, raid repelled (`UO-W-07`, `UO-T-08`) | W14-10 |
| 12 | Drifter extra flock vs a closed wall ring from S8 (data hook only; behaviour lands with W19) (`UO-T-08`) | W14-10 |
| 13 | Hostile ground pathing goes to gates when walls are closed (fauna now, PvP in W18) (`UO-W-08`) | W14-11 |
| 14 | Wall Gate T1: 1×1 in a wall line, 15 s, 60/30/0/0, −1 E/s, HP 1 200, own units only, closed if unpowered, destroyed → Prepared breach, shed group 4, "open to partners" toggle (enabled with W18) | W14-12 |
| 15 | Walls excluded from Terraform % (`UO-TF-06`): already in W05-10 | — |
| 16 | Wall cost check (~60-tile ring) (`UO-W-09`) | W14-25 |
| 17 | Tile and nav deltas | W14-14 |
| 18 | Wall line tool, isolation warning, Lower/Dig modes | W14-15 |
| 19 | Gate placement snapping, open/closed state | W14-16 |
| 20 | Line-of-fire preview on the selected shooter's ring | W14-17 |
| 21 | Ridge/Moat terrain look, breach rubble | W14-18 |
| 22 | Wall Gate archetype | W14-19 |
| 23 | Raise / dig / lower / breach VFX | W14-20 |
| 24 | Achievement: Great Wall | W14-21 |
| 25 | Analytics | W14-22 |
| 26 | Dev console | W14-23 |
| 27 | Tests: `AC-14`, `AC-16` (W14-24); `AC-15` (W14-07 fixtures) | W14-24, W14-07 |
| 28 | D-27 demo flag: walls unlock at S4 in the hackathon build, S7 in the full game | W14-26 |
| 29 | Perf: nav rebuild after wall ops | W14-27 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W14-01 | Contracts & data: op rows `raiseRidge`, `digMoat`, `lower`; tile classes `ridge`, `moat`; Wall Gate T1 row; weapon `arc` already in W07 (assert present); events `wallRaised`, `wallLowered`, `wallBreached`, `gateDestroyed`, `siegeStarted/Ended`; reject `would_isolate`; flag `W14`; stage-unlock row S7 with the demo override key | contract | M | H | W05-01, W07-01 | `TA_WAVES=..14` → 3 new ops in data; `..13` → none | §4.5, §4.8 | TA-14.1 |
| W14-02 | Raise Ridge op: Prepared → Ridge, 12 s, 150 E, 15 M + 10 Min, own territory only, waits if a unit stands on the tile | sim | S | H | W14-01 | Raise 1 tile → Ridge after 12 s at 1.0×; a unit standing there delays the op until it moves | `UO-W`, §4.5 | TA-14.3 |
| W14-03 | Dig Moat op: Prepared → Moat, 10 s, 120 E, yields +5 `minerals.t1` | sim | S | H | W14-01 | Dig 1 tile → Moat; `minerals.t1` +5 | §4.5 | TA-14.3 |
| W14-04 | Lower op: Ridge/Moat → Prepared, 8 s, 60 E, Ridge refunds 50 % of its resource cost | sim | S | H | W14-02 | Lower a ridge → Prepared; stock +7 M +5 Min (rounded down) | §4.5 | TA-14.3 |
| W14-05 | Nav graph: Ridge and Moat impassable for ground units and fauna, air ignores; on wall-op completion mark nav dirty, invalidate cached paths, re-path moving units within the A\* budget | sim | M | H | W14-02 | A unit mid-path when a ridge completes on its route → re-paths around it within 1 s; never enters the ridge | `UO-W-01`, `SIM-T-02` | TA-14.4 |
| W14-07 | Line of fire: hex line from shooter to target; for `direct` ground weapons, any Ridge on the line blocks unless the ridge is adjacent to the shooter (parapet); Moats never block; `indirect` and air shots ignore ridges | sim | M |  | W14-02, W07-03 | Fixtures: turret adjacent to a ridge → fires; Recon 3 tiles behind → no fire; demo artillery → fires over | `UO-W-02/03`, `UO-C-05` | TA-14.4 |
| W14-08 | `would_isolate`: when a Raise/Dig op starts, flood-fill owned tiles from the Hub (gates count as open for own units) and reject if any own structure or deposit becomes unreachable; ≤ ~2 000 tiles | sim | M | H | W14-05 | Close a ring that cuts off a quarry → `would_isolate` names the quarry; with a gate in the ring → accepted | `UO-W-05` | TA-14.3 |
| W14-09 | Meteor breach: consume W05 `meteorImpact`; a Ridge in radius 1 → Rock, a Moat → Hole; `wallBreached`; the rule engine offers re-raise (away rebuild `AW-02` once W09 is on) | sim | S |  | W05-16, W14-02 | `meteor` on a ridge → that tile reads Rock and is passable; `wallBreached` fires | `UO-W-06` | TA-14.3 |
| W14-10 | Fauna vs walls: a raid with no ground path to any colony structure targets the nearest Wall Gate; with no gate it besieges at the nearest wall tile for 5 min, then leaves and the raid counts as repelled; data hook for the +1 Drifter flock from S8 (behaviour in W19) | sim | M | H | W14-05, W07-15 | Fully walled core with a gate → skitters attack the gate; without a gate → `siegeStarted`, 5 min later `raidRepelled` | `UO-W-07`, `UO-T-08` | TA-14.4 |
| W14-11 | Hostile ground pathing to gates: any hostile ground unit whose target is behind closed walls paths to the nearest reachable gate (shared helper for fauna now, PvP raids in W18) | sim | S | H | W14-10 | Dev-spawn a hostile `demoTank` (W07 dev unit) outside a walled core → it drives to the gate and attacks it | `UO-W-08` | TA-06.11 |
| W14-12 | Wall Gate T1: 1×1, must sit in a wall line (≥ 2 neighbouring ridge/moat hex tiles, B12 default, data row), 15 s, 60/30/0/0, −1 E/s, HP 1 200, passable for own units only, closed for everyone when unpowered, destroyed → Prepared (breach), shed group 4; `openToPartners` flag stored (used by W18-13) | sim | M | H | W14-05 | Cut the gate's power → own units can no longer pass; destroy the gate → the tile is Prepared and passable | §4.8 Wall Gate | TA-14.3 |
| W14-14 | Wall sync: wall tile classes ride the tile diff; a `navChanged {bbox}` event makes the client engine rebuild its nav graph for predicted paths and path previews | sim | S | H | W14-05 | Raise a ridge → the client receives the tile class and `navChanged` in the next delta | PROTOCOL | TA-07.6 |
| W14-15 | Wall tool: Raise / Dig / Lower modes, drag a hex line or polyline, ghost with per-tile cost and total, red "isolates X" warning from the `@terra/sim` `wouldIsolate` check run in the predicted engine (no client copy of the rule) + the server reject message | client | M | H | W14-08 | Drag a closing ring → the ghost turns red and names the isolated building | `UO-M`, `UO-W-05` | TA-14.8 |
| W14-16 | Gate placement: snaps into a wall line, shows open/closed/unpowered state, gate HP bar, "open to partners" toggle hidden until W18 (W18-13) | client | S | H | W14-12 | Hover the ghost over a wall line → it snaps; off the line → it shows invalid | §4.8 | TA-14.8 |
| W14-17 | Line-of-fire preview: the selected shooter's weapon ring shades sectors blocked by ridges (computed with the `@terra/sim` line-of-fire helper in the predicted engine) | client | S |  | W14-07, W07-21 | Select a Recon behind a ridge → the sector beyond the ridge is greyed | `UO-W-02`, `UO-C-08` | TA-14.10 |
| W14-18 | Ridge and Moat terrain look (`shader-texture-tuning`): raised rock ridge (reuse the existing `frontend/render/visuals/terrain/landform/ridge.ts` stamp for the displacement) with triplanar grain, moat trench with dark water; breach rubble look for Rock created from a ridge | visual | M | H | W05-23 | Scenario `w14` → ridges read as walls in iso view, moats as trenches; a breached tile shows rubble | shader skill, Pillar 3 | TA-14.9 |
| W14-19 | Kitbash: Wall Gate T1 (≥ 7 parts, two door leaves animated open/closed via a new slide `animType` in `aPartAnim`, emissive state light) | visual | M |  | — | `?inspect=building.wallGate` → 4-view audit passes; doors animate in game | Pillar 1 | TA-14.9 |
| W14-20 | VFX: ridge rising (earth push-up), moat digging (soil spray), lowering, breach dust + debris — reuse `Particles.ts` and the landform/terrain shader | visual | S |  | W14-18 | Raise and breach in the scenario → each shows its effect | VFX | TA-14.9 |
| W14-21 | Progression events: `wallRaised` (Great Wall counts Ridge + Moat tiles) | sim | S | H | W14-02 | Raise 5 tiles → the bus logs 5 `wallRaised` | player-profile §3 | — |
| W14-22 | Analytics: `first_wall`, `first_gate`, `first_siege`, `first_breach` | client | S |  | W14-15 | Raise the first ridge → one `first_wall` row | CLIENT §10 | — |
| W14-23 | Dev console: `wallLine <q1> <r1> <q2> <r2>`, `breach <q> <r>`, `siegeDebug` (shows fauna path and siege timer) | server | S | H+ | W00-40 | `wallLine` → a ridge line appears instantly (dev only) | PRODUCT_WAVES §3 | — |
| W14-24 | Tests: `AC-14` property test (no ground unit or creature ever on Ridge/Moat; air never blocked), `AC-16` would-isolate property test, Terraform % regression (raise 10 Ridges → W05-10's Terraform % unchanged); the `AC-15` line-of-fire fixtures are W14-07's acceptance | test | M | H+ | W14-05, W14-08, W05-10 | `npm test -w @terra/sim -- walls` → green | `AC-14`, `AC-16` | TA-14.4 |
| W14-25 | Balance check: cost of a ~60-tile ring from Flat ≈ 900 M + 600 Min + 10 200 E and ~15 min of one Terraformer, recorded in the scenario report | test | S |  | W14-02 | `npm run scenario w14 -- --report` → the cost line matches `UO-W-09` within 10 % | `UO-W-09` | — |
| W14-26 | D-27 demo override: data key `unlockOverrides.walls = 'S4'` (declared in W14-01) set by the hackathon build; the full game keeps S7 (enforced only when W08 is on; without W08 the wave flag alone controls availability) | data | S | H | W14-01 | With W08 on and `unlockOverrides.walls = 'S4'` → walls show in the S4 menu; without the override → locked until S7 | D-27, units spec §8.1 | — |
| W14-27 | Perf: nav rebuild after a 60-tile wall op ≤ 5 ms; flood fill ≤ 2 ms | test | S |  | W14-05, W14-08 | Bench → both budgets hold | SIM §12 | — |
| W14-28 | Wave e2e + scenario `w14-fortify` + tag `wave-14` | test | M | H | all W14 | `npm run e2e -- --waves ..14` → the demo passes and earlier suites still pass | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w14.spec.ts` passes, and so do all earlier wave suites.
- `AC-14` (ground half) and `AC-16` are green; `AC-15` and the indirect-fire half of `AC-14` once W14-07 lands.
- With `TA_WAVES=..13`, no wall op, gate, line-of-fire block or siege exists, and every ridge from a saved snapshot is inert and shown as Prepared.
- Tag `wave-14` is created.

## Notes

- **Stage gating** (walls at S7, S4 in the demo) is enforced only when W08 is on. Otherwise the wave flag alone controls availability.
- **Truce partners through gates** (`openToPartners`) are stored here but used only by W18.
- **The extra Drifter flock** against a closed ring is a data hook here; it becomes live with W19.
