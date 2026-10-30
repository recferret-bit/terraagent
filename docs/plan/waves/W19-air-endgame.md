# W19 — Air & Endgame (S8–S10)

**Goal.** The air layer and the top tier. Players build an Aero Hangar, field Air Recon, Fighters, Gunships and Bombers, and defend with Anti-Air. Drifter flocks arrive. The colony reaches S8–S10 with T3 structures, Multitask T3 and an HQ T3 that can "build all".

**Demo story.**
1. Load the S7 colony with Hub T2 and Factory T2. Build an Aero Hangar T2. → Toast "S8 Skies"; Air Recon and Anti-Air unlock.
2. Fly Air Recon across a ridge and a deep-water lake. → It moves in a straight line and reveals 14 tiles.
3. Trigger a Drifter flock raid. → Autocannons hit them at baseline, and Anti-Air lasers clear the flock.
4. After the first air unit plus 10 min dwell (warped) → "S9 Air War". Build 4 Fighters vs an enemy's 4 Gunships (dev spawn). → Fighters win.
5. Gunships strafe Recons. → Gunships win. Bombers vs Tanks → Bombers win. Anti-Air vs Bombers → Anti-Air wins.
6. On a fresh S6 colony, spawn enemy air in view (dev). → S8 Anti-Air unlocks immediately (override), buildable at Factory T1.
7. Upgrade the Hub to T3. → HQ refits to T3; "S10 Strategic"; T3 rows, Multitask T3, Hangar T3 and Bomber unlock; the HQ can build a T3 Fusion Reactor.

**Depends on:** W17 (T2, Hub upgrade/refit pipeline, Factory T2, spotting). Optional: W14 (walled colonies → extra Drifter flock), W08 (stage engine; required for stage toasts).
**Track:** Gameplay (G). **Owned paths:**
- `shared/sim/src/systems/{air,hangar,tier3}/`
- `shared/sim/src/data/{air,tier3,fauna-drifter}.ts`
- `client/src/features/{air,hangar}/`
- kitbash `src/kitbash/archetypes/units/{air-*,aa}.ts` and `.../buildings/aero-hangar.ts`

**Flag:** `W19` · **Scenario:** `scenarios/w19-air-endgame.ts` (S7 colony with Hub T2, Factory T2, Multitask T2 ×2, stock 5 000 each, a Drifter roost at 25 tiles, an enemy colony with air units for duels) · **Tag:** `wave-19`

## Features covered

| Spec item | Issues |
|---|---|
| Aero Hangar T2 (3×3, 55 s, 300/220/120/40, −24 E/s, 2 000 HP; Recon/Fighter/Gunship; needs Hub T2 + S7) (§5.3) | W19-02 |
| Aero Hangar T3 (4×4, 120 s, 850/680/340/120, −65 E/s, 5 200 HP, +Bomber, 1.5×; needs Hub T3); shed group 2 | W19-03 |
| Air movement: straight line, no A*, ignores terrain and walls, bounded by map (§5.3) | W19-04 |
| Air layer targeting (`hitsAir` / `hitsGround`; structures count as ground) (`UO-C-01`) | W19-05 |
| Evasive air units (heading change 0.5 s) (`UO-C-04`) | W19-05 |
| Air Recon (unarmed, 6.0 t/s, view 14) | W19-06 |
| Fighter (rocket 40×1/s, range 6, speed 15, air-only) | W19-07 |
| Gunship (bullet 16×2/s, range 5, ground-only, hovers) | W19-08 |
| Bomber (shell 100×0.5/s, range 2 fly-over, AoE 1.5, indirect, ground + structures; Hangar T3) | W19-09 |
| Anti-Air (laser 15×4/s, range 10, air-only, 480 HP; Factory T1+) | W19-10 |
| Autocannon baseline AA (`hitsAir`) and Laser Tower air hits | W19-11 |
| Drifter fauna (180 HP, 4.0 t/s, flies, evasive, bite 10 DPS; S8+) and roosts | W19-12 |
| Extra Drifter flock for colonies with a closed wall ring from S8 (`UO-T-08`) | W19-13 |
| S8 override: enemy air seen → Anti-Air unlock immediately (`UO-LC-04`) | W19-14 |
| Stages S8 / S9 / S10 data, toasts, suggested goals (§6.2) | W19-15 |
| Hub T3 upgrade (Δ cost), HQ T3 refit (5 000 HP, 4.0×, "build all", 5 goals, 6 offers, cell 5 000 E) | W19-16 |
| Multitask T3 (360/260/100/40, 4 supply, 5.0×, ≤ T3) | W19-17 |
| All T3 structure rows enabled (economy spec §3, incl. Nuclear T3, Capacitor T3, Substation T3, Railgun, Plasma Arc, Shield dome, Processor T3) | W19-18 |
| Factory T3 (2.2×) | W19-18 |
| Client: air rendering at altitude, shadows, range rings for air weapons, AA beam VFX, bomb drop VFX | W19-19, W19-20 |
| Kitbash: `air.recon`, `air.fighter`, `air.gunship`, `air.bomber`, `unit.aa`, `building.aeroHangar`, `fauna.drifter` reuse check | W19-21 … W19-26 |
| Duel checks air triangle (§5.5) | W19-27 |
| Analytics funnel `stage_reached{8,9,10}`, `first_air_unit`, `hub_t3` | W19-28 |
| Dev console `spawnAir <type> <n> [enemy]`, `spawnDrifters` | W19-29 |
| Touch: hangar production menu and air unit selection in landscape | W19-30 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W19-01 | Contracts & data: unit ids `airRecon/fighter/gunship/bomber/aa`, building `aeroHangar` T2/T3, fauna `drifter`, T3 rows, `layer: 'air'`, flag `W19` | contract | M |  | W17-01 | `TA_WAVES=..19` → rows compile; `..18` → filtered | units §5.2–5.3 | TA-14.1 |
| W19-02 | Sim: Aero Hangar T2 — requirements (Hub T2, S7), production of Recon/Fighter/Gunship at 1.0× | sim | M |  | W19-01 | Build Hangar at S7 → Units menu shows the 3 air units with a Hangar badge | §5.3 | — |
| W19-03 | Sim: Aero Hangar T3 — 1.5×, Bomber; shed group 2 | sim | S |  | W19-02, W19-16 | Upgrade Hangar to T3 → Bomber orderable; brownout sheds the Hangar with the Factory | §5.3 | — |
| W19-04 | Sim: air movement — straight path, altitude layer, ignore terrain / walls / deep water, clamp to map | sim | M |  | W19-01 | Order Air Recon across a ridge line → it reaches the far side in distance ÷ 6.0 s with no detour | §5.3 | TA-14.4 |
| W19-05 | Sim: air targeting layer + evasive heading for air units in combat | sim | M |  | W19-04, W07-03 | Tank (ground-only rocket) next to a Gunship → never fires; Gunship strafes every 0.5 s while engaging | `UO-C-01`, `UO-C-04` | TA-14.4 |
| W19-06 | Sim: Air Recon unit | sim | S |  | W19-04 | Build Air Recon → shared view grows by a 14-tile circle around it | §5.2 | — |
| W19-07 | Sim: Fighter unit (air-only rockets) | sim | S |  | W19-05 | Fighter vs Drifter → kills it; Fighter ignores ground units | §5.2 | — |
| W19-08 | Sim: Gunship unit (ground-only bullets, hovers) | sim | S |  | W19-05 | Gunship vs 3 Recons → all Recons die in < 15 s | §5.2 | — |
| W19-09 | Sim: Bomber unit (fly-over shell drop, AoE 1.5, indirect, structures) | sim | M |  | W19-05, W19-03 | Bomber over a building cluster → bomb AoE damages 2+ buildings per drop | §5.2 | — |
| W19-10 | Sim: Anti-Air unit (laser, air-only, Factory T1+) | sim | S |  | W19-05 | AA near a Gunship → instant hits every 0.25 s, 60 DPS | §5.2 | — |
| W19-11 | Sim: Autocannon `hitsAir` baseline + Laser Tower air hits | sim | S |  | W19-05 | Drifter flies past an Autocannon T1 → takes 18 DPS bullets | §5.4 footnote, `UO-C-01` | — |
| W19-12 | Sim: Drifter fauna + roosts (flocks 4–8, drift over walls to extractors) | sim | M |  | W19-04 | Dev `spawnDrifters 6` → flock flies straight to the nearest extractor and attacks it | §5.6 | — |
| W19-13 | Sim: extra Drifter flock on raids for colonies with a closed wall ring (S8+) | sim | S |  | W19-12, W14-05 | Walled S8 colony raid → composition includes 1 extra flock vs an unwalled one | `UO-T-08` | TA-14.5 |
| W19-14 | Sim: S8 override — enemy air seen by colony < S8 unlocks Anti-Air immediately | sim | S |  | W19-10, W08-03 | S6 colony sees an enemy Gunship → Anti-Air appears in the Factory T1 menu that tick | `UO-LC-04` | TA-14.5 |
| W19-15 | Data: stages S8 (Hangar T2 or override), S9 (first air unit + 10 min), S10 (Hub T3); toasts + suggested goals | data | S |  | W08-03 | Build first Fighter, warp 10 min → toast "S9 Air War" and Build Army (air mix) card | §6.2 | TA-14.5 |
| W19-16 | Sim: Hub T3 upgrade (HQ-only, +1 ring) + HQ T3 refit (5 000 HP, 4.0×, all tiers, 5 goals, 6 offers, cell 5 000 E, reprint T3) | sim | M |  | W17-04 | Order Hub T3 → HQ refits, inspector `hq.tier = 3`, HQ can be assigned a T3 structure | `UO-HQ-01`, §3.2 | TA-14.2 |
| W19-17 | Sim: Multitask T3 unit (≤ T3, 5.0×, 4 supply) | sim | S |  | W19-16 | Build Multitask T3 → it can take a T3 build; Multitask T2 cannot | §5.1 | — |
| W19-18 | Data/sim: enable all T3 structure rows + Factory T3 2.2× | data | M |  | W19-16 | Construction menu at S10 shows T3 rows; Factory T3 builds Recon in 6.4 s | econ §3 | TA-14.1 |
| W19-19 | Client: air unit rendering at altitude (hover bob, ground shadow), air weapon range rings, minimap air icons | client | M |  | W19-04, W04-05 | Air units float 4 m above ground with a shadow; selecting a Fighter shows a 6-tile ring | `UO-C-08` | TA-14.10 |
| W19-20 | VFX: AA laser beams, fighter rocket trails, bomb drop + ground explosion decals | visual | M |  | W19-09, W19-10 | Bomber drop → falling bomb mesh, 1.5-tile explosion decal; AA → 0.1 s beam per shot | `UO-C-08` | TA-14.10 |
| W19-21 | Kitbash `air.recon` (+ audit) | visual | S |  | — | Playground inspect passes 4-view audit, < 3.5k tris | Pillar 1 | TA-14.9 |
| W19-22 | Kitbash `air.fighter` (+ audit) | visual | S |  | — | Playground inspect passes audit | Pillar 1 | TA-14.9 |
| W19-23 | Kitbash `air.gunship` (rotor/hover silhouette, + audit) | visual | M |  | — | Playground inspect passes audit | Pillar 1 | TA-14.9 |
| W19-24 | Kitbash `air.bomber` (+ audit) | visual | M |  | — | Playground inspect passes audit | Pillar 1 | TA-14.9 |
| W19-25 | Kitbash `unit.aa` (upward barrels) (+ audit) | visual | S |  | — | Playground inspect passes audit | Pillar 1 | TA-14.9 |
| W19-26 | Kitbash `building.aeroHangar` T2/T3 variants (+ audit); verify `fauna.drifter` exists and meets budget | visual | M |  | — | Both hangar tiers pass audit; drifter < 3.5k tris | Pillar 1 | TA-14.9 |
| W19-27 | Duel harness: air rows (AA vs Gunship/Bomber/Fighter, Fighter vs Gunship/Bomber, Gunship vs Recon/Artillery, Bomber vs Tank/Artillery, ground vs AA) | test | M |  | W19-07 … W19-10 | `npm run test -w @terra/sim -- duels` → all air rows pass; AA vs Bomber equal-supply flagged weak but passing | §5.5, AC-04 | TA-14.7 |
| W19-28 | Analytics `stage_reached{8,9,10}`, `first_air_unit`, `hub_t3` | client | S |  | W00-44 | Reach S9 → events recorded | CLIENT §10 | — |
| W19-29 | Dev console `spawnAir <type> <n> [enemy]`, `spawnDrifters <n>` | client | S |  | W00-40 | `spawnAir gunship 4 enemy` → 4 hostile Gunships spawn at the map edge | PRODUCT_WAVES §3 | — |
| W19-30 | Touch: Hangar menu and air selection in landscape | client | S |  | W24-11 | On 844×390, tap Hangar → queue Fighter works | D-22 | — |
| W19-31 | Perf check: 40 air units + 60 ground in one planet stays within the sim step budget | test | S |  | W19-04 | Bench scenario → step p99 within SIMULATION §12 budget | SIM §12 | — |
| W19-32 | Wave e2e `e2e/w19.spec.ts` + scenario `w19-air-endgame` + tag `wave-19` | test | M |  | all W19 | `npm run e2e -- --waves ..19` passes the demo; `TA_WAVES=..18` hides Hangar, air units, T3 | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w19.spec.ts` and all earlier suites pass.
- The scenario loads.
- With the flag off: no Hangar, air units, Drifters, S8–S10 or T3. Autocannon `hitsAir` stays harmless because there are no air targets.
- Air duel rows pass.
- Tag `wave-19` is created.
