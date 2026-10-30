# W19 — Air & Endgame (S8–S10)

> **Track:** Gameplay (G) · **Flag:** `W19` · **Scenario:** `scenarios/w19-air-endgame.ts` · **Tag:** `wave-19` · **Depends on:** W08, W14, W17. Optional: W04 (minimap air icons, W19-19), W24 (touch menus, W19-30).
> **Specs:** [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §3.1–3.2 (`UO-HQ-01`), §5.1, §5.2, §5.3 (`UO-B`), §5.4 (`UO-C-01/04/08`), §5.5 (`AC-04`), §5.6, §6.1 (`UO-LC-04`), §6.2, §6.3 (`UO-T-03/08`) · [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §3 · D-28, D-34, D-35 · [`OWNER_TASKS.md`](../OWNER_TASKS.md) B3, B4, B6
> **Costs and balance:** T3 rows pay through the D-34 tier rule: 40 % of their M and Min in T1, 30 % in T2 and 30 % in T3 (`metals.t3`, `minerals.t3`), Pet in `bio.t2`, plus 10 % of their M as `bio.t3`; T3 sub-resources come from the W05-34 gate at Terraform ≥ 70 % or from the market (W13). Every number here is a data row, tunable with W00-59 (D-35); the accepted OWNER_TASKS defaults B3 (Hub T3 dwell), B4 (air targeting) and B6 (no special effects) are the starting rows.
> **Owned paths:** `shared/sim/src/systems/{air,hangar,tier3}/`, `shared/sim/src/data/{air,tier3,fauna-drifter}.ts`, `frontend/game/features/{air,hangar}/`, new archetypes `frontend/render/kitbash/archetypes/units/{air-recon,air-fighter,air-gunship,air-bomber,aa}.ts` and `frontend/render/kitbash/archetypes/buildings/aero-hangar.ts`; Drifters use the existing `fauna.drifter` (`frontend/render/kitbash/archetypes/units/nature.ts`).
> **Soft dependencies:** touch menus need W24-11.

## Goal

The air layer and the top tier:
- players build an Aero Hangar, field Air Recon, Fighters, Gunships and Bombers, and defend with Anti-Air;
- Drifter flocks arrive with raids from S8;
- the colony reaches S8–S10 with T3 structures, Multitask T3 and an HQ T3 that can "build all".

## Demo story (e2e `e2e/w19.spec.ts`)

1. Open `/play.html?scenario=w19`: an S7 colony with Hub T2, Factory T2, Multitask T2 ×2, enough Depots for stock 5 000 each, a Skitter nest at 25 tiles, and an enemy colony with air units for duels. Construction menu → build an Aero Hangar T2. → Toast "S8 Skies"; Air Recon and Anti-Air unlock.
2. Order an Air Recon and send it across a ridge and a deep-water lake. → It moves in a straight line and reveals 14 tiles.
3. Dev console `spawnRaid 5` and `spawnDrifters 6` (S8 raids bring a Drifter flock). → Autocannons hit the Drifters at baseline, and Anti-Air lasers clear the flock.
4. Dev console `warp 20` for the 10 min dwell after the first air unit → "S9 Air War". Build 4 Fighters, then run `spawnAir gunship 4 enemy`. → Fighters win.
5. Order 2 Recons next to the enemy Gunships (`spawnAir gunship 2 enemy`). → Gunships strafe the Recons and win.
6. Reload `/play.html?scenario=w19`, run `stage set 6`, then `spawnAir gunship 2 enemy` in view. → S8 Anti-Air unlocks immediately (override), buildable at Factory T1.
7. Dev console `upgradeHub 3` (or upgrade from the Construction menu). → HQ refits to T3; "S10 Strategic"; T3 rows, Multitask T3, Hangar T3 and Bomber unlock; the HQ can build a T3 Fusion Reactor.
8. Upgrade the Hangar to T3 and build Bombers. → Bombers vs Tanks (`spawnUnit tank 3 enemy`): Bombers win. Anti-Air vs Bombers (`spawnAir bomber 3 enemy`): Anti-Air wins.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Aero Hangar T2 (3×3, 55 s, 300/220/120/40, −24 E/s, 2 000 HP; Recon/Fighter/Gunship; needs Hub T2 + S7) (§5.3) | W19-02 |
| 2 | Aero Hangar T3 (4×4, 120 s, 850/680/340/120, −65 E/s, 5 200 HP, +Bomber, 1.5×; needs Hub T3); shed group 2 | W19-03 |
| 3 | Air movement: straight line, no A*, ignores terrain and walls, bounded by map (§5.3) | W19-04 |
| 4 | Air layer (`layer: 'air'`) on the W07-07 layer filter; structures count as ground (`UO-C-01`) | W19-05 |
| 5 | Evasive air units on the W07-06 evasive steering (`UO-C-04`) | W19-05 |
| 6 | Air Recon (unarmed, 6.0 t/s, view 14) | W19-06 |
| 7 | Fighter (rocket 40×1/s, range 6, speed 15, air-only) | W19-07 |
| 8 | Gunship (bullet 16×2/s, range 5, ground-only, hovers) | W19-08 |
| 9 | Bomber (shell 100×0.5/s, range 2 fly-over, AoE 1.5, indirect, ground + structures; Hangar T3) | W19-09 |
| 10 | Anti-Air (laser 15×4/s, range 10, air-only, 480 HP; Factory T1+) | W19-10 |
| 11 | Autocannon baseline AA (`hitsAir`) and Laser Tower air hits: already flagged in W07-07 / W07-13; checked against Drifters in W19-12 | W19-12 |
| 12 | Drifter fauna (180 HP, 4.0 t/s, radius 0.6, flies, evasive, bite 10 DPS); a flock of 4–8 joins raids from S8 (`UO-T-03`) | W19-12 |
| 13 | Extra Drifter flock for colonies with a closed wall ring from S8 (`UO-T-08`) | W19-13 |
| 14 | S8 override: enemy air seen → Anti-Air unlock immediately (`UO-LC-04`) | W19-14 |
| 15 | Stages S8 / S9 / S10 data, toasts, suggested goals (§6.2) | W19-15 |
| 16 | Hub T3 upgrade (Δ cost), HQ T3 refit (5 000 HP, 4.0×, "build all", 5 goals, 6 offers, cell 5 000 E) | W19-16 |
| 17 | Multitask T3 (360/260/100/40, 4 supply, 5.0×, ≤ T3) | W19-17 |
| 18 | All T3 structure rows enabled with plain stats (economy spec §3); no special T3 effects in battle v1 (B6 default) | W19-18 |
| 19 | Factory T3 (2.2×) | W19-18 |
| 20 | Client: air rendering at altitude, shadows, minimap air icons; rings (W07-21) and beams/trails (W07-22) reused; bomb drop VFX | W19-19, W19-20 |
| 21 | Kitbash: `air.recon`, `air.fighter`, `air.gunship`, `air.bomber`, `unit.aa`, `building.aeroHangar` (new); `fauna.drifter` exists | W19-21 … W19-26 |
| 22 | Duel checks air triangle (§5.5) | W19-27 |
| 23 | Analytics funnel `first_air_unit`, `hub_t3` (`stage_reached` from W08-29) | W19-28 |
| 24 | Dev console `spawnAir <type> <n> [enemy]`, `spawnDrifters` | W19-29 |
| 25 | Touch: hangar production menu and air unit selection in landscape | W19-30 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W19-01 | Contracts & data: unit ids `airRecon/fighter/gunship/bomber/aa`, building `aeroHangar` T2/T3, fauna `drifter`, T3 rows, `layer: 'air'`, flag `W19` | contract | M |  | W17-01 | `TA_WAVES=..19` → rows compile; `..18` → filtered | units §5.2–5.3 | TA-14.1 |
| W19-02 | Sim: Aero Hangar T2 — requirements (Hub T2, S7), production of Air Recon / Fighter / Gunship at 1.0×, each gated by its stage (S8 / S9 / S9) | sim | M |  | W19-01 | Build the Hangar T2 at S7 → Air Recon is orderable at the Hangar; Fighter and Gunship are listed greyed until S9 | §5.3, §6.2 | — |
| W19-03 | Sim: Aero Hangar T3 — 1.5×, Bomber; shed group 2 | sim | S |  | W19-02, W19-16 | Upgrade Hangar to T3 → Bomber orderable; brownout sheds the Hangar with the Factory | §5.3 | — |
| W19-04 | Sim: air movement — straight path, altitude layer, ignore terrain / walls / deep water, clamp to map | sim | M |  | W19-01 | Order Air Recon across a ridge line → it reaches the far side in distance ÷ 6.0 s with no detour | §5.3 | TA-14.4 |
| W19-05 | Sim: air units carry `layer: 'air'` and `evasive: true`; reuse the W07-07 layer filter and the W07-06 evasive steering (no new combat code) | sim | S |  | W19-04, W07-06, W07-07 | Tank (ground-only rocket) next to a Gunship → never fires; the Gunship changes heading every 0.5 s while engaging | `UO-C-01`, `UO-C-04` | TA-14.4 |
| W19-06 | Sim: Air Recon unit | sim | S |  | W19-04 | Build Air Recon → shared view grows by a 14-tile circle around it | §5.2 | — |
| W19-07 | Sim: Fighter unit (air-only rockets) | sim | S |  | W19-05 | Fighter vs Drifter → kills it; Fighter ignores ground units | §5.2 | — |
| W19-08 | Sim: Gunship unit (ground-only bullets, hovers) | sim | S |  | W19-05 | Gunship vs 1 Recon → every bullet hits and the Recon dies in 7–8 s (240 HP ÷ 32 DPS) | §5.2 | — |
| W19-09 | Sim: Bomber unit (fly-over shell drop, AoE 1.5, indirect, structures) | sim | M |  | W19-05, W19-03 | Bomber over a building cluster → bomb AoE damages 2+ buildings per drop | §5.2 | — |
| W19-10 | Sim: Anti-Air unit (laser, air-only, Factory T1+) | sim | S |  | W19-05 | AA near a Gunship → instant hits every 0.25 s, 60 DPS | §5.2 | — |
| W19-12 | Sim: Drifter fauna (180 HP, 4.0 t/s, radius 0.6, flies, evasive, bite 10 DPS); raids from S8 add one flock of 4–8 (`UO-T-03`); flocks drift over walls to the nearest extractor; only Autocannon and Laser Tower hit them, Recon, Tank and HQ weapons are ground-only (B4 default) | sim | M |  | W19-05, W17-14 | Dev `spawnDrifters 6` → the flock flies straight to the nearest extractor, and an Autocannon T1 in range hits it for 18 DPS | §5.6, `UO-T-03` | — |
| W19-13 | Sim: extra Drifter flock on raids for colonies with a closed wall ring (S8+), using the W14-10 data hook | sim | S |  | W19-12, W14-10 | Walled S8 colony raid → composition includes 1 extra flock vs an unwalled one | `UO-T-08` | TA-14.5 |
| W19-14 | Sim: S8 override — enemy air seen by colony < S8 unlocks Anti-Air immediately | sim | S |  | W19-10, W08-03 | S6 colony sees an enemy Gunship → Anti-Air appears in the Factory T1 menu that tick | `UO-LC-04` | TA-14.5 |
| W19-15 | Data: stages S8 (Hangar T2 or override), S9 (first air unit + 10 min), S10 (Hub T3); toasts + suggested goals | data | S |  | W08-03 | Build first Fighter, warp 10 min → toast "S9 Air War" and Build Army (air mix) card | §6.2 | TA-14.5 |
| W19-16 | Sim: Hub T3 upgrade (HQ-only, orderable after 10 min in S7 like Hub T2's S4 dwell (B3 default, data row), Δ 1 200/750/450/350 through the D-34 T3 rule, +1 ring) + HQ T3 refit (5 000 HP, 4.0×, all tiers, 5 goals, 6 offers, cell 5 000 E; the T3 reprint cost is W18-07's) | sim | M |  | W17-04 | Order Hub T3 → HQ refits, inspector `hq.tier = 3`, HQ can be assigned a T3 structure | `UO-HQ-01`, §3.2, econ §3.1 | TA-14.2 |
| W19-17 | Sim: Multitask T3 unit (≤ T3, 5.0×, 4 supply) | sim | S |  | W19-16 | Build Multitask T3 → it can take a T3 build; Multitask T2 cannot | §5.1 | — |
| W19-18 | Data/sim: enable all T3 structure rows with plain stats (cost, size, HP, drain, output, range, DPS) + Factory T3 2.2×; T3 effects beyond plain stats (Plasma Arc chain, Shield dome, Railgun armor-piercing, Depot T3 raid protection, Beacon T3 turret buff, DCA T3 work speed) are not in battle v1 (B6 default); costs through the D-34 T3 rule | data | M |  | W19-16 | Construction menu at S10 shows T3 rows; Factory T3 builds Recon in 6.4 s | econ §3 | TA-14.1 |
| W19-19 | Client: air units at altitude (hover bob, ground shadow; 4 m altitude is owner-tunable), minimap air icons; air weapon rings come from W07-21 | client | M |  | W19-04, W04-05, W07-21 | Air units float above ground with a shadow; selecting a Fighter shows its 6-tile ring | `UO-C-08` | TA-14.10 |
| W19-20 | VFX: bomb drop (falling bomb mesh + 1.5-tile explosion decal); AA beams and Fighter rocket trails reuse the W07-22 projectile VFX | visual | S |  | W19-09, W07-22 | Bomber drop → a falling bomb mesh, then a 1.5-tile explosion decal at the aim point | `UO-C-08` | TA-14.10 |
| W19-21 | Kitbash `air.recon` (+ audit) | visual | S |  | — | Playground inspect passes 4-view audit and `validate:models`, < 3.5k tris | Pillar 1 | TA-14.9 |
| W19-22 | Kitbash `air.fighter` (+ audit) | visual | S |  | — | Playground inspect passes audit and `validate:models` | Pillar 1 | TA-14.9 |
| W19-23 | Kitbash `air.gunship` (rotor/hover silhouette, + audit) | visual | M |  | — | Playground inspect passes audit and `validate:models` | Pillar 1 | TA-14.9 |
| W19-24 | Kitbash `air.bomber` (+ audit) | visual | M |  | — | Playground inspect passes audit and `validate:models` | Pillar 1 | TA-14.9 |
| W19-25 | Kitbash `unit.aa` (upward barrels) (+ audit) | visual | S |  | — | Playground inspect passes audit and `validate:models` | Pillar 1 | TA-14.9 |
| W19-26 | Kitbash `building.aeroHangar` T2 (3×3) and T3 (4×4) variants (+ audit) | visual | M |  | — | Both hangar tiers pass the 4-view audit and `validate:models` (0/0) | Pillar 1 | TA-14.9 |
| W19-27 | Duel harness: air rows (AA vs Gunship/Bomber/Fighter, Fighter vs Gunship/Bomber, Gunship vs Recon/Artillery, Bomber vs Tank/Artillery, ground vs AA) on the W07-26 harness | test | M |  | W07-26, W19-07 … W19-10 | `npm run test -w @terra/sim -- duels` → all air rows pass; AA vs Bomber equal-supply flagged weak but passing | §5.5, AC-04 | TA-14.7 |
| W19-28 | Analytics `first_air_unit`, `hub_t3` (`stage_reached` for S8–S10 is W08-29's event) | client | S |  | W00-44 | Reach S9 → events recorded | CLIENT §10 | — |
| W19-29 | Dev console `spawnAir <type> <n> [enemy]`, `spawnDrifters <n>` | server | S |  | W00-40 | `spawnAir gunship 4 enemy` → 4 hostile Gunships spawn at the map edge | PRODUCT_WAVES §3 | — |
| W19-30 | Touch: Hangar menu and air selection in landscape | client | S |  | W24-11 | On 844×390, tap Hangar → queue Fighter works | D-22 | — |
| W19-31 | Perf check: 40 air units + 60 ground in one planet stays within the sim step budget | test | S |  | W19-04 | Bench scenario → step p99 within SIMULATION §12 budget | SIM §12 | — |
| W19-32 | Wave e2e `e2e/w19.spec.ts` + scenario `w19-air-endgame` + tag `wave-19` | test | M |  | all W19 | `npm run e2e -- --waves ..19` passes the demo; `TA_WAVES=..18` hides Hangar, air units, T3 | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w19.spec.ts` and all earlier suites pass.
- The scenario loads.
- With the flag off: no Hangar, air units, Drifters, S8–S10 or T3. Autocannon `hitsAir` stays harmless because there are no air targets.
- Air duel rows pass.
- Tag `wave-19` is created.

## Notes

- **W19-11** (Autocannon `hitsAir` + Laser Tower air hits) was dropped: W07-07 and W07-13 already flag both; W19-12's acceptance checks it against Drifters.
- **Drifter roosts** were dropped from the scenario: §5.6 and `UO-T-03` bring Drifters only as raid flocks. If the owner wants roosts, their density, HP and spawn rate need a spec row first.
