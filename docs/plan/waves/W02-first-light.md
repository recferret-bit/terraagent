# W02 — First Light

> **Track:** Spine (lead) · **Flag:** `W02` · **Tag:** `wave-02` · **Scenario:** `scenarios/w02-first-light.ts` · **Depends on:** W01
>
> **Specs:**
> - [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md):
>   - §3.1 `UO-L-01/05`
>   - §3.3 `UO-S-01..03`
>   - §4.1 `UO-M`
>   - §4.2 `UO-Q-01..05`
>   - §4.3 `UO-D-01/03/04`
>   - §4.4 `UO-P`
>   - §5.1 Harvester row
>   - §6.2 S1
>   - §6.4 S1 pacing
> - [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md):
>   - §1 rules 2, 4
>   - §3.3 Solar T1
>   - §3.4 Metals Extractor T1
> - [`SIMULATION.md`](../../spec/SIMULATION.md):
>   - §3 slots 1, 5–9
>   - §7.4 (single component part)
>   - §7.6 day length
>   - §9 `resourceShortage`
> - [`CLIENT.md`](../../spec/CLIENT.md) §8, §10
> - D-16, D-24, D-31, D-33, D-34, D-35, D-36
>
> **Owned paths:**
> - `shared/sim/src/systems/{environment,economy,power-core,production,queue,dispatch,factories-hub,harvest}/`
> - `shared/sim/src/data/{resources,economy-t1-basic,units-workers-basic}.ts`
> - `frontend/game/features/{construction-menu,units-menu,queue-panel,resources-hud,power-hud,harvest-weights}/`
> - the prototype resource bar `frontend/game/ui/hud.ts` (`GameHud`) and its fake income tick in `frontend/game/app/Gameplay.ts` (replaced by `resources-hud`)
> - anims/validator fixes on the **existing** archetypes `building.mine` (= Metals Extractor T1), `building.solar`, `robot.miner` (= Harvester) in `frontend/render/kitbash/archetypes/`; day/night wiring of the existing `frontend/render/lighting/PlanetaryLightingSystem.ts`
> - `scenarios/w02-first-light.ts`
>
> **Already exists (prototype, client-only):** the archetypes above, `PlanetaryLightingSystem` (not wired), and a static resource bar (energy/metal/water/biomass with a fake tick). Under D-31 the numbers and the day cycle come from `shared/sim`; the client only draws them.

## Goal

The colony starts to live. Resources flow, power has to balance, and day turns into night. The player uses the first real **order queue** (Construction + Units lanes), which shows why each order is waiting and when it will start.

Content follows stage S1, limited to what this wave owns: Harvester, Metals Extractor, Solar T1. The Terraformer and Level (also S1) arrive with W05 and appear in S1 automatically when `W05` is on. There are no stage gates yet: stages are W08, so every W02 item is available as soon as the Hub stands.

**Planet type.** Still `temperate` only (D-33). `desert` (Solar +35 %) and `ocean` arrive with their generators in W05-17 (post-hackathon). The Solar modifier hook is built here and tested with a fake planet type.

**Resources (D-34).** Three families, Metals, Minerals and Bio, each with T1/T2/T3 sub-resources; the ledger keeps 10 stock keys (`metals.t1..t3`, `minerals.t1..t3`, `bio.water`, `bio.biomass`, `bio.t2`, `bio.t3`) and one storage cap per family. Energy is not a family: it is grid power (E/s). In this wave every extractor and harvester produces **T1 only**; the T2/T3 unlock by terraforming is W05-34. Cost shorthand `M/Min/Pet/W` (e.g. `65/20/0/10`) reads through the D-34 tier rule: a T1 item pays M → `metals.t1`, Min → `minerals.t1`, Pet → `bio.biomass`, W → `bio.water`. All numbers are data rows, tunable with W00-59 (D-35).

## Demo story (`e2e/w02.spec.ts`)

1. Open `/play.html?scenario=w02`: Hub done, stock `metals.t1 400, minerals.t1 250, bio.biomass 150, bio.water 150`, morning → **see** the resource bar (three family chips Metals / Minerals / Bio with stock / cap / income and a tier breakdown, plus Energy) and the power widget (`+8 supply / −5 demand`, sun icon).
2. Open the Units menu → queue 1 Harvester → **see** the Units lane entry go `in_progress`. The stock drops `40/15/5/0` at start. About 10 s later a Harvester rolls out and starts harvesting the nearest surface deposit by itself.
3. Open the Construction menu → place a Metals Extractor on a deposit and a Solar → **see** both ghosts show prep bills, linked prep, then construction by the HQ, one after the other.
4. **See** the Extractor produce about `1.0 metals.t1/s` (× richness) once powered. The power widget shows Solar +20.
5. Queue builds until the Minerals chip is under 20, then queue a second Extractor → **see** `waiting: Minerals 5/20 · ~30 s at +0.5/s` in the queue panel. It starts automatically when affordable.
6. In the dev console run `time night` → **see** Solar drop to 0, demand exceed supply, and the Extractor shed (`offline: brownout`) with a red banner. `time day` restores everything.
7. In the dev console run `fill metals.t1` (or `grant metals.t1 9999`) → **see** the Metals chip at `500/500`, extraction paused, and an entry costing more than the cap show `waiting(storage)` with a "build a Supply Depot" hint (the Depot arrives in W03, so the hint is greyed out).
8. In the queue panel cancel an in-progress order → **see** 75 % refunded in the stock chips. Cancel a waiting order → **see** nothing charged.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–8. `W02-34` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** anims on the existing `building.mine` / `building.solar` / `robot.miner` archetypes (they stand in unanimated), wiring the existing day/night lighting system, harvest-weight sliders, analytics, pacing and perf checks. Phone layout moved to W24 (W24-13, W24-15, W24-16).
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Resources (D-34): 10 sub-resource stock keys in three families, colony ledger, storage cap per family, `production.capped` (econ §1 rule 4) | W02-02 |
| 2 | `ECONOMY_RATE_SCALE = 0.25` on all resource flows (`UO-S-03`) | W02-03 |
| 3 | Day/night: 20 min day, night share per planet type (40 %; `temperate` 45 %, D-33), daylight curve; storms hook (W03/W05) | W02-04 |
| 4 | Power v0 for one component: Hub acts as a pylon (span 6, attach ≤ 3 tiles), Founder Core +8, drains, unit drain at 50 % when idle, balance (`SIM-G-PWR`, `UO-S-02`) | W02-05 |
| 5 | Brownout shedding by data-driven groups, newest first; HQ fast-recharge in group 3 (econ §1 rule 2) | W02-06 |
| 6 | Solar T1 (+21 gross, −1 internal, 0 at night, `desert` hook) | W02-07 |
| 7 | Metals Extractor T1 on a Graded metals deposit, 4.0 × scale × richness of `metals.t1`, powered only | W02-08 |
| 8 | Generic T1 construction by HQ (footprint, linked prep reuse, progress, completion, demolish 50 %) | W02-09 |
| 9 | Hub production of workers (Units lane at the Hub, 5-slot buffer, supply check `supply_cap`) (`UO-D-04`, `UO-S-01`) | W02-10 |
| 10 | Harvester unit + standing harvest job (nearest surface deposit of the most-needed resource, weights), 0.5 res/s, Clear/Break eligible (`UO-L-01`) | W02-11, W02-12 |
| 11 | Order queue v1: entry lifecycle, pay on start, cancel refunds, wait reasons `resources/storage/worker/power/site`, ETA, lane limits, precedence `system > player > auto` (`UO-Q-01..05`, `UO-P`) | W02-13, W02-14, W02-15 |
| 12 | Dispatch v1: nearest idle eligible worker, lowest tier on ties, pre-emption only by `player` (`UO-D-01/03`) | W02-16 |
| 13 | Events `resourceShortage`, `energyCollapse` (brownout ≥ 30 s), `buildingCompleted`, `unitProduced` (`SIM-E`) | W02-17 |
| 14 | Visuals on existing assets: `building.mine` as Metals Extractor, `building.solar`, `robot.miner` as Harvester (anims), existing `PlanetaryLightingSystem` synced to sim daylight | W02-18, W02-19, W02-20, W02-21 |
| 15 | Construction menu (catalog from data rows, wave filter, cost/time/power, greyed with reason) | W02-22 |
| 16 | Generic placement ghost (2×2, deposit-coverage highlight, prep bill, rotation) | W02-23 |
| 17 | Units menu (Hub production, count, repeat toggle) | W02-24 |
| 18 | Queue panel (two lanes, states, reason + ETA text, cancel, drag to reorder player entries) | W02-25 |
| 19 | Family resource bar (Metals / Minerals / Bio chips with tier breakdown + Energy, D-34) + power widget + building info panel (online/offline reason), vanilla DOM (D-36) | W02-26 |
| 20 | Harvest weights sliders (immediate command, not queued) | W02-27 |
| 21 | Achievement events: Architect (buildings completed), Stockpile (resources produced) | W02-28 |
| 22 | Analytics: `first_building_built`, `first_unit_built`, `brownout_seen`, `queue_wait_seen` | W02-29 |
| 23 | Dev console: `time day/night/<hh:mm>`, `skipnight`, `fill <res>` (`grant` is W01-35's) | W02-30 |
| 24 | Touch / phone landscape for menus and queue panel (D-22): moved to W24 (W24-13, W24-15, W24-16, W24-17) | — |
| 25 | Pacing check S0–S1 (§6.4 rows) as a scripted sim test | W02-32 |
| 26 | Perf check: `sim:bench` with an economy-heavy planet | W02-33 |
| 27 | Wave e2e + scenario + tag | W02-34 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W02-01 | Contracts & data: commands `enqueueTask{build, buildUnit {unit, count, repeat}}`, `cancelTask`, `reorderTask`, `demolish`, `setHarvestWeights`; events `resourceShortage`, `energyCollapse`, `unitProduced`, `brownout`; rows (wave `W02`): resources (one row per `ResourceKey` with family and tier, D-34), Harvester, Metals Extractor T1, Solar T1, shed groups, day cycle; reject codes `insufficient_resources`, `supply_cap` | contract | M | H | W01-01 | Run `npm run gen` → see the kinds and rows; `..01` compiles them out | econ §3.3–3.4, §5.1 | TA-14.1 |
| W02-02 | Colony resource ledger (D-34): stock per sub-resource (10 keys), one cap per family shared by its tiers (Hub 500 + future Depots), clamp on credit, `production.capped` stat per family, ledger views in the `c` delta op | sim | S | H | W02-01 | Credit 600 `metals.t1` with the Metals cap 500 → see stock 500 and `capped.metals = 100` | econ §1 rule 4 | TA-06.4 |
| W02-03 | `ECONOMY_RATE_SCALE` (default 0.25) applied in `compileData` to every resource flow (extraction, harvest, upkeep, terraform `bio.water`, ammo) and never to E/s or costs | sim | S | H | W02-01 | Compile with scale 0.25 → see the Extractor at 1.0 M/s and the Solar still at +21 E/s | `UO-S-03` | — |
| W02-04 | Environment system: day length 20 min, night share per planet type from data (default 40 %; `temperate` 45 %, "cold nights", D-33), daylight curve 0..1, phase in the colony view; `dt`-safe; storm hook stub | sim | S | H | W00-15 | On a `temperate` planet advance 11 min of game time → see daylight drop to 0 and `night` start | SIM §7.6 | TA-06.5 |
| W02-05 | Power v0 (single component): Hub acts as a pylon (span 6), buildings attach if a footprint tile is ≤ 3 tiles away; supply = Σ generator net + Founder Core 8; demand = Σ online drains + unit drains (idle 50 %); balance every step | sim | M | H | W02-04, W01-17 | Hub alone → see `+8 / −5`; add 1 working Harvester → see `−6.5` demand | `SIM-G-PWR`, `UO-S-02` | TA-06.5 |
| W02-06 | Brownout shedding: data-driven groups (1: terraform ops, processors, silo; 2: factories, trade; 3: extractors, depots, HQ fast recharge; 4: keep last), newest first within a group; shed reason `offline: brownout`; `energyCollapse` after 30 s | sim | M | H | W02-05 | Force a 10 E/s deficit → see group 1 shed first, then the newest Extractor | econ §1 rule 2, `UO-TF-02` | TA-06.5 |
| W02-07 | Solar T1: 2×2, 18 s, `60/75/10/5`, internal −1, gross +21 × daylight; planet-type modifier hook (+35 % on `desert`, D-33) tested with a fake type | sim | S | H | W02-05 | Run `time 12:00`, then `time 00:00` → see the Solar's net output go from +20 to −1 | econ §3.3 | TA-06.5 |
| W02-08 | Metals Extractor T1: 2×2, 14 s, `65/20/0/10`, −6 E/s, HP 500; the footprint must cover a metals deposit tile; output `4.0 × scale × richness` of `metals.t1` while powered (T1 only until W05-34's tier gate); halts at the Metals cap | sim | S | H | W02-02, W02-03 | Place it off a deposit → see `cmd.reject site_blocked (no deposit)` (the 1.0 M/s rate is checked by W02-03) | econ §3.4 | TA-06.4 |
| W02-09 | Generic T1 construction: any data row with a footprint uses the W01 placement, linked prep and paid-on-start build path; completion; demolish refunds 50 %; T1 worker tier check (HQ ≤ T1) | sim | M | H | W01-16 | Demolish a finished Extractor → see 50 % of its cost returned and the tiles stay Prepared | `UO-Q-01/02`, `UO-L-02` | TA-06.4 |
| W02-10 | Hub worker production: Units lane at the Hub (5-slot buffer, 1.0×), paid on start, `supply_cap` check (supply 10), unit spawns at the Hub edge, `unitProduced` | sim | M | H | W02-09 | Queue 11 Harvesters → see 10 built and the 11th `waiting(supply)` | `UO-D-04`, `UO-S-01` | TA-06.6 |
| W02-11 | Harvester unit: `40/15/5/0`, 10 s, supply 1, −1.5 E/s, HP 160, speed 1.5, view 7, radius 0.4 | sim | S | H | W02-10 | Produce one → see its stats in the inspector match the row | §5.1 | TA-06.6 |
| W02-12 | Standing harvest job: idle harvest-capable workers pick the nearest surface deposit (not under a building) of the most-needed family (weights × stock deficit); T1 yield only (metal → `metals.t1`, mineral → `minerals.t1`, forest → `bio.biomass`); 2.0 × scale res/s credited directly; they also take Clear/Break sub-jobs | sim | M | H | W02-11, W02-02 | Set weights `minerals 100, metals 0` → see all Harvesters move to minerals deposits within 5 s | `UO-L-01` | TA-06.6 |
| W02-13 | Queue v1, part 1: Construction and Units lanes; entry lifecycle `queued → waiting(reason) → in_progress → done \| cancelled`; payment at start; cancel waiting = free, in progress = 75 %; player drag reorder | sim | M | H | W02-09, W02-10 | Queue 3 builds and reorder the third to the top → see it start first | `UO-Q-01/02` | TA-14.2 |
| W02-14 | Queue v1, part 2: wait reasons `resources` (with the missing amounts), `storage` (cost > cap, never earmarks), `worker`, `power`, `site`; ETA from the current income; precedence `system > player > auto`; limits Construction 20, Units 10 + 5 per producer | sim | M | H | W02-13 | Queue an item costing 600 M with cap 500 → see `waiting(storage)` and no ETA | `UO-Q-03/05`, `UO-P` | TA-14.2 |
| W02-15 | A blocked entry never blocks later entries (scan in precedence order and start the first startable one); earmarks come in W03 | sim | S | H | W02-14 | Block the head on Minerals with an affordable second entry → see the second start | `UO-D-01` | TA-14.2 |
| W02-16 | Dispatch v1: nearest idle eligible worker, lowest tier on ties, pre-emption of lower-precedence work only by `player` entries; linked prep goes to terraform-capable workers (HQ in W02) | sim | S | H | W02-13 | Two Hub orders with only the HQ → see the HQ finish the first, then walk to the second | `UO-D-03` | TA-14.2 |
| W02-17 | Events: `resourceShortage` (< 5 % of cap, negative net over 60 s), `energyCollapse`, `buildingCompleted`, `unitProduced`, `brownout {group}` with debounce | sim | S | H | W02-06, W02-02 | Drain `bio.water` below 5 % of the Bio cap for 60 s → see one `resourceShortage` event | SIM §9 | TA-06.4 |
| W02-18 | Bind the existing `building.mine` archetype as Metals Extractor T1: fix its validator findings (24 errors / 7 warnings today), add a drill working anim and an offline state (lights off) driven by the sim power state | visual | M | H+ | W02-08 | Force a brownout in game → see the drill stop and its lights dim | AGENTS Pillar 1, `model-geometry-validator` skill | TA-14.9 |
| W02-19 | Bind the existing `building.solar` archetype as Solar T1 (fix its 1 validator error): sun-tracking panel tilt driven by sim daylight, emissive off at night | visual | S | H+ | W02-07 | Run `time 18:00` → see the panels tilt toward the low sun and go dark at night | AGENTS Pillar 1 | TA-14.9 |
| W02-20 | Bind the existing `robot.miner` archetype as the Harvester (fix its 1 validator error): harvest anim + ore puff, carry indicator | visual | S | H+ | W02-12 | Watch a Harvester on a deposit → see the harvest loop animation | AGENTS Pillar 1 | TA-14.9 |
| W02-21 | Wire the existing `frontend/render/lighting/PlanetaryLightingSystem.ts` into the colony scene, driven by the sim daylight view (no client clock); building emissives on at night | visual | S | H+ | W02-04 | Run `warp 50` → see a smooth sunrise and sunset matching the HUD clock | `planetary-lighting-and-lightning` skill, SIM §7.6 | TA-11.5 |
| W02-22 | Construction menu: catalog from compiled rows (only enabled waves), card with cost / build time at the HQ's rate / power / footprint; unaffordable or invalid items show the reason; opens placement | client | M | H | W02-01, W00-27 | Open the menu with `?waves=..02` → see Hub (built), Extractor and Solar cards with cost, time and power | `UO-M` | TA-11.8, TA-14.8 |
| W02-23 | Generic placement ghost: any footprint, rotation (`R`), deposit-coverage highlight for extractors, prep bill, valid/invalid reason, confirm | client | M | H | W02-22, W01-28 | Hover the Extractor near a deposit → see the deposit tiles glow and "must cover a metals deposit" when off it | `UO-TF-03`, econ §3.4 | TA-11.8 |
| W02-24 | Units menu: Hub production list (Harvester), count stepper, repeat toggle, supply readout | client | S | H | W02-10, W00-27 | Queue 3 Harvesters with repeat → see the lane refill after each completes | `UO-M` Units row | TA-14.8 |
| W02-25 | Queue panel: Construction and Units lanes; entry chip with icon, state, progress %, reason text ("waiting: Minerals 5/20 · ~30 s"), cancel button, drag to reorder; collapsed mode for phones | client | M | H | W02-14 | Make an order wait on Minerals → see the reason and a decreasing ETA | `UO-Q-03` | TA-11.7, TA-14.8 |
| W02-26 | Drive the existing prototype resource bar (`GameHud` in `frontend/game/ui/hud.ts`, vanilla DOM panel classes + Faction Plate CSS, D-36) from the sim ledger view: switch it from energy/metal/water/biomass to three family chips Metals / Minerals / Bio (D-34) with stock / family cap / income (red at cap) and a tier breakdown on hover (T1/T2/T3; Bio: water, biomass, T2, T3; locked tiers greyed) plus an Energy chip (grid E/s), delete the fake income tick in `frontend/game/app/Gameplay.ts`; add the power widget (supply / demand, day clock, brownout banner) and the building info panel (HP, state, offline reason) | client | M | H | W02-05, W02-02 | Trigger night with only Solar → see the brownout banner and the Extractor panel showing `offline: brownout` | CLIENT §8 | TA-11.7 |
| W02-27 | Harvest weights sliders (Construction menu side panel); applied immediately via `setHarvestWeights` | client | S |  | W02-12 | Move the Minerals slider to 100 → see the Harvesters retarget within 5 s | `UO-L-01`, `UO-M` | TA-14.8 |
| W02-28 | Progression events: `buildingCompleted {kind}` (Architect), `resourceProduced {res, amount}` (`res` = `ResourceKey`) aggregated per 60 s per colony (Stockpile) onto the event bus | server | S | H | W02-17, W00-13 | Run 2 min of production → see two `resourceProduced` batches summing the ledger's produced counters | profile spec §3 families 6, 9 | TA-15.1 |
| W02-29 | Analytics: `first_building_built`, `first_unit_built`, `brownout_seen`, `queue_wait_seen {reason}` | client | S |  | W00-44 | Play the demo → see the four events recorded | CLIENT §10 | — |
| W02-30 | Dev console: `fill <res>`, `time day\|night\|hh:mm`, `skipnight`, `power` (component dump); `grant` is W01-35's | client | S | H | W00-40, W01-35 | Type `time 23:00` → see night and Solar at 0 | PRODUCT_WAVES §3 | — |
| W02-32 | Pacing check: scripted reference orders for S0–S1 (§6.4 rows) as a sim test; asserts S1 purchases are affordable by about 3:00 and the night power result is −6 E/s with Solar + Extractor + 2 Harvesters | test | S |  | W02-12, W02-07 | Run `pacing-s0-s1.spec.ts` → see times and power within the table's ±20 % | §6.4 | TA-14.7 |
| W02-33 | Perf: extend `sim:bench` with an economy-heavy planet (5 colonies, 60 buildings, 40 harvesters); step p99 ≤ 3 ms | test | S |  | W00-47 | Run `npm run sim:bench` → see step p99 ≤ 3 ms on `w02-econ` | SIM-P | TA-06.4 |
| W02-34 | Wave e2e `e2e/w02.spec.ts` (demo steps 1–8) + scenario `w02-first-light` (Hub done, morning, stock `metals.t1 400, minerals.t1 250, bio.biomass 150, bio.water 150`) + tag `wave-02` | test | S | H | all above | Run `npm run e2e -- --waves ..02` → see W00–W02 pass; then tag `wave-02` | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w02.spec.ts` passes, together with the W00 and W01 suites.
- `?scenario=w02` loads in the morning.
- `?waves=..01` hides every W02 menu item, the panels, the Harvester and the day/night lighting. The W01 demo still passes.
- The pacing test and `sim:bench` are within budget, and the bound archetypes (`building.mine`, `building.solar`, `robot.miner`) pass `npm run validate:models` with 0 errors and 0 warnings.
- Tag `wave-02` is created.
