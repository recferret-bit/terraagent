# W03 — The Grid

> **Track:** Gameplay (G) · **Flag:** `W03` · **Scenario:** `scenarios/w03-the-grid.ts` · **Tag:** `wave-03` · **Depends on:** W02 (spine)
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §3.1, §3.3, §4.1–4.4, §5.1 · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §1 rules 2–4, §3.2–3.5 · [`SIMULATION.md`](../../spec/SIMULATION.md) §7.4 (`SIM-G-PWR`, D-21), §7.6, §9 · [`CLIENT.md`](../../spec/CLIENT.md) §8 · D-31, D-33, D-34, D-35
> **Resources (D-34):** every extractor here produces its family's **T1** sub-resource (`minerals.t1`, `bio.water`); Depots add to the cap of all three families; the Petroleum Well is the Bio T2 source and yields only once W05-34's terraforming gate opens. Cost shorthand `M/Min/Pet/W` reads through the D-34 tier rule (T1: `metals.t1` / `minerals.t1` / `bio.biomass` / `bio.water`).
> **Owned paths:** `shared/sim/src/systems/{power-grid,builder,lanes,earmarks}/`, `shared/sim/src/data/grid.ts`, `frontend/game/features/{grid,power,lanes,builder}/`, and in `frontend/render/kitbash/archetypes/` the bindings/anims of the existing `building.pylon`, `building.capacitor`, `building.wind`, `building.coalGen` (= Thermal Plant), `building.supplyDepot`, `building.waterPump` (= Water Extractor) plus two new archetypes `building.quarry` and `building.petroleumWell`. This wave **extends** W02's `power-core` (single component → graph), `queue` and `dispatch` systems; it does not re-implement them.

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
5. Build a Wind Turbine, a Capacitor and a Supply Depot → the storage cap of every family goes from 500 to 1 500 and the capacitor charges.
6. Time-warp to night → solar drops to 0, the capacitor discharges, the wind holds. With the dev command `addLoad 200`, the brownout sheds **group 1 first, then group 2…**, and the HUD lists shed buildings with reasons.
7. Overload a T1 pylon (> 80 E/s through it) → its branch sheds, the pylon shows `overload`, and a `powerOverload` alert fires.
8. Damage a building with the dev console → a repair job appears and the Builder repairs it at 1.5×.
9. Queue an item costing more than the storage cap → `waiting(storage)` with a "build a Supply Depot" hint.
10. Let a cheaper item and a starved item compete → after 60 s the starved item earmarks, and the HUD shows the earmark.
11. Dawn arrives with no shedding beyond group 1 → `nightSurvived` fires, and Night Shift progress +1.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–4, 6 (night → shedding by group, without wind or capacitor), 7, 8, 9, 10. `W03-29` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- Until W03-18 (power overlay + HUD, `H+`) lands, steps 3, 6 and 7 assert the synced power fields (W03-16) instead of the overlay and the shed list.
- **Deferred:** Wind Turbine, Capacitor (step 5 keeps only the Supply Depot), the Petroleum Well (W03-30: it yields only `bio.t2`, which needs W05-34's terraforming gate), assist, power events and Night Shift (step 11), archetype bindings/anims and the two new archetypes (existing models stand in).
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
| 7 | Brownout shedding per connected component (W02-06's groups and order, extended to the multi-component grid); terraform op load in group 1 (`UO-TF-02`) | W03-07 |
| 8 | Robot drain counted on the Hub's component only (idle 50 % already in W02-05, `UO-S-02`) | W03-07 |
| 9 | Capacitor T1: 1 500 E, discharge ≤ 30 E/s, surplus charges | W03-08 |
| 10 | Wind Turbine T1: wind factor 50–140 %, resampled and smoothed | W03-09 |
| 11 | Thermal Plant T1: `bio.biomass` fuel upkeep × `ECONOMY_RATE_SCALE` (D-34 maps T1 Pet to biomass), offline at 0 biomass, pollution counter (raid hook for W07) | W03-10 |
| 12 | Supply Depot T1 (+1 000 cap per family), Minerals Quarry T1 (`minerals.t1`), Water Extractor T1 (`bio.water`, `desert` ×0.5) | W03-11 |
| 28 | Petroleum Well T1 on an oil deposit: the Bio T2 source (`bio.t2`), producing only while W05-34's tier gate is open (D-34) | W03-30 |
| 13 | Four lanes (Construction, Terraform, Units, HQ goals shell), precedence `system > player > hq > ai > auto`, per-lane limits 20/20/10 + 5 per production building (`UO-P`) | W03-12 |
| 14 | Dispatch across the four lanes: W02-15/W02-16's non-blocking scan and worker choice, run in the W03 precedence order (`UO-D-01/03`) | W03-12, W03-13 |
| 15 | Earmarks after 60 s, ≤ 80 % of cap; `waiting(storage)` never earmarks (`UO-D-02`, `UO-Q-05`) | W03-13 |
| 16 | `waiting(power \| worker \| storage)` reasons + ETA shown per lane (`UO-Q-03`; the reasons themselves are W02-14) | W03-19 |
| 17 | Demolish (50 % refund) and drag reorder: built in W02-09 / W02-13; W03 adds only the UI (`UO-Q-02`) | W03-20 |
| 18 | Power-line drag = 1 order (`UO-M`) | W03-17 |
| 19 | Power overlay + power HUD (generation, demand, stored, night forecast, shed list) | W03-18 |
| 20 | Repair and demolish UI | W03-20 |
| 21 | Building archetypes: bind existing Pylon, Capacitor, Wind, Thermal (`coalGen`), Depot, Water (`waterPump`); new Quarry and Petroleum Well | W03-21, W03-22, W03-23 |
| 22 | Power-line cables and overload VFX | W03-24 |
| 23 | `powerSevered` (W03-05), `nightSurvived`, `brownoutShed` list (SIM §9; `energyCollapse` is W02-06/W02-17) | W03-15 |
| 24 | Achievements: Power Broker (peak net E/s), Night Shift | W03-25 |
| 25 | Analytics: first pylon, first brownout, first night survived, first overload | W03-26 |
| 26 | Dev console: wind, fuel drain, add load, damage building (time of day is W02-30's `time`) | W03-27 |
| 27 | Perf: grid rebuild ≤ 2 ms for 300 nodes | W03-28 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W03-01 | Contracts & data: Builder unit row; Pylon T1, Capacitor T1, Wind T1, Thermal T1, Depot T1, Quarry T1, Water T1, Petroleum Well T1 rows (`wave:'W03'`); commands `repair`, `placePowerLine` (`demolish`, `reorderTask` and `energyCollapse` already exist from W02-01); events `powerSevered`, `powerOverload`, `brownoutShed`, `nightSurvived`; reject codes `worker_tier_locked`, `lane_full`; register flag `W03` | contract | M | H | W02-01 | Run `npm run check` with `TA_WAVES=..03` → see the new rows compile through `compileData` | econ §3.2–3.5, `UO-L`, `SIM-C` | TA-14.1, TA-06.4 |
| W03-02 | Builder drone in sim: Hub prints it (Units lane, 12 s), build rate 1.0×, construction ≤ T1, `worker_tier_locked` above | sim | M | H | W03-01 | Order a T2 build with only Builders (scenario) → see it rejected `worker_tier_locked` | `UO-L-02`, §5.1 | TA-06.6, TA-14.2 |
| W03-03 | Repair job: auto-queued for damaged own structures (`system` precedence for critical), Builder repairs any tier at 1.5×, every builder-capable worker can repair | sim | S | H | W03-02 | Damage a pylon to 50 % → see a repair entry appear and HP return to max at the 1.5× rate | `UO-L-02` | TA-06.6 |
| W03-04 | Assist: up to 4 workers on one construction, rates add | sim | S |  | W03-02 | Put 2 Builders on a 14 s build → see it complete in 7 s | `UO-L-04/05` | TA-14.2 |
| W03-05 | Power graph v2 (extends W02-05's single component): pylon span 6, building connects within 3 tiles of a pylon/Hub, connected components, `OFFLINE` without generator or charged capacitor, dirty rebuild on build or destroy | sim | M | H | W03-01, W02-05 | Destroy the middle pylon of a chain → see downstream consumers go `offline: no grid` in the same tick and `powerSevered` fire | `SIM-G-PWR` | TA-06.5 |
| W03-06 | Per-pylon max load: deterministic BFS spanning tree, subtree flow, overload sheds the branch by shed order, `offline: overload`, `powerOverload` debounced 600 ticks, Hub max 150 E/s | sim | M | H | W03-05, W03-07 | Push 120 E/s through a T1 pylon → see its branch shed until ≤ 80 E/s while other branches stay online | D-21, `SIM-G-PWR` | TA-06.12 |
| W03-07 | Per-component brownout: run W02-06's shed groups (newest first) on each connected component separately; W03 rows join their groups (Depot → 3, Thermal/Wind/Capacitor cooling → 4); robot drain counts only on the Hub's component | sim | S | H | W03-05, W02-06 | Split the grid into two components and overload one → see only that component shed, group 1 first | econ §1 rule 2, `UO-S-02`, `UO-TF-02` | TA-06.5 |
| W03-08 | Capacitor T1: stores 1 500 E, discharges ≤ 30 E/s, surplus charges, counts as supply in its component | sim | S |  | W03-05 | At night with a 20 E/s deficit → see the capacitor drain at 20 E/s and the colony stay online until it is empty | econ §3.2 | TA-06.5 |
| W03-09 | Wind Turbine T1: +16 gross × wind factor (5 000–14 000 bp), resampled every 1 200 ticks and smoothed; environment publishes the wind factor | sim | S |  | W03-01 | Dev-set wind to 140 % → see the turbine at +22.4 gross | econ §3.3, SIM §7.6 | TA-06.5 |
| W03-10 | Thermal Plant T1: +28 gross, consumes 1.5 × scale `bio.biomass`/s (the spec's Pet fuel, read through the D-34 T1 rule), offline at 0 biomass, `pollution` counter per colony (consumed by W07 raids) | sim | S | H | W03-01 | Drain `bio.biomass` to 0 → see the thermal plant show `offline: no fuel` | econ §3.3, `UO-S-03` | TA-06.5 |
| W03-11 | Supply Depot T1 (+1 000 to the cap of each family: Metals, Minerals, Bio), Minerals Quarry T1 (`minerals.t1`), Water Extractor T1 (`bio.water`, ×0.5 on `desert`, no deposit), all scaled by `ECONOMY_RATE_SCALE`; T1 output only (T2/T3 split is W05-34) | sim | M | H | W03-01 | Build a Depot and a Quarry on a minerals deposit → see the Minerals cap read 1 500 and +0.75 `minerals.t1`/s × richness | econ §3.4–3.5 | TA-06.4 |
| W03-12 | Four lanes in sim (extends W02-13/W02-14): Construction, Terraform, Units, HQ-goal shell; precedence `system > player > hq > ai > auto`; limits 20 / 20 / 10 + 5 per production building; `lane_full` drops the oldest `auto` first | sim | M | H | W02-14 | Fill Construction to 20 → see the 21st player order rejected `lane_full` | `UO-P`, `SIM-C-04` | TA-14.2 |
| W03-13 | Earmarks: a resource-starved entry earmarks its missing amount after 60 s, capped at 80 % of storage; `waiting(storage)` never earmarks; W02-15/W02-16's scan and worker choice run across the four lanes in precedence order | sim | S | H | W03-12, W02-16 | A blocked 75-Min item waits 60 s → see later items unable to spend the earmarked Min and the entry state read `earmark 40 Min` | `UO-D-01..04`, `UO-Q-03/05` | TA-14.2 |
| W03-15 | Power events: `nightSurvived` at dawn if no shedding beyond group 1 that night, `brownoutShed` list in the colony view (`energyCollapse` stays in W02-17) | sim | S |  | W03-07 | Run a full night with a capacitor and wind → see `nightSurvived` fire at dawn exactly once | SIM §9 | TA-06.5 |
| W03-16 | Power sync: register per-building `power: {state, reason, component}`, per-pylon `{flow, max}` and the colony power summary as synced fields; they ride the W00-24 diff and the client reads them through `view()` | sim | S | H | W03-06 | Open the WS inspector during an overload → see the power fields change within 1 delta | PROTOCOL deltas | TA-07.6 |
| W03-17 | Construction menu: new buildings and a **power-line drag tool** (hex path, auto-spaced pylons, one queue entry with N sub-sites, cost total on the ghost) | client | M | H | W03-01 | Drag a 12-tile line and confirm → see one queue entry with 2 pylon sub-sites | `UO-M` | TA-11.8 |
| W03-18 | Power overlay (toggle `P`): cables coloured by pylon load (green / amber / red), offline and overload badges, component tint; power HUD panel (extends W02-26's widget) with generation, demand, stored, time to night, night forecast, shed list | client | M | H+ | W03-16 | Press `P` during an overload → see the overloaded pylon blink red and the HUD list the shed buildings with `overload` | CLIENT §8 | TA-11.7 |
| W03-19 | Queue panel v2 (extends W02-25): four lane tabs, earmark bars, `waiting(storage)` hint button ("build Depot" opens the placement ghost) | client | M | H | W03-13 | Click the storage hint on a `waiting(storage)` entry → see the Depot placement ghost open | `UO-Q-03/05` | TA-14.8 |
| W03-20 | Context actions on buildings: Repair (manual), Demolish (confirm plate with refund preview, on W02-09's demolish), Cancel; damaged HP indicator on buildings | client | S |  | W03-03, W02-09 | Select a damaged pylon and press Demolish → see a "refund 7 M / 2 Min" preview | `UO-Q-02` | TA-11.8 |
| W03-21 | Bind the existing `building.pylon` and `building.capacitor` archetypes as Pylon T1 / Capacitor T1: fix their validator findings (pylon 16 errors, capacitor 1 error today), add the `aPartAnim` pulse | visual | M | H+ | — | Run `npm run validate:models -- building.pylon building.capacitor` → see 0 errors and 0 warnings | AGENTS Pillar 1, `model-geometry-validator` skill | TA-14.9 |
| W03-22 | Bind the existing `building.wind` (rotor anim tied to the wind factor), `building.coalGen` as Thermal Plant T1 (chimney smoke emitter) and `building.supplyDepot`; fix their validator findings | visual | M |  | — | Set wind to 140 % in game → see the rotor spin visibly faster than at 50 % | Pillars 1, 3 | TA-14.9 |
| W03-23 | Bind the existing `building.waterPump` as Water Extractor T1; new archetypes `building.quarry` (Minerals Quarry T1) and `building.petroleumWell` (pump-jack anim) | visual | M | H+ | — | Run `npm run validate:models -- building.waterPump building.quarry building.petroleumWell` → see 0 errors and 0 warnings | Pillar 1 | TA-14.9 |
| W03-24 | Power cables between pylons (sagging `CatmullRomCurve3`), overload flicker and sparks VFX, offline buildings dim their emissives | visual | S | H+ | W03-21 | Overload a pylon → see its cable flicker amber/red | lighting skill | TA-14.9 |
| W03-25 | Progression events: `peakNetPower` (Power Broker), `nightSurvived` (Night Shift) emitted to the progression bus | sim | S |  | W03-15 | Dev-run a night → see the progression bus log `nightSurvived {colonyId}` | player-profile §3 | — |
| W03-26 | Analytics: `first_pylon_built`, `first_brownout`, `first_night_survived`, `first_overload` via `track()` | client | S |  | W03-18 | Trigger an overload → see one `first_overload` row in the analytics table | CLIENT §10 | — |
| W03-27 | Dev console: `setWind <pct>`, `drainFuel`, `addLoad <E/s>`, `damage <entity> <pct>` (time of day uses W02-30's `time`) | server | S | H | W00-40, W02-30 | Run `addLoad 200` → see colony demand rise by 200 E/s and shedding start | PRODUCT_WAVES §3 | — |
| W03-28 | Unit tests + perf: flow-tree determinism (same graph → same shed set), shed order, earmark starvation, grid rebuild ≤ 2 ms at 300 nodes | test | M | H+ | W03-06, W03-13 | Run `npm test -w @terra/sim -- grid` → see it green and the bench print ≤ 2 ms | SIM §12 | TA-06.5 |
| W03-30 | Petroleum Well T1 (split out of W03-11 by D-34): footprint must cover an oil deposit; it is the Bio T2 source and yields `bio.t2` (rate × richness × `ECONOMY_RATE_SCALE`) only while its deposit passes the T2 gate (a hook that stays closed until W05-34 implements it); otherwise `offline: needs terraforming (T2)` | sim | S | H+ | W03-01 | Build a Well on an oil deposit in `?scenario=w03` → see `offline: needs terraforming (T2)`, and in the unit test with the gate hook forced open see `bio.t2` credited at rate × richness | econ §3.4–3.5, D-34 | TA-06.4 |
| W03-29 | Wave e2e + scenario `w03-the-grid` + tag `wave-03` | test | M | H | all W03 | Run `npm run e2e -- --waves ..03` → see the demo story pass and W00–W02 still pass | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w03.spec.ts` passes, and so do all earlier wave suites.
- `?scenario=w03` loads.
- With `TA_WAVES=..02`, no W03 building, lane, overlay or command exists, and W02's demo still passes.
- Tag `wave-03` is created.
- Every row of "Features covered" is checked against its issue.
