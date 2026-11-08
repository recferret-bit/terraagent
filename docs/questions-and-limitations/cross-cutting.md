# Cross-cutting: duplication, dead code, test gaps, docs vs code

Tool-driven review of the whole W01 branch diff (`git diff main...HEAD`): copy/paste detection, unused code, coverage,
docs vs code and repo hygiene. Area reviews live in the other files of this folder; entry format in the
[README](./README.md). Ledger limits already recorded in [`economy-ledger.md`](./economy-ledger.md) (LED-01..15) are not repeated.

## Balance data and duplicated constants

### XC-01 · Data rows carry the same value under 2–4 names; the "declared" field is often the one nobody reads

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/hq.ts:24-45,59-62`, `shared/sim/src/data/hub.ts:17-35`, `shared/sim/src/data/ops-basic.ts:15-18,30-33,45-48`; readers `shared/sim/src/systems/hq/index.ts:294-296`, `shared/sim/src/systems/terraform-basic/queue.ts:65-66`, `shared/sim/src/systems/territory-claim/index.ts:138-139,162-164`, `shared/sim/src/systems/construction/build.ts:55-62`, `shared/sim/src/systems/construction/placement.ts:144`, `shared/sim/src/systems/landing/index.ts:70-71`
- **What happens:** one balance value is stored under several field names, e.g. HQ self recharge `cellSelfRechargePerS` / `designCellSelfRechargePerS` / `selfRechargeEPerS` (all 3), fast recharge `cellFastRechargePerS` / `designCellFastRechargePerS` / `hubRechargeEPerS` (20), radius `cellFastRechargeRadius` / `hubRechargeRadius`, Hub build time `buildS` / `designBuildS` / `buildTimeS`, Founder Core `founderCoreGenPerS` / `founderCoreEPerS` / `powerGen`, footprint `footprint` / `footprintW` / `footprintD` / `footprintH`, op time `timeS` / `baseTimeS` / `designSeconds`, op energy `energy` / `energyCostE`. Readers pick one through `??` chains. The fields declared in `units:` (and therefore unit-converted by `compileData`) are often not the ones read: `cellSelfRechargePerS`, `cellFastRechargePerS` and `opsBasic.*.timeS` have no reader at all. So `tune hq.t1.cellSelfRechargePerS 10` or `tune opsBasic.grade.timeS 10` change the data hash and nothing else, while `tune hq.t1.designCellSelfRechargePerS 10` works. `resolveHubBuildTimeS` (`build.ts:55-62`) detects an override by comparing each alias with its default (`!== 30`, `!== 150` ticks), so a tune back to the default value is ignored if another alias differs. `resolveDescentTicks` (`landing/index.ts:69-76`) guesses whether `podDescentS` is already in ticks by comparing it with `designPodDescentS`: `tune hq.startingKit.podDescentS 1.2` compiles to 6 ticks, equals the design value 6, is taken for seconds and gives 30 ticks (6 s) instead of 1.2 s. `territory-claim` writes the same number into three colony fields (`powerGenEPerS`, `founderCoreEPerS`, `founderCoreGenPerS`).
- **Why it is like this:** issues in different waves named the same stat differently (spec name, "design" UI copy, unit-suffixed name) and each kept its own field.
- **Workaround / mitigation:** the default values all agree, so play is unaffected until someone tunes or edits one alias.
- **To resolve:** one field per value (the unit-declared one), readers read only that, delete the aliases and the `??` chains; add a data-compile check that every row field has a reader (or is listed as reserved for a later wave). Recommendation: do it before W02 adds more rows on top of this shape.
- **Found:** 2026-11-01, cross-cutting review (grep of every data field against its readers).
- **Fix (sim side):** one field per value in `hq`, `hub`, `opsBasic` (kept: `speedTilesPerS`, `cellCapacity`, `cellSelfRechargePerS`, `cellFastRechargePerS`, `cellFastRechargeRadius`, `podDescentS`, `autoPlaceIdleS`, `footprint`, `buildS`, `founderCoreGenPerS`, `timeS`, `energyCostE`; aliases deleted). Readers read only the declared field through `systems/rows.ts` (`w01Row`, `rowNum`), in compiled units, converting back with `ticksToSeconds` / `perTickToPerSecond` only for display; no `??` chains, no sentinel comparisons; the colony record gets one field (`founderCoreGenPerS`). The data check `shared/sim/test/data/generation-data.spec.ts` now covers `hq`, `hub`, `opsBasic` (unread fields listed as reserved for their wave).

### XC-02 · Balance numbers repeated as code fallbacks (sim and client)

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** sim: `shared/sim/src/systems/construction/build.ts:45-50` (Hub cost 200/100/50/50), `shared/sim/src/systems/landing/index.ts:58` (cargo 600/350/200/200), `shared/sim/src/systems/construction/build.ts:227` and `index.ts:203` (`hp ?? 1500`), `shared/sim/src/systems/territory-claim/index.ts:77,135,137,139` (`claimRadius ?? 10`, `supplyCap ?? 10` — removed, Resolved (47facdc): supply is computed by `systems/supply/` from `supplyProvided` rows —, `?? 8`), `shared/sim/src/systems/hq/index.ts:294-296` (`?? 3`, `?? 20`, `?? 6`), `shared/sim/src/systems/terraform-basic/queue.ts:65-66` (`?? 3`, `?? 20`); client: `frontend/game/features/hud-min/MinimalHud.ts:107,110` (`cellMax ?? 800`), `frontend/game/features/landfall/selection.ts:179,181` (`?? 900`, `?? 800`), `frontend/game/features/hud-min/MinimalHud.ts:214,223,232` (`'0 / 500'` placeholders)
- **What happens:** the same balance values live in the data rows and as literal fallbacks. If a row is renamed or its field dropped, the code silently keeps running on the stale literal instead of failing, and a fallback cannot tell design units from compiled ticks (`landing/index.ts:70` `podDescentS ?? 30` is ticks, `queue.ts:65` `?? 3` is seconds). The client fallbacks show 800 / 900 even when the data says otherwise.
- **Why it is like this:** defensive defaults for tests and for hosts started without W01 data.
- **Workaround / mitigation:** all hosts load the W01 data, so the fallbacks are not reached in normal play.
- **To resolve:** read rows through one typed accessor that throws on a missing field (the compiled data is always present once the wave flag is on); the client shows `—` instead of a made-up max. AGENTS.md "balance numbers in code" rule.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix (sim side, review-fix round 2026-11-01):** no balance literal is left as a fallback in `shared/sim/src/systems`: cost, cargo, HP (Hub and pod: new `hq.startingKit.podHp`), claim radius, supply cap, Founder Core, recharge rates, op time / energy, unit stats and initial caps (`hq.startingKit.storageCaps`) come from the rows and throw when missing. Still open: the client fallbacks (`MinimalHud.ts` `cellMax ?? 800`, `'0 / 500'`; `landfall/selection.ts` `?? 900`, `?? 800`) belong to FRONTEND-FEATURES.
- **Fix (client, final pass 2026-11-01):** no balance literal is left as a client fallback: the HUD and HQ panel show `—` until a view carries the value and take missing maxima from the `hq.t1` row (FF-23; `cellMax ?? 800`, `'0 / 500'`, `?? 900` gone), the Hub button cost and HQ speed come from `resolveHubCost` / `resolveHqT1Row` over the store's live data (FF-12), and the Hub shortfall toast that read `hub.t1.cost` is gone with GP-30 (FF-22 follow-up). The terraform planner's `hostAutoPrepares` (`frontend/game/features/terraform-basic/planner.ts`) still mirrors the sim's `enqueueTask` rule `op === 'grade' && tiles.length > 1` because `shared/sim/src/systems/terraform-basic/index.ts` does not export it (guarded by the parity spec); exporting it from the sim would let the client import it.

### XC-03 · Dev planet constants defined in the sim and again in the backend and client

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/gen/flat.ts:6-9` (`DEV_PLANET_RADIUS = 56`, `DEV_PLANET_TYPE`, `DEV_PLANET_SEED = 'golden-1'`); copies: `backend/app/src/core/home/home.repository.ts:9-10` (`DEV_PLANET_CAPACITY = 5`, `DEV_PLANET_RADIUS = 56`), `backend/app/src/game/game.module.ts:141` (literal `radius: 56, capacity: 5`), `frontend/game/app/online/bootOnline.ts:200-204` (`'pl_dev'`, `'golden-1'`, `56`), `tests/scenarios/w01-landfall.ts:11,30`, `shared/sim/src/data/terrain.ts:21`
- **What happens:** the backend exports its own `DEV_PLANET_RADIUS` with the same name as the sim's; changing the dev planet size or seed means finding five places.
- **Why it is like this:** the backend constant predates the sim export.
- **Workaround / mitigation:** none needed while all copies say 56.
- **To resolve:** import `DEV_PLANET_RADIUS` / `DEV_PLANET_SEED` from `@terra/sim` everywhere; move `capacity` next to them.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix (backend part, review-fix round 2026-11-01):** the backend no longer defines its own `DEV_PLANET_RADIUS`/`SEED`/`TYPE`: `home.repository.ts`, `prisma-home.store.ts` and `game.module.ts` import them from `@terra/sim`; capacity is one backend constant (`DEV_PLANET_CAPACITY`, `home.repository.ts`) used by boot too (no literal `radius: 56, capacity: 5`).
- **Not fixed because:** moving `capacity` next to the sim constants is in `shared/sim/src/gen/flat.ts` (SIM-ENGINE), and the client copies in `frontend/game/app/online/bootOnline.ts` are FRONTEND-APP's; status left Open for them. (Superseded: both done in the final pass, below.)
- **Fix (final pass 2026-11-01):** `DEV_PLANET_CAPACITY = 5` lives next to the other `DEV_PLANET_*` constants in `shared/sim/src/gen/flat.ts` (exported by `@terra/sim`); `home.repository.ts` and `game.module.ts` import it, and the generator's default spawn capacity (`DEFAULT_SPAWN_CAPACITY`, `gen/spawnSlots.ts`) is that constant. Test `shared/sim/test/gen/devPlanets.spec.ts` › "a dev planet seats DEV_PLANET_CAPACITY colonies, within the sim colony limit". The scenarios `w00` and `w01` use `DEV_PLANET_RADIUS` too (`tests/scenarios/w00-empty.ts`, `tests/scenarios/w01-landfall.ts`); the client's dev-planet fallback in `frontend/game/app/online/bootOnline.ts` was switched by FRONTEND in the same pass.
- **Fix (client, final pass 2026-11-01):** `frontend/game/app/online/bootOnline.ts` has no copy left: the local fallback builds its planet from `DEV_PLANET_RADIUS`, `DEV_PLANET_SEED`, `DEV_PLANET_CAPACITY` (now exported by the sim, `shared/sim/src/gen/flat.ts`) and `devPlanetIdFor`; the `/me/home` reader no longer invents `pl_dev` / `golden-1` / `56` defaults (it parses `HomeResponse`, FA-32). The backend now imports `DEV_PLANET_CAPACITY` from the sim too (`home.repository.ts`, `game.module.ts`). Still open: the scenarios write the radius as a literal (`tests/scenarios/w00-empty.ts:9`, `tests/scenarios/w01-landfall.ts:11`, `radius: 56`) instead of `DEV_PLANET_RADIUS` (scenarios are not frontend; reported to the final backend/shared pass).

### XC-04 · Client hard-codes the tick rate

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hud-min/MinimalHud.ts:23` (`tick / 5`), `frontend/game/store/WorldStore.ts:347` and `frontend/game/store/devHook.ts:27` (`tickMs: 200`)
- **What happens:** the HUD clock assumes 5 TPS instead of using `TICK_MS` (exported by `@terra/sim`, already used by `EntityMeshes.ts`) or the `tickMs` in the welcome message.
- **Why it is like this:** written when the rate was fixed.
- **Workaround / mitigation:** the rate is 5 TPS on every host today.
- **To resolve:** derive from `TICK_MS` (or the welcome `tickMs`).
- **Found:** 2026-11-01, cross-cutting review.
- **Partly done (review-fix round 2026-11-01, FRONTEND-APP):** `WorldStore.ts` (in-process `LocalHost` welcome) and `store/devHook.ts` now send `tickMs: TICK_MS`. Still open: `frontend/game/features/hud-min/MinimalHud.ts` (`tick / 5`) belongs to FRONTEND-FEATURES.

## Copy/paste: client
- **Fix (FRONTEND-FEATURES):** `MinimalHud.formatClock` divides by `TICKS_PER_SECOND` from `@terra/sim`; covered by `hud-min.spec.ts` › "formats game clock correctly at 5 Hz from tick".

### XC-05 · Five hand-written fake DOMs; two of them ship in production code

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hub-placement/dom.ts` (284 lines) and `frontend/game/features/terraform-basic/dom.ts` (238 lines): the same `MiniElement` shim (`:50`) and `ensureDom()` (`:215` / `:205`), ~200 lines identical after whitespace normalisation; `FakeElement` again in `frontend/game/app/online/bootFlow.spec.ts:12`, `frontend/game/features/hud-min/hud-min.spec.ts:16`, `frontend/game/features/landfall/landfall.spec.ts:14` (39 / 27 / 23-line identical windows between them)
- **What happens:** every feature spec grew its own DOM stand-in. The two `dom.ts` shims are imported by production modules, and production constructors call `ensureDom()` (`HubPlacementMenu.ts:96`, `hub-placement/index.ts:126`, `terraform-basic/index.ts:145`, `TerraformMenu.ts:26`, `TileOverlay.ts:235`), so test scaffolding is bundled into `/play.html` (a no-op in a browser because `document` exists). A fix to one shim (selector matching, `classList`, listeners) does not reach the others.
- **Why it is like this:** the vitest projects run in `node` without jsdom / happy-dom, and each issue wrote the minimum it needed.
- **Workaround / mitigation:** none; the shims pass the current specs.
- **To resolve:** one test-only module (e.g. `frontend/game/test/miniDom.ts`) installed from the vitest `setupFiles`, or `environment: 'happy-dom'` for `frontend/game`; drop `ensureDom()` from production code. Keep `makeDiv` / `makeBtn` (real helpers) in a UI util.
- **Found:** 2026-11-01, cross-cutting review (normalised 7-line window duplicate scan).
- **Partly done (review-fix round 2026-11-01, FRONTEND-FEATURES):** both shipped shims (`hub-placement/dom.ts`, `terraform-basic/dom.ts`) and the `ensureDom()` calls in production constructors are deleted; the feature specs that need a DOM run under jsdom via a per-file `// @vitest-environment jsdom` pragma (no vitest config change) with real `MouseEvent` / `KeyboardEvent`; the `FakeElement` copies in `hud-min.spec.ts` and `landfall.spec.ts` are gone (the landfall 3D tests moved to `landfall-scene.spec.ts`, plain Node); `makeDiv` / `makeBtn` / `setDataAttr` are in `features/shared/dom.ts`. Still open: `frontend/game/app/online/bootFlow.spec.ts` keeps its own `FakeElement` (FRONTEND-APP's file; the same pragma replaces it).
- **Fix (rest, final pass 2026-11-01):** `frontend/game/app/online/bootFlow.spec.ts` runs under jsdom (`// @vitest-environment jsdom`); its `FakeElement` and the `globalThis.document` / `window` shims are deleted. It and `OnlineSession.lifecycle.spec.ts` stub `HTMLCanvasElement.prototype.getContext` (null), so the jsdom "Not implemented: getContext" noise is gone from the run; `bootFlow.spec.ts` also stubs `requestAnimationFrame` away (as the old fake had none: the specs drive the sim, not the seconds-long touchdown animation). No hand-written fake DOM is left in `frontend/game`.

### XC-06 · Entity view rows decoded by raw offsets in five files

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** layout in `frontend/game/store/replica/viewCodec.ts:4-11` (`ENTITY_STRIDE`, `ENTITY_FIELDS` — the latter has no reader); decoders `frontend/game/features/hub-placement/GhostEvaluator.ts:127-139`, `frontend/game/features/landfall/selection.ts:92-107`, `frontend/game/app/online/EntityMeshes.ts:229-231,239,276-278`, `frontend/game/app/online/bootOnline.ts:381-393`, `frontend/game/features/entities/EntityLayer.ts:46-54`
- **What happens:** each consumer reads `buf[o + 8]` (hp), `buf[o + 10]` (state) and so on by number, and the two `Float32Array | ViewEntity[]` branches are repeated per file. Adding or reordering a column (likely when W02+ entities get more fields) breaks the five readers silently.
- **Why it is like this:** each feature issue added its own extraction.
- **Workaround / mitigation:** the layout has not changed since W00.
- **To resolve:** export named offsets (`E_HP = 8`, … generated from `ENTITY_FIELDS`) and one `readEntity(view, i)` / `forEachEntity` helper in `viewCodec.ts`; replace the five copies.
- **Found:** 2026-11-01, cross-cutting review.
- **Partly done (review-fix round 2026-11-01, FRONTEND-APP):** `store/replica/viewCodec.ts` exports `E` (column offsets generated from `ENTITY_FIELDS`; `ENTITY_STRIDE = ENTITY_FIELDS.length`), `EntityRow`, `readEntity(ents, i)`, `entityCount(ents, count?)` and `forEachEntity(ents, count, fn)` (both `Float32Array` and `ViewEntity[]`; `fn` returning `false` stops); `packEntities`, `app/online/EntityMeshes.ts` and the pod/HQ scan (moved from `bootOnline.ts` to `app/online/podStatus.ts`) use them. Still open: `features/hub-placement/GhostEvaluator.ts`, `features/landfall/selection.ts`, `features/entities/EntityLayer.ts` (FRONTEND-FEATURES).
- **Done in features (review-fix round 2026-11-01, FRONTEND-FEATURES):** `features/shared/placementWorld.ts` (ghost and brush) and `features/shared/hqView.ts` (HQ panel and top bar, ex `landfall/selection.ts`) read rows with `forEachEntity` / `EntityRow`; `features/entities/EntityLayer.ts` is deleted with the W00 layer (XC-07). No raw entity offsets are left under `frontend/game/features/`.
- **Fix (final pass 2026-11-01, e2e):** the e2e suites no longer read view rows by raw offsets either: `tests/e2e/w00.spec.ts` and `tests/e2e/w01.spec.ts` pass the client codec's `E` / `ENTITY_STRIDE` (and `ENTITY_KIND` / `ENTITY_STATE` from `@terra/sim/ecs/columns`) into `page.evaluate`. With the app and features parts above, no copy of the layout is left.

### XC-07 · Two entity renderers with two smoothing pipelines

- **Status:** Resolved (review-fix round 2026-11-01) — recommendation applied
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** W00 path `frontend/game/features/entities/` (`EntityLayer.ts`, `interp.ts` `INTERP_DELAY_TICKS = 2`, `blend.ts` 150 ms correction) for kind `devProbe`; W01 path `frontend/game/app/online/EntityMeshes.ts` + `entityMotion.ts` (`RENDER_DELAY_TICKS = 1.5`, `FOLLOW_PER_S = 20`) for HQ / pod / Hub; the split is `EntityMeshes.ts:224,242` (`hasEntityLayer` skips `devProbe`)
- **What happens:** two parallel systems interpolate entity poses with different delays and correction rules. `docs/dev/DEV_TOOLS.md:35` (`&predict=0`: "interpolated 400 ms behind") is only true for the W00 test entity; W01 units are always drawn 1.5 ticks (300 ms) behind on the shared `RenderClock`. AGENTS.md §6 asks for one renderer extended by registries.
- **Why it is like this:** W01 needed constant-speed walking and pod/hub staging; it was built beside the W00 feature instead of replacing it.
- **Workaround / mitigation:** the kinds are disjoint, so nothing is drawn twice.
- **To resolve:** owner: should `features/entities` be retired (move `devProbe` to `EntityMeshes` + `MotionTrack`)? Recommendation: yes, one pipeline, then fix the DEV_TOOLS line.
- **Found:** 2026-11-01, cross-cutting review.
- **Partly done (review-fix round 2026-11-01, FRONTEND-APP):** `EntityMeshes` draws every kind, `devProbe` included, as soon as the W00 layer (scene object `entities`) is not mounted, so deleting `features/entities` hands `devProbe` over with no app change; DEV_TOOLS `&predict=0` now names which renderer does what. Remaining (FRONTEND-FEATURES owns the folder): delete `features/entities` after moving what the app still imports from it: `Scene3dService` / `SimFrame` and the `scene3d` / `GameView.sim` declaration merge (`features/entities/services.ts`, used by `app/online/sessionHud.ts` and `features/hub-placement/GhostRig3D.ts`) and `lerpAngle` (`features/entities/blend.ts`, used by `app/online/entityMotion.ts`); then drop the `hasEntityLayer` guard in `EntityMeshes.syncView` and the `&predict=0` 400 ms sentence.
- **Fix (review-fix round 2026-11-01, FRONTEND-FEATURES):** `features/entities` deleted (W00 `EntityLayer`, `PoseBlender`, `SampleBuffer` and their specs); `Scene3dService`, `SimFrame`, the `scene3d` / `GameView.sim` declaration merge, `Pose` and `lerpAngle` moved to `features/shared/scene3d.ts` (imports updated in `app/online/sessionHud.ts`, `app/online/entityMotion.ts`, `hub-placement/GhostRig3D.ts`); the `hasEntityLayer` guard in `EntityMeshes.syncView` is dropped, so `EntityMeshes` draws every kind; `__online.entityMeshes()` (`viewportHelper.listSceneEntities`) now lists the `online-entities` group (meshes carry `userData.entityId`); DEV_TOOLS `&predict=0` names the one renderer. Side effect recorded as FF-32 (net stats "last correction" has no reporter now).

### XC-08 · Smaller client copies: pointer-to-tile resolver, view shapes

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `resolveCoord` in `frontend/game/features/hub-placement/HubPlacementMenu.ts:367-386` and `frontend/game/features/terraform-basic/BrushController.ts:357-371` (same pick → `data-q`/`data-r` fallback); `HqStatusView` (`frontend/game/features/landfall/selection.ts:6-22`) restates `HqUnitView` (`shared/sim/src/systems/hq/index.ts:17-35`) minus two fields; `ExtractedEntity` (`GhostEvaluator.ts:65-74`) restates `PlacementEntity` (`shared/sim/src/systems/construction/placement.ts:17-26`)
- **What happens:** a change to tile picking (e.g. ignoring UI overlays) has to be made twice; the type copies drift from the sim types without a compile error.
- **Why it is like this:** written in parallel issues.
- **Workaround / mitigation:** none needed today.
- **To resolve:** one `resolvePointerTile(ev, pickTile)` helper; `Omit<HqUnitView, ...>` / import `PlacementEntity`.
- **Found:** 2026-11-01, cross-cutting review.

## Copy/paste: backend, sim and tests
- **Fix:** one `resolvePointerTile(ev, pickTile)` (`features/shared/pointer.ts`) used by the Hub placement, the brush and landfall; `HqStatusView = Omit<HqUnitView, 'workRate' | 'viewRadius' | 'currentJob'> & { currentJob: HqPanelJob }` (`features/shared/hqView.ts`); `ExtractedEntity` is gone, the ghost and the brush use the sim's `PlacementEntity` / `placementWorldFromState` via `features/shared/placementWorld.ts`. Covered by the hub-placement, terraform and landfall specs.

### XC-09 · Progression event batching written twice

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/progression-events.service.ts:67-113` (`aggregateTileEvents`) and `:115-165` (`aggregateObstacleEvents`); event payload shapes again in `backend/app/src/bus/channels.ts:15-68`
- **What happens:** the two functions are the same accumulator (resolve player, key, count, last q/r, map to an event with the fields duplicated into `data`) differing only in the key and one field; the achievement names `'Groundbreaker'` / `'Stone Mason'` are literals in code.
- **Why it is like this:** the obstacle variant was copied from the tile one.
- **Workaround / mitigation:** both are covered by `backend/app/test/unit/progression-events.spec.ts`.
- **To resolve:** one generic `aggregate(kind, keyOf, extra)`; achievement names into a data row (balance/content belongs in data).
- **Found:** 2026-11-01, cross-cutting review.
- **Fix:** `aggregateTileEvents`/`aggregateObstacleEvents` merged into one `aggregateCounts(kind, …)` whose key fields come from a per-kind table (`op` for `obstacleRemoved`); the achievement names live in the data table `PROGRESSION_ACHIEVEMENTS` (`backend/app/src/game/progression-achievements.ts`), not in code; test `progression-events.spec.ts` › "batches multiple tilePrepared and obstacleRemoved events in the same step per (colonyId, op)" now asserts the exact batch shape of both kinds.

### XC-10 · "Try Postgres, swallow the error, fall back to memory" copied into every repository method

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** PLAUSIBLE (the duplication itself is confirmed: 34 copies; the split-brain consequence is not reproduced)
- **Area / code:** `backend/app/src/core/home/home.repository.ts` (20 `catch {}` blocks, 486 lines), `backend/app/src/core/auth/auth.repository.ts` (14), e.g. `auth.repository.ts:49-51,65-67`, `home.repository.ts:95-106`
- **What happens:** each method repeats `if (this.dbEnabled && this.prisma) { try { … } catch { /* fall through */ } } return memory…`. Besides the copy/paste, a transient DB error silently answers from (and writes to) the per-process in-memory maps, so a seat or session can exist only in memory and disappear on restart or differ between app instances.
- **Why it is like this:** the in-memory store lets unit tests run without Postgres.
- **Workaround / mitigation:** single app process in dev.
- **To resolve:** split into a Prisma repository and an in-memory repository behind one port (chosen at module wiring, like `LedgerStore`), and let DB errors surface. The backend area review should judge the failure semantics.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix:** split into stores behind one port each, chosen once at construction (like `LedgerStore`): `AuthStore` (`PrismaAuthStore` / `MemoryAuthStore`) and `HomeStore` (`PrismaHomeStore` / `MemoryHomeStore`); the repositories hold the rules (handle retry, dev planet family, colony cache) and no `catch {}` is left, so database errors surface (BE-03). `home.repository.ts` 486 → ~190 lines. Tests: `test/unit/auth-hardening.spec.ts` › "database errors propagate (BE-03)" plus the existing auth/home suites.

### XC-11 · Dev-only 404 gate re-implemented per controller

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/dev-planets.controller.ts:7-9` (`assertDevOnly`, added on this branch), inline copies in `backend/app/src/scenarios/scenarios.controller.ts:12`, `backend/app/src/dev/dev.controller.ts:11`, `backend/app/src/near/infrastructure/dev/chain-explorer.controller.ts:53-54`, `backend/app/src/near/infrastructure/dev/mock-chain-read.ts:8-9`
- **What happens:** five slightly different checks (`NODE_ENV === 'production'`, `registry.enabled`, plus mock-adapter checks); a new dev route can forget it.
- **Why it is like this:** each module added its own before `assertDevOnly` existed.
- **Workaround / mitigation:** every current `/v1/dev/*` route has a check.
- **To resolve:** a `DevOnlyGuard` applied to every `dev/*` controller (and a test that enumerates `dev` routes in production mode).
- **Found:** 2026-11-01, cross-cutting review.
- **Fix:** `DevOnlyGuard` (`backend/app/src/core/dev-only.guard.ts`) applied at controller level to every `dev*` controller; the inline gates are removed (`requireMockChainRead` keeps only its mock-adapter check). Test `backend/app/test/core/dev-routes.spec.ts` enumerates the mapped `/v1/dev` routes in production and asserts 404.

### XC-12 · Test host factories copied into every spec

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `createW01Host` in `shared/sim/test/systems/{territory-claim,hub-placement,landing,hub-construction,hq,linked-prep,terraform-basic}.spec.ts:30-34`, `shared/sim/test/systems/dev.spec.ts:23` (`w01Host`), `backend/app/test/unit/progression-events.spec.ts:35`
- **What happens:** nine copies of "new `SimHost` with `..01` flags + flat planet"; `shared/sim/test/units/helpers.ts` and `economy/helpers.ts` already exist as the place for this.
- **Why it is like this:** each issue's spec was self-contained.
- **Workaround / mitigation:** none needed.
- **To resolve:** `shared/sim/test/helpers/host.ts` exporting `w01Host({ seed, radius, type })`.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix (sim side):** `shared/sim/test/helpers/host.ts` exports `w01Host({ seed, radius, type, data })` and `playerCmd`; every sim spec that had its own factory (`territory-claim`, `hub-placement`, `landing`, `hub-construction`, `hq`, `linked-prep`, `terraform-basic`, `dev`, `units/helpers`) uses it. Left for BACKEND: `backend/app/test/unit/progression-events.spec.ts:35`.
- **Fix (backend, final pass 2026-11-01):** `backend/app/test/unit/progression-events.spec.ts` builds its host with the sim's `w01Host` (`shared/sim/test/helpers/host.ts`); no factory copy is left.

### XC-13 · Small enumerations and converters written out per kind

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/tileModel.ts:90-134` (`terrainIdFromKey` / `terrainKeyFromId` / `prepIdFromKey` / … : three identical pairs); terraform op list in `shared/contracts/src/ws/sim.ts:56` (`W01_TERRAFORM_OPS`), again in `shared/sim/src/systems/terraform-basic/queue.ts:12,55` and `shared/sim/src/systems/construction/prep.ts:62`
- **What happens:** adding an op (W05 Level / Fill) or a terrain key means editing several lists by hand.
- **Why it is like this:** written per issue.
- **Workaround / mitigation:** none needed.
- **To resolve:** a generic `keyCodec(keys)`; derive `TerraformOpKind` and the validation set from the contracts constant.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix (sim side, review-fix round 2026-11-01):** `TerraformOpKind` is the contracts' `TerraformOp` and the op set is `W01_TERRAFORM_OPS` (`terraform-basic/ops.ts`); the op lists in `queue.ts` / `prep.ts` are gone (the prep planner chains ops from the `opsBasic` rows). Still open: the per-kind key converters in `grid/tileModel.ts` (SIM-ENGINE area).
- **Fix (final pass 2026-11-01):** one generic `keyCodec(what, table)` in `grid/tileModel.ts` derives the key list (sorted by code, checked to be `0..n-1`) and both converters from each enum table; `TERRAIN_KEYS`, `terrainIdFromKey`, … are kept as named exports of it (public API for tools). The tables themselves are the contracts' (RN-06). Covered by `shared/sim/test/grid/tile-model.spec.ts`.

## Unused and dead code

### XC-14 · Lint does not check unused code in `frontend/`; unused symbols in branch files

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/config/eslint.config.js:22-25` (`@typescript-eslint/no-unused-vars: 'off'` for all of `frontend/**`, "the prototype predates the linter"); `tsc --noUnusedLocals --noUnusedParameters -p frontend/tsconfig.json` finds in branch-changed files: `frontend/game/features/hub-placement/HubPlacementMenu.ts:71,78` (`billEl`, `cancelBtn` fields assigned, never read), `frontend/game/features/hud-min/MinimalHud.ts:138` (`latestTick` written, never read), `frontend/game/features/hud-min/hud-min.spec.ts:2` (`parseWaves`), `frontend/game/app/online/bootFlow.spec.ts:4` (`ENTITY_STATE`); untouched by the branch but in branch files: `frontend/render/kitbash/archetypes/buildings/rocket.ts:4-5`, `tech.ts:4`, `industry.ts:4`, `frontend/game/app/RTSCamera.ts:20`. All other workspaces (`shared/*`, `backend/app`, `tests/scenarios`, `tests/e2e`, test tsconfigs) are clean.
- **What happens:** all W01 frontend code (the largest part of the diff) is exempt from the unused-variable rule, so dead fields accumulate in files already at the 500-line limit.
- **Why it is like this:** a blanket exemption made for the pre-linter prototype.
- **Workaround / mitigation:** none.
- **To resolve:** scope the exemption to the prototype folders (`frontend/game/app/Game.ts`, `descent/`, `landing/`, `playground/` …) or turn on `noUnusedLocals` in `shared/tsconfig.base.json` (or `frontend/tsconfig.json`); remove the symbols above.
- **Found:** 2026-11-01, cross-cutting review (`tsc --noUnusedLocals` on every workspace tsconfig).
- **Fix (final pass 2026-11-01):** `shared/config/eslint.config.js` turns `@typescript-eslint/no-unused-vars` on for `frontend/**` (error; `_`-prefixed args / vars ignored, caught errors not checked), the same options as the rest of the repo. The symbols listed above were already removed by the area fixers; the last two `tsc --noUnusedLocals --noUnusedParameters` hits (`frontend/landing/colony/ColonyScene.ts` field `tiles`, `frontend/landing/resources/ResourceViewer3D.ts` parameter property `stageEl`) are fixed, and the new rule caught unused imports in `hud-min.spec.ts`. `npm run lint` and `npm run typecheck` (with `--noUnusedLocals`) are clean. (Unused class members are not an ESLint rule; `tsc --noUnusedLocals` is what finds them.)

### XC-15 · Dead exports and orphan files added on the branch

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** no importer anywhere: `tests/scenarios/w01-landfall.ts:25` (`w01AutoPlaceScenario`, never registered: `tests/scenarios/index.generated.ts` takes only the default export), `frontend/game/store/replica/viewCodec.ts:11` (`ENTITY_FIELDS`), `shared/contracts/src/rest/home.ts:21,36` (`PlanetSummarySchema`, `ColonySummarySchema` aliases), `shared/sim/src/grid/tileModel.ts:196` (`terrainMoveMultiplier`), `shared/sim/src/systems/construction/validate.ts:62-72` (`findAliveColonyHqRow`, also uncovered); used only by tests: `validate.ts:107-117` (`validateHubPlacement`, a dual-signature wrapper), `validate.ts:49` (`hasColonyHub`); orphan barrels `frontend/game/features/index.ts` and `frontend/game/features/define.ts` (new, nothing imports them; features load through `import.meta.glob('../../features/*/index.ts')`, and the barrel omits several features); data fields with no reader: `hub.t1.pylonSpan`, `pylonMaxLoad`, `powerDrainPerS`, `hq.t1.selfPreservationHpRatio`, `cellCapacityE`, `cellFastRechargeShedGroup`, `gridDrawPerS`, `hq.startingKit.autoPlaceIdleS` / `designAutoPlaceIdleS` (W01-18 deferred).
- **What happens:** dead API surface looks supported (the scenario looks loadable, the barrel looks like the public entry, the data fields look tunable).
- **Why it is like this:** leftovers from refactors (D-37 replaced the old placement checks) and reservations for later waves.
- **Workaround / mitigation:** none needed.
- **To resolve:** delete the dead code; either register `w01-auto-place` with W01-18 or delete it; mark reserved data fields with a comment naming their wave (and exclude them from the reader check proposed in XC-01). `defineTileLayer` (`shared/sim/src/grid/layers.ts:25`) has no caller but is a documented extension point (`shared/sim/README.md:24`): keep.
- **Found:** 2026-11-01, cross-cutting review (grep-based export/importer scan).
- **Fix (final pass 2026-11-01):** re-ran the export sweep over `shared/` and `backend/app/src` (every `export const|function|class|type|interface` grepped repo-wide outside its file). Deleted: `w01AutoPlaceScenario` (`tests/scenarios/w01-landfall.ts`, never registered; W01-18 is deferred), `PlanetSummarySchema` / `ColonySummarySchema` aliases (`shared/contracts/src/rest/home.ts`), `buildView` (alias of `view`, `shared/sim/src/host/view.ts`), `resolveTerraformOpForTile` (`systems/terraform-basic/queue.ts`), the `EntityKindCode` / `EntityStateCode` types (`ecs/columns.ts`). Already gone in this round: `terrainMoveMultiplier`, `findAliveColonyHqRow` / `validateHubPlacement` (`validate.ts` deleted), the client barrels `features/index.ts` / `define.ts`; `ENTITY_FIELDS` now has readers (XC-06); the unread data fields are listed as reserved by the XC-01 data check. Kept on purpose: `defineTileLayer` / `defineEntityColumn` (documented extension points, now tested: `shared/sim/test/kernel/extension-points.spec.ts`), Nest modules (loaded by module discovery), W00 API still named in docs (`EnvelopeHead`, `TERMINAL_CLOSE_CODES`, `RestErrorCode`, `CoreUnauthorized` / `CoreForbidden`, `EMPTY_DATA`, `SLOT_NAMES`, `typedArrayTag`), the tile key converters (public API, XC-13), `hasColonyHub` (query helper used by specs). No orphan source file is left in `shared/`, `backend/app/src` or `tests/scenarios/`.

### XC-16 · `GET /v1/v1/me/home` also answers

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/home/home.controller.ts:12` (`@Controller(['me', 'v1/me'])`) with `app.setGlobalPrefix('v1')` (`backend/app/src/app.ts:50`)
- **What happens:** the home route is served at `/v1/me/home` and at `/v1/v1/me/home`. Only the first is documented or used.
- **Why it is like this:** probably added while the global prefix was being wired.
- **Workaround / mitigation:** harmless alias.
- **To resolve:** `@Controller('me')`.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix:** `@Controller('me')` (`backend/app/src/core/home/home.controller.ts`); test `backend/app/test/core/dev-routes.spec.ts` › "the home route is mounted once…".

## Debug leftovers

### XC-17 · `console.log('[pick]')` now runs every frame while the Hub ghost is open

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/viewportHelper.ts:76` (`pickTerrainAt`); called via `OnlineSession.pickAt` (`OnlineSession.ts:432-433`) from the hub ghost's per-frame `update` (`frontend/game/features/hub-placement/index.ts:233-234`) and the terraform brush drag (`BrushController.ts:385-387`); also `shared/sim/test/systems/prepared-ground.property.spec.ts:353` logs on every test run
- **What happens:** on `main`, `pickAt` had no per-frame caller; on this branch the placement ghost calls it every animation frame, so the browser console gets ~60 lines per second while placing a Hub (and every pointer move while brushing), drowning real errors during QA. Lint does not catch it (no `no-console` rule).
- **Why it is like this:** a debug line from the first tile-picking commit, moved with the function.
- **Workaround / mitigation:** none.
- **To resolve:** delete the log (keep `lastPick` on `window.__online` for debugging); consider `no-console: ['error', { allow: ['warn', 'error'] }]` for `frontend/game` and `shared/`.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix:** the log in `pickTerrainAt` is deleted (FA-23); `lastPick` stays on `window.__online`. Not in this fix: the log in `shared/sim/test/systems/prepared-ground.property.spec.ts:353` (SIM-GAMEPLAY) and the `no-console` lint rule (cross-cutting XC-14 pass).

## Tests
- **Feature-side caller (FRONTEND-FEATURES):** the Hub ghost renderer (`hub-placement/ghostRenderer.ts`) picks only when the pointer moved and at most every 150 ms while it rests (not every frame), and the brush picks on drag moves only, deduped per tile; test `hub-placement-input.spec.ts` › "picks the tile under the pointer when it moves (not every frame)…".

### XC-18 · Coverage of the branch: weakest changed files

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** measured with `vitest --coverage` per package (unit projects, no Postgres): `shared/sim` 96.4 % lines / 82.7 % branches, `shared/ledger` 100 %, `backend/app` 79.9 % / 63.5 %, `frontend/game` 67.3 % lines. Weakest branch-changed files: backend `game/ledger/prisma-ledger-store.ts` 17 % (covered by `test/game/ledger.int.spec.ts`), `core/auth/auth.repository.ts` 51 % (one `auth.int.spec.ts` test), `core/home/home.repository.ts` 55 % (its Prisma seat paths are exercised by **no** spec, unit or integration), `game/persistence/snapshot-store.ts` 54 %, `game/thread/planet-host.ts` 61 %, `ws/sim-command-ingress.ts` 69 %; sim `systems/construction/validate.ts` 64 % (`insufficient_resources` branch `:95-97` uncovered), `ecs/columns.ts:56-61` and `grid/layers.ts:26-31` (the `defineEntityColumn` / `defineTileLayer` extension points) 0 % branches, `systems/territory-claim/index.ts` 57 % branches; client `app/Game.ts` 0 % (prototype), `app/online/viewportHelper.ts` 29 %, `app/RTSCamera.ts` 51 %, `app/online/unitControl.ts` 56 %, `app/online/OnlineSession.ts` 68 %. Sim files with no dedicated spec (`grid/geo.ts`, `units/movement/locomotion.ts`, `systems/terraform-basic/work.ts`, `gen/world/stages/reliefDesert.ts`) are covered indirectly.
- **What happens:** the Postgres seat assignment (capacity, concurrent seats, D-38 retype of old dev planets in `fixDevPlanetType`) is the least tested W01 server path.
- **Why it is like this:** unit tests run without a database; integration specs were written for ledger and snapshots.
- **Workaround / mitigation:** e2e `npm run e2e -- --waves ..01` seats real guests.
- **To resolve:** a `home.int.spec.ts` (seat, full planet, two concurrent guests, retype); a unit test for the `insufficient_resources` placement branch.
- **Found:** 2026-11-01, cross-cutting review.
- **Partly done (final pass 2026-11-01, backend and shared):** `backend/app/test/core/home-store.int.spec.ts` (Postgres: capacity and the next planet of the family, seat counts, rollback and the `(planetId, colonyIndex)` unique row, the D-38 retype of an empty old row and not of an inhabited one, reads from a fresh repository); `planet-host.ts` failure path and `detail` (`test/game/planet-down.spec.ts`), `sim-command-ingress.ts` reject detail and unregistered codes (`test/ws/ingress-colony.spec.ts`), seating on `planet_full` (`test/unit/home-seat-reject.spec.ts`); the sim extension points `defineTileLayer` / `defineEntityColumn` (`shared/sim/test/kernel/extension-points.spec.ts`); `systems/territory-claim/index.ts` is at 79 % branches now. The `insufficient_resources` placement branch no longer exists (GP-30), and `validate.ts` is gone. Concurrent guests are serialised by `HomeService`'s seat lock (`withSeatLock`) in one process; several app processes are out of W01 scope.
- **Earlier note:** the client files belonged to FRONTEND-APP; done in the final frontend pass below.
- **Fix (client, final frontend pass 2026-11-01):** jsdom specs with exact assertions: `app/online/viewportHelper.spec.ts` (changed-tile diff, planet look by sim type / orbit pick, stored orbit pick incl. junk and throwing storage, save-on-hide listeners and their cleanup, Escape held by the hub ghost / dev console, space terrain offset, pick NDC and tile projection on a stub viewport, scene entity list, headless viewport), `app/online/unitControl.spec.ts` (X stop key incl. typing / modifier / repeat guards and dispose, target flash, one no-path toast through a real in-process host, rollback and pose-correction counters), `app/RTSCamera.spec.ts` (FOV / elevation, key pan, Shift, keyup / blur, Q/E 90° turns, wheel clamp, middle-drag and edge pan, disabled camera, map clamp, follow / F / manual pan, dispose), and the FA-07 fallback specs (`app/online/localFallback.spec.ts`, `OnlineSession.lifecycle.spec.ts` › "the fallback is the in-process LocalHostCore…"). Line coverage (`npx vitest run --project @terra/game --coverage`, same command before / after): `viewportHelper.ts` 45.8 % → 97.2 %, `RTSCamera.ts` 77.5 % → 100 %, `unitControl.ts` 76.5 % → 94.1 %, `OnlineSession.ts` 79.3 % → 79.4 % (FA-07 also changed it; its uncovered lines are the space-descent hand-off and terrain rebuild that need a WebGL viewport). `app/Game.ts` (the prototype page) stays at 0 %: it builds a WebGL viewport (`createColonyViewport`) in its constructor and is not unit-testable without one (manual QA: `/play.html?planet=dune&skip=1`). The client caller of `construction/validate.ts` no longer exists (the file is gone, GP-30).

## Docs vs code

### XC-19 · Owner check guide: pre-Hub caps are `600/600`, not `600/500`; the HUD spec fakes the caps

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `docs/plan/checks/w01-check.md:27` (**Metals `600/500`**); code `shared/sim/src/economy/caps.ts:13` (`INITIAL_CAPS.metals = 600`), set at landing `shared/sim/src/systems/landing/index.ts:177`, copied to the view by `shared/sim/src/host/view.ts:50`, shown by `frontend/game/features/hud-min/MinimalHud.ts:309-311`; the spec `frontend/game/features/hud-min/hud-min.spec.ts:158-162` hand-writes `caps: { metals: 500, … }` and asserts `600 / 500` (`:204`)
- **What happens:** the owner will see `600 / 600` after landing and report a mismatch; the HUD unit test passes because it feeds caps the sim never produces.
- **Why it is like this:** the guide and the spec fixture both assume a 500 metals cap before the Hub; the sim's landing hold cap is `INITIAL_CAPS.metals = 600` (so the 600-metal cargo fits).
- **Workaround / mitigation:** e2e checks only the post-Hub caps (`tests/e2e/w01.spec.ts:229,247`), which are right.
- **To resolve:** fix the guide line to `600/600`; build the spec's colony from `INITIAL_CAPS` (or a real landed host).
- **Found:** 2026-11-01, cross-cutting review.
- **Partly done (final pass 2026-11-01):** the guide line now reads **Metals `600/600`** (pre-Hub caps come from `hq.startingKit.storageCaps` 600 / 500 / 500); the post-Hub line and the e2e steps 5–6 expect `/ 600` for metals, because Hub completion keeps each cap at `max(current, 500)` (GP-11) — the e2e suite failed on the stale `/ 500` before this pass.
- **Not fixed because:** the HUD spec fixture (`frontend/game/features/hud-min/hud-min.spec.ts`, hand-written `caps: { metals: 500, … }`) belongs to FRONTEND-FEATURES; build it from `initialCaps(compileData(…))` or a landed host.
- **Fix:** the check guide reads `600/600` (final shared pass); `frontend/game/features/hud-min/hud-min.spec.ts` builds the colony caps from the sim (`initialCaps()`) and asserts against them instead of a hand-written `500` fixture.


### XC-20 · `?host=local` without `scenario` opens the prototype, not the local engine

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/onlineMode.ts:23` (`if (host === 'local' && !scenario) return null;` → `main.ts` starts the prototype `Game`), asserted by `frontend/game/app/online/bootFlow.spec.ts:427`; docs `docs/dev/DEV_TOOLS.md:31` ("Without `scenario`, uses `w00`") and `README.md:118`
- **What happens:** `/play.html?host=local` shows the orbit picker of the prototype; the documented default `w00` (`localHostOptions`, `frontend/game/app/online/localHost.ts:10`) is unreachable from the page.
- **Why it is like this:** W01-38 routed the bare URL to the world picker on purpose (comment `onlineMode.ts:9`); the docs were not updated.
- **Workaround / mitigation:** use `?host=local&scenario=w00|w01` (the guide and CLAUDE.md already do).
- **To resolve:** update DEV_TOOLS line 31 and README line 118 (or route it to the local engine with `w01` if that is what the owner wants).
- **Found:** 2026-11-01, cross-cutting review.
- **Fix:** DEV_TOOLS `?host=local` row and README line 118 now say `scenario` is required and `?host=local` alone opens the prototype world picker (FA-26).

### XC-21 · Smaller doc drifts: test counts, dev planet wording, undocumented QA parameters

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/plan/checks/w01-check.md:58` says `npm test` = 93 suites / 500 tests (today 141 files / 872 tests, all green); `docs/dev/DEV_TOOLS.md:122` calls boot dev planets "Flat" (W01 boots them as `desert`, `backend/app/src/game/game.module.ts:140-142`); `/play.html` parameters `autodeploy`, `menutime`, `qat`, `t` (`frontend/game/app/Game.ts:73-106`) are not in DEV_TOOLS although `onlineMode.ts:19` now routes on `autodeploy` / `menutime` (they predate the branch), and `skip=1` on the online boot (`OnlineSession.ts:107`) is only implied.
- **What happens:** readers of DEV_TOOLS cannot find the QA capture parameters; the guide's "already green" counts look stale.
- **Why it is like this:** docs written mid-wave.
- **Workaround / mitigation:** none needed.
- **To resolve:** add the rows; drop the hard-coded test counts from the guide (they go stale every commit).
- **Found:** 2026-11-01, cross-cutting review.
- **Fix (final pass 2026-11-01):** the guide no longer hard-codes test counts ("every vitest project green"); DEV_TOOLS `GAME_DEV_PLANETS` names the desert `pl_dev…` family with W01 (flat W00 planet without); DEV_TOOLS has rows for `&skip=1` (prototype and online boot), `&t=<s>`, `?autodeploy=<ms>` / `&qat=<s>` and `?menutime=<s>`. The same pass fixed the other DEV_TOOLS drifts a full re-read found (production gating of the console and pages, `/play.html` seating by the remembered pick, the `w01` scenario starting with the pod descending, `&dev=1`, `cell` bounds, `already_landed` per command, HUD toasts without shortfall numbers (GP-30), HQ job names, `/v1/me/home` has no W01/W11 gate, ledger store in memory without persistence, `AI_LIVE=1`).

## Structure

### XC-22 · Several W01 files sit at the 500-line limit

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hub-placement/HubPlacementMenu.ts` (499), `frontend/game/app/online/OnlineSession.ts` (499), `frontend/game/app/online/bootOnline.ts` (493), `shared/sim/src/systems/construction/index.ts` (490), `shared/sim/src/gen/spawnSlots.ts` (486), `backend/app/src/core/home/home.repository.ts` (486)
- **What happens:** `npm run check:structure` passes, but the next feature touching these files must extract first. `HubPlacementMenu.ts` carries two unused fields (XC-14) and a copied resolver (XC-08) that would free space.
- **Why it is like this:** the limit is enforced as a hard cap.
- **Workaround / mitigation:** none needed.
- **To resolve:** when next touched, split by AGENTS.md §6 (parts under a subfolder), never by compressing lines.
- **Found:** 2026-11-01, cross-cutting review.
- **Fix (final pass 2026-11-01):** re-measured: `HubPlacementMenu.ts`, `bootOnline.ts`, `construction/index.ts` and `home.repository.ts` (now ~200 lines, XC-10) were already split in this round; `shared/sim/src/gen/spawnSlots.ts` (485) is split into `spawnSlots.ts` (generation, 345), `spawnGuarantee.ts` (the `UO-TF-09` check `validateSpawnSlotGuarantee`) and `spawnDisk.ts` (disk / footprint helpers both use); covered by `shared/sim/test/gen/spawnSlots.spec.ts`. No file in `shared/`, `backend/`, `tests/scenarios/`, `tests/e2e/` is over 480 lines. Left for FRONTEND-APP: `frontend/game/app/online/OnlineSession.ts` is over 500 lines at the time of this pass (over the limit: `npm run check:structure` fails) and `OnlineSession.lifecycle.spec.ts:83` has a 106-line function.

## Cross-area findings (added by the lead)

### XC-23 · DEV_TOOLS describes `tp` and `land` differently from the handlers

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/dev/DEV_TOOLS.md` (~L68-69) vs `shared/sim/src/systems/dev/{index,land}.ts`
- **What happens:** `tp` can move another colony's HQ (the doc implies your own); `land` without coordinates on an already-landed colony is acked silently (not rejected `already_landed`); the cargo is credited when the pod is created, not when `land` deposits it.
- **To resolve:** correct the two rows (or the handlers, if the doc is the intended behaviour).
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** the handlers changed to match the documented behaviour (GP-26, GP-27): `land` / `dev.land` act for the caller's colony only and reject `already_landed` once the pod is open, with or without coordinates; `tp` / `cell` never fall back to another colony's HQ (`unknown_entity`), `dev.teleport { id }` refuses another colony's entity (`not_own_colony`); the DEV_TOOLS rows say so and that the cargo is credited when the pod is created. Re-checked against `shared/sim/src/systems/dev/{index,land}.ts` in the final pass; the `already_landed` sentence now also says when `system.spawnColony` rejects it (the colony already has a pod or a landing).


### XC-24 · Specs and READMEs described W00–W01 differently from the built code

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/spec/{SIMULATION,PROTOCOL,DECISIONS}.md`, `shared/sim/README.md`, `shared/ledger/README.md`, `backend/app/src/near/README.md`
- **What happens:** a full re-read against the code found, among others: `step()` signature and result, `cmd.rejected` events (rejections are command outcomes with an optional `detail`), a stale reject code list, `INITIAL_CAPS`, "storage +500 per family", `colonyFounded` at landing, `planetFaulted` / `FAULTED`, "server-private fields do not exist", JSON-only frames (welcome / delta are MessagePack since D-31), one socket per colony, origin allow-list, close-code reasons, sim-thread message shapes, `GET /me`, the `@terra/eslint-config/sim` rule name, the state layout, terrain mixes, the W01 starting kit, the ledger living in sim state, `MOCK_CHAIN_CONFIG` provided by a module, placement rejecting for cost.
- **Fix (final pass 2026-11-01):** each statement corrected in place, or marked as the target with an "As built (W01)" note where the spec deliberately describes later waves (PROTOCOL §4.3 / §4.5, SIMULATION §5 state block, §7.3 starting kit, §13 test matrix, `SIM-H-04` / `SIM-H-07` marked W09); DECISIONS stays append-only and got an "Amendments — as built" section (D-02, D-23 / D-24, D-37, D-38, D-39).
- **Found:** 2026-11-01, final cross-cutting pass (doc audit)

### XC-25 · `?scenario=w00` page errors: the test entity maps to a missing archetype

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (e2e `w00.spec.ts` step 2 fails with 20+ `ArchetypeCatalog: unknown "robot.scout"` page errors; the later W00 steps do not run)
- **Area / code:** `frontend/game/app/online/EntityMeshes.ts` (`archetypeForKind`: kind 1 `devProbe` → `'robot.scout'`), `frontend/render/kitbash/catalog.ts` (`get` throws on an unknown id)
- **What happens:** since XC-07 `EntityMeshes` draws `devProbe` too, and no `robot.scout` archetype is registered (robots: hero, miner, builder, combat), so every view sync with the W00 test entity throws. DEV_TOOLS says `spawn` draws it "as the builder robot".
- **To resolve:** map kind 1 to `robot.builder` (or register `robot.scout`) and add a unit test that every kind's archetype exists in the catalog.
- **Not fixed because:** `frontend/**` belongs to the FRONTEND final fixer in this pass.
- **Found:** 2026-11-01, final cross-cutting pass (`npm run e2e`)
- **Fix:** `archetypeForKind` (`frontend/game/app/online/EntityMeshes.ts`) maps `devProbe` and unknown kinds to the registered `robot.builder` archetype instead of the unregistered `robot.scout`; `?scenario=w00` renders without page errors (W00 e2e).

### XC-26 · Root directory clutter & `D-37` numbering collision between `main` (W26) and `wave/w01-landfall`

- **Status:** Resolved (root reorganization 2026-11-02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** repository root (`vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `.prettier*`, `vitest*.config.ts`, `.env.example`, `.dockerignore`, `e2e/`, `scenarios/`) and `docs/spec/DECISIONS.md` (`D-37` defined on `wave/w01-landfall` as single placement rule `evaluatePlacement` and on `main` as `terraagent.fun` hosting)
- **What happens:** config files, test directories, and runtime outputs (`dist/`, `.dev/`, `coverage/`) accumulated in the repository root, and merging `main` (W26) into `wave/w01-landfall` produced a `D-37` numbering collision.
- **Why it is like this:** W01 and W26 were authored in parallel worktrees (`D-37` was the next free decision number in both).
- **Workaround / mitigation:** none needed once resolved.
- **To resolve:** renumber W26 hosting to `D-40`, record the 7-domain clean root layout (`backend/`, `docs/`, `frontend/`, `infra/`, `scripts/`, `shared/`, `tests/`) as `D-41`, move all root configs/tests into their domain directories, and update all scripts, configs, plans, waves (`W00`–`W26`), specs, and agentic files.
- **Found:** 2026-11-01, root reorganization & W26 merge.
- **Fix (2026-11-02):** merged `main` (W26 + 3 untracked docs from `main`), renumbered W26 hosting to `D-40`, added `D-41` in `docs/spec/DECISIONS.md`, moved `e2e/` and `scenarios/` + `vitest*.config.ts` into `tests/`, `vite.config.ts` + `tsconfig.json` into `frontend/` (with build output in `frontend/dist/`), `tsconfig.base.json` + `eslint.config.js` + `.prettier*` into `shared/` (`shared/config/`), `.env.example` + `.env.worktree` + `Dockerfile.*.dockerignore` into `infra/`, and `.dev/` into `scripts/dev/.out/`, with backward-compatible env fallbacks and two full audit/verification passes across all code, plans, waves, and specs.


## Found in the W02 review (rounds 1–2)

### XC-27 · Two resolvers for W02 building rows, and two `resolveBuildingRow` functions

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/buildingRows.ts` (`resolveBuildingRow`: Hub + Extractor + Solar with their names and aliases, own default data), `shared/sim/src/systems/construction/placement.ts` (`resolveBuildingRow`: Hub only; `resolveEconomyBuildingRow` + `W02_BUILDING_ALIASES` for the W02 rows)
- **What happens:** the W02 build path and the placement rule map a building name to its row in two places with two alias lists (`extractor` / `metalsExtractor`, `solar` / `solarCollector`). The two exported `resolveBuildingRow` share a name but differ in scope and return type (`{ row, entityKind }` vs `CompiledRow`, Hub only), so an import from the wrong module compiles and answers `null` for an Extractor. A new W02 building must be added to both.
- **To resolve:** one resolver (name → row, entity kind, placement rule) in one module; rename or remove the Hub-only one.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### XC-28 · Two Units-lane implementations

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/factories-hub/index.ts` (queue, `enqueueHubUnit`, production loop, slot 9), `shared/sim/src/systems/queue/step.ts` (`buildUnit` entries, `finishUnit` → `produceWorkerAtHubEdge`)
- **What happens:** Worker Drone T1 production exists twice: the W02 queue's Units lane and the older factories-hub queue, each with cost, progress, count / repeat and cancel handling. Only the queue has a live caller; both write `col.unitQueue` (GP-62).
- **To resolve:** remove the factories-hub queue (keep its spawn helper) or route the lane through it; one implementation.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### XC-29 · `cancelTask { taskId: 'all' }` cancels only one W01 construction order and one terraform order

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/queue/cancel.ts` (`cancelAllColonyTasks`: `cancelConstructionOrder(…, 'current')`, `cancelTerraformOrder(…, 'active')`)
- **What happens:** "cancel all" clears every W02 queue entry, building job, Hub unit, Worker Drone T1 task and work job of the colony, but for W01 orders it uses the lane wildcards, which name one order each: the open construction order (`'current'`) and the first manual terraform order (`'active'`). Other W01 terraform orders stay queued.
- **To resolve:** loop over `constructionOrdersOf` / `colonyTerraformOrders` of the colony.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### XC-30 · Linked prep skips the duplicate-job check (pre-existing W01)

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` (`planJobs`: a request with explicit `jobs` bypasses `evaluateTerraform` and its `pending` set), callers `economy/construction.ts` (`enqueueLinkedPrep`) and the W01 Hub prep
- **What happens:** a linked prep order is built from `buildLinkedPrepJobs` and passed as `jobs`, so the GP-01 rule "each `(op, q, r)` once per colony" is not applied: a footprint tile already queued in a manual terraform order gets a second job. The completion re-check (GP-01) prevents a double yield, but the HQ may walk to and start the duplicate.
- **To resolve:** run the `pending` check for explicit `jobs` too (skip tiles already queued, count them as prepared work in progress).
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### XC-31 · W02 rows deferred past the hackathon cut

- **Status:** Accepted (deferred, owner's hackathon cut)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/plan/waves/W02-first-light.md` ("Deferred" line, rows 14, 20, 22, 25, 26); `package.json` (`sim:bench` → `scripts/dev/sim-bench.mjs`, `notImplemented`)
- **What happens:** these W02 rows are not built:
  - W02-18..21 (H+): anims on the existing `building.mine` / `building.solar` / `robot.miner` archetypes (they stand in unanimated), and wiring `PlanetaryLightingSystem` to the sim daylight view (no `frontend/game` code imports it; the scene's sun follows the viewport day/night clock synced from the solar clock);
  - W02-27: the harvest-weight slider UI (no client code sends `setHarvestWeights`; the sim command is done);
  - W02-29: analytics events (`first_building_built`, `first_unit_built`, `brownout_seen`, `queue_wait_seen`) are not recorded anywhere;
  - W02-32: the pacing test `pacing-s0-s1.spec.ts` does not exist;
  - W02-33: `npm run sim:bench` is a stub, so there is no economy-heavy perf number (GP-63).
- **To resolve:** build them in a later landing of W02 (`wave-02.2`) or in the wave that now owns them: W02-18..21 → W03-31; W02-27 → W03-37 (sliders reuse W08-27's component); W02-29 → W03-26 (events) and W25-15 (funnel); W02-32 → W25-22 (AC-01 asserts the S0–S1 rows); W02-33 → W03-28 (makes `sim:bench` real, adds `w02-econ`). Other W02 leftovers: dispatch / eligibility W03-32, one Units lane W03-33, depleted extractor W03-34, owner-decided economy rules W03-35, day window and income-table cleanup W03-36, `resourceProduced` durability / player id / audience W12-33 and W12-34.
- **Found:** 2026-11-03, W02 review round 1 (audit)

### XC-32 · Two near-identical particle reference pages in the `procedural-particles-3d` skill

- **Status:** Open
- **Area / code:** `.agents/skills/procedural-particles-3d/references/particle-physics-and-presets.md`, `.agents/skills/procedural-particles-3d/references/preset-catalog.md`
- **What happens:** both pages describe the same presets and the same physics (bounce floor, spray, per-target layers) in nearly the same words. The W02 docs pass had to correct the same stale facts (`backSprayBias`, the op list, the bounce formula) in both.
- **Why it is like this:** the catalog was split off the physics page and the two were never merged; nobody owned the duplication.
- **Workaround / mitigation:** both were brought in line with the code in the W02 docs pass (2026-11-03).
- **To resolve:** keep one page (physics + catalog) and make the other a short pointer, so a future preset change is written once.
- **Found:** 2026-11-03, W02 docs pass (skills agent)

### XC-33 · W06 rows past the hackathon slice are not built

- **Status:** Accepted (deferred, hackathon slice)
- **Area / code:** `docs/plan/waves/W06-invisible-chain.md` (Hackathon slice; features list), `docs/plan/HACKATHON_CUT.md`
- **What happens:** this landing is the H slice (guest login, Pilot ID, named and colony accounts, key store, mock relayer, one `storage_deposit`, retry toast, contract suites, dev console, flag off). These rows are not built: W06-17 (Settings → Account and `POST /v1/near/claim`), W06-18 (NEP-413 verifier and `W06.walletLink`), W06-21 (`npm run test:copy`), W06-23 (analytics `track()` events), W06-24 (`near_tx_total` / `near_tx_pending`), W06-26 (844×390 touch pass). W06-07's server path is built and unit-tested; only the second-device e2e step is skipped. The player-facing strings in the landed HUD do not say wallet, gas, transaction, seed phrase, or private key.
- **Why it is like this:** the hackathon slice defers account settings, the second device, the wallet link, copy lint, and telemetry. Analytics and the mobile pass are blank in the H column (after the hackathon).
- **Workaround / mitigation:** the features list in the wave file is unchecked for those rows. Returning login of the same subject is covered by `backend/app/test/near/social-auth.spec.ts`.
- **To resolve:** build them in a later landing. W21 owns the claim button. W23 owns the real adapters and can run the same contract suites.
- **Found:** 2026-11-03, W06 plan review


### XC-34 · Frontend feature glob retained by Vitest disk transform cache

- **Status:** Accepted (test cache disabled for the game project)
- **Area / code:** `frontend/game/vitest.config.ts`, `frontend/game/core/registry/index.ts`
- **What happens:** after merging W10 into W12, the on-disk transformed `import.meta.glob` omitted the newly added Trade Hub feature. Its registration test failed until the source text changed; reverting the temporary diagnostic text reproduced the failure. Disabling `fsModuleCache` restored discovery with unchanged application code.
- **Why it is like this:** the cached transformation was keyed by source content without invalidating the glob's directory expansion on this branch merge.
- **Workaround / mitigation:** game tests now transform their modules afresh. Test coverage and assertions are unchanged; startup is slower. Other projects retain their caches.
- **To resolve:** re-enable only after a cache invalidation fix is verified with a feature directory added between consecutive runs.
- **Found:** 2026-11-04, W12 landing gate after W10 merge.

### XC-35 · W03 rows deferred past the hackathon cut

- **Status:** Accepted (deferred, owner's hackathon cut)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/plan/waves/W03-the-grid.md` ("Hackathon slice" and Issues table), `docs/plan/HACKATHON_CUT.md`
- **What happens:** this landing builds the 15 H-tagged issues (`W03-01..03`, `W03-05..07`, `W03-10..13`, `W03-16..17`, `W03-19`, `W03-27`, `W03-29`). The H+ / post-hackathon rows are not in this landing:
  - `W03-04`: worker assist (up to 4 workers on one construction job);
  - `W03-08`, `W03-09`: Capacitor T1 discharge/charge and Wind Turbine T1 wind-factor curve (`grid.capacitor` and `grid.wind` data rows compile in `W03-01`, and `dev.setwind` exists from `W03-27`; step 5 of the demo story builds only the Supply Depot in the H slice);
  - `W03-15`, `W03-25`, `W03-26`: `nightSurvived` event, Night Shift / Power Broker progression events, and `first_*` analytics events;
  - `W03-18`, `W03-20`: power overlay (`P` toggle) + full power HUD shed list (steps 3, 6, 7 assert the synced power fields from `W03-16`) and building context action plate (manual Repair/Dismantle already work from the Terraform tab);
  - `W03-21..24`, `W03-31`: validator fixes/animations for `building.pylon`, `building.capacitor`, `building.wind`, `building.coalGen`, `building.supplyDepot`, `building.waterPump`, new `building.quarry` / `building.petroleumWell` archetypes (existing kitbash models stand in), sagging power-line cables/sparks VFX, and W02-18..21 visuals;
  - `W03-28`: 300-node grid perf benchmark and `npm run sim:bench`;
  - `W03-30`: Petroleum Well T1 `bio.t2` runtime hook (needs W05-34's terraforming gate);
  - `W03-32..37`: multi-builder dispatch cleanup, single Units-lane consolidation, depleted-extractor offline state, economy-row territory/refund rules, day-window cleanup, and harvest-weight slider UI.
- **Why it is like this:** per `docs/plan/waves/W03-the-grid.md` ("Hackathon slice"), only the 15 `H` issues are in scope for this wave landing.
- **Workaround / mitigation:** the 15 H issues and all `@hack` demo steps (steps 1–4, 5 Depot, 6 night + group shedding, 7 pylon branch overload, 8 Worker Drone T2 1.5× auto-repair, 9 `waiting(storage)` + Build Depot button, 10 60 s earmark, plus `?waves=..02` DoD) are built and verified in `tests/e2e/w03.spec.ts`.
- **To resolve:** build the H+ and post-hackathon rows in a later landing (`wave-03.2`) or their downstream waves.
- **Found:** 2026-11-03, W03 landing

### XC-36 · `/dev/chain/` probed `/v1/near/health` (W06-gated), breaking `w00.spec.ts` when `TA_WAVES` is below `W06`

- **Status:** Resolved (W03 landing 2026-11-03)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/dev/explorer/gate.ts` (`nearHealthStatus`), `backend/app/src/near/infrastructure/dev/near-health.controller.ts`, `tests/e2e/w00.spec.ts` (Test 7), `tests/e2e/w06.spec.ts` (Test 7)
- **What happens:** W02 (`58956ab`) updated `tests/e2e/harness/stack.ts` so `npm run e2e -- --waves ..NN` boots the backend with `TA_WAVES=..NN`. W06 (`91aad6d`) gated `/dev/chain/` on `GET /v1/near/health` (`NearHealthController`), which returns `404` whenever `W06` is not in `TA_WAVES`. Because `/dev/chain/` is a W00 feature (`W00-35`, tested by `w00.spec.ts` Test 7), running `npm run e2e -- --waves ..03` booted the backend with `TA_WAVES=..03`, causing `/v1/near/health` to return `404` and `/dev/chain/` to render `Off` during `w00.spec.ts`.
- **Fix:** `nearHealthStatus` in `frontend/game/dev/explorer/gate.ts` now probes `/v1/dev/chain/receipts?limit=1` (W00's dev chain explorer endpoint, guarded by `DevOnlyGuard` in production) while `wavesExcludeW06(location.search)` continues to gate explicit `?waves=..05` URLs (`w06.spec.ts` Test 7).
- **Found:** 2026-11-03, W03 merge with `main`

### XC-37 · Dead balance rows after the W03 owner-feedback pass

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/ops-basic.ts` (`TERRAFORM_TIME_TABLE.dismantle`), `hq.t1.cellFastRechargeShedGroup`, `ColonyPowerSummary.hqFastRechargeShed`, `docs/game/colony-economy-and-buildings-spec.md` (still says "Power Line Pylon"), `docs/plan/ISSUE_INDEX.md` (W03-01 row)
- **What happens:** `TERRAFORM_TIME_TABLE.dismantle` (60 ticks, 5 E) no longer drives anything (dismantle is a work job, GP-69) and `w02-resource-harvest-terraform.spec.ts:49` still asserts its shape; the fast-recharge shed fields are unused (GP-67); design docs still describe the removed Power Line path tool.
- **Why it is like this:** Left to avoid widening the owner-feedback change.
- **Workaround / mitigation:** —
- **To resolve:** Remove the rows and fields, update the spec text.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### XC-38 · Fresh guest refresh rejection is expected in browser smoke checks

- **Status:** Accepted (auth bootstrap)
- **Area / code:** `tests/e2e/harness/helpers.ts`
- **What happens:** A fresh browser without a refresh cookie receives HTTP 401 from `/v1/auth/refresh`, then the app creates a guest session. The browser console reports that HTTP rejection even though bootstrap succeeds.
- **Why it is like this:** Session restoration precedes guest creation. The error collector ignores only this endpoint's 401; other HTTP errors and JavaScript exceptions still fail the test.
- **Workaround / mitigation:** The W01 flow verifies that the authenticated game view arrives afterward.
- **To resolve:** No runtime change required.
- **Found:** 2026-11-04, merged W01 browser check.

### XC-39 · Live map repaint batches include active workers

- **Status:** Accepted (live simulation)
- **Area / code:** `tests/e2e/w04.spec.ts`, `frontend/game/maps/rasterCache.spec.ts`
- **What happens:** Adding one deposit in a running scenario can coincide with harvesting or exploration changes, so the next minimap update may repaint several tiles. An exact `dirtyTiles === 1` browser assertion depends on timing.
- **Why it is like this:** Synced updates batch all changed tiles while the world continues running.
- **Workaround / mitigation:** The browser check verifies new repaint work and fewer repaints than the full map. The stationary raster-cache unit fixture still requires exactly one repaint for one changed tile.
- **To resolve:** No runtime change needed.
- **Found:** 2026-11-04, post-landing main browser suite.

### XC-40 · Two copies of the open-ground prep set

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/grid/hexTile.ts` (`isOpenGround`), `shared/sim/src/grid/geo.ts` (`isPreparedGround`)
- **What happens:** `hexTile.isOpenGround` repeats the prep set of `geo.isPreparedGround`.
- **Why it is like this:** `frontend/render` may import `grid/hexTile` (pure functions over arrays and contract codes) but not `geo.ts`, which pulls in the sim layers.
- **To resolve:** Move the prep set into a tiny pure module both import, if a third copy appears.
- **Found:** 2026-11-07, W05 full review (terraform agent)

### XC-41 · e2e w12 step 4 expects 1 past colony; the scenario seeds 2

- **Status:** Open
- **Area / code:** `tests/e2e/w12.spec.ts` ("4. Planets section current & past colony cards"), `tests/scenarios/w12-profile.ts` ("an active colony ... and 2 past colonies")
- **What happens:** On the server host the page shows 2 `me-past-colony` cards and the test expects 1. Neither file changed in the W05 branch (pre-existing on `main`; the step was never reached in earlier W05 runs because `@hack 1` timed out first).
- **To resolve:** Align the test with the scenario (expect 2) or the scenario with the test; W12 owner.
- **Found:** 2026-11-07, W05 full review (lead, e2e)
