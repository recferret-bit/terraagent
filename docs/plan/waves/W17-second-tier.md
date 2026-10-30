# W17 — Second Tier (S5–S7)

**Goal.** The colony moves past T1. The HQ upgrades the Hub to T2, the HQ and Multitask drones become multirole, T2 buildings unlock, and the full ground rock–paper–scissors triangle (Recon / Tank / Artillery) plus Mobile Radar spotting is playable against the new Brute fauna.

**Demo story.**
1. Load the S4 colony and order a Hub T2 upgrade from the Construction menu. The order waits because S4 dwell is under 8 min.
2. Use dev time-warp: the upgrade becomes orderable. The HQ prepares the +1 ring and upgrades the Hub. → The HQ docks for a 20 s refit and comes back as HQ T2 (multirole). Stage toast "S5 Second Tier".
3. Queue a Multitask T2 at the Hub. → It builds a T2 Metals Extractor. A Builder T1 cannot take that job (`worker_tier_locked` reason shown).
4. Upgrade the Factory to T2 (S6 after 5 min dwell) and build Tank ×2 + Artillery ×2. → A Brute raid arrives.
5. With no spotter, Artillery does not fire at the Brute beyond its 6-tile view. Build Mobile Radar. → Radar contacts are spotted, and artillery shells land on the Brute from 14 tiles.
6. Spawn an evasive Recon squad (dev console) near the artillery. → Shells miss the strafing Recon, and Tanks kill it.

**Depends on:** W07 (battle v1, factory T1, recon), W08 (stage engine, dwell, suggestion cards). Optional: W05 (Deep Reclaim tiles), W14 (walls; indirect fire over ridges).
**Track:** Gameplay (G). **Owned paths:**
- `shared/sim/src/systems/{tiers,spotting,fauna-brute}/`
- `shared/sim/src/data/{tier2,units-ground2,fauna-brute}.ts`
- `client/src/features/{tiers,radar}/`
- kitbash `src/kitbash/archetypes/units/{tank,artillery,radar,multitask,brute}.ts`

**Flag:** `W17` · **Scenario:** `scenarios/w17-second-tier.ts` (colony at S4 with 8 min dwell done, Factory T1, Terraformer, Recon ×2, a Brute nest at 20 tiles, stock 2 000 each, Hub T1) · **Tag:** `wave-17`

## Features covered

| Spec item | Issues |
|---|---|
| Hub T2 upgrade: HQ-only, in place, Δ cost 400/250/150/100, +1 ring Prepared + owned (`UO-L-03`, `UO-TF-01`) | W17-02, W17-03 |
| Hub T2 orderable only after 8 min in S4 (§6.2, §6.4) | W17-02 |
| HQ refit 20 s → HQ T2 (2 200 HP, 2.5×, all lanes, 3 goals, 3 offers, cell 2 000 E) (`UO-HQ-01`, `UO-HQ-06`) | W17-04 |
| HQ reprint cost at T2 (500/300/150/100 · 90 s) | W17-04 |
| Multitask T2 (130/90/30/15, 2 supply, 2.0× all lanes, ≤ T2) built at Hub T2 | W17-05 |
| Worker tier gate for T2 structures (`UO-L-02`, reject `worker_tier_locked`) | W17-06 |
| Dispatch tie-break: lowest tier first (`UO-D-03`) | W17-06 |
| T2 rows enabled: Beacon, Solar, Extractors, Depot, DCA, Turret, Factory (economy spec §3) | W17-07 |
| Factory T2 (1.5× on T1 units), unlocking Tank / Artillery / Radar | W17-08 |
| Tank (900 HP, rocket 36 DPS, range 5, AoE 1.0) | W17-09, W17-15 |
| Artillery (shell 45 DPS, range 14, min 3, speed 4, AoE 1.5, indirect, view 6) | W17-10, W17-15 |
| Mobile Radar (radar 22, contacts count as spotted, unarmed) (`UO-C-06`) | W17-11, W17-12 |
| Min-range ring (dashed red) for Artillery (`UO-C-08`) | W17-17 |
| Brute fauna (1 400 HP, 30 DPS bite, speed 1.0, radius 0.8; from S6; 1 per 4 in raids) (§5.6, `UO-T-03`) | W17-13, W17-14 |
| Stages S5 / S6 / S7 data: triggers, dwell, suggested goals, toasts (§6.2) | W17-16 |
| Deep Reclaim enabled from S5 for T2 workers (`UO-TF-10`) | W17-18 |
| Terraforming Processor T1 unlocked at S5 (`UO-TF-08`, shed group 1) | W17-19 |
| Stage S7 extras: Beacon T2 view radius, Laser Tower T1 orderable, Aero Hangar orderable flag (built in W19) | W17-16, W17-07 |
| Kitbash: `unit.tank`, `unit.artillery`, `unit.radar`, `robot.multitask`, `fauna.brute` (Pillar 1, 4-view audit) | W17-20 … W17-24 |
| Tech Up goal targeting Hub T2 / Factory T2 (`UO-G`) | W17-25 |
| Duel checks for ground triangle (§5.5, `AC-04`) | W17-26 |
| Analytics funnel: `hub_t2_ordered`, `stage_reached{5..7}`, `first_tank`, `first_artillery_hit` | W17-27 |
| Dev console: `upgradeHub`, `spawnBrute`, `setDwell` | W17-28 |
| Mobile/touch: Multitask/upgrade orders work in landscape touch | W17-29 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W17-01 | Contracts & data: `upgradeBuilding` for Hub (HQ-only), unit ids `multitask`/`tank`/`artillery`/`radar`, fauna `brute`, events `hubUpgraded`, `hqRefitted`, `radarContact`, flag `W17`; data rows with `wave: 'W17'` | contract | M |  | W07-01, W08-01 | Run `npm run contracts:check` with `TA_WAVES=..17` → new kinds validate; with `..16` the rows are filtered out | units §5.1–5.2 | TA-14.1 |
| W17-02 | Hub T2 orderability rule: HQ-only, ≥ 8 min in S4, Δ cost, `stage_locked` / `dwell` wait reason | sim | S |  | W17-01 | Order Hub T2 at S4 + 3 min → entry shows "waiting: available in 5:00" | `UO-L-03`, §6.4 | TA-14.2 |
| W17-03 | In-place upgrade footprint: +1 ring must be owned + Prepared; auto-linked prep for the ring | sim | M |  | W17-02, W05-09 | Order the upgrade with a Wild ring tile → a linked terraform order appears; the upgrade starts only after the ring is Prepared | `UO-TF-01`, `UO-TF-03` | TA-14.3 |
| W17-04 | HQ refit system: dock at Hub, 20 s refit, tier follows Hub, T2 stats/lanes/goal & offer limits, cell 2 000 E, reprint cost T2 | sim | M |  | W17-03 | Complete Hub T2 → HQ walks to Hub, stays 20 s, inspector shows `hq.tier = 2`, HP 2 200, lanes construction+harvest+terraform | `UO-HQ-01`, §3.2 | TA-14.2 |
| W17-05 | Multitask T2 unit: built at Hub T2, 2 supply, −5 E/s, 420 HP, all lanes 2.0× | sim | S |  | W17-01 | Queue Multitask T2 at Hub T2 → after 26 s a Multitask appears and takes a harvest job when idle | §5.1 | TA-14.2 |
| W17-06 | Worker tier gate + dispatch tie-break (lowest tier first; pre-empt only by player) | sim | M |  | W17-05 | Queue a T2 Extractor with only Builders idle → entry shows `waiting: worker (T2 needed)`; with a Builder and Multitask idle on a T1 job, the Builder is picked | `UO-L-02`, `UO-D-03` | TA-14.2 |
| W17-07 | Enable T2 building rows (Beacon T2 view 20, Solar T2, Extractors T2, Depot T2, DCA T2, Autocannon T2, Factory T2) with tier requirements Hub ≥ T2 | data | S |  | W17-01 | With `TA_WAVES=..17`, the Construction menu lists T2 rows; with `..16` they are greyed with the "S5" unlock hint | econ §3.1–3.7 | TA-14.1 |
| W17-08 | Factory T2 production: 1.5× on T1 units, unlocks Tank/Artillery/Radar | sim | S |  | W17-07 | Upgrade Factory to T2 → Recon build time drops from 14 s to 9.3 s; Units menu shows Tank/Artillery | econ §3.6 | — |
| W17-09 | Tank unit: 900 HP, speed 1.2, radius 0.7, view 7, rocket 36×1/s range 5 speed 10 AoE 1.0, −6 E/s, 2 supply | sim | S |  | W17-08, W07-03 | Spawn Tank vs 3 Recons (dev) → rockets hit evasive Recons and all 3 die | §5.2 | TA-14.4 |
| W17-10 | Artillery unit: shell 90×0.5/s, range 14, min range 3, speed 4, AoE 1.5, indirect, view 6; retreat inside min range | sim | M |  | W17-08, W07-03 | Put Artillery 10 tiles from a stationary dummy (spotted) → shells land and deal 90; place a dummy 2 tiles away → Artillery backs off and does not fire | §5.2, `UO-C-03` | TA-14.4 |
| W17-11 | Mobile Radar unit: unarmed, view 10, radar 22, −8 E/s | sim | S |  | W17-08 | Build Radar → inspector lists `radarContacts` for every enemy within 22 tiles | §5.2 | TA-14.4 |
| W17-12 | Spotting system: shared colony view + radar contacts; non-spotted targets cannot be fired upon | sim | M |  | W17-11 | Artillery with no spotter ignores a Brute at 12 tiles; build Radar → artillery starts firing within 1 s | `UO-C-06` | TA-14.4 |
| W17-13 | Brute fauna: stats, behaviour (solo/pairs, walks at walls), bite range 1 | sim | S |  | W17-01 | Dev `spawnBrute` → Brute walks to nearest structure at 1.0 t/s and deals 30 DPS | §5.6 | TA-14.4 |
| W17-14 | Stage-scaled raid composition: from `threatStage ≥ S6` add 1 Brute per 4 raiders | sim | S |  | W17-13, W08-09 | Set threatStage S6 and trigger a raid of 8 → 2 Brutes + 6 Skitters spawn | `UO-T-03` | TA-14.5 |
| W17-15 | Client: Tank and Artillery renderers + rocket trail / shell arc VFX + impact decals | client | M |  | W17-09, W17-10, W07-22 | Watch an artillery volley → parabolic shell arc, explosion flash and a 1.5-tile AoE decal at the aim point | `UO-C-08` | TA-14.10 |
| W17-16 | Stage data S5/S6/S7: triggers (Hub T2 complete; Factory T2 + 5 min dwell; first artillery + 5 min or S6 + 10), toasts, suggested goals, unlock lists | data | S |  | W08-03, W17-01 | Complete Factory T2 at S5 + 5 min → toast "S6 Combined Arms" and a Build Army card | §6.2 | TA-14.5 |
| W17-17 | Client: min-range dashed red ring + radar range ring + radar contact blips on minimap | client | S |  | W17-11, W04-05 | Select Artillery → solid orange 14-tile ring + dashed red 3-tile ring; select Radar → 22-tile ring; contacts blink on the minimap | `UO-C-08`, CLIENT §8b | TA-14.10 |
| W17-18 | Enable Deep Reclaim op at S5 for T2+ workers (HQ T2, Multitask T2) | sim | S |  | W17-06, W05-09 | Brush Deep Water at S5 with only a Terraformer → `waiting: worker (T2 needed)`; with Multitask → tile becomes Shallow in 28 s | `UO-TF-10` | TA-14.3 |
| W17-19 | Terraforming Processor T1: Prepared → Living in radius 10, water/energy draw, shed group 1 | sim | M |  | W17-07 | Build Processor next to Prepared tiles → Living % rises over time; brownout pauses it first | `UO-TF-08`, econ §3.6 | — |
| W17-20 | Kitbash `unit.tank` (≥ 7 parts, low/wide silhouette, rocket pod, 60/30/10) + 4-view audit | visual | M |  | — | `/playground.html?inspect=unit.tank` → iso/front/side/top OK, minY 0.000, < 3.5k tris | AGENTS.md Pillar 1 | TA-14.9 |
| W17-21 | Kitbash `unit.artillery` (long barrel, recoil animation) + audit | visual | M |  | — | Playground inspect shows barrel elevation animation; audit passes | Pillar 1 | TA-14.9 |
| W17-22 | Kitbash `unit.radar` (dish silhouette breaker, rotating) + audit | visual | S |  | — | Dish rotates in playground; audit passes | Pillar 1 | TA-14.9 |
| W17-23 | Kitbash `robot.multitask` (three-tool arms) + audit | visual | S |  | — | Playground inspect passes audit | Pillar 1 | TA-14.9 |
| W17-24 | Kitbash `fauna.brute` (heavy quadruped, bob animation) + audit | visual | S |  | — | Playground inspect passes audit | Pillar 1 | — |
| W17-25 | HQ goal "Tech Up" targets Hub T2/T3 and Factory T2; Build Army preset "counter what you see" | sim | M |  | W08-16, W17-09, W17-10 | Accept the Tech Up card → earmarks appear and the Hub upgrade is queued when affordable | `UO-G`, §4.6 | TA-14.6 |
| W17-26 | Duel harness port: ground triangle rows (Tank/Recon, Artillery/Tank, Recon/Artillery) at equal cost + supply in `shared/sim/test/duels.spec.ts` | test | M |  | W17-09, W17-10 | `npm run test -w @terra/sim -- duels` → 6 ground rows pass with ≥ 50 % survivors | §5.5, `AC-04` | TA-14.7 |
| W17-27 | Analytics: `hub_t2_ordered`, `stage_reached{5,6,7}`, `first_tank`, `first_artillery_hit` | client | S |  | W00-44 | Play to S6 → analytics table has the four events for the session | CLIENT §10 | — |
| W17-28 | Dev console: `upgradeHub <tier>`, `spawnBrute <n>`, `setDwell <stage> <min>` | client | S |  | W00-40 | Type `upgradeHub 2` → Hub becomes T2 instantly and HQ refits | PRODUCT_WAVES §3 | — |
| W17-29 | Touch: upgrade button + Multitask lane chips usable in phone landscape | client | S |  | W24-11 | On a 844×390 viewport, tap Hub → Upgrade → confirm works without hover | D-22 | — |
| W17-30 | Wave e2e `e2e/w17.spec.ts` + scenario `w17-second-tier` + tag `wave-17` | test | M |  | all W17 | `npm run e2e -- --waves ..17` → demo story passes; `TA_WAVES=..16` hides every W17 item | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w17.spec.ts` passes, and so does every earlier wave suite.
- `?scenario=w17` loads.
- `TA_WAVES=..16` hides T2 rows, the new units, Brute and stages S5–S7, while W17 entities in snapshots stay inert.
- Duel rows pass in CI.
- Tag `wave-17` is created.
