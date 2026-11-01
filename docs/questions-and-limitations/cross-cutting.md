# Cross-cutting: duplication, dead code, test gaps, docs vs code

Tool-driven review of the whole W01 branch diff (`git diff main...HEAD`): copy/paste detection, unused code, coverage,
docs vs code and repo hygiene. Area reviews live in the other files of this folder; entry format in the
[README](./README.md). Ledger limits already recorded in [`economy-ledger.md`](./economy-ledger.md) (LED-01..15) are not repeated.

## Balance data and duplicated constants

### XC-01 · Data rows carry the same value under 2–4 names; the "declared" field is often the one nobody reads

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/hq.ts:24-45,59-62`, `shared/sim/src/data/hub.ts:17-35`, `shared/sim/src/data/ops-basic.ts:15-18,30-33,45-48`; readers `shared/sim/src/systems/hq/index.ts:294-296`, `shared/sim/src/systems/terraform-basic/queue.ts:65-66`, `shared/sim/src/systems/territory-claim/index.ts:138-139,162-164`, `shared/sim/src/systems/construction/build.ts:55-62`, `shared/sim/src/systems/construction/placement.ts:144`, `shared/sim/src/systems/landing/index.ts:70-71`
- **What happens:** one balance value is stored under several field names, e.g. HQ self recharge `cellSelfRechargePerS` / `designCellSelfRechargePerS` / `selfRechargeEPerS` (all 3), fast recharge `cellFastRechargePerS` / `designCellFastRechargePerS` / `hubRechargeEPerS` (20), radius `cellFastRechargeRadius` / `hubRechargeRadius`, Hub build time `buildS` / `designBuildS` / `buildTimeS`, Founder Core `founderCoreGenPerS` / `founderCoreEPerS` / `powerGen`, footprint `footprint` / `footprintW` / `footprintD` / `footprintH`, op time `timeS` / `baseTimeS` / `designSeconds`, op energy `energy` / `energyCostE`. Readers pick one through `??` chains. The fields declared in `units:` (and therefore unit-converted by `compileData`) are often not the ones read: `cellSelfRechargePerS`, `cellFastRechargePerS` and `opsBasic.*.timeS` have no reader at all. So `tune hq.t1.cellSelfRechargePerS 10` or `tune opsBasic.grade.timeS 10` change the data hash and nothing else, while `tune hq.t1.designCellSelfRechargePerS 10` works. `resolveHubBuildTimeS` (`build.ts:55-62`) detects an override by comparing each alias with its default (`!== 30`, `!== 150` ticks), so a tune back to the default value is ignored if another alias differs. `resolveDescentTicks` (`landing/index.ts:69-76`) guesses whether `podDescentS` is already in ticks by comparing it with `designPodDescentS`: `tune hq.startingKit.podDescentS 1.2` compiles to 6 ticks, equals the design value 6, is taken for seconds and gives 30 ticks (6 s) instead of 1.2 s. `territory-claim` writes the same number into three colony fields (`powerGenEPerS`, `founderCoreEPerS`, `founderCoreGenPerS`).
- **Why it is like this:** issues in different waves named the same stat differently (spec name, "design" UI copy, unit-suffixed name) and each kept its own field.
- **Workaround / mitigation:** the default values all agree, so play is unaffected until someone tunes or edits one alias.
- **To resolve:** one field per value (the unit-declared one), readers read only that, delete the aliases and the `??` chains; add a data-compile check that every row field has a reader (or is listed as reserved for a later wave). Recommendation: do it before W02 adds more rows on top of this shape.
- **Found:** 2026-11-01, cross-cutting review (grep of every data field against its readers).

### XC-02 · Balance numbers repeated as code fallbacks (sim and client)

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** sim: `shared/sim/src/systems/construction/build.ts:45-50` (Hub cost 200/100/50/50), `shared/sim/src/systems/landing/index.ts:58` (cargo 600/350/200/200), `shared/sim/src/systems/construction/build.ts:227` and `index.ts:203` (`hp ?? 1500`), `shared/sim/src/systems/territory-claim/index.ts:77,135,137,139` (`claimRadius ?? 10`, `supplyCap ?? 10`, `?? 8`), `shared/sim/src/systems/hq/index.ts:294-296` (`?? 3`, `?? 20`, `?? 6`), `shared/sim/src/systems/terraform-basic/queue.ts:65-66` (`?? 3`, `?? 20`); client: `frontend/game/features/hud-min/MinimalHud.ts:107,110` (`cellMax ?? 800`), `frontend/game/features/landfall/selection.ts:179,181` (`?? 900`, `?? 800`), `frontend/game/features/hud-min/MinimalHud.ts:214,223,232` (`'0 / 500'` placeholders)
- **What happens:** the same balance values live in the data rows and as literal fallbacks. If a row is renamed or its field dropped, the code silently keeps running on the stale literal instead of failing, and a fallback cannot tell design units from compiled ticks (`landing/index.ts:70` `podDescentS ?? 30` is ticks, `queue.ts:65` `?? 3` is seconds). The client fallbacks show 800 / 900 even when the data says otherwise.
- **Why it is like this:** defensive defaults for tests and for hosts started without W01 data.
- **Workaround / mitigation:** all hosts load the W01 data, so the fallbacks are not reached in normal play.
- **To resolve:** read rows through one typed accessor that throws on a missing field (the compiled data is always present once the wave flag is on); the client shows `—` instead of a made-up max. AGENTS.md "balance numbers in code" rule.
- **Found:** 2026-11-01, cross-cutting review.

### XC-03 · Dev planet constants defined in the sim and again in the backend and client

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/gen/flat.ts:6-9` (`DEV_PLANET_RADIUS = 56`, `DEV_PLANET_TYPE`, `DEV_PLANET_SEED = 'golden-1'`); copies: `backend/app/src/core/home/home.repository.ts:9-10` (`DEV_PLANET_CAPACITY = 5`, `DEV_PLANET_RADIUS = 56`), `backend/app/src/game/game.module.ts:141` (literal `radius: 56, capacity: 5`), `frontend/game/app/online/bootOnline.ts:200-204` (`'pl_dev'`, `'golden-1'`, `56`), `scenarios/w01-landfall.ts:11,30`, `shared/sim/src/data/terrain.ts:21`
- **What happens:** the backend exports its own `DEV_PLANET_RADIUS` with the same name as the sim's; changing the dev planet size or seed means finding five places.
- **Why it is like this:** the backend constant predates the sim export.
- **Workaround / mitigation:** none needed while all copies say 56.
- **To resolve:** import `DEV_PLANET_RADIUS` / `DEV_PLANET_SEED` from `@terra/sim` everywhere; move `capacity` next to them.
- **Found:** 2026-11-01, cross-cutting review.

### XC-04 · Client hard-codes the tick rate

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hud-min/MinimalHud.ts:23` (`tick / 5`), `frontend/game/store/WorldStore.ts:347` and `frontend/game/store/devHook.ts:27` (`tickMs: 200`)
- **What happens:** the HUD clock assumes 5 TPS instead of using `TICK_MS` (exported by `@terra/sim`, already used by `EntityMeshes.ts`) or the `tickMs` in the welcome message.
- **Why it is like this:** written when the rate was fixed.
- **Workaround / mitigation:** the rate is 5 TPS on every host today.
- **To resolve:** derive from `TICK_MS` (or the welcome `tickMs`).
- **Found:** 2026-11-01, cross-cutting review.

## Copy/paste: client

### XC-05 · Five hand-written fake DOMs; two of them ship in production code

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hub-placement/dom.ts` (284 lines) and `frontend/game/features/terraform-basic/dom.ts` (238 lines): the same `MiniElement` shim (`:50`) and `ensureDom()` (`:215` / `:205`), ~200 lines identical after whitespace normalisation; `FakeElement` again in `frontend/game/app/online/bootFlow.spec.ts:12`, `frontend/game/features/hud-min/hud-min.spec.ts:16`, `frontend/game/features/landfall/landfall.spec.ts:14` (39 / 27 / 23-line identical windows between them)
- **What happens:** every feature spec grew its own DOM stand-in. The two `dom.ts` shims are imported by production modules, and production constructors call `ensureDom()` (`HubPlacementMenu.ts:96`, `hub-placement/index.ts:126`, `terraform-basic/index.ts:145`, `TerraformMenu.ts:26`, `TileOverlay.ts:235`), so test scaffolding is bundled into `/play.html` (a no-op in a browser because `document` exists). A fix to one shim (selector matching, `classList`, listeners) does not reach the others.
- **Why it is like this:** the vitest projects run in `node` without jsdom / happy-dom, and each issue wrote the minimum it needed.
- **Workaround / mitigation:** none; the shims pass the current specs.
- **To resolve:** one test-only module (e.g. `frontend/game/test/miniDom.ts`) installed from the vitest `setupFiles`, or `environment: 'happy-dom'` for `frontend/game`; drop `ensureDom()` from production code. Keep `makeDiv` / `makeBtn` (real helpers) in a UI util.
- **Found:** 2026-11-01, cross-cutting review (normalised 7-line window duplicate scan).

### XC-06 · Entity view rows decoded by raw offsets in five files

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** layout in `frontend/game/store/replica/viewCodec.ts:4-11` (`ENTITY_STRIDE`, `ENTITY_FIELDS` — the latter has no reader); decoders `frontend/game/features/hub-placement/GhostEvaluator.ts:127-139`, `frontend/game/features/landfall/selection.ts:92-107`, `frontend/game/app/online/EntityMeshes.ts:229-231,239,276-278`, `frontend/game/app/online/bootOnline.ts:381-393`, `frontend/game/features/entities/EntityLayer.ts:46-54`
- **What happens:** each consumer reads `buf[o + 8]` (hp), `buf[o + 10]` (state) and so on by number, and the two `Float32Array | ViewEntity[]` branches are repeated per file. Adding or reordering a column (likely when W02+ entities get more fields) breaks the five readers silently.
- **Why it is like this:** each feature issue added its own extraction.
- **Workaround / mitigation:** the layout has not changed since W00.
- **To resolve:** export named offsets (`E_HP = 8`, … generated from `ENTITY_FIELDS`) and one `readEntity(view, i)` / `forEachEntity` helper in `viewCodec.ts`; replace the five copies.
- **Found:** 2026-11-01, cross-cutting review.

### XC-07 · Two entity renderers with two smoothing pipelines

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** W00 path `frontend/game/features/entities/` (`EntityLayer.ts`, `interp.ts` `INTERP_DELAY_TICKS = 2`, `blend.ts` 150 ms correction) for kind `devProbe`; W01 path `frontend/game/app/online/EntityMeshes.ts` + `entityMotion.ts` (`RENDER_DELAY_TICKS = 1.5`, `FOLLOW_PER_S = 20`) for HQ / pod / Hub; the split is `EntityMeshes.ts:224,242` (`hasEntityLayer` skips `devProbe`)
- **What happens:** two parallel systems interpolate entity poses with different delays and correction rules. `docs/dev/DEV_TOOLS.md:35` (`&predict=0`: "interpolated 400 ms behind") is only true for the W00 test entity; W01 units are always drawn 1.5 ticks (300 ms) behind on the shared `RenderClock`. AGENTS.md §6 asks for one renderer extended by registries.
- **Why it is like this:** W01 needed constant-speed walking and pod/hub staging; it was built beside the W00 feature instead of replacing it.
- **Workaround / mitigation:** the kinds are disjoint, so nothing is drawn twice.
- **To resolve:** owner: should `features/entities` be retired (move `devProbe` to `EntityMeshes` + `MotionTrack`)? Recommendation: yes, one pipeline, then fix the DEV_TOOLS line.
- **Found:** 2026-11-01, cross-cutting review.

### XC-08 · Smaller client copies: pointer-to-tile resolver, view shapes

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `resolveCoord` in `frontend/game/features/hub-placement/HubPlacementMenu.ts:367-386` and `frontend/game/features/terraform-basic/BrushController.ts:357-371` (same pick → `data-q`/`data-r` fallback); `HqStatusView` (`frontend/game/features/landfall/selection.ts:6-22`) restates `HqUnitView` (`shared/sim/src/systems/hq/index.ts:17-35`) minus two fields; `ExtractedEntity` (`GhostEvaluator.ts:65-74`) restates `PlacementEntity` (`shared/sim/src/systems/construction/placement.ts:17-26`)
- **What happens:** a change to tile picking (e.g. ignoring UI overlays) has to be made twice; the type copies drift from the sim types without a compile error.
- **Why it is like this:** written in parallel issues.
- **Workaround / mitigation:** none needed today.
- **To resolve:** one `resolvePointerTile(ev, pickTile)` helper; `Omit<HqUnitView, ...>` / import `PlacementEntity`.
- **Found:** 2026-11-01, cross-cutting review.

## Copy/paste: backend, sim and tests

### XC-09 · Progression event batching written twice

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/progression-events.service.ts:67-113` (`aggregateTileEvents`) and `:115-165` (`aggregateObstacleEvents`); event payload shapes again in `backend/app/src/bus/channels.ts:15-68`
- **What happens:** the two functions are the same accumulator (resolve player, key, count, last q/r, map to an event with the fields duplicated into `data`) differing only in the key and one field; the achievement names `'Groundbreaker'` / `'Stone Mason'` are literals in code.
- **Why it is like this:** the obstacle variant was copied from the tile one.
- **Workaround / mitigation:** both are covered by `backend/app/test/unit/progression-events.spec.ts`.
- **To resolve:** one generic `aggregate(kind, keyOf, extra)`; achievement names into a data row (balance/content belongs in data).
- **Found:** 2026-11-01, cross-cutting review.

### XC-10 · "Try Postgres, swallow the error, fall back to memory" copied into every repository method

- **Status:** Open
- **Severity:** medium
- **Confidence:** PLAUSIBLE (the duplication itself is confirmed: 34 copies; the split-brain consequence is not reproduced)
- **Area / code:** `backend/app/src/core/home/home.repository.ts` (20 `catch {}` blocks, 486 lines), `backend/app/src/core/auth/auth.repository.ts` (14), e.g. `auth.repository.ts:49-51,65-67`, `home.repository.ts:95-106`
- **What happens:** each method repeats `if (this.dbEnabled && this.prisma) { try { … } catch { /* fall through */ } } return memory…`. Besides the copy/paste, a transient DB error silently answers from (and writes to) the per-process in-memory maps, so a seat or session can exist only in memory and disappear on restart or differ between app instances.
- **Why it is like this:** the in-memory store lets unit tests run without Postgres.
- **Workaround / mitigation:** single app process in dev.
- **To resolve:** split into a Prisma repository and an in-memory repository behind one port (chosen at module wiring, like `LedgerStore`), and let DB errors surface. The backend area review should judge the failure semantics.
- **Found:** 2026-11-01, cross-cutting review.

### XC-11 · Dev-only 404 gate re-implemented per controller

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/dev-planets.controller.ts:7-9` (`assertDevOnly`, added on this branch), inline copies in `backend/app/src/scenarios/scenarios.controller.ts:12`, `backend/app/src/dev/dev.controller.ts:11`, `backend/app/src/near/infrastructure/dev/chain-explorer.controller.ts:53-54`, `backend/app/src/near/infrastructure/dev/mock-chain-read.ts:8-9`
- **What happens:** five slightly different checks (`NODE_ENV === 'production'`, `registry.enabled`, plus mock-adapter checks); a new dev route can forget it.
- **Why it is like this:** each module added its own before `assertDevOnly` existed.
- **Workaround / mitigation:** every current `/v1/dev/*` route has a check.
- **To resolve:** a `DevOnlyGuard` applied to every `dev/*` controller (and a test that enumerates `dev` routes in production mode).
- **Found:** 2026-11-01, cross-cutting review.

### XC-12 · Test host factories copied into every spec

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `createW01Host` in `shared/sim/test/systems/{territory-claim,hub-placement,landing,hub-construction,hq,linked-prep,terraform-basic}.spec.ts:30-34`, `shared/sim/test/systems/dev.spec.ts:23` (`w01Host`), `backend/app/test/unit/progression-events.spec.ts:35`
- **What happens:** nine copies of "new `SimHost` with `..01` flags + flat planet"; `shared/sim/test/units/helpers.ts` and `economy/helpers.ts` already exist as the place for this.
- **Why it is like this:** each issue's spec was self-contained.
- **Workaround / mitigation:** none needed.
- **To resolve:** `shared/sim/test/helpers/host.ts` exporting `w01Host({ seed, radius, type })`.
- **Found:** 2026-11-01, cross-cutting review.

### XC-13 · Small enumerations and converters written out per kind

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/tileModel.ts:90-134` (`terrainIdFromKey` / `terrainKeyFromId` / `prepIdFromKey` / … : three identical pairs); terraform op list in `shared/contracts/src/ws/sim.ts:56` (`W01_TERRAFORM_OPS`), again in `shared/sim/src/systems/terraform-basic/queue.ts:12,55` and `shared/sim/src/systems/construction/prep.ts:62`
- **What happens:** adding an op (W05 Level / Fill) or a terrain key means editing several lists by hand.
- **Why it is like this:** written per issue.
- **Workaround / mitigation:** none needed.
- **To resolve:** a generic `keyCodec(keys)`; derive `TerraformOpKind` and the validation set from the contracts constant.
- **Found:** 2026-11-01, cross-cutting review.

## Unused and dead code

### XC-14 · Lint does not check unused code in `frontend/`; unused symbols in branch files

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `eslint.config.js:22-25` (`@typescript-eslint/no-unused-vars: 'off'` for all of `frontend/**`, "the prototype predates the linter"); `tsc --noUnusedLocals --noUnusedParameters -p tsconfig.json` finds in branch-changed files: `frontend/game/features/hub-placement/HubPlacementMenu.ts:71,78` (`billEl`, `cancelBtn` fields assigned, never read), `frontend/game/features/hud-min/MinimalHud.ts:138` (`latestTick` written, never read), `frontend/game/features/hud-min/hud-min.spec.ts:2` (`parseWaves`), `frontend/game/app/online/bootFlow.spec.ts:4` (`ENTITY_STATE`); untouched by the branch but in branch files: `frontend/render/kitbash/archetypes/buildings/rocket.ts:4-5`, `tech.ts:4`, `industry.ts:4`, `frontend/game/app/RTSCamera.ts:20`. All other workspaces (`shared/*`, `backend/app`, `scenarios`, `e2e`, test tsconfigs) are clean.
- **What happens:** all W01 frontend code (the largest part of the diff) is exempt from the unused-variable rule, so dead fields accumulate in files already at the 500-line limit.
- **Why it is like this:** a blanket exemption made for the pre-linter prototype.
- **Workaround / mitigation:** none.
- **To resolve:** scope the exemption to the prototype folders (`frontend/game/app/Game.ts`, `descent/`, `landing/`, `playground/` …) or turn on `noUnusedLocals` in the root `tsconfig.json`; remove the symbols above.
- **Found:** 2026-11-01, cross-cutting review (`tsc --noUnusedLocals` on every workspace tsconfig).

### XC-15 · Dead exports and orphan files added on the branch

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** no importer anywhere: `scenarios/w01-landfall.ts:25` (`w01AutoPlaceScenario`, never registered: `scenarios/index.generated.ts` takes only the default export), `frontend/game/store/replica/viewCodec.ts:11` (`ENTITY_FIELDS`), `shared/contracts/src/rest/home.ts:21,36` (`PlanetSummarySchema`, `ColonySummarySchema` aliases), `shared/sim/src/grid/tileModel.ts:196` (`terrainMoveMultiplier`), `shared/sim/src/systems/construction/validate.ts:62-72` (`findAliveColonyHqRow`, also uncovered); used only by tests: `validate.ts:107-117` (`validateHubPlacement`, a dual-signature wrapper), `validate.ts:49` (`hasColonyHub`); orphan barrels `frontend/game/features/index.ts` and `frontend/game/features/define.ts` (new, nothing imports them; features load through `import.meta.glob('../../features/*/index.ts')`, and the barrel omits several features); data fields with no reader: `hub.t1.pylonSpan`, `pylonMaxLoad`, `powerDrainPerS`, `hq.t1.selfPreservationHpRatio`, `cellCapacityE`, `cellFastRechargeShedGroup`, `gridDrawPerS`, `hq.startingKit.autoPlaceIdleS` / `designAutoPlaceIdleS` (W01-18 deferred).
- **What happens:** dead API surface looks supported (the scenario looks loadable, the barrel looks like the public entry, the data fields look tunable).
- **Why it is like this:** leftovers from refactors (D-37 replaced the old placement checks) and reservations for later waves.
- **Workaround / mitigation:** none needed.
- **To resolve:** delete the dead code; either register `w01-auto-place` with W01-18 or delete it; mark reserved data fields with a comment naming their wave (and exclude them from the reader check proposed in XC-01). `defineTileLayer` (`shared/sim/src/grid/layers.ts:25`) has no caller but is a documented extension point (`shared/sim/README.md:24`): keep.
- **Found:** 2026-11-01, cross-cutting review (grep-based export/importer scan).

### XC-16 · `GET /v1/v1/me/home` also answers

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/home/home.controller.ts:12` (`@Controller(['me', 'v1/me'])`) with `app.setGlobalPrefix('v1')` (`backend/app/src/app.ts:50`)
- **What happens:** the home route is served at `/v1/me/home` and at `/v1/v1/me/home`. Only the first is documented or used.
- **Why it is like this:** probably added while the global prefix was being wired.
- **Workaround / mitigation:** harmless alias.
- **To resolve:** `@Controller('me')`.
- **Found:** 2026-11-01, cross-cutting review.

## Debug leftovers

### XC-17 · `console.log('[pick]')` now runs every frame while the Hub ghost is open

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/viewportHelper.ts:76` (`pickTerrainAt`); called via `OnlineSession.pickAt` (`OnlineSession.ts:432-433`) from the hub ghost's per-frame `update` (`frontend/game/features/hub-placement/index.ts:233-234`) and the terraform brush drag (`BrushController.ts:385-387`); also `shared/sim/test/systems/prepared-ground.property.spec.ts:353` logs on every test run
- **What happens:** on `main`, `pickAt` had no per-frame caller; on this branch the placement ghost calls it every animation frame, so the browser console gets ~60 lines per second while placing a Hub (and every pointer move while brushing), drowning real errors during QA. Lint does not catch it (no `no-console` rule).
- **Why it is like this:** a debug line from the first tile-picking commit, moved with the function.
- **Workaround / mitigation:** none.
- **To resolve:** delete the log (keep `lastPick` on `window.__online` for debugging); consider `no-console: ['error', { allow: ['warn', 'error'] }]` for `frontend/game` and `shared/`.
- **Found:** 2026-11-01, cross-cutting review.

## Tests

### XC-18 · Coverage of the branch: weakest changed files

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** measured with `vitest --coverage` per package (unit projects, no Postgres): `shared/sim` 96.4 % lines / 82.7 % branches, `shared/ledger` 100 %, `backend/app` 79.9 % / 63.5 %, `frontend/game` 67.3 % lines. Weakest branch-changed files: backend `game/ledger/prisma-ledger-store.ts` 17 % (covered by `test/game/ledger.int.spec.ts`), `core/auth/auth.repository.ts` 51 % (one `auth.int.spec.ts` test), `core/home/home.repository.ts` 55 % (its Prisma seat paths are exercised by **no** spec, unit or integration), `game/persistence/snapshot-store.ts` 54 %, `game/thread/planet-host.ts` 61 %, `ws/sim-command-ingress.ts` 69 %; sim `systems/construction/validate.ts` 64 % (`insufficient_resources` branch `:95-97` uncovered), `ecs/columns.ts:56-61` and `grid/layers.ts:26-31` (the `defineEntityColumn` / `defineTileLayer` extension points) 0 % branches, `systems/territory-claim/index.ts` 57 % branches; client `app/Game.ts` 0 % (prototype), `app/online/viewportHelper.ts` 29 %, `app/RTSCamera.ts` 51 %, `app/online/unitControl.ts` 56 %, `app/online/OnlineSession.ts` 68 %. Sim files with no dedicated spec (`grid/geo.ts`, `units/movement/locomotion.ts`, `systems/terraform-basic/work.ts`, `gen/world/stages/reliefDesert.ts`) are covered indirectly.
- **What happens:** the Postgres seat assignment (capacity, concurrent seats, D-38 retype of old dev planets in `fixDevPlanetType`) is the least tested W01 server path.
- **Why it is like this:** unit tests run without a database; integration specs were written for ledger and snapshots.
- **Workaround / mitigation:** e2e `npm run e2e -- --waves ..01` seats real guests.
- **To resolve:** a `home.int.spec.ts` (seat, full planet, two concurrent guests, retype); a unit test for the `insufficient_resources` placement branch.
- **Found:** 2026-11-01, cross-cutting review.

## Docs vs code

### XC-19 · Owner check guide: pre-Hub caps are `600/600`, not `600/500`; the HUD spec fakes the caps

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `docs/plan/checks/w01-check.md:27` (**Metals `600/500`**); code `shared/sim/src/economy/caps.ts:13` (`INITIAL_CAPS.metals = 600`), set at landing `shared/sim/src/systems/landing/index.ts:177`, copied to the view by `shared/sim/src/host/view.ts:50`, shown by `frontend/game/features/hud-min/MinimalHud.ts:309-311`; the spec `frontend/game/features/hud-min/hud-min.spec.ts:158-162` hand-writes `caps: { metals: 500, … }` and asserts `600 / 500` (`:204`)
- **What happens:** the owner will see `600 / 600` after landing and report a mismatch; the HUD unit test passes because it feeds caps the sim never produces.
- **Why it is like this:** the guide and the spec fixture both assume a 500 metals cap before the Hub; the sim's landing hold cap is `INITIAL_CAPS.metals = 600` (so the 600-metal cargo fits).
- **Workaround / mitigation:** e2e checks only the post-Hub caps (`e2e/w01.spec.ts:229,247`), which are right.
- **To resolve:** fix the guide line to `600/600`; build the spec's colony from `INITIAL_CAPS` (or a real landed host).
- **Found:** 2026-11-01, cross-cutting review.

### XC-20 · `?host=local` without `scenario` opens the prototype, not the local engine

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/onlineMode.ts:23` (`if (host === 'local' && !scenario) return null;` → `main.ts` starts the prototype `Game`), asserted by `frontend/game/app/online/bootFlow.spec.ts:427`; docs `docs/dev/DEV_TOOLS.md:31` ("Without `scenario`, uses `w00`") and `README.md:118`
- **What happens:** `/play.html?host=local` shows the orbit picker of the prototype; the documented default `w00` (`localHostOptions`, `frontend/game/app/online/localHost.ts:10`) is unreachable from the page.
- **Why it is like this:** W01-38 routed the bare URL to the world picker on purpose (comment `onlineMode.ts:9`); the docs were not updated.
- **Workaround / mitigation:** use `?host=local&scenario=w00|w01` (the guide and CLAUDE.md already do).
- **To resolve:** update DEV_TOOLS line 31 and README line 118 (or route it to the local engine with `w01` if that is what the owner wants).
- **Found:** 2026-11-01, cross-cutting review.

### XC-21 · Smaller doc drifts: test counts, dev planet wording, undocumented QA parameters

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/plan/checks/w01-check.md:58` says `npm test` = 93 suites / 500 tests (today 141 files / 872 tests, all green); `docs/dev/DEV_TOOLS.md:122` calls boot dev planets "Flat" (W01 boots them as `desert`, `backend/app/src/game/game.module.ts:140-142`); `/play.html` parameters `autodeploy`, `menutime`, `qat`, `t` (`frontend/game/app/Game.ts:73-106`) are not in DEV_TOOLS although `onlineMode.ts:19` now routes on `autodeploy` / `menutime` (they predate the branch), and `skip=1` on the online boot (`OnlineSession.ts:107`) is only implied.
- **What happens:** readers of DEV_TOOLS cannot find the QA capture parameters; the guide's "already green" counts look stale.
- **Why it is like this:** docs written mid-wave.
- **Workaround / mitigation:** none needed.
- **To resolve:** add the rows; drop the hard-coded test counts from the guide (they go stale every commit).
- **Found:** 2026-11-01, cross-cutting review.

## Structure

### XC-22 · Several W01 files sit at the 500-line limit

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hub-placement/HubPlacementMenu.ts` (499), `frontend/game/app/online/OnlineSession.ts` (499), `frontend/game/app/online/bootOnline.ts` (493), `shared/sim/src/systems/construction/index.ts` (490), `shared/sim/src/gen/spawnSlots.ts` (486), `backend/app/src/core/home/home.repository.ts` (486)
- **What happens:** `npm run check:structure` passes, but the next feature touching these files must extract first. `HubPlacementMenu.ts` carries two unused fields (XC-14) and a copied resolver (XC-08) that would free space.
- **Why it is like this:** the limit is enforced as a hard cap.
- **Workaround / mitigation:** none needed.
- **To resolve:** when next touched, split by AGENTS.md §6 (parts under a subfolder), never by compressing lines.
- **Found:** 2026-11-01, cross-cutting review.

## Cross-area findings (added by the lead)

### XC-23 · DEV_TOOLS describes `tp` and `land` differently from the handlers

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `docs/dev/DEV_TOOLS.md` (~L68-69) vs `shared/sim/src/systems/dev/{index,land}.ts`
- **What happens:** `tp` can move another colony's HQ (the doc implies your own); `land` without coordinates on an already-landed colony is acked silently (not rejected `already_landed`); the cargo is credited when the pod is created, not when `land` deposits it.
- **To resolve:** correct the two rows (or the handlers, if the doc is the intended behaviour).
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
