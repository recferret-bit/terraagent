# W03 — The Grid

> **Track:** Gameplay (G) · **Flag:** `W03` · **Scenario:** `scenarios/w03-the-grid.ts` · **Tag:** `wave-03` · **Depends on:** W02 (spine)
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §3.1, §3.3, §4.1–4.4, §5.1 · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §1.2–1.4, §3.2–3.5 · [`SIMULATION.md`](../../spec/SIMULATION.md) §7.4 (`SIM-G-PWR`, D-21) · [`CLIENT.md`](../../spec/CLIENT.md) §8
> **Owned paths:** `shared/sim/src/systems/{power,builder,lanes,dispatch}/`, `shared/sim/src/data/grid.ts`, `client/src/features/{grid,power,lanes,builder}/`, kitbash archetypes for the buildings below.

## Goal

Turn the single-generator colony from W02 into a real **power grid with workers in parallel**:
- the Builder drone;
- pylons with reach and per-pylon load;
- capacitors, wind, thermal fuel;
- the remaining extractors and the Supply Depot;
- brownout shedding;
- repair;
- the full order-lane model (all four lanes, precedence, earmarks, limits, storage waits).

## Demo story (e2e `e2e/w03.spec.ts`)

1. Load `?scenario=w03`. This is the colony at the end of W02: Hub, 1 Metals Extractor, 1 Solar, 2 Harvesters.
2. Units lane → order 1 Builder at the Hub → the Builder appears; Construction can now run on 2 workers.
3. Drag a power line of 3 pylons toward a minerals deposit → it becomes **one** queue entry. The pylons get built and the power overlay shows them connected.
4. Place a Minerals Quarry beyond the last pylon's reach → it shows `offline: no grid`. Extend the line → it turns online.
5. Build a Wind Turbine, a Capacitor and a Supply Depot → the storage cap goes from 500 to 1 500 and the capacitor charges.
6. Time-warp to night → solar drops to 0, the capacitor discharges, the wind holds. With the dev command `addLoad 200`, the brownout sheds **group 1 first, then group 2…**, and the HUD lists shed buildings with reasons.
7. Overload a T1 pylon (> 80 E/s through it) → its branch sheds, the pylon shows `overload`, and a `powerOverload` alert fires.
8. Damage a building with the dev console → a repair job appears and the Builder repairs it at 1.5×.
9. Queue an item costing more than the storage cap → `waiting(storage)` with a "build a Supply Depot" hint.
10. Let a cheaper item and a starved item compete → after 60 s the starved item earmarks, and the HUD shows the earmark.
11. Dawn arrives with no shedding beyond group 1 → `nightSurvived` fires, and Night Shift progress +1.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–4, 6 (night → shedding by group, without wind or capacitor), 7, 8, 9, 10. `W03-29` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** Wind Turbine, Capacitor (step 5 keeps only the Supply Depot), demolish/reorder, power events and Night Shift (step 11), new archetypes (existing models stand in).
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Builder drone: build ≤ T1, repair any tier at 1.5×, build rate 1.0× (`UO-L-02`, §5.1) | W03-02, W03-03 |
| 2 | Worker tier gate `worker_tier_locked` (`UO-L-02/03`) | W03-02 |
| 3 | Assist: ≤ 4 workers per construction job, rates add (`UO-L-04/05`) | W03-04 |
| 4 | Pylon T1: span 6, connect radius 3, Hub acts as pylon span 6 (`SIM-G-PWR`) | W03-05 |
| 5 | Components, `OFFLINE` without generator or charged capacitor, dirty rebuild (`SIM-G-PWR`) | W03-05 |
| 6 | Per-pylon max load (T1 80, Hub 150 E/s), BFS flow tree, branch overload shedding, `powerOverload` debounce 600 ticks (D-21) | W03-06 |
| 7 | Brownout shedding groups 1–4, newest first; terraform op load in group 1 (`UO-TF-02`) | W03-07 |
| 8 | Idle units draw 50 % (`UO-S-02`); robot drain on the Hub's component | W03-07 |
| 9 | Capacitor T1: 1 500 E, discharge ≤ 30 E/s, surplus charges | W03-08 |
| 10 | Wind Turbine T1: wind factor 50–140 %, resampled and smoothed | W03-09 |
| 11 | Thermal Plant T1: Pet upkeep × `ECONOMY_RATE_SCALE`, offline at 0 Pet, pollution counter (raid hook for W07) | W03-10 |
| 12 | Supply Depot T1 (+1 000 cap), Minerals Quarry T1, Water Extractor T1 (Desert ×0.5), Petroleum Well T1 (deposit coverage) | W03-11 |
| 13 | Four lanes (Construction, Terraform, Units, HQ goals shell), precedence `system > player > hq > ai > auto`, per-lane limits 20/20/10 + 5 per production building (`UO-P`) | W03-12 |
| 14 | Dispatch: precedence scan, non-blocking, nearest idle lowest-tier worker, player-only pre-emption (`UO-D-01/03`) | W03-13 |
| 15 | Earmarks after 60 s, ≤ 80 % of cap; `waiting(storage)` never earmarks (`UO-D-02`, `UO-Q-05`) | W03-13 |
| 16 | `waiting(power \| worker \| storage)` reasons + ETA (`UO-Q-03`) | W03-13, W03-19 |
| 17 | Demolish (50 % refund), drag reorder (`UO-Q-02`) | W03-14 |
| 18 | Power-line drag = 1 order (`UO-M`) | W03-17 |
| 19 | Power overlay + power HUD (generation, demand, stored, night forecast, shed list) | W03-18 |
| 20 | Repair and demolish UI | W03-20 |
| 21 | Building archetypes: Pylon, Capacitor, Wind, Thermal, Depot, Quarry, Water, Petroleum Well | W03-21, W03-22, W03-23 |
| 22 | Power-line cables and overload VFX | W03-24 |
| 23 | `energyCollapse` (≥ 300 ticks brownout), `powerSevered`, `nightSurvived` events (SIM §9) | W03-15 |
| 24 | Achievements: Power Broker (peak net E/s), Night Shift | W03-25 |
| 25 | Analytics: first pylon, first brownout, first night survived, first overload | W03-26 |
| 26 | Dev console: time of day, wind, fuel drain, add load, damage building | W03-27 |
| 27 | Perf: grid rebuild ≤ 2 ms for 300 nodes | W03-28 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W03-01 | Contracts & data: Builder unit row; Pylon T1, Capacitor T1, Wind T1, Thermal T1, Depot T1, Quarry T1, Water T1, Petroleum Well T1 rows (`wave:'W03'`); commands `repair`, `demolish`, `reorderTask`, `placePowerLine`; events `powerSevered`, `powerOverload`, `energyCollapse`, `brownoutShed`, `nightSurvived`; reject codes `worker_tier_locked`, `lane_full`; register flag `W03` | contract | M | H | W02-01 | Run `npm run check` with `TA_WAVES=..03` → new rows compile through `compileData`; with `..02` they are absent | econ §3.2–3.5, `UO-L`, `SIM-C` | TA-14.1, TA-06.4 |
| W03-02 | Builder drone in sim: Hub prints it (Units lane, 12 s), build rate 1.0×, construction ≤ T1, `worker_tier_locked` above | sim | M | H | W03-01 | Order a T2 build with only Builders (scenario) → rejected `worker_tier_locked`; T1 build → completes in build time ÷ 1.0 | `UO-L-02`, §5.1 | TA-06.6, TA-14.2 |
| W03-03 | Repair job: auto-queued for damaged own structures (`system` precedence for critical), Builder repairs any tier at 1.5×, every builder-capable worker can repair | sim | S | H | W03-02 | Damage a pylon to 50 % → a repair entry appears and HP returns to max at the 1.5× rate | `UO-L-02` | TA-06.6 |
| W03-04 | Assist: up to 4 workers on one construction, rates add | sim | S |  | W03-02 | Put 2 Builders on a 14 s build → it completes in 7 s; a 5th worker is not assigned | `UO-L-04/05` | TA-14.2 |
| W03-05 | Power graph v2: pylon span 6, building connects within 3 tiles of a pylon/Hub, connected components, `OFFLINE` without generator or charged capacitor, dirty rebuild on build or destroy | sim | M | H | W03-01 | Destroy the middle pylon of a chain → downstream consumers go `offline: no grid` in the same tick and `powerSevered` fires | `SIM-G-PWR` | TA-06.5 |
| W03-06 | Per-pylon max load: deterministic BFS spanning tree, subtree flow, overload sheds the branch by shed order, `offline: overload`, `powerOverload` debounced 600 ticks, Hub max 150 E/s | sim | M | H | W03-05, W03-07 | Push 120 E/s through a T1 pylon → its branch sheds until ≤ 80 E/s; other branches are unaffected | D-21, `SIM-G-PWR` | TA-06.12 |
| W03-07 | Brownout shedding groups 1–4 (group 1 terraform ops + silo, 2 factory + trade hub, 3 extractors + depot, 4 turrets/beacons/DCA/generator cooling), newest first; idle units draw 50 %; robot drain on the Hub component | sim | M | H | W03-05 | Demand > supply by 30 E/s → group-1 consumers shed first; with none left, group 2 sheds newest first | econ §1.2, `UO-S-02`, `UO-TF-02` | TA-06.5 |
| W03-08 | Capacitor T1: stores 1 500 E, discharges ≤ 30 E/s, surplus charges, counts as supply in its component | sim | S |  | W03-05 | At night with a 20 E/s deficit → the capacitor drains at 20 E/s and the colony stays online until it is empty | econ §3.2 | TA-06.5 |
| W03-09 | Wind Turbine T1: +16 gross × wind factor (5 000–14 000 bp), resampled every 1 200 ticks and smoothed; environment publishes the wind factor | sim | S |  | W03-01 | Dev-set wind to 50 % → the turbine shows +8 gross; at 140 % → +22.4 | econ §3.3, SIM §7.6 | TA-06.5 |
| W03-10 | Thermal Plant T1: +28 gross, consumes 1.5 × scale Pet/s, offline at 0 Pet, `pollution` counter per colony (consumed by W07 raids) | sim | S | H | W03-01 | Drain Pet to 0 → the thermal plant shows `offline: no fuel`; pollution reads 1 per plant | econ §3.3, `UO-S-03` | TA-06.5 |
| W03-11 | Supply Depot T1 (+1 000 cap all resources), Minerals Quarry T1, Water Extractor T1 (×0.5 Desert, no deposit), Petroleum Well T1 (deposit coverage), all scaled by `ECONOMY_RATE_SCALE` | sim | M | H | W03-01 | Build a Depot → the cap reads 1 500. Build a Quarry on a minerals deposit → +0.75 Min/s × richness | econ §3.4–3.5 | TA-06.4 |
| W03-12 | Four lanes in sim: Construction, Terraform, Units, HQ-goal shell; precedence `system > player > hq > ai > auto`; limits 20 / 20 / 10 + 5 per production building; `lane_full` drops the oldest `auto` first | sim | M | H | W02-14 | Fill Construction to 20 → the 21st player order is rejected `lane_full`; an `auto` entry is evicted before any player entry | `UO-P`, `SIM-C-04` | TA-14.2 |
| W03-13 | Dispatch v2: scan by precedence, first affordable + eligible starts (non-blocking), nearest idle eligible worker with lowest tier first, player-only pre-emption, earmarks after 60 s capped at 80 % of storage, `waiting(storage)` never earmarks, wait reasons `resources/storage/worker/power/site` | sim | M | H | W03-12 | A blocked 75-Min item waits 60 s → later items cannot spend the earmarked Min, and the HUD state reads `earmark 40 Min` | `UO-D-01..04`, `UO-Q-03/05` | TA-14.2 |
| W03-14 | Demolish (50 % refund; not the Hub), drag-reorder within a lane (player entries only) | sim | S |  | W03-12 | Demolish a depot → 50 % of its cost returns to stock and the cap drops back | `UO-Q-02` | TA-06.4 |
| W03-15 | Power events: `energyCollapse` after ≥ 300 ticks of brownout, `nightSurvived` at dawn if no shedding beyond group 1 that night, `brownoutShed` list in the colony view | sim | S |  | W03-07 | Run a full night with a capacitor and wind → `nightSurvived` fires at dawn exactly once | SIM §9 | TA-06.5 |
| W03-16 | Power sync: register per-building `power: {state, reason, component}`, per-pylon `{flow, max}` and the colony power summary as synced fields; they ride the W00-24 diff and the client reads them through `view()` | sim | S | H | W03-06 | Open the WS inspector → the power fields change within 1 delta of an overload | PROTOCOL deltas | TA-07.6 |
| W03-17 | Construction menu: new buildings and a **power-line drag tool** (hex path, auto-spaced pylons, one queue entry with N sub-sites, cost total on the ghost) | client | M | H | W03-01 | Drag a 12-tile line → a ghost shows 2 pylons + cost; confirm → one queue entry with 2 sub-sites | `UO-M` | TA-11.8 |
| W03-18 | Power overlay (toggle `P`): cables coloured by pylon load (green / amber / red), offline and overload badges, component tint; power HUD panel with generation, demand, stored, time to night, night forecast, shed list | client | M | H+ | W03-16 | Press `P` during an overload → the overloaded pylon blinks red and the HUD lists the shed buildings with `overload` | CLIENT §8 | TA-11.7 |
| W03-19 | Queue panel v2: four lane tabs, drag reorder, wait-reason chips with ETA, earmark bars, `waiting(storage)` hint button ("build Depot" opens the placement ghost) | client | M | H | W03-13 | A starved item shows "Minerals 40/75 · ~50 s" and an earmark bar; the storage hint opens the Depot ghost | `UO-Q-03/05` | TA-14.8 |
| W03-20 | Context actions on buildings: Repair (manual), Demolish (confirm plate with refund preview), Cancel; damaged HP indicator on buildings | client | S |  | W03-14 | Select a damaged pylon → Repair queues a repair; Demolish shows a "refund 7 M / 2 Min" preview | `UO-Q-02` | TA-11.8 |
| W03-21 | Kitbash: Pylon T1 + Capacitor T1 (≥ 7 parts each, silhouette breaker, 60/30/10, `aPartAnim` pulse), playground 4-view audit, minY 0 | visual | M | H+ | — | `/playground.html?inspect=building.pylonT1` → 4 views pass; tris < 3.5 k | AGENTS Pillar 1 | TA-14.9 |
| W03-22 | Kitbash: Wind Turbine T1 (rotor anim tied to wind factor), Thermal Plant T1 (chimney smoke emitter), Supply Depot T1 | visual | M |  | — | In-game wind at 140 % → the rotor visibly spins faster than at 50 % | Pillars 1, 3 | TA-14.9 |
| W03-23 | Kitbash: Minerals Quarry T1, Water Extractor T1, Petroleum Well T1 (pump-jack anim) | visual | M | H+ | — | Playground audit passes for all 3 ids | Pillar 1 | TA-14.9 |
| W03-24 | Power cables between pylons (sagging `CatmullRomCurve3`), overload flicker and sparks VFX, offline buildings dim their emissives | visual | S | H+ | W03-21 | Overload a pylon → its cable flickers amber/red; offline buildings lose their emissive glow | lighting skill | TA-14.9 |
| W03-25 | Progression events: `peakNetPower` (Power Broker), `nightSurvived` (Night Shift) emitted to the progression bus | sim | S |  | W03-15 | Dev-run a night → the progression bus logs `nightSurvived {colonyId}` | player-profile §3 | — |
| W03-26 | Analytics: `first_pylon_built`, `first_brownout`, `first_night_survived`, `first_overload` via `track()` | client | S |  | W03-18 | Trigger an overload → one `first_overload` row lands in the analytics table | CLIENT §10 | — |
| W03-27 | Dev console: `setTime <h>`, `setWind <pct>`, `drainFuel`, `addLoad <E/s>`, `damage <entity> <pct>` | server | S |  | W00-40 | Run `setTime 22` → the scene goes to night and solar reads 0 | PRODUCT_WAVES §3 | — |
| W03-28 | Unit tests + perf: flow-tree determinism (same graph → same shed set), shed order, earmark starvation, grid rebuild ≤ 2 ms at 300 nodes | test | M | H+ | W03-06, W03-13 | `npm test -w @terra/sim -- grid` → green; bench prints ≤ 2 ms | SIM §12 | TA-06.5 |
| W03-29 | Wave e2e + scenario `w03-the-grid` + tag `wave-03` | test | M | H | all W03 | `npm run e2e -- --waves ..03` → the demo story passes and W00–W02 still pass | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w03.spec.ts` passes, and so do all earlier wave suites.
- `?scenario=w03` loads.
- With `TA_WAVES=..02`, no W03 building, lane, overlay or command exists, and W02's demo still passes.
- Tag `wave-03` is created.
- Every row of "Features covered" is checked against its issue.
