# W17 — Second Tier (S5–S7)

> **Track:** Gameplay (G) · **Flag:** `W17` · **Scenario:** `scenarios/w17-second-tier.ts` · **Tag:** `wave-17` · **Depends on:** W05, W07, W08. Optional: W14 (walls; indirect fire over ridges), W04 (minimap radar blips, W17-17), W24 (touch chips, W17-29).
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §3.1 (`UO-L-02/03`), §3.2 (`UO-HQ-01`), §4.3 (`UO-D-03`), §4.5 (`UO-TF-01/03/08/10`), §4.6 (`UO-G`), §5.1, §5.2, §5.4 (`UO-C-06/08`), §5.5 (`AC-04`), §5.6, §6.2, §6.3 (`UO-T-03`), §6.4 · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §3 · D-28, D-34, D-35 · [`OWNER_TASKS.md`](../OWNER_TASKS.md) B1, B5, B6, B7
> **Costs and balance:** T2 rows pay through the D-34 tier rule: 60 % of their M and Min in `metals.t1` / `minerals.t1` and 40 % in `metals.t2` / `minerals.t2`, Pet in `bio.t2`, W in `bio.water`. A colony gets T2 sub-resources from the W05-34 terraforming gate or buys them on the market (W13). Every number here (stats, dwell, Processor rate, unlock stages) is a data row, tunable with W00-59 (D-35); the accepted OWNER_TASKS defaults B1, B5, B6 and B7 are the starting rows.
> **Owned paths:** `shared/sim/src/systems/{tiers,radar,fauna-brute}/`, `shared/sim/src/data/{tier2,units-ground2,fauna-brute}.ts`, `frontend/game/features/{tiers,radar}/`, new archetypes `frontend/render/kitbash/archetypes/units/{tank,artillery,radar,multitask,brute}.ts`.
> **Soft dependencies:** walls (W14) make Brutes walk at walls and let artillery fire over ridges; touch chips need W24-11.

## Goal

The colony moves past T1:
- the HQ upgrades the Hub to T2, and the HQ and the Multitask drone become multirole;
- T2 buildings unlock;
- the full ground rock–paper–scissors triangle (Recon / Tank / Artillery) plus Mobile Radar spotting is playable against the new Brute fauna.

## Demo story (e2e `e2e/w17.spec.ts`)

1. Open `/play.html?scenario=w17`: an S4 colony with 3 min of S4 dwell, Hub T1, Factory T1, a Terraformer, Recon ×2, two Supply Depots, stock 2 000 of every T1 sub-resource plus 600 `metals.t2` / `minerals.t2` / `bio.t2` (D-34 T2 costs) and a Skitter nest at 20 tiles. Construction menu → order a Hub T2 upgrade → the order waits ("available in 5:00") because S4 dwell is under 8 min.
2. Dev console `warp 20` (or `setDwell 4 8`) → the upgrade becomes orderable. The HQ prepares the +1 ring and upgrades the Hub. → The HQ docks for a 20 s refit and comes back as HQ T2 (multirole). Stage toast "S5 Second Tier".
3. Queue a Multitask T2 at the Hub. → It builds a T2 Metals Extractor. A Builder T1 cannot take that job (`waiting: worker (T2 needed)`).
4. Upgrade the Factory to T2 (S6 after 5 min dwell; `warp 20` or `setDwell 5 5`) and build Tank ×2 + Artillery ×2 from the Units menu. Run `spawnBrute 1` → a raid with a Brute arrives.
5. With no spotter, Artillery does not fire at the Brute beyond its 6-tile view. Build Mobile Radar. → Radar contacts are spotted, and artillery shells land on the Brute from 14 tiles.
6. Dev console `spawnUnit recon 3 enemy` near the artillery. → Shells miss the strafing Recon, and Tanks kill it.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Hub T2 upgrade: HQ-only, in place, Δ cost 400/250/150/100, +1 ring Prepared + owned (`UO-L-03`, `UO-TF-01`) | W17-02, W17-03 |
| 2 | Hub T2 orderable only after 8 min in S4 (§6.2, §6.4) | W17-02 |
| 3 | HQ refit 20 s → HQ T2 (2 200 HP, 2.5×, all lanes, 3 goals, 3 offers, cell 2 000 E) (`UO-HQ-01`, `UO-HQ-06`) | W17-04 |
| 4 | HQ reprint cost at T2 (500/300/150/100 · 90 s): one reprint table for all tiers in W18-07 | W18-07 |
| 5 | Multitask T2 (130/90/30/15, 2 supply, 2.0× all lanes, ≤ T2) built at Hub T2 | W17-05 |
| 6 | Worker tier gate for T2 structures (`UO-L-02`, reject `worker_tier_locked`) | W17-06 |
| 7 | Dispatch tie-break: lowest tier first (`UO-D-03`): W02-16's rule, T2 workers join it | W17-06 |
| 8 | T2 rows enabled: Beacon, Solar, Extractors, Depot, DCA, Turret, Factory (economy spec §3) | W17-07 |
| 9 | Factory T2 (1.5× on T1 units), unlocking Tank / Artillery / Radar | W17-08 |
| 10 | Tank (900 HP, rocket 36 DPS, range 5, AoE 1.0) | W17-09, W17-15 |
| 11 | Artillery (shell 45 DPS, range 14, min 3, speed 4, AoE 1.5, indirect, view 6); min-range back-off and impact checks from W07 | W17-10, W17-15 |
| 12 | Mobile Radar (radar 22, contacts count as spotted, unarmed) (`UO-C-06`); the shared view and fire-only-on-spotted rule are W07-08 | W17-11, W17-12 |
| 13 | Radar range ring and minimap contact blips; the min-range ring is W07-21 (`UO-C-08`) | W17-17 |
| 14 | Brute fauna (1 400 HP, 30 DPS bite, speed 1.0, radius 0.8; from S6; 1 per 4 in raids) (§5.6, `UO-T-03`) | W17-13, W17-14 |
| 15 | Stages S5 / S6 / S7 data: triggers, dwell, suggested goals, toasts, unlock lists incl. Deep Reclaim at S5 (W05-06 op) and Processor T1 (§6.2, `UO-TF-10`) | W17-16 |
| 16 | Terraforming Processor T1 unlocked at S5 (`UO-TF-08`, shed group 1) | W17-19 |
| 17 | Stage S7 extras: Beacon T2 view radius, Laser Tower T1 orderable, Aero Hangar orderable flag (built in W19) | W17-16, W17-07 |
| 18 | Kitbash: `unit.tank`, `unit.artillery`, `unit.radar`, `robot.multitask`, `fauna.brute` (Pillar 1, 4-view audit) | W17-20 … W17-24 |
| 19 | Build Army goal body (stub in W08-20) and Tech Up targets Factory T2 / Hub T3 (Tech Up breakdown is W08-19) (`UO-G`) | W17-25 |
| 20 | Duel checks for the ground triangle on the real units (§5.5, `AC-04`) | W17-26 |
| 21 | Analytics funnel: `hub_t2_ordered`, `first_tank`, `first_artillery_hit` (`stage_reached` from W08-29) | W17-27 |
| 22 | Dev console: `upgradeHub`, `spawnBrute`, `setDwell`, hostile `spawnUnit` | W17-28 |
| 23 | Mobile/touch: Multitask/upgrade orders work in landscape touch | W17-29 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W17-01 | Contracts & data: `upgradeBuilding` for Hub (HQ-only), unit ids `multitask`/`tank`/`artillery`/`radar`, fauna `brute`, events `hubUpgraded`, `hqRefitted`, `radarContact`, flag `W17`; data rows with `wave: 'W17'` | contract | M |  | W07-01, W08-01 | Run `npm run contracts:check` with `TA_WAVES=..17` → new kinds validate; with `..16` the rows are filtered out | units §5.1–5.2 | TA-14.1 |
| W17-02 | Hub T2 orderability rule: HQ-only, ≥ 8 min in S4, Δ cost, `stage_locked` / `dwell` wait reason | sim | S |  | W17-01, W08-03 | Order Hub T2 at S4 + 3 min → entry shows "waiting: available in 5:00" | `UO-L-03`, §6.4 | TA-14.2 |
| W17-03 | In-place upgrade footprint: +1 ring must be owned + Prepared; auto-linked prep for the ring | sim | M |  | W17-02, W05-09 | Order the upgrade with a Wild ring tile → a linked terraform order appears; the upgrade starts only after the ring is Prepared | `UO-TF-01`, `UO-TF-03` | TA-14.3 |
| W17-04 | HQ refit system: dock at Hub, 20 s refit, tier follows Hub, T2 stats/lanes/goal & offer limits, cell 2 000 E (HQ reprint costs per tier are W18-07's) | sim | M |  | W17-03 | Complete Hub T2 → HQ walks to Hub, stays 20 s, inspector shows `hq.tier = 2`, HP 2 200, lanes construction+harvest+terraform | `UO-HQ-01`, §3.2 | TA-14.2 |
| W17-05 | Multitask T2 unit: built at Hub T2, 2 supply, −5 E/s, 420 HP, all lanes 2.0× | sim | S |  | W17-01 | Queue Multitask T2 at Hub T2 → after 26 s a Multitask appears and takes a harvest job when idle | §5.1 | TA-14.2 |
| W17-06 | Worker tier gate for T2 entries (`waiting: worker (T2 needed)`, reject `worker_tier_locked`); the lowest-tier tie-break and player-only pre-emption stay W02-16's dispatch, which T2 workers join unchanged | sim | S |  | W17-05, W02-16 | Queue a T2 Extractor with only Builders idle → the entry shows `waiting: worker (T2 needed)` | `UO-L-02`, `UO-D-03` | TA-14.2 |
| W17-07 | Enable T2 building rows (Beacon T2 view 20, Solar T2, Extractors T2, Depot T2, DCA T2, Autocannon T2, Factory T2) with tier requirements Hub ≥ T2; plain stat bumps only, no T2/T3 special effects in battle v1 (B6 default; DCA T2's +10 % move speed is not applied); a T2 row missing from the S5 list unlocks at its T1 row's stage + 1, minimum S5, and "Turret T2" means the Autocannon only (B5 default); costs through the D-34 T2 rule | data | S |  | W17-01 | With W08 on at S4 → the Construction menu lists the T2 rows greyed with the "S5" hint; at S5 they are orderable; with `TA_WAVES=..16` they are absent | econ §3.1–3.7 | TA-14.1 |
| W17-08 | Factory T2 production: 1.5× on T1 units, unlocks Tank/Artillery/Radar | sim | S |  | W17-07 | Upgrade Factory to T2 → Recon build time drops from 14 s to 9.3 s; Units menu shows Tank/Artillery | econ §3.6 | — |
| W17-09 | Tank unit: 900 HP, speed 1.2, radius 0.7, view 7, rocket 36×1/s range 5 speed 10 AoE 1.0, ground-only (B4 default), −6 E/s, 2 supply | sim | S |  | W17-08, W07-03 | Spawn Tank vs 3 Recons (dev) → rockets hit evasive Recons and all 3 die | §5.2 | TA-14.4 |
| W17-10 | Artillery unit row: 320 HP, speed 1.1, shell 90 × 0.5/s, range 14, min 3, speed 4, AoE 1.5, `arc: indirect`, view 6; projectiles, AoE and min-range back-off reuse W07-03 / W07-04 / W07-09 | sim | S |  | W17-08, W07-09 | Put Artillery 10 tiles from a stationary spotted dummy → shells land and deal 90; place a dummy 2 tiles away → Artillery backs off and does not fire | §5.2, `UO-C-03` | TA-14.4 |
| W17-11 | Mobile Radar unit: unarmed, view 10, radar 22, −8 E/s | sim | S |  | W17-08 | Build Radar → inspector lists `radarContacts` for every enemy within 22 tiles | §5.2 | TA-14.4 |
| W17-12 | Radar contacts join the W07-08 shared colony view, so they count as spotted (no second spotting system) | sim | S |  | W17-11, W07-08 | Artillery with no spotter ignores a Brute at 12 tiles; build Radar → artillery starts firing within 1 s | `UO-C-06` | TA-14.4 |
| W17-13 | Brute fauna: stats, behaviour (solo/pairs, walks at walls), bite range 1 | sim | S |  | W17-01 | Dev `spawnBrute` → Brute walks to nearest structure at 1.0 t/s and deals 30 DPS | §5.6 | TA-14.4 |
| W17-14 | Stage-scaled raid composition: from `threatStage ≥ S6` add 1 Brute per 4 raiders | sim | S |  | W17-13, W08-09 | Set threatStage S6 and trigger a raid of 8 → 2 Brutes + 6 Skitters spawn | `UO-T-03` | TA-14.5 |
| W17-15 | Client: bind the `unit.tank` / `unit.artillery` archetypes to the unit renderer (turret yaw, barrel recoil); rocket trails, shell arcs and AoE decals reuse the W07-22 projectile VFX | client | S |  | W17-09, W17-10, W17-20, W17-21, W07-22 | Watch an artillery volley → the artillery recoils, a parabolic shell arc flies and a 1.5-tile AoE decal shows at the aim point | `UO-C-08` | TA-14.10 |
| W17-16 | Stage data S5/S6/S7: triggers (Hub T2 complete; Factory T2 + 5 min dwell; first artillery + 5 min or S6 + 10), toasts, suggested goals, unlock lists (Deep Reclaim at S5 for the W05-06 op with no new op code, Processor T1 at S5, Aero Hangar T2 at S7; Laser Tower T1 stays at S3 per B7) | data | S |  | W08-03, W17-01, W05-06 | Complete Factory T2 at S5 + 5 min → toast "S6 Combined Arms" and a Build Army card | §6.2, `UO-TF-10` | TA-14.5, TA-14.3 |
| W17-17 | Client: radar range ring (22 tiles) + radar contact blips on the minimap; weapon, min-range and view rings come from W07-21 | client | S |  | W17-11, W07-21, W04-05 | Select Radar → a 22-tile ring renders; select Artillery → the existing 14-tile and dashed 3-tile rings show; contacts blink on the minimap | `UO-C-08`, CLIENT §8b | TA-14.10 |
| W17-19 | Terraforming Processor T1: Prepared → Living in radius 10 at 0.5 tiles/s (B1 default, data row), `bio.water`/energy draw, shed group 1 | sim | M |  | W17-07 | Build Processor next to Prepared tiles → Living % rises over time; brownout pauses it first | `UO-TF-08`, econ §3.6 | — |
| W17-20 | Kitbash `unit.tank` (≥ 7 parts, low/wide silhouette, rocket pod, 60/30/10) + 4-view audit | visual | M |  | — | `/playground.html?inspect=unit.tank` → iso/front/side/top OK, minY 0.000, < 3.5k tris, `validate:models` 0/0 | AGENTS.md Pillar 1 | TA-14.9 |
| W17-21 | Kitbash `unit.artillery` (long barrel, recoil animation) + audit | visual | M |  | — | Playground inspect shows barrel elevation animation; audit and `validate:models` pass | Pillar 1 | TA-14.9 |
| W17-22 | Kitbash `unit.radar` (dish silhouette breaker, rotating) + audit | visual | S |  | — | Dish rotates in playground; audit and `validate:models` pass | Pillar 1 | TA-14.9 |
| W17-23 | Kitbash `robot.multitask` (three-tool arms) + audit | visual | S |  | — | Playground inspect passes audit and `validate:models` | Pillar 1 | TA-14.9 |
| W17-24 | Kitbash `fauna.brute` (heavy quadruped, bob animation; distinct from the existing `fauna.skitter`) + audit | visual | S |  | — | Playground inspect passes audit and `validate:models` | Pillar 1 | — |
| W17-25 | HQ goals: Build Army body for the W08-20 stub with the preset "counter what you see"; add Factory T2 and Hub T3 as Tech Up targets (the Tech Up earmark breakdown is W08-19) | sim | M |  | W08-19, W08-20, W17-09, W17-10 | With a Brute in view, accept Build Army "counter what you see" → Artillery orders appear in the Units lane within its 40 % budget | `UO-G`, §4.6 | TA-14.6 |
| W17-26 | Duel harness: switch the 3 ground-triangle rows of W07-26 from `demoTank` / `demoArtillery` to the real `tank` / `artillery` rows | test | S |  | W07-26, W17-09, W17-10 | `npm run test -w @terra/sim -- duels` → 6 ground rows (equal cost + equal supply) pass with ≥ 50 % survivors on the real unit ids | §5.5, `AC-04` | TA-14.7 |
| W17-27 | Analytics: `hub_t2_ordered`, `first_tank`, `first_artillery_hit` (`stage_reached` for S5–S7 is W08-29's event) | client | S |  | W00-44 | Play to S6 → analytics table has the three events for the session | CLIENT §10 | — |
| W17-28 | Dev console: `upgradeHub <tier>`, `spawnBrute <n>`, `setDwell <stage> <min>`, `spawnUnit <id> <n> enemy` | server | S |  | W00-40 | Type `upgradeHub 2` → Hub becomes T2 instantly and HQ refits | PRODUCT_WAVES §3 | — |
| W17-29 | Touch: upgrade button + Multitask lane chips usable in phone landscape | client | S |  | W24-11 | On a 844×390 viewport, tap Hub → Upgrade → confirm works without hover | D-22 | — |
| W17-30 | Wave e2e `e2e/w17.spec.ts` + scenario `w17-second-tier` + tag `wave-17` | test | M |  | all W17 | `npm run e2e -- --waves ..17` → demo story passes; `TA_WAVES=..16` hides every W17 item | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w17.spec.ts` passes, and so does every earlier wave suite.
- `?scenario=w17` loads.
- `TA_WAVES=..16` hides T2 rows, the new units, Brute and stages S5–S7, while W17 entities in snapshots stay inert.
- Duel rows pass in CI.
- Tag `wave-17` is created.

## Notes

- **Deep Reclaim** is built and tier-gated in W05-06; this wave only adds its S5 unlock row (W17-16) and the T2 workers that can run it. W17-18 was folded into W17-16.
- **Rings and spotting** are W07 systems (W07-08, W07-21); this wave adds radar contacts and the radar ring only.
