# W27 Readiness Manifest — Wave W11 Planet Foundations & Sector Admission

**Status:** W11 `H` Foundation Slice Complete · W27 Mega-Planet Gate **CLOSED** (`w27Ready: false`, `w27ScaleClaimed: false`)  
**Wave Spec:** [`docs/plan/waves/W11-lobby-planets.md`](./waves/W11-lobby-planets.md)  
**Map Extension Handoff:** [`docs/plan/MAP_EXTENSION_HANDOFF.md`](./MAP_EXTENSION_HANDOFF.md)  
**Owner Check Guide:** [`docs/plan/checks/w11-check.md`](./checks/w11-check.md)

---

## 1. Executive Summary

Wave **W11** (`Lobby, Matchmaking, Planets & Sector Foundations`) delivers the **28 `H` (Hackathon Foundation)** issues establishing:
1. **Three canonical persistent worlds** (`Kharon Dunes` / `desert` / `dune`, `Thalassa Verde` / `ocean` / `oceanForest`, `Granite Hollow` / `temperate` / `forestRock`) with `PROVISIONING | ACTIVE | ARCHIVED` lifecycle, `OK | LOADING | RETRYING | FAULTED` health, `OPEN | PAUSED | ARCHIVED` admission, and dynamic availability (`open | full | paused | faulted | archived`) without age seals or on-demand overflow instances.
2. **Deterministic 19-sector small-atlas topology with 4× sector size** (`7` land sectors `sec_0_0`..`sec_0_1` = `49,399` land tiles + `12` ocean ring sectors = `84,684` ocean tiles; `R = 48`, `7,057` tiles/sector, `134,083` total tiles, `W11_MAX_SMALL_ATLAS_TILES = 140,000`) with regional resource endowment hooks (`W11-46`) and `X = 3 / 4 / 5` validated safe landing sites per land sector (`W11-03`).
3. **Sector-aware matchmaking, reservation lease & spawn commit** (`POST /v1/match/tickets`, `GET /v1/match/tickets/:id`, `DELETE /v1/match/tickets/:id`, `GET /v1/planets`, `GET /v1/planets/:id/sectors`, `GET /v1/planets/stats`, `GET /v1/home`) with `HELD -> COMMITTED | RELEASED | EXPIRED` seat leases, atomic `system.spawnColony` landing commit, and `foundingSectorId` continuity across reconnects and elimination recaps.
4. **Isolated single-sector gameplay (`R=48`, `7,057` tiles) & 19-sector Orbital Picker / W04 Global Map `'sectors'` layer** (`W11-15`, `W11-20`, `W11-22`, `W11-42`, `W11-47`): in-game `PlanetState.grid` loads a single isolated `R=48` (`7,057`-tile) sector and blocks crossing sector boundaries (`reason: 'cross_sector_disabled'`) for unit movement/pathfinding, building placement across sectors or straddling seams, cross-sector power relay links, cross-sector territory claims, and cross-sector seam terraforming (deferring infinite/streaming multi-sector loading and seamless cross-sector traversal to **W27**). Both the Orbital Picker and the Global Map (`M` dialog) display all `19` surrounding sectors (`7` land + `12` ocean) with per-sector founding vs present counts, biome/resource summaries, and colony presence badges.

### Explicit W27 Gate Status

```json
{
  "wave": "W11",
  "hSliceComplete": true,
  "completedHIssues": 28,
  "deferredUntaggedIssues": 19,
  "w27Ready": false,
  "w27ScaleClaimed": false
}
```

- **`w27Ready: false`** — Wave **W27** (`150`-sector / `450`-colony single persistent planet with infinite/streaming multi-sector loading, seamless cross-sector boundary traversal, continent tectonic plates, cross-continent sea lanes, and multi-player party admission) **must not start** until all **19 deferred untagged / `H+` issues** listed in §3 are implemented and verified.
- **`w27ScaleClaimed: false`** — The W11 `H` baseline intentionally caps canonical worlds at the `19`-sector (`7` land + `12` ocean) small-atlas manifest (`R=48`, `7,057` tiles/sector, `134,083` total manifest tiles, `≤ 35` founding seats/world, with an isolated single-sector `R=48` / `7,057`-tile active `PlanetState.grid`) and does not claim 150-sector scale or multi-sector streaming.

---

## 2. Completed `H` Foundation Issues (28 / 28)

| Issue | Slice | Delivered Scope | Primary Modules | Verification Suites |
| :--- | :--- | :--- | :--- | :--- |
| **`W11-01`** | `11A` | Atlas, sector, admission, ticket, party & `HomeV1` Zod contracts | `shared/contracts/src/lobby/atlas.ts`, `admission.ts`, `tickets.ts`, `shared/contracts/src/commands/system-spawn-colony.ts` | `shared/contracts/src/lobby/w11-contracts.spec.ts` |
| **`W11-02`** | `11A` | Deterministic small-world atlas generator (`7` land + `12` ocean sectors, `R=48`, `7,057` tiles/sector, `134,083` total tiles) | `shared/sim/src/atlas/partition.ts`, `smallAtlas.ts`, `generateAtlas.ts` | `shared/sim/src/atlas/smallAtlas.spec.ts` |
| **`W11-03`** | `11A` | Safe landing site validator across `desert`/`ocean`/`temperate` × `X=3/4/5` | `shared/sim/src/atlas/landingSites.ts` | `shared/sim/src/atlas/landingSites.spec.ts`, `tests/scenarios/test/w11-lobby.spec.ts` |
| **`W11-04`** | `11A` | Authoritative `AtlasManifestV1`, `configHash` & `atlasHash` builder | `shared/sim/src/atlas/manifest.ts` | `shared/sim/src/atlas/manifest.spec.ts` |
| **`W11-06`** | `11B` | Prisma models & persistence service for canonical worlds, sectors, tickets & reservations | `shared/db/prisma/schema.prisma`, `backend/app/src/lobby/lobby-persistence.service.ts` | `backend/app/src/lobby/lobby-persistence.spec.ts` |
| **`W11-07`** | `11B` | Canonical world bootstrapper, `lifecycle`/`health`/`admission` state machine & no-seal policy | `backend/app/src/lobby/lifecycle.service.ts`, `world-bootstrap.service.ts` | `backend/app/src/lobby/lifecycle.spec.ts` |
| **`W11-08`** | `11B` | `GET /v1/planets`, `GET /v1/planets/:id`, `GET /v1/planets/:id/sectors`, `GET /v1/planets/stats` | `backend/app/src/lobby/planets.controller.ts`, `planets.service.ts`, `planets.helpers.ts` | `backend/app/src/lobby/planets.spec.ts` |
| **`W11-10`** | `11C` | `POST /v1/match/tickets`, `GET /v1/match/tickets/:id`, `DELETE /v1/match/tickets/:id` with idempotency & guards | `backend/app/src/lobby/tickets.controller.ts`, `tickets.service.ts`, `tickets.helpers.ts` | `backend/app/src/lobby/tickets.spec.ts` |
| **`W11-11`** | `11C` | Atomic sector seat reservation lease (`HELD -> COMMITTED | RELEASED | EXPIRED`) & auto-sector balancer | `backend/app/src/lobby/reservation.service.ts`, `sector-balancer.ts` | `backend/app/src/lobby/reservation.spec.ts` |
| **`W11-12`** | `11C` | Reservation-to-sim `system.spawnColony` commit, rollback on failure & retry recovery | `backend/app/src/lobby/spawn-commit.service.ts` | `backend/app/src/lobby/spawn-commit.spec.ts` |
| **`W11-13`** | `11C` | Elimination seat release (`foundedSeats` decrement on colony death, `foundingSectorId` recap) | `backend/app/src/lobby/seat-release.service.ts` | `backend/app/src/lobby/seat-release.spec.ts` |
| **`W11-15`** | `11C` | Isolated single-sector gameplay guard (`reason: 'cross_sector_disabled'` for cross-sector move/build/power/claim/terraform) & `presentColonies` vs `foundedSeats` | `shared/sim/src/atlas/crossSectorGameplay.ts`, `sectorMetrics.ts` | `shared/sim/src/atlas/crossSectorGameplay.spec.ts` |
| **`W11-20`** | `11E` | Orbital world cards (`dune`, `oceanForest`, `forestRock`) + 19-sector chooser (`AUTO` + `7` land + `12` ocean halo sectors) | `frontend/game/ui/menu.ts`, `worldCard.ts`, `frontend/game/ui/lobby/sectorChooser.ts`, `orbitalPickerModel.ts` | `frontend/game/ui/w11-orbital-picker.spec.ts` |
| **`W11-22`** | `11E` | W04 Global Map (`M`) `'sectors'` layer (`defaultOn: true`, `order: 15`) displaying all `19` surrounding sectors & sector inspection card | `frontend/game/maps/sectorLayer.ts`, `sectorSelection.ts`, `atlasMapAdapter.ts`, `MapsController.ts`, `GlobalMapOverlay.ts` | `frontend/game/maps/sectorLayer.spec.ts` |
| **`W11-32`** | `11F` | Wave E2E suite (`w11.spec.ts`), `w11-lobby` seed scenario & parity case, owner guide & W27 manifest | `tests/scenarios/w11-lobby.ts`, `tests/scenarios/parity/w11-lobby.parity.ts`, `tests/e2e/w11.spec.ts`, `docs/plan/w27-readiness-manifest.md`, `docs/plan/checks/w11-check.md` | `tests/scenarios/test/w11-lobby.spec.ts`, `tests/e2e/w11.spec.ts` |
| **`W11-33`** | `11C` | Contract & unit tests for ticket validation, `NEW_PLANET` rejection & sector intent parsing | `shared/contracts/src/lobby/tickets.ts`, `shared/contracts/src/lobby/w11-contracts.spec.ts` | `shared/contracts/src/lobby/w11-contracts.spec.ts` |
| **`W11-34`** | `11B` | Contract & service tests for `PlanetListV1`, `PlanetSummaryV1`, `SectorSummaryV1` & `PublicPlanetStatsV1` | `backend/app/src/lobby/planets.spec.ts` | `backend/app/src/lobby/planets.spec.ts` |
| **`W11-35`** | `11B` | World lifecycle & health transition unit/integration tests (no age seal, no overflow instances) | `backend/app/src/lobby/lifecycle.spec.ts` | `backend/app/src/lobby/lifecycle.spec.ts` |
| **`W11-36`** | `11C` | Ticket concurrency, per-player lock (`20` parallel POSTs → `1` ticket), ownership & cancel tests | `backend/app/src/lobby/tickets.spec.ts` | `backend/app/src/lobby/tickets.spec.ts` |
| **`W11-37`** | `11C` | Seat reservation capacity (`X` concurrent reservations → zero over-assignment) & lease expiry tests | `backend/app/src/lobby/reservation.spec.ts` | `backend/app/src/lobby/reservation.spec.ts` |
| **`W11-38`** | `11C` | Spawn commit failure rollback, crash recovery & elimination seat release tests | `backend/app/src/lobby/spawn-commit.spec.ts`, `seat-release.spec.ts` | `backend/app/src/lobby/spawn-commit.spec.ts`, `seat-release.spec.ts` |
| **`W11-39`** | `11A` | Atlas generator determinism, 19-sector (`R=48`, `7,057`-tile) partition & safe landing site corpus tests | `shared/sim/src/atlas/smallAtlas.spec.ts`, `landingSites.spec.ts`, `manifest.spec.ts` | `shared/sim/src/atlas/*.spec.ts` |
| **`W11-40`** | `11E` | `GET /v1/home` state machine (`NEW`, `QUEUED`, `ACTIVE`, `ELIMINATED`, `PLANET_ENDED`) & reconnect tests | `backend/app/src/core/home/home.service.ts`, `frontend/game/app/online/guestBoot.ts` | `backend/app/src/core/home/home.spec.ts`, `frontend/game/app/online/guestBoot.w11.spec.ts` |
| **`W11-41`** | `11E` | Orbital picker UI, queue status banner, full-sector alternatives & cancel flow tests | `frontend/game/ui/w11-orbital-picker.spec.ts`, `frontend/game/app/online/BootOverlay.ts` | `frontend/game/ui/w11-orbital-picker.spec.ts` |
| **`W11-42`** | `11C` | Isolated single-sector gameplay & cross-sector boundary guard (`moveUnit`, `placeBuilding`, power grid, territory claim, seam terraform → `cross_sector_disabled`) integration tests | `shared/sim/src/atlas/crossSectorGameplay.spec.ts` | `shared/sim/src/atlas/crossSectorGameplay.spec.ts` |
| **`W11-43`** | `11F` | Small-atlas performance benchmark (`R=48`, `7,057` tiles/sector, `134,083` manifest tiles, `28` colonies, `tickP95Ms <= 25 ms`) & published caps | `shared/sim/src/atlas/perfCaps.ts`, `perfBenchmark.ts` | `shared/sim/src/atlas/perfBenchmark.spec.ts` |
| **`W11-46`** | `11A` | Regional resource endowment inheritance (`global -> planetType -> planetId -> sectorArchetype -> sectorId`) | `shared/sim/src/atlas/resourceEndowment.ts` | `shared/sim/src/atlas/resourceEndowment.spec.ts` |
| **`W11-47`** | `11E` | W04 Map Extension Handoff (`MAP_EXTENSION_HANDOFF.md`) `'sectors'` layer & regression verification | `frontend/game/maps/sectorLayer.ts`, `sectorLayer.spec.ts`, `GlobalMapOverlay.spec.ts` | `frontend/game/maps/sectorLayer.spec.ts`, `GlobalMapOverlay.spec.ts` |

---

## 3. Deferred Untagged / `H+` Issues Required Before W27 (19 / 19)

Wave **W27** (`150` sectors, `450` colonies, infinite/streaming multi-sector loading and cross-sector boundary traversal) remains **blocked** (`w27Ready: false`) until all 19 deferred untagged / `H+` issues below are completed:

| Issue | Slice | Deferred Scope | Why Required Before W27 |
| :--- | :--- | :--- | :--- |
| **`W11-05`** | `11A` | Multi-continent tectonic plate & ocean channel generator (`150` sectors, `4–7` continents) | W11 `H` uses the single-continent `7`-land + `12`-ocean small-atlas fixture (`19` sectors, `R=48`). |
| **`W11-09`** | `11B` | Live planetary telemetry streaming aggregator & cross-worker pub/sub fan-out | W11 `H` serves in-process / DB-backed `PlanetSummaryV1` and nullable live telemetry. |
| **`W11-14`** | `11C` | Cross-planet `TRANSFER` cargo capsule & tech carry-over settlement pipeline | W11 `H` validates `TRANSFER` contract guards (`same_planet_transfer`) while deferring live transfer execution. |
| **`W11-16`** | `11C` | Cross-continent sea-lane & orbital shuttle transit across ocean sectors | W11 `H` ocean ring sectors are non-buildable / non-foundable boundaries. |
| **`W11-17`** | `11D` | Party lobby endpoints (`POST /v1/parties`, `POST /v1/parties/:code/join`, `DELETE /v1/parties/:id/members/:playerId`) | Party creation, invite codes, and member roster management are deferred from the `H` slice. |
| **`W11-18`** | `11D` | Multi-seat party sector solver (same-sector / adjacent-sector / split-continent fallback) | Atomic multi-member seat reservation across `1..5` party members is deferred. |
| **`W11-19`** | `11D` | Legacy friend-beacon removal migration & party co-founding telemetry | Replaces deprecated post-landing friend beacons with pre-drop party sector co-admission. |
| **`W11-21`** | `11E` | Orbital party drawer UI, invite code copy, ready-check & leader sector lock | Frontend party drawer and ready-state controls depend on `W11-17..18`. |
| **`W11-23`** | `11E` | Landing page (`landing.html`) live `GET /v1/planets/stats` ticker & per-planet occupancy badges | Landing page live stats polling and sector heat strip are deferred. |
| **`W11-24`** | `11E` | Partial-party admission prompt (`WAIT_TOGETHER` vs `SPLIT_NEAREST_SECTORS`) | Handles party admission when a chosen land sector has fewer than `party.members.length` free seats. |
| **`W11-25`** | `11F` | Viewport-scoped tile & entity delta subscription protocol (`ws` sector interest sets) | Required to unlock multi-sector streaming beyond W11's isolated `7,057`-tile (`R=48`) active sector (`134,083` manifest tiles across `19` sectors) to `150+` sectors. |
| **`W11-26`** | `11F` | Sparse sector chunk hydration & cold-sector hibernation in `@terra/sim` | Keeps unpopulated sectors in compressed cold storage and unlocks multi-sector loading in W27. |
| **`W11-27`** | `11F` | Hierarchical macro-sector HPA* pathfinding cache across `150` sectors | Unlocks cross-sector unit pathfinding and long-range routing when W27 enables cross-sector traversal. |
| **`W11-28`** | `11F` | Cross-sector power & logistics graph condensation at sector borders | Unlocks cross-sector power/pipe networks across boundary port edges in W27 (`450`-colony worlds). |
| **`W11-29`** | `11F` | Incremental snapshot & journal compaction per sector | Avoids full-planet monolithic blob serialization at `150`-sector scale. |
| **`W11-30`** | `11F` | Operator admin API for world drain, archive, re-seed & per-sector admission pause | Production operator controls beyond dev console / lifecycle service helpers. |
| **`W11-31`** | `11F` | Multi-worker planet shard router & sticky WebSocket gateway | Distributes the 3 canonical worlds across dedicated simulation worker processes. |
| **`W11-44`** | `11D` | Party admission, split-sector placement & leader-cancel integration test suite | Verification suite for `W11-17..19`, `W11-21`, and `W11-24`. |
| **`W11-45`** | `11F` | `150`-sector / `450`-colony mega-planet soak & memory-ceiling verification (`W27` unlock gate) | Final scale benchmark required to flip `w27Ready` from `false` to `true`. |

---

## 4. Published W11 Small-Atlas Performance & Capacity Bounds (`W11-43`)

Defined authoritatively in [`shared/sim/src/atlas/perfCaps.ts`](../../shared/sim/src/atlas/perfCaps.ts) (`W11_SMALL_ATLAS_PERF_CAPS`) and verified by [`shared/sim/src/atlas/perfBenchmark.spec.ts`](../../shared/sim/src/atlas/perfBenchmark.spec.ts):

| Parameter / Budget | Published W11 `H` Value | Notes |
| :--- | :--- | :--- |
| **`canonicalWorldCount`** | `3` | `desert` (`Kharon Dunes`), `ocean` (`Thalassa Verde`), `temperate` (`Granite Hollow`) |
| **`landSectorsPerWorld`** | `7` | `sec_0_0`, `sec_1_0`, `sec_1_-1`, `sec_0_-1`, `sec_-1_0`, `sec_-1_1`, `sec_0_1` (`49,399` land tiles) |
| **`oceanSectorsPerWorld`** | `12` | Outer ring (`macroDistance === 2`), `foundingCapacity = 0` (`84,684` ocean halo tiles) |
| **`totalSectorsPerWorld`** | `19` | `7` land + `12` ocean (`W11_MAX_SMALL_ATLAS_SECTORS = 19`) |
| **`sectorRadius`** | `48` | `7,057` axial hex tiles per sector (`3 * 48 * 49 + 1`, 4× basic sector hex area; active `PlanetState.grid.radius = 48`) |
| **`totalTilesPerWorld`** | `134,083` | `19 × 7,057` tiles (`49,399` land + `84,684` ocean; `<= W11_MAX_SMALL_ATLAS_TILES = 140,000`) |
| **`supportedFoundingSeatsPerSector`** | `[3, 4, 5]` | Default `X = 4` (`28` nominal seats/world), max `X = 5` (`35` seats/world) |
| **`maxValidatedSeatsPerWorld`** | `35` | `7` land sectors × `5` seats/sector |
| **`atlasBuildBudgetMs`** | `<= 250 ms` | Cold 19-sector manifest + safe landing site generation |
| **`stepTickAvgBudgetMs`** | `<= 15 ms` | Mean sim tick duration with `28` active colonies on an isolated `R=48` (`7,057`-tile) sector |
| **`stepTickP95BudgetMs`** | `<= 25 ms` | 95th-percentile sim tick duration (`20 Hz` / `50 ms` frame budget) |
| **`sectorMetricsBudgetMs`** | `<= 10 ms` | Full `computeAtlasSectorColonyMetrics` pass across all `19` sectors |
| **`w27ScaleClaimed`** | `false` | Explicitly false until `W11-25..31` and `W11-45` land |

---

## 5. W04 Map Extension Handoff Regression Evidence (`W11-22`, `W11-47`)

Per [`docs/plan/MAP_EXTENSION_HANDOFF.md`](./MAP_EXTENSION_HANDOFF.md), W11 extends the W04 map layer registry (`frontend/game/maps/GlobalMapOverlay.ts`, `MapsController.ts`, `sectorLayer.ts`, `sectorSelection.ts`) without breaking any W04/W06/W07/W10 layers:

1. **Layer Registration:** `'sectors'` is registered in `createBuiltinW04Layers()` with `id: 'sectors'`, `label: 'SECTORS'`, `wave: 'W11'`, `defaultOn: true`, `order: 15`.
2. **Wave-Flag Gating (`&waves=..10`):** When `W11` is disabled (`waves=..10`), `visibleLayers()` omits `'sectors'` (`[data-testid="map-layer-chip-sectors"]` count is `0`) while `TERRITORY`, `TERRAIN`, `RESOURCES`, and `UNITS` remain active and interactive.
3. **Interactive Sector Inspection:** Clicking a sector hex on the Global Map (`M`) opens `[data-testid="map-sector-card"]` displaying `sectorId`, `kind` (`land` / `ocean`), `availability`, `foundedSeats / validatedCapacity`, `presentColonies`, and regional `mainResource` / `scarceResources`.
4. **Automated Regression Gate:**
   - `npx vitest run --config tests/vitest.config.ts frontend/game/maps/` (`GlobalMapOverlay.spec.ts`, `Minimap.spec.ts`, `MapsController.spec.ts`, `sectorLayer.spec.ts`) — **100% green**.
   - `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/w11.spec.ts` — verifies `'sectors'` chip toggle (`M`) and `&waves=..10` wave-flag fencing in both server and `--host local` modes.
