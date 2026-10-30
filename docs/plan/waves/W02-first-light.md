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
> - [`CLIENT.md`](../../spec/CLIENT.md) §8, §11
> - D-16, D-24
>
> **Owned paths:**
> - `shared/sim/src/systems/{environment,economy,power-core,production,queue,dispatch,factories-hub,harvest}/`
> - `shared/sim/src/data/{resources,economy-t1-basic,units-workers-basic}.ts`
> - `client/src/features/{construction-menu,units-menu,queue-panel,resources-hud,power-hud,harvest-weights}/`
> - kitbash `building.metalsExtractor`, `building.solar`, `robot.miner` (tuning)
> - `scenarios/w02-first-light.ts`

## Goal

The colony starts to live. Resources flow, power has to balance, and day turns into night. The player uses the first real **order queue** (Construction + Units lanes), which shows why each order is waiting and when it will start.

Content follows stage S1, limited to what this wave owns: Harvester, Metals Extractor, Solar T1. The Terraformer and Level (also S1) arrive with W05 and appear in S1 automatically when `W05` is on. There are no stage gates yet: stages are W08, so every W02 item is available as soon as the Hub stands.

**Planet type.** Still Temperate only. Desert, with its Solar +35 % modifier, is deferred to the gameplay wave that adds the Desert terrain mix (proposed: W05). The Solar modifier hook is built here and tested with a fake planet type.

## Demo story (`e2e/w02.spec.ts`)

1. Load `?scenario=w02`: Hub done, stock `400/250/150/150`, morning → **see** the resource bar (stock / cap / income) and the power widget (`+8 supply / −5 demand`, sun icon).
2. Open the Units menu → queue 1 Harvester → **see** the Units lane entry go `in_progress`. The stock drops `40/15/5/0` at start. About 10 s later a Harvester rolls out and starts harvesting the nearest surface deposit by itself.
3. Open the Construction menu → place a Metals Extractor on a deposit and a Solar → **see** both ghosts show prep bills, linked prep, then construction by the HQ, one after the other.
4. **See** the Extractor produce about `1.0 M/s` (× richness) once powered. The power widget shows Solar +20.
5. Queue a second Extractor with too little Minerals → **see** `waiting: Minerals 5/20 · ~30 s at +0.5/s`. It starts automatically when affordable.
6. Run `time night` in the dev console → **see** Solar drop to 0, demand exceed supply, the Extractor shed (`offline: brownout`) with a red banner, and the Harvesters slow down. `time day` restores everything.
7. Fill Metals to the cap (`grant metals 9999`) → **see** the bar at `500/500`, extraction paused, and an entry costing more than the cap show `waiting(storage)` with a "build a Supply Depot" hint (the Depot arrives in W03, so the hint is greyed out).
8. Cancel an in-progress order → **see** 75 % refunded. Cancel a waiting order → **see** nothing charged.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–8. `W02-34` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** the new Extractor/Solar/Harvester archetypes (existing models stand in), day/night lighting, harvest-weight sliders, phone layout, pacing and perf checks.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Resources M/Min/Pet/W, colony ledger, storage caps, `production.capped` (econ §1 rule 4) | W02-02 |
| 2 | `ECONOMY_RATE_SCALE = 0.25` on all resource flows (`UO-S-03`) | W02-03 |
| 3 | Day/night: 20 min day, 60 % day / 40 % night, daylight curve; storms hook (W03/W05) | W02-04 |
| 4 | Power v0 for one component: Hub acts as a pylon (span 6, attach ≤ 3 tiles), Founder Core +8, drains, unit drain at 50 % when idle, balance (`SIM-G-PWR`, `UO-S-02`) | W02-05 |
| 5 | Brownout shedding by data-driven groups, newest first; HQ fast-recharge in group 3 (econ §1 rule 2) | W02-06 |
| 6 | Solar T1 (+21 gross, −1 internal, 0 at night, Desert hook) | W02-07 |
| 7 | Metals Extractor T1 on a Graded metals deposit, 4.0 × scale × richness, powered only | W02-08 |
| 8 | Generic T1 construction by HQ (footprint, linked prep reuse, progress, completion, demolish 50 %) | W02-09 |
| 9 | Hub production of workers (Units lane at the Hub, 5-slot buffer, supply check `supply_cap`) (`UO-D-04`, `UO-S-01`) | W02-10 |
| 10 | Harvester unit + standing harvest job (nearest surface deposit of the most-needed resource, weights), 0.5 res/s, Clear/Break eligible (`UO-L-01`) | W02-11, W02-12 |
| 11 | Order queue v1: entry lifecycle, pay on start, cancel refunds, wait reasons `resources/storage/worker/power/site`, ETA, lane limits, precedence `system > player > auto` (`UO-Q-01..05`, `UO-P`) | W02-13, W02-14, W02-15 |
| 12 | Dispatch v1: nearest idle eligible worker, lowest tier on ties, pre-emption only by `player` (`UO-D-01/03`) | W02-16 |
| 13 | Events `resourceShortage`, `energyCollapse` (brownout ≥ 30 s), `buildingCompleted`, `unitProduced` (`SIM-E`) | W02-17 |
| 14 | Visuals: Metals Extractor, Solar, Harvester anims, day/night lighting sync | W02-18, W02-19, W02-20, W02-21 |
| 15 | Construction menu (catalog from data rows, wave filter, cost/time/power, greyed with reason) | W02-22 |
| 16 | Generic placement ghost (2×2, deposit-coverage highlight, prep bill, rotation) | W02-23 |
| 17 | Units menu (Hub production, count, repeat toggle) | W02-24 |
| 18 | Queue panel (two lanes, states, reason + ETA text, cancel, drag to reorder player entries) | W02-25 |
| 19 | Resource bar + power widget + building info panel (online/offline reason) | W02-26 |
| 20 | Harvest weights sliders (immediate command, not queued) | W02-27 |
| 21 | Achievement events: Architect (buildings completed), Stockpile (resources produced) | W02-28 |
| 22 | Analytics: `first_building_built`, `first_unit_built`, `brownout_seen`, `queue_wait_seen` | W02-29 |
| 23 | Dev console: `grant`, `time day/night/<hh:mm>`, `skipnight`, `fill <res>` | W02-30 |
| 24 | Touch / phone landscape for menus and queue panel (D-22) | W02-31 |
| 25 | Pacing check S0–S1 (§6.4 rows) as a scripted sim test | W02-32 |
| 26 | Perf check: `sim:bench` with an economy-heavy planet | W02-33 |
| 27 | Wave e2e + scenario + tag | W02-34 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W02-01 | Contracts & data: commands `enqueueTask{build, buildUnit {unit, count, repeat}}`, `cancelTask`, `reorderTask`, `demolish`, `setHarvestWeights`; events `resourceShortage`, `energyCollapse`, `unitProduced`, `brownout`; rows (wave `W02`): resources, Harvester, Metals Extractor T1, Solar T1, shed groups, day cycle; reject codes `insufficient_resources`, `supply_cap` | contract | M | H | W01-01 | Run `npm run gen` → see the kinds and rows; `..01` compiles them out | econ §3.3–3.4, §5.1 | TA-14.1 |
| W02-02 | Colony resource ledger: stock per resource, cap per resource (Hub 500 + future Depots), clamp on credit, `production.capped` stat, ledger views in the `c` delta op | sim | S | H | W02-01 | Credit 600 M with cap 500 → see stock 500 and `capped.metals = 100` | econ §1 rule 4 | TA-06.4 |
| W02-03 | `ECONOMY_RATE_SCALE` (default 0.25) applied in `compileData` to every resource flow (extraction, harvest, upkeep, terraform water, ammo) and never to E/s or costs | sim | S | H | W02-01 | Compile with scale 0.25 → see the Extractor at 1.0 M/s and the Solar still at +21 E/s | `UO-S-03` | — |
| W02-04 | Environment system: day length 20 min (60 % day), daylight curve 0..1, phase in the colony view; `dt`-safe; storm hook stub | sim | S | H | W00-15 | Advance 12 min of game time → see daylight drop to 0 and `night` start | SIM §7.6 | TA-06.5 |
| W02-05 | Power v0 (single component): Hub acts as a pylon (span 6), buildings attach if a footprint tile is ≤ 3 tiles away; supply = Σ generator net + Founder Core 8; demand = Σ online drains + unit drains (idle 50 %); balance every step | sim | M | H | W02-04, W01-17 | Hub alone → see `+8 / −5`; add 1 working Harvester → see `−6.5` demand | `SIM-G-PWR`, `UO-S-02` | TA-06.5 |
| W02-06 | Brownout shedding: data-driven groups (1: terraform ops, processors, silo; 2: factories, trade; 3: extractors, depots, HQ fast recharge; 4: keep last), newest first within a group; shed reason `offline: brownout`; `energyCollapse` after 30 s | sim | M | H | W02-05 | Force a 10 E/s deficit → see group 1 shed first, then the newest Extractor | econ §1 rule 2, `UO-TF-02` | TA-06.5 |
| W02-07 | Solar T1: 2×2, 18 s, `60/75/10/5`, internal −1, gross +21 × daylight; planet-type modifier hook (+35 % Desert, −25 % Ice at T2) tested with a fake type | sim | S | H | W02-05 | At noon → see net +20; at midnight → see −1 | econ §3.3 | TA-06.5 |
| W02-08 | Metals Extractor T1: 2×2, 14 s, `65/20/0/10`, −6 E/s, HP 500; the footprint must cover a metals deposit tile; output `4.0 × scale × richness` while powered; halts at cap | sim | S | H | W02-02, W02-03 | Place it off a deposit → see `cmd.reject site_blocked (no deposit)`; on one → see about 1.0 M/s | econ §3.4 | TA-06.4 |
| W02-09 | Generic T1 construction: any data row with a footprint uses the W01 placement, linked prep and paid-on-start build path; completion; demolish refunds 50 %; T1 worker tier check (HQ ≤ T1) | sim | M | H | W01-16 | Demolish a finished Extractor → see 50 % of its cost returned and the tiles stay Prepared | `UO-Q-01/02`, `UO-L-02` | TA-06.4 |
| W02-10 | Hub worker production: Units lane at the Hub (5-slot buffer, 1.0×), paid on start, `supply_cap` check (supply 10), unit spawns at the Hub edge, `unitProduced` | sim | M | H | W02-09 | Queue 11 Harvesters → see 10 built and the 11th `waiting(supply)` | `UO-D-04`, `UO-S-01` | TA-06.6 |
| W02-11 | Harvester unit: `40/15/5/0`, 10 s, supply 1, −1.5 E/s, HP 160, speed 1.5, view 7, radius 0.4 | sim | S | H | W02-10 | Produce one → see its stats in the inspector match the row | §5.1 | TA-06.6 |
| W02-12 | Standing harvest job: idle harvest-capable workers pick the nearest surface deposit (not under a building) of the most-needed resource (weights × stock deficit); 2.0 × scale res/s credited directly; they also take Clear/Break sub-jobs | sim | M | H | W02-11, W02-02 | Set weights `minerals 100, metals 0` → see all Harvesters move to minerals deposits within 5 s | `UO-L-01` | TA-06.6 |
| W02-13 | Queue v1, part 1: Construction and Units lanes; entry lifecycle `queued → waiting(reason) → in_progress → done \| cancelled`; payment at start; cancel waiting = free, in progress = 75 %; player drag reorder | sim | M | H | W02-09, W02-10 | Queue 3 builds and reorder the third to the top → see it start first | `UO-Q-01/02` | TA-14.2 |
| W02-14 | Queue v1, part 2: wait reasons `resources` (with the missing amounts), `storage` (cost > cap, never earmarks), `worker`, `power`, `site`; ETA from the current income; precedence `system > player > auto`; limits Construction 20, Units 10 + 5 per producer | sim | M | H | W02-13 | Queue an item costing 600 M with cap 500 → see `waiting(storage)` and no ETA | `UO-Q-03/05`, `UO-P` | TA-14.2 |
| W02-15 | A blocked entry never blocks later entries (scan in precedence order and start the first startable one); earmarks come in W03 | sim | S | H | W02-14 | Block the head on Minerals with an affordable second entry → see the second start | `UO-D-01` | TA-14.2 |
| W02-16 | Dispatch v1: nearest idle eligible worker, lowest tier on ties, pre-emption of lower-precedence work only by `player` entries; linked prep goes to terraform-capable workers (HQ in W02) | sim | S | H | W02-13 | Two Hub orders with only the HQ → see the HQ finish the first, then walk to the second | `UO-D-03` | TA-14.2 |
| W02-17 | Events: `resourceShortage` (< 5 % of cap, negative net over 60 s), `energyCollapse`, `buildingCompleted`, `unitProduced`, `brownout {group}` with debounce | sim | S | H | W02-06, W02-02 | Drain Water below 5 % for 60 s → see one `resourceShortage` event | SIM §9 | TA-06.4 |
| W02-18 | Metals Extractor T1 archetype `building.metalsExtractor` (drill head, conveyor, cable silhouette breaker) + working anim + offline state (lights off) | visual | M | H+ | W02-08 | `?inspect=building.metalsExtractor` → see the audit pass; brownout in game → see the drill stop and lights dim | AGENTS Pillar 1 | TA-14.9 |
| W02-19 | Solar T1 archetype `building.solar` (panel array, angled masts) + sun-tracking anim driven by daylight; emissive off at night | visual | M | H+ | W02-07 | Run `time 18:00` → see the panels tilt and go dark at night | AGENTS Pillar 1 | TA-14.9 |
| W02-20 | Harvester (`robot.miner`): audit pass, harvest anim + ore puff, carry indicator | visual | S | H+ | W02-12 | Watch a Harvester on a deposit → see the harvest loop animation | AGENTS Pillar 1 | TA-14.9 |
| W02-21 | Day/night lighting synced to sim daylight (orbital sun, `planetary-lighting-and-lightning` skill), building emissives at night | visual | M | H+ | W02-04 | Run `warp 50` → see a smooth sunrise and sunset matching the HUD clock | AGENTS lighting skill | TA-11.5 |
| W02-22 | Construction menu: catalog from compiled rows (only enabled waves), card with cost / build time at the HQ's rate / power / footprint; unaffordable or invalid items show the reason; opens placement | client | M | H | W02-01, W00-27 | Open the menu with `..02` → see Hub (built), Extractor, Solar; with `..01` → see the Hub only | `UO-M` | TA-11.8, TA-14.8 |
| W02-23 | Generic placement ghost: any footprint, rotation (`R`), deposit-coverage highlight for extractors, prep bill, valid/invalid reason, confirm | client | M | H | W02-22, W01-28 | Hover the Extractor near a deposit → see the deposit tiles glow and "must cover a metals deposit" when off it | `UO-TF-03`, econ §3.4 | TA-11.8 |
| W02-24 | Units menu: Hub production list (Harvester), count stepper, repeat toggle, supply readout | client | S | H | W02-10, W00-27 | Queue 3 Harvesters with repeat → see the lane refill after each completes | `UO-M` Units row | TA-14.8 |
| W02-25 | Queue panel: Construction and Units lanes; entry chip with icon, state, progress %, reason text ("waiting: Minerals 5/20 · ~30 s"), cancel button, drag to reorder; collapsed mode for phones | client | M | H | W02-14 | Make an order wait on Minerals → see the reason and a decreasing ETA | `UO-Q-03` | TA-11.7, TA-14.8 |
| W02-26 | Resource bar (stock / cap / income per resource, red at cap), power widget (supply / demand, day clock, brownout banner), building info panel (HP, state, offline reason) | client | M | H | W02-05, W02-02 | Trigger night with only Solar → see the brownout banner and the Extractor panel showing `offline: brownout` | CLIENT §8 | TA-11.7 |
| W02-27 | Harvest weights sliders (Construction menu side panel); applied immediately via `setHarvestWeights` | client | S |  | W02-12 | Move the Minerals slider to 100 → see the Harvesters retarget within 5 s | `UO-L-01`, `UO-M` | TA-14.8 |
| W02-28 | Progression events: `buildingCompleted {kind}` (Architect), `resourceProduced {res, amount}` aggregated per 60 s per colony (Stockpile) onto the event bus | server | S | H | W02-17, W00-13 | Run 2 min of production → see two `resourceProduced` batches summing the ledger's produced counters | profile spec §3 families 6, 9 | TA-15.1 |
| W02-29 | Analytics: `first_building_built`, `first_unit_built`, `brownout_seen`, `queue_wait_seen {reason}` | client | S |  | W00-44 | Play the demo → see the four events recorded | CLIENT §10 | — |
| W02-30 | Dev console: `grant <res> <n>`, `fill <res>`, `time day\|night\|hh:mm`, `skipnight`, `power` (component dump) | client | S | H | W00-40 | Type `time 23:00` → see night and Solar at 0 | PRODUCT_WAVES §3 | — |
| W02-31 | Phone landscape: menus as bottom sheets, queue panel collapsible, resource bar compact, ≥ 44 px touch targets | client | S |  | W02-22, W02-25 | Run the e2e in 844×390 touch emulation → see the whole demo pass with touch | D-22, CLIENT §11 | TA-11.9 |
| W02-32 | Pacing check: scripted reference orders for S0–S1 (§6.4 rows) as a sim test; asserts S1 purchases are affordable by about 3:00 and the night power result is −6 E/s with Solar + Extractor + 2 Harvesters | test | S |  | W02-12, W02-07 | Run `pacing-s0-s1.spec.ts` → see times and power within the table's ±20 % | §6.4 | TA-14.7 |
| W02-33 | Perf: extend `sim:bench` with an economy-heavy planet (5 colonies, 60 buildings, 40 harvesters); step p99 ≤ 3 ms | test | S |  | W00-47 | Run `npm run sim:bench` → see step p99 ≤ 3 ms on `w02-econ` | SIM-P | TA-06.4 |
| W02-34 | Wave e2e `e2e/w02.spec.ts` (demo steps 1–8) + scenario `w02-first-light` (Hub done, morning, stock 400/250/150/150) + tag `wave-02` | test | S | H | all above | Run `npm run e2e -- --waves ..02` → see W00–W02 pass; then tag `wave-02` | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `e2e/w02.spec.ts` passes, together with the W00 and W01 suites.
- `?scenario=w02` loads in the morning.
- `?waves=..01` hides every W02 menu item, the panels, the Harvester and the day/night lighting. The W01 demo still passes.
- The pacing test and `sim:bench` are within budget, and the new archetypes pass the playground audit.
- Tag `wave-02` is created.
