# Epic TA-14 — Units, Orders, Ground & Learning Curve (D-16)

> **Orchestrator:** [`EXECUTION_ORCHESTRATOR.md`](../EXECUTION_ORCHESTRATOR.md) · **Status Board:** [`STATUS.md`](../STATUS.md)
> **Spec:** [`docs/game/units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) (all rule ids `UO-*`, acceptance criteria `AC-01..16`) · [`SIMULATION.md`](../../spec/SIMULATION.md) · [`DECISIONS.md`](../../spec/DECISIONS.md) D-16 (Accepted), D-21
> **Lanes:** `L2` (sim: TA-14.1–14.7) · `L5` (client & visuals: TA-14.8, TA-14.9, TA-14.10). The AI side of goals/truces is [`TA-09.6`](./TA-09-ai-orchestrator.md) (`L4`).
>
> **⚠ 2026-10-30 — D-24 and D-28 apply.**
> - **D-24:** the sim runs in one app on one runtime. Floats are allowed. There are no state hashes, tick markers, replay or fog-of-war views. The `sim:determinism` scripts below now only check **reproducibility** (same seed and same commands give the same result in one runtime).
> - **D-28:** combat is **battle v1**: plain HP and damage, projectile events resolved at impact time, lasers, rockets, AoE, evasive units (units spec §5.2–5.5). The damage × armor matrix is *Future*.
> - **Hackathon:** slices of TA-14.1–14.5, 14.8 and 14.10 are pulled into [`HACKATHON_CUT.md`](../HACKATHON_CUT.md) D3–D6.

## Overview

D-16 replaces the D-15 robot list with the spec's roster, order lanes, ground preparation, terrain walls, truces and an 11-stage learning curve.

**MVP scope:** stages **S0–S7**, with 9 unit types: HQ T1–T2, Harvester, Builder, Terraformer, Multitask T2, Recon, Tank, Artillery and Mobile Radar. It also includes the Prepared-ground rule, all terraform ops (Deep Reclaim from S5), Ridge/Moat walls with the Wall Gate, line of fire, and truces. S8–S10 content (air, Anti-Air, Aero Hangar, T3) is data-only with `enabled: false`.

This epic adds sim systems and data on top of TA-06, and the client surfaces on top of TA-11. Existing TA-06 and TA-11 tasks are rescoped where they overlap (TA-06.6, TA-06.7, TA-06.11, TA-11.8).

## Epic analytics

- **Goal / user value:**
  - A limited, readable roster with rock–paper–scissors counters.
  - Orders that wait sensibly in a local queue and tell you why.
  - A first session that teaches one mechanic at a time.
- **Success metrics:**
  - `AC-01` stage-reach windows hold for the reference bot.
  - `AC-04` duel table holds in CI.
  - `AC-09` no building ever starts on unprepared ground.
  - `AC-14` walls are never crossed by ground units.
  - Playtest median stage times within ±30 % (`AC-08`).
- **In scope:** everything in spec §§3–6 for S0–S7, plus data rows for S8–S10.
- **Out of scope:**
  - Air movement and combat beyond the data rows (post-MVP).
  - Truce on-chain receipts.
  - Cross-planet trades (D-19: same planet only).
- **Key risks → mitigations:**
  - L2 overload (this epic adds 7 sim tasks) → strict lane order, and duel/bot harness last (W5).
  - Line-of-fire and wall nav-graph cost → bounded hex-line checks; nav invalidation only on wall completion.
  - Balance drift → all numbers in `src/data/*`, asserted by fixtures copied from the spec tables.

## Task index

| Task | Title | Wave / Lane | Depends On |
|---|---|---|---|
| `TA-14.1` | Data tables: units, weapons (battle v1), stages, terrain & terraform ops, fauna, Wall Gate & Aero Hangar rows | W2 / L2 | TA-06.2, TA-01.7 |
| `TA-14.3` | Ground & terraform: terrain classes, spawn guarantee, `prep` state, 9 ops with energy draw, linked prep, Prepared-ground rule, wall ops, meteor holes, Terraform % | W2 / L2 | TA-14.1, TA-06.4 |
| `TA-14.2` | Order lanes & queue: pay-on-start, dispatch + earmarks, precedence, worker-tier gate, HQ rules (cell, refit, reprint, elimination) | W2 / L2 | TA-06.6, TA-14.3 |
| `TA-14.5` | Progression: `unlockStage`/`threatStage`, triggers + dwell + overrides, stage-scaled raids, newcomer shield, suggestion cards | W3 / L2 | TA-06.7, TA-14.2 |
| `TA-14.6` | HQ goals & diplomacy in sim: goal breakdown + budgets, truces (offer/sign/notice/Oathbreaker), Negotiate goal | W3 / L2 | TA-14.5 |
| `TA-14.9` | Visuals: MVP archetypes (terraformer, multitask, tank, artillery, radar, wall gate, brute), Prepared pad & Ridge/Moat terrain look, terraform VFX | W3 / L5 | TA-11.6 |
| `TA-14.4` | Battle v1 (D-28): plain HP/damage, projectile impact-at-time, lasers/rockets/AoE, evasive units, layers, line of fire (parapet), wall-aware nav, fauna siege, gate pathing, Recon/Tank/Artillery/Radar, Brute | W4 / L2 | TA-06.6, TA-14.3, TA-14.6 |
| `TA-14.8` | Client order menus: Construction/Terraform/Units/HQ Goals, queue panel (reasons, ETA, earmarks), tile overlay, goal & stage cards, truce UI | W4 / L5 | TA-11.7, TA-11.8 |
| `TA-14.10` | Battle v1 client: weapon/min/view range rings, projectile visuals (tracers, arcs, rocket trails, beams), impact + AoE decals | W4 / L5 | TA-14.4, TA-11.6 |
| `TA-14.7` | Balance harness: deterministic duel harness (spec §5.5) + headless reference-player bot S0→S7 + stage telemetry | W5 / L2 | TA-14.4, TA-14.5, TA-06.13 |

---

## Tasks

### `TA-14.1` — Data tables: units, weapons (battle v1), stages, terrain & terraform ops, fauna, Wall Gate & Aero Hangar rows

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W2 / L2` (first L2 task after TA-06.3)
- **Depends On:** `TA-06.2`, `TA-01.7`
- **Spec:** units spec §2, §3.1–3.3, §4.5, §4.8, §5.1–5.6, §6.2
- **Target Files:**
  - `shared/sim/src/data/{units.ts,weapons.ts,stages.ts,terrain.ts,terraform.ts,fauna.ts,diplomacy.ts}` (`weapons.ts`: kind, damage, rate, range, min range, projectile speed, AoE, `hitsGround`/`hitsAir`, `arc`; units carry `radius`, `view`, `evasive`; 1 tile = 2 m)
  - `shared/sim/src/data/buildings.ts` (add Wall Gate, Aero Hangar T2/T3, `hitsAir` on Autocannon/Laser)
  - `shared/sim/src/data/compile.ts`
  - `shared/sim/test/data/{units.spec.ts,stages.spec.ts,terraform.spec.ts}`
- **Verify:** `npm run test -w @terra/sim -- data`

#### Analytics
- **Problem:** balance must be tunable without touching systems.
- **Constraint:** design numbers are in seconds and tiles; `compileData()` converts them for the configured TPS (5 active, coarse dt 5). Floats are allowed (D-24).
- **Risk:** transcription errors → fixtures copied verbatim from the spec tables.
- **Telemetry:** none (data only).

#### Architecture
- Rows carry `enabled` and `stage`. MVP enables S0–S7.
- `ECONOMY_RATE_SCALE = 0.25` is applied in `compileData` to resource flows only.

#### Definition of Ready (DoR)
- [ ] Contract change request (lead, W2 pre-step): `UnitId` (14 ids), `TerraformOp` (`grade, clear, break, level, fill, reclaim, deepReclaim, irrigate, seed, raiseRidge, digMoat, lower`), tile `terrain` and `prep` enums.

#### Definition of Done (DoD)
- [ ] Every table row in spec §5.1–5.3 (incl. the battle v1 weapon columns and the "other shooters" table), §4.5 and §4.8 is asserted by a fixture.
- [ ] `stages.spec.ts` enforces `AC-05` (≤ 1 mechanic and ≤ 2 new unit types per stage).
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-14.3` — Ground & terraform

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W2 / L2` (after TA-06.4, before TA-06.6)
- **Depends On:** `TA-14.1`, `TA-06.4`
- **Spec:** units spec §4.5 (`UO-TF-01..10`), §4.8 (`UO-W-04..06`, `UO-W-09`)
- **Target Files:**
  - `shared/sim/src/gen/terrain.ts` (classes and mix per planet type; spawn guarantee `UO-TF-09`)
  - `shared/sim/src/systems/terraform.ts`
  - `shared/sim/src/systems/terraform/{ops.ts,linked-prep.ts,walls.ts,isolation-check.ts}`
  - `shared/sim/src/systems/construction.ts` (Prepared-ground gate; Hub exemption on unclaimed tiles `UO-TF-05`)
  - `shared/sim/src/systems/power.ts` (terraform load in shed group 1)
  - `shared/sim/test/systems/{terraform.spec.ts,walls.spec.ts,prepared-ground.property.spec.ts}`
  - `shared/sim/scenarios/landfall.ts`
- **Verify:** `npm run test -w @terra/sim -- terraform walls prepared-ground && npm run sim:determinism -w @terra/sim -- --ticks 6000 --scenario landfall --runs 3`

#### Analytics
- **Problem:** buildings may stand only on Prepared tiles. The HQ must always be able to prepare its own Hub site.
- **Risks → mitigations:**
  - Spawn sites too expensive → generator guarantee + `AC-10` sweep.
  - Self-trapping walls → `would_isolate` flood fill (≤ ~2 000 tiles, run when the op starts).
- **Telemetry:** stats `terraformOpsDone`, `terraformEnergy`; events `tilePrepared`, `wallRaised`, `wallBreached`.

#### Architecture
- Tile arrays gain `terrain` and `prep`.
- A placement on unprepared tiles creates **one linked terraform order** that does not count toward the lane limit.
- Op energy joins robot drain on the Hub component. The HQ draws from its cell (`UO-HQ-06`, implemented in TA-14.2).
- Meteors turn tiles into Hole and breach walls.
- Deep Reclaim is gated to T2+ workers.
- Hydro needs ≥ 1 adjacent water tile.

#### Definition of Ready (DoR)
- [ ] Contract change request (lead): `placeBuilding` returns `linkedTerraformId`; reject codes `would_isolate`, `terrain_unbuildable` (Deep Water before S5).

#### Definition of Done (DoD)
- [ ] `AC-09` property test: no construction starts on a tile that is not Prepared or Living, over random command logs on both planet types.
- [ ] `AC-10`: over 1 000 generated spawn slots per planet type, the HQ finishes site prep + Hub on its T1 cell within ≤ 60 s of work time.
- [ ] `AC-11`: in any brownout, nothing outside group 1 goes offline while a terraform op is drawing.
- [ ] `AC-16`: no wall op isolates an own structure.
- [ ] `walls.spec.ts`: Lower refunds 50 % on a Ridge; a meteor turns Ridge → Rock and Moat → Hole.
- [ ] Status synced (§1.6).

---

### `TA-14.2` — Order lanes & queue + HQ rules

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W2 / L2` (last W2 L2 task)
- **Depends On:** `TA-06.6`, `TA-14.3`
- **Spec:** units spec §3.1–3.2 (`UO-L`, `UO-HQ-01..06`), §4.2–4.4 (`UO-Q`, `UO-D`, `UO-P`)
- **Target Files:**
  - `shared/sim/src/tasks/{lanes.ts,dispatch.ts,earmarks.ts,precedence.ts}`
  - `shared/sim/src/systems/hq.ts` (power cell, refit, reprint, self-preservation)
  - `shared/sim/src/systems/lifecycle.ts` (elimination per `UO-HQ-04`; offline elimination allowed, D-17)
  - `shared/sim/test/tasks/{dispatch.spec.ts,earmarks.spec.ts,tier-gate.spec.ts}`
  - `shared/sim/test/systems/hq.spec.ts`
- **Verify:** `npm run test -w @terra/sim -- tasks hq && npm run sim:determinism -w @terra/sim -- --ticks 36000 --scenario founder`

#### Analytics
- **Problem:** orders are intents that are paid when work starts. A blocked entry must never block the ones behind it.
- **Risk:** starvation → earmarks after 60 s, capped at 80 % of storage cap.
- **Telemetry:** stats `queueWaiting{reason}`, `earmarked[4]`; events `hqLost`, `hqReprinted`, `colonyCritical`.

#### Architecture
- Lanes: Construction, Terraform, Units, plus HQ goals (sim side of goals in TA-14.6).
- Precedence: `system > player > hq > ai > auto`.
- Limits: 20 / 20 / 10 (+5 per production building).
- Refunds: cancelling an in-progress entry refunds 75 %. Wait reasons: `resources | storage | worker | power | site`.

#### Definition of Ready (DoR)
- [ ] Contract change request (lead, W2 pre-step): `enqueueTask` variants `terraform`, `buildUnit`, `queueGoal`, `setStance`, `attackMove`, `setRally`, `setHarvestWeights`; queue view DTO with `waitReason` + `etaTicks`; reject codes `worker_tier_locked`, `stage_locked`.

#### Definition of Done (DoD)
- [ ] `dispatch.spec.ts`: pay-on-start; refunds; `waiting(storage)` never earmarks.
- [ ] `tier-gate.spec.ts`: a T1 Builder cannot start a T2 structure; only the HQ upgrades the Hub.
- [ ] `hq.spec.ts`: refit on Hub upgrade; reprint while the Hub stands; Hub lost + HQ alive gives a 6 000-tick window; both lost eliminates the colony.
- [ ] `AC-07` data: every waiting entry carries a reason and an ETA in the view.
- [ ] Status synced (§1.6).

---

### `TA-14.5` — Progression & threat scaling

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W3 / L2`
- **Depends On:** `TA-06.7`, `TA-14.2`
- **Spec:** units spec §6.1–6.3 (`UO-LC-01..07`, `UO-T-01..08`)
- **Target Files:**
  - `shared/sim/src/systems/progression/{stages.ts,threat.ts,shield.ts,suggestions.ts}`
  - `shared/sim/test/systems/progression-stages.spec.ts`
  - `shared/sim/scenarios/unattended-stages.ts`
- **Verify:** `npm run test -w @terra/sim -- progression && npm run sim:determinism -w @terra/sim -- --ticks 72000 --scenario unattended-stages`

#### Analytics
- **Problem:** threat must follow the colony's stage, and a counter must arrive no later than its threat.
- **D-17 hard mode:** an unattended colony **can** be eliminated, so `AC-03` is restated (units spec §8.3) as "reaches S4 on its own; every `underAttack` / `colonyCritical` produces a player notification within 60 s". Because Hub loss starts a 10-min `critical` window (`UO-HQ-04`), the player also gets at least 10 min of warning before elimination by Hub loss.
- **Telemetry:** events `stageReached{stage}`, `threatStageChanged`.

#### Architecture
- `unlockStage` is per player and arrives in `core.spawnColony` args. `threatStage` is per colony, derived from the gating buildings the colony owns.
- Raids follow `UO-T-02/03`, meteors follow `UO-T-07`, and the newcomer shield follows `UO-T-05`.

#### Definition of Ready (DoR)
- [ ] Contract change request (lead): `spawnColony.unlockStage`, event `stageReached`.

#### Definition of Done (DoD)
- [ ] `progression-stages.spec.ts`: triggers, dwell and overrides; S8 Anti-Air override when enemy air is seen; autopilot advances only S0–S4 (`UO-LC-07`).
- [ ] `AC-06`: no PvP raid on a colony with `threatStage < S6` and age < 6 h.
- [ ] `AC-03` (restated as above) holds in the `unattended-stages` scenario.
- [ ] Status synced (§1.6).

---

### `TA-14.6` — HQ goals & diplomacy (sim side)

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W3 / L2`
- **Depends On:** `TA-14.5`
- **Spec:** units spec §4.6 (`UO-G`), §4.7 (`UO-DIP-01..06`), §3.2 `UO-HQ-05`
- **Target Files:**
  - `shared/sim/src/goals/{breakdown.ts,budgets.ts,goals.ts}`
  - `shared/sim/src/systems/diplomacy.ts`
  - `shared/sim/test/goals/breakdown.spec.ts`
  - `shared/sim/test/systems/diplomacy.spec.ts`
- **Verify:** `npm run test -w @terra/sim -- goals diplomacy`

#### Analytics
- **Problem:** the HQ turns player goals into orders. Truces are sim-local pacts with a no-backstab notice period.
- **Telemetry:** events `truceOffered`, `truceSigned`, `truceNotice`, `truceEnded`; stats `goalsActive`.

#### Architecture
- Goal budget caps apply on top of `AW-20` (player-set away budget, D-17).
- Truces live in colony-pair state, with a 10-min offer expiry, a 10-min cancel notice and a 24 h Oathbreaker mark.
- Combat enforcement (no auto-targeting, `truce_active` rejections on raid/attack-move) lands in TA-14.4. This task rejects truce-violating commands at validation.

#### Definition of Ready (DoR)
- [ ] Contract change request (lead, W3 pre-step): `diplomacy.proposeTruce`, `diplomacy.respondTruce`, `diplomacy.cancelTruce`; reject codes `truce_active`, `oathbreaker`, `recent_hostility`; the events above.

#### Definition of Done (DoD)
- [ ] `breakdown.spec.ts`: every §4.6 goal produces only validator-accepted orders and respects its budget.
- [ ] `AC-13`: away AI never cancels a truce; a cancel always starts the notice and the Oathbreaker mark.
- [ ] Status synced (§1.6).

---

### `TA-14.9` — Visuals for MVP units, walls and ground

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W3 / L5` (after TA-11.6)
- **Depends On:** `TA-11.6`
- **Spec:** units spec §2 (archetype ids), §7 rows 11, 15, 17 · [`AGENTS.md`](../../../AGENTS.md) Pillars 1–4
- **Target Files:**
  - `frontend/game/src/kitbash/archetypes/{units/terraformer.ts,units/multitask.ts,units/tank.ts,units/artillery.ts,units/radar.ts,buildings/wall-gate.ts,nature/brute.ts}`
  - `frontend/game/src/render/terrain/{prep-overlay.ts,ridge-moat.ts}`
  - `frontend/game/src/render/fx/terraform-fx.ts`
  - `frontend/game/test/visual/*.spec.ts`
- **Verify:** `npm run test -w @terra/game -- visual && npm run build -w @terra/game`

#### Analytics
- **Problem:** each role must read from its silhouette, and walls must read as walls from the 28° camera.
- **Constraints:** `procedural-kitbash-3d` (≥ 7 parts, a silhouette breaker, 60/30/10 materials), `shader-texture-tuning` for the Prepared pad and the Ridge/Moat blend.
- **Telemetry:** none.

#### Definition of Ready (DoR)
- [ ] `TA-11.6` done; the archetype ids in spec §2 are frozen.

#### Definition of Done (DoD)
- [ ] 4-view audit (`iso/front/side/top`) passes for each new archetype: `minY == 0`, parts connected.
- [ ] Recon re-skins the existing `robot.combat`.
- [ ] Ridge/Moat/Prepared/Living are distinguishable in the iso view.
- [ ] Status synced (§1.6).

---

### `TA-14.4` — Battle v1, line of fire & walls in combat (D-28)

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L2` (first W4 L2 task; TA-06.8 and TA-06.11 build on it). **Hackathon:** core slice on D5, nav slice on D6.
- **Depends On:** `TA-06.6`, `TA-14.3`, `TA-14.6`
- **Spec:** units spec §5.2–5.6 (`UO-C-00..08`), §4.8 (`UO-W-01..03`, `UO-W-07`, `UO-W-08`), §4.7 `UO-DIP-03`; D-28
- **Target Files:**
  - `shared/sim/src/systems/combat/{weapons.ts,projectiles.ts,impact.ts,lasers.ts,splash.ts,evasive.ts,layers.ts,line-of-fire.ts,spotting.ts,stances.ts,targeting.ts}`
  - `shared/sim/src/pathfinding/nav-graph.ts` (impassable Ridge/Moat/Deep Water, gate passability per owner, dirty invalidation)
  - `shared/sim/src/systems/fauna/siege.ts`
  - `shared/sim/test/systems/combat/{projectiles.spec.ts,evasive.spec.ts,splash.spec.ts,line-of-fire.spec.ts,walls-nav.property.spec.ts,duel-smoke.spec.ts}`
- **Verify:** `npm run test -w @terra/sim -- combat && npm run sim:bench -w @terra/sim`

#### Analytics
- **Problem:** combat must be simple (plain HP, plain damage) and still produce counters.
  - Counters come from weapon behaviour: slow shells miss evasive units; instant lasers and fast rockets don't; AoE punishes clumps.
  - They also come from range, speed and HP.
  - Walls stop all ground movement and direct fire; artillery and air go over.
- **Risks → mitigations:**
  - Projectile cost → no per-tick flight and no collision checks; one event per shot, resolved at `impactAt`.
  - LOS cost → a hex-line check only at fire time, for direct weapons.
  - Tick quantisation at 5 TPS → `impactAt` is stored in seconds and resolved in the first step past it.
- **Telemetry:** stats `shotsFired{kind}`, `projectileHits`, `projectileMisses`, `losChecks`, `navInvalidations`; events `projectileFired {from, aim, kind, impactAt}`, `projectileResolved {hit, aoeVictims}`, `raidRepelled{reason: 'siege'}`.

#### Architecture
- **Fire:** `t = dist / speed`; `aim = target.pos + target.vel × t` (one-time lead, no homing); store the event.
- **Impact:** hit if the target is alive and `dist(target, aim) ≤ aoe + radius`; full damage. Other enemies within `aoe` take 50 %. A missed shell still explodes at the aim point.
- **Lasers:** instant, in range and in line of fire.
- **Evasive units** change heading every 0.5 s while engaging.
- `arc: direct | indirect`, with the parapet exception (a ridge adjacent to the shooter does not block).
- **Target choice:** nearest enemy the weapon can hit, then lowest `entityId`; keep the target until it dies or leaves range. Truce partners are never targeted.
- Brute starts appearing at S6.

#### Definition of Ready (DoR)
- [ ] TA-14.3 nav-relevant tile states landed. Contract fields `weapon`, `radius`, `view`, `evasive` in unit views, and the events `projectileFired` / `projectileResolved` (lead).

#### Definition of Done (DoD)
- [ ] `projectiles.spec.ts`: a stationary target is always hit. A straight-moving target is hit (lead works). An evasive target at long shell flight is missed. A laser always hits in range.
- [ ] `splash.spec.ts`: 50 % to other enemies within AoE; no friendly fire.
- [ ] `AC-14`: no ground unit or creature occupies a Ridge/Moat tile; air and indirect fire are never blocked.
- [ ] `AC-15`: line-of-fire fixtures (parapet, moat, artillery).
- [ ] `duel-smoke.spec.ts`: the 3 ground-triangle rows of spec §5.5 (v1 model) hold. The full table moves to TA-14.7.
- [ ] `AC-12`: no damage passes between truce partners.
- [ ] `sim:bench` p99 within the TA-06 budget on `mvp-scale` with walls and 200 projectiles in flight.
- [ ] Status synced (§1.6).

---

### `TA-14.8` — Client order menus, queue panel, ground overlay, goal/stage/truce UI

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L5` (after TA-11.8)
- **Depends On:** `TA-11.7`, `TA-11.8`
- **Spec:** units spec §4.1–4.8, §6.2 (suggestion cards), `AC-07`
- **Target Files:**
  - `frontend/game/src/hud/orders/{ConstructionMenu.tsx,TerraformMenu.tsx,UnitsMenu.tsx,GoalsMenu.tsx}`
  - `frontend/game/src/hud/queue/QueuePanel.tsx`
  - `frontend/game/src/hud/{StageToast.tsx,GoalCard.tsx,TrucePanel.tsx,AwayBudget.tsx}`
  - `frontend/game/src/render/overlays/tile-state.ts`
  - `frontend/game/test/hud/orders/*.test.tsx`
  - `tests/e2e/w4-orders.spec.ts`
- **Verify:** `npm run test -w @terra/game -- orders && npm run test:e2e -- --grep @w4-orders`

#### Analytics
- **Problem:** players must see what is unlocked, what comes next, and why an order waits.
- **Constraints:** also works in landscape fullscreen on phones (TA-11.9 reuses these components).
- **Telemetry:** `order_menu_open{menu}`, `queue_wait_reason_view`, `stage_card_accept`.

#### Definition of Ready (DoR)
- [ ] Queue view DTO (`waitReason`, `etaTicks`, earmarks) and diplomacy commands landed in contracts.

#### Definition of Done (DoD)
- [ ] Greyed next-stage items show their unlock condition.
- [ ] Ghost footprint shows the prep bill.
- [ ] `AC-07`: every waiting entry shows a reason and an ETA.
- [ ] Truce offer/accept/cancel shows the notice countdown.
- [ ] Away-budget sliders send `setAutopilot` (D-17).
- [ ] E2E `@w4-orders`: place on forest → linked prep → building completes.
- [ ] Status synced (§1.6).

---

### `TA-14.10` — Battle v1 client: range rings & projectile visuals

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L5` (after TA-14.8). **Hackathon:** D6.
- **Depends On:** `TA-14.4`, `TA-11.6`
- **Spec:** units spec §5.4 `UO-C-08`; CLIENT §8b (range rings, projectiles); D-28
- **Target Files:**
  - `frontend/game/src/render/combat/{range-rings.ts,ring-dash.material.ts,projectiles.ts,impacts.ts}`; hackathon: `src/game/combat/*.ts`
  - `frontend/game/test/render/combat/*.test.ts`
- **Verify:** `npm run test -w @terra/game -- combat && npm run build -w @terra/game`

#### Analytics
- **Problem:** players must see reach and sight, and why a shot hit or missed.
- **Constraints:**
  - Rings are ground decals at `radius_tiles × 2 m`, drawn as one instanced ring mesh with a dash shader (a single draw call).
  - Projectiles are client-only animation; the server decides every hit.
  - Pillar 4 diorama camera; the bloom threshold is respected for tracers and beams.
- **Telemetry:** `rings_toggle_all`.

#### Definition of Done (DoD)
- [ ] Selected own unit or building: weapon ring (solid, faction orange), min ring (dashed red), view ring (thin dashed white, 40 %). Hovered enemy: its weapon ring in red. `Alt`: rings for every own unit on screen. The turret placement ghost shows its range.
- [ ] `projectileFired` animates bullets as tracers, shells as parabolic arcs, rockets as straight lines with a smoke trail, and lasers as a 0.1 s beam. At `impactAt` it plays an impact flash plus an AoE decal. `projectileResolved` with `hit:false` shows the round landing off target.
- [ ] 200 projectiles in flight keep the frame budget of CLIENT §9.
- [ ] Status synced (§1.6).

---

### `TA-14.7` — Balance harness: duels, reference bot, stage telemetry

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W5 / L2` (before TA-13.4)
- **Depends On:** `TA-14.4`, `TA-14.5`, `TA-06.13`
- **Spec:** units spec §5.5, §6.4, §8.3 (`AC-01`, `AC-02`, `AC-04`, `AC-08`)
- **Target Files:**
  - `shared/sim/scripts/{duels.ts,reference-bot.ts}`
  - `shared/sim/scenarios/reference-player.ts`
  - `shared/sim/test/balance/{duels.spec.ts,stage-windows.spec.ts}`
- **Verify:** `npm run sim:duels -w @terra/sim && npm run sim:reference-bot -w @terra/sim -- --seeds 5 --planet temperate,desert`

#### Analytics
- **Problem:** the balance numbers are hand estimates and must be proven before tuning.
- **Telemetry:** the `stage_reached{stage}` funnel feeds `AC-08` after launch.

#### Definition of Done (DoD)
- [ ] `AC-04`: every ground row of §5.5 (battle v1 model: per-shot projectiles, impact check, evasive drift, 50 % splash) holds at equal cost and at equal supply. Air rows are skipped while S8+ is disabled. The design-time duel model is re-implemented from spec §5.4 in `shared/sim/test/balance/duels.spec.ts`.
- [ ] `AC-01`: bot windows S1 ≤ 1:15, S2 ≤ 4:00, S3 ≤ 10:00, S4 ≤ 18:00, S5 ≤ 30:00, S6 ≤ 40:00 (and S7 ≤ 50:00).
- [ ] `AC-02` (no shedding beyond group 1 before the first night).
- [ ] Results are written to `shared/sim/reports/balance.md` for the owner.
- [ ] Status synced (§1.6).
