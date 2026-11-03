# Sim world and engine core: questions and limitations

Scope: the engine core of `shared/sim` (`kernel/`, `grid/` incl. sectors and path search, `gen/` world generation,
`world/` landing planner and presence, `data/` tables and overrides, `codec/`, `ecs/`, `host/`) and its lint rules.
Ledger and journal limits live in [`economy-ledger.md`](./economy-ledger.md) (LED-xx) and are not repeated here.
Format: [README](./README.md).

## Kernel, codec and versions

### WE-01 · `SIM_VERSION` went 1 → 2 without a migration: v1 snapshots of non-dev planets cannot be restored

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/kernel/constants.ts:7`, `shared/sim/src/codec/migrations/index.ts` (registry "ships
  empty", only tests register), `shared/sim/src/codec/snapshot.ts:72-73`; `backend/app/src/game/persistence/dev-planet-verdict.ts`
- **What happens:** `restore` of a snapshot with `header.simVersion === 1` throws `no migration path from 1 to 2`.
  Dev planets (`pl_dev*`) catch this in `devSnapshotVerdict` and are wiped and regenerated. A non-dev planet (a
  scenario planet such as `w00` / `w01-landfall`, or any future real planet) saved before the bump fails to load
  ("restore errors surface as usual"); a browser local save is discarded. If a real database holds such a planet,
  this is high.
- **Why it is like this:** the bump moved colony stock to `col.stock` and the journal out of state (no `ledger` /
  `colonyStock` blobs). Writing a migration was skipped, presumably because only dev data exists.
- **Workaround / mitigation:** `npm run db:reset` or re-running the scenario recreates the planet.
- **To resolve:** decide whether v1 non-dev planets can exist anywhere. If yes, register a `1 → 2` migration (sum the
  old ledger blob into `col.stock`, drop the blobs). If no, write that down next to `SIM_VERSION` ("pre-W01 saves are
  discarded"). Recommendation: write it down. The migration code path then stays untested until the first real one.
- **Found:** 2026-11-01, world/engine review
- **Fix:** applied the recommendation: the rule is written next to `SIM_VERSION` (`shared/sim/src/kernel/constants.ts`): no non-dev planet was saved at v1, pre-W01 saves are discarded, and from the first real planet on every bump registers a migration. No behaviour change, no test.

### WE-02 · The `GEN_VERSION` fingerprint pins only the desert profile and three layers

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/test/gen/world.spec.ts:99-107`, `shared/sim/src/gen/generators.ts:20-27` (bump rule)
- **What happens:** the guard against a forgotten `GEN_VERSION` bump hashes `terrain`, `height` and `deposit` of one
  planet: `golden-1`, desert, radius 56. A change that only affects the temperate or ocean profile, `prep`,
  `richness`, the hidden subsurface or the spawn slots (`blobs.spawnSlots`) passes the test without a bump. Then
  persisted dev planets are not wiped (`dev-planet-verdict.ts` keys on `genVersion`), local saves are kept
  (`LocalHostCore.ts:118`), and `backend/app/src/core/home/home.service.ts:296` (which regenerates the planet from its
  seed to read spawn slots) can return slots that do not match the ground the persisted planet really has.
- **Why it is like this:** the fingerprint was added together with the desert generator (D-38).
- **Workaround / mitigation:** the bump rule is written in `generators.ts` and `data/worldgen.ts`.
- **To resolve:** fingerprint all three profiles (one seed each) over `terrain`, `prep`, `height`, `deposit`,
  `richness`, `subDeposit` / `subRichness` (with a fixed test salt) and the spawn slot coordinates.
- **Found:** 2026-11-01, world/engine review
- **Fix:** the fingerprint covers one planet per profile (desert `golden-1`, temperate `golden-2`, ocean `golden-3`) over `terrain`, `prep`, `height`, `deposit`, `richness`, `subDeposit`, `subRichness` (fixed test salt) and the spawn slot coordinates. `shared/sim/test/gen/world.spec.ts` › "one planet per profile: pinned summary …".

### WE-03 · The `desert` and `ocean` generator ids override the caller's `planetType`

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/gen/world/index.ts:44-48`, `shared/sim/src/gen/createPlanet.ts:12-19`
- **What happens:** `createPlanet({ type: 'desert', planetType: 'temperate' })` builds a desert (the generator spreads
  `planetType: 'desert'` over the params). With `type: 'temperate'` the profile follows `planetType`. Note the
  defaults differ: `createPlanet` defaults `type` to `temperate` while `backend/.../planet-host.ts:106` defaults it to
  `flat` (an empty planet with no spawn slots).
- **Why it is like this:** hosts pass the planet type as the generator id (`type: planet.type`); the generator id
  then has to win.
- **To resolve:** nothing; know that the generator id decides when it is a planet type.
- **Found:** 2026-11-01, world/engine review

### WE-04 · Engine diffs cannot delete: blobs, colonies and meta keys only appear or change

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/host/diff.ts:75-76` (`colonies` / `blobs` filtered by `changedAt`), `:119-122`
  (`state.colonies[c.index] = c`, `state.blobs[name] = b`, `Object.assign(state.meta, d.meta)`)
- **What happens:** a blob removed with `delete state.blobs.x`, a shortened `colonies` array, or a meta field set to
  `undefined` (dropped by the encoder, `codec/values.ts:33`) is never removed on a replica. The replica then no longer
  deep-equals the authority until the next full snapshot. No code deletes any of these today (checked by grep).
- **Why it is like this:** the diff format carries "stamped after `fromTick`" only; deletion needs tombstones.
- **Workaround / mitigation:** clear a blob by writing an empty value with `setBlob`; mark a colony `eliminated`.
- **To resolve:** if a feature needs deletion, add tombstones (like `entities.removed`) to `EngineDiff`.
- **Found:** 2026-11-01, world/engine review

### WE-05 · Every client gets every rng stream state, so future random draws are predictable

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/host/diff.ts:67` (`rng: state.rng` also with `forClient`), `shared/sim/src/codec/snapshot.ts:37`, `shared/sim/src/kernel/rng.ts:6`
- **What happens:** client snapshots and diffs carry all seven xoshiro states (`gen`, `weather`, `hazard`, `fauna`,
  `ai`, `combat`, `misc`). A modified client can step its replica ahead and know the next combat roll, hazard spawn or
  AI decision before it happens.
- **Why it is like this:** the replica and the prediction worker run the same `step`, which needs the same streams
  to stay deterministic (D-31).
- **To resolve:** decide whether hidden-information streams are needed (W01 draws are world generation only; this
  becomes medium once combat, hazards or AI draw from the streams). Recommendation: when the first such system
  lands, give it a server-only stream (seeded with `meta.worldSalt`, stripped like the hidden layers) and accept that
  the client does not predict that system's outcome.
- **Found:** 2026-11-01, world/engine review
- **Fix:** applied the recommendation as a rule in `shared/sim/src/kernel/rng.ts`: the first system whose draws must stay hidden gets a server-only stream seeded with `meta.worldSalt`, stripped from client payloads like the hidden layers, and the client does not predict it. W01 draws only `gen`, so nothing changes now.

### WE-06 · Fog of war is not a security boundary; `explored` covers only colonies 0–7, `owner` only up to 127

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/layers.ts:13-14` (`owner` i8, `explored` u8 bitmask), `shared/sim/src/grid/tileModel.ts:322`, `shared/sim/src/systems/hq/index.ts:74`, `shared/sim/src/ecs/columns.ts:11`
- **What happens:** every client receives the whole visible ground (terrain, deposits, heights, owners) and every
  entity of every colony; `explored` (D-25, "client-side fog") only drives the client's rendering. `explored` is one
  bit per colony, so colonies with index ≥ 8 never mark tiles explored (`markTileExplored` / `revealVision` return
  early). Tile `owner` and entity `owner` are `i8`: a colony index ≥ 128 would wrap negative. The landing planner can
  seat colonies beyond the spawn slots (`beyondSlots`, a test lands 100), so these limits are reachable.
- **Why it is like this:** D-25 makes fog a client-side presentation; W01 planets have 5 slots.
- **To resolve:** cap colonies per planet at 8 (or widen `explored` to a per-colony bitset layer) and validate
  colony indices at the command boundary.
- **Found:** 2026-11-01, world/engine review

## Hidden ground (D-38)

### WE-07 · Scenario planets have no `worldSalt`: their buried deposits can be regenerated from the public seed

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `tests/scenarios/_loader.ts:51-55` (`createPlanet` without `worldSalt`),
  `backend/app/src/scenarios/scenarios.service.ts:33` (persists that state as the server planet),
  `shared/sim/src/gen/world/context.ts:57` (`secretSeed` mixes `worldSalt ?? ''`),
  `shared/sim/src/gen/world/stages/subsurface.ts:30-43`
- **What happens:** only `planet-host.ts:111` sets a salt (planets the server generates itself). A scenario planet
  (`w01-landfall` is temperate, so it has a subsurface) is built with no salt and loaded on the server as a snapshot.
  A client knows `meta.seed`, the planet type and radius, and ships the generator, so it can rebuild
  `subDeposit` / `subRichness` exactly. The `forClient` stripping is then pointless for that planet.
- **Why it is like this:** the scenario loader runs on every host (also the browser and the CLI), where the salt has
  no meaning; nobody added it on the server path.
- **Workaround / mitigation:** today scenarios are dev / QA planets.
- **To resolve:** let `createScenarioPlanet` accept `worldSalt` and pass `randomUUID()` from `scenarios.service.ts`;
  add a test that a server-loaded scenario planet has `meta.worldSalt`.
- **Found:** 2026-11-01, world/engine review
- **Fix (sim side):** `createScenarioPlanet(id, { worldSalt })` (`tests/scenarios/_loader.ts`) passes the salt to `createPlanet`; test `tests/scenarios/test/world-salt.spec.ts` (salt stored in `meta`, only the hidden layers differ).
- **Fix (server side):** `ScenariosService.create` passes `worldSalt: randomUUID()` to `createScenarioPlanet` (`backend/app/src/scenarios/scenarios.service.ts`); test `backend/app/test/scenarios/scenarios.spec.ts` › "a scenario planet loaded on the server has its own worldSalt, never sent to clients (WE-07)".

### WE-08 · Client-bound paths are all stripped; hosts that run in the browser keep the subsurface by design

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/codec/snapshot.ts:25-38`, `shared/sim/src/host/diff.ts:58-68`; callers
  `backend/app/src/game/thread/planet-host.ts:180,213`, `frontend/game/store/WorldStore.ts:342,371`,
  `frontend/game/store/local/LocalHostCore.ts:176,201`, `frontend/game/store/devHook.ts:27,32`
- **What happens:** every welcome / delta / `fullState` sent to a client uses `{ forClient: true }`, which drops
  `subDeposit`, `subRichness` and `meta.worldSalt`; persisted server snapshots (`snapshotNow`) keep them. The browser
  hosts (`?host=local`, the no-backend fallback in `bootOnline.ts:238`) generate the planet in the player's own tab
  without a salt and save the full snapshot to IndexedDB, so the player can read the subsurface there.
- **Why it is like this:** a browser host is fully under the player's control; hiding data from it is impossible.
- **To resolve:** nothing. Keep `forClient` on every new client-bound path (a test per path is cheap:
  `test/host/hidden-layers.spec.ts` covers the sim side only).
- **Found:** 2026-11-01, world/engine review

### WE-09 · Most buried deposits can never be uncovered in W01

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/gen/world/stages/subsurface.ts:17-28`, `shared/sim/src/systems/terraform-basic/queue.ts:118-136`,
  `shared/sim/src/gen/world/stages/landing.ts:57`, `shared/sim/src/gen/spawnSlots.ts:103-116,308-335`
- **What happens:** the subsurface stage buries deposits under `slope` (minerals / oil "under dunes", 8–10 %) and
  `flat` (oil "under plains", 2–4 %) as well as under rock and forest. Only Clear (forest) and Break (rock) call
  `revealSubsurface`, so everything under slope and flat stays hidden for the whole game. Later generation steps also
  change tile classes after the subsurface stage without touching the buried layer: `landing.ts:57` turns rock into
  slope (its metal vein becomes unreachable), and the spawn guarantees (`makeTileFlat`) and the temperate re-balance
  (`rebalanceGlobalTerrainMix`, which turns flat tiles into rock / forest) move buried deposits under other classes, so
  a Break can uncover oil, which the per-terrain kind table does not plan.
- **Why it is like this:** the layers are written for later ops (Level, W05) that are not built yet.
- **To resolve:** confirm the slope / flat subsurface is meant for a later op. Recommendation: keep it, and clear
  `subDeposit` wherever generation changes a tile's class after the subsurface stage (as `levelZone` already does for
  the landing disc), or run `subsurface` after `landing`.
- **Found:** 2026-11-01, world/engine review
- **Fix:** kept the slope / flat subsurface for the later Level op (recommendation) and moved the `subsurface` stage after `landing` in every profile (`shared/sim/src/data/worldgen.ts`), so no later generation step changes a tile's class over a buried deposit; the per-tile clearing in `levelZone` is gone. Side effect: Flat tiles of a landing zone can now carry buried oil like any other Flat tile (still unreachable in W01). `GEN_VERSION` 3 → 4 (only the hidden layers change for temperate / ocean). Pinned by the WE-02 fingerprint.

## Change tracking and sectors

### WE-10 · Tile setters called without `tick` stamp `meta.tick + 1`, not the tick the step produces

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/tileModel.ts:263-274` (`stampTile` fallback); callers without `tick`:
  `shared/sim/src/gen/starterSpace.ts:71-76` (also at runtime from `systems/landing/index.ts:174`),
  `shared/sim/src/systems/territory-claim/index.ts:108`
- **What happens:** without a `tick` argument a write is stamped `max(meta.tick + 1, changedAt + 1)`. In a coarse step
  (dt 5) that is below `ctx.tick`; a second write to the same tile in one step stamps `ctx.tick + 1`, i.e. ahead of
  the state's tick, so the tile is also re-sent in the next window. Sync stays correct (every diff window starts at a
  tick already reached), but it breaks the README rule "stamp every change with `ctx.tick`", and a replica's
  `changedAt` can hold a tick in its future.
- **Why it is like this:** the fallback serves world generation and tools that have no step context.
- **To resolve:** pass `ctx.tick` from the two runtime callers (`ensureStarterHubSpace` needs a `tick` parameter);
  keep the fallback for generation only.
- **Found:** 2026-11-01, world/engine review

### WE-11 · Sector stamps live in a side cache: any bulk write to `changedAt` must call `forgetTileStamps`

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/sectors.ts:106-160`, `shared/sim/src/kernel/state.ts:108-111`,
  `shared/sim/src/systems/dev/index.ts:182-183` (the only bulk writer)
- **What happens:** per-sector max stamps are kept in a module-level `WeakMap` keyed by the `changedAt` array and
  updated only through `touchTile`, `stampTile` and `applyDiff`. A direct `changedAt[i] = t` or `changedAt.fill(t)`
  that skips `noteTileStamp` / `forgetTileStamps` makes `diffSince` silently skip that sector: the change never
  reaches clients. Writes to other layers without a stamp are equally invisible. Today every writer was checked and
  is correct (`dev.seed` calls `forgetTileStamps`).
- **Why it is like this:** sector skipping keeps `diffSince` cheap on large planets; the stamps are derived data, so
  they stay out of the snapshot.
- **To resolve:** a lint rule (like SIM-M-01's position-write rule) that rejects direct writes to `layers.changedAt`
  outside `kernel/state.ts`, `grid/tileModel.ts`, `host/diff.ts`, and `.fill` without `forgetTileStamps`.
- **Found:** 2026-11-01, world/engine review

## Path search and path queue

### WE-12 · The A* heuristic is not admissible past 6 tiles: about half of the long paths are not the cheapest

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/pathSearch.ts:15-19,83-87`
- **What happens:** the heuristic charges 900 per tile for the first 6 tiles and `FAR_HEURISTIC_WEIGHT_BP` = 1450 per
  tile after that, more than a Flat step (1000) or a Living step (909). Closed nodes are never reopened. A probe on
  three temperate planets (radius 30, 167 reachable random pairs) compared `findHexPath` with Dijkstra on the same
  step costs: 78 paths cost more than the optimum, the worst by 14.4 %. The comment on `HEURISTIC_WEIGHT_BP`
  ("Admissible heuristic") and the "prefers Living and Flat bypasses" test suggest optimal routes are expected.
  Results are still deterministic on every host.
- **Why it is like this:** the far weight makes long searches expand fewer nodes within the 2 000-expansion budget.
- **To resolve:** decide: optimal routes (set the far weight ≤ 909, accept more expansions) or bounded-suboptimal
  routes (keep it, fix the comment and state the bound, e.g. "weighted A*, ≤ 1.6× optimal"). Recommendation: keep
  the speed, document it, and add a test that pins the bound.
- **Found:** 2026-11-01, world/engine review (probe: Dijkstra comparison in a scratch script)
- **Fix:** applied the recommendation (keep the speed): the comment now says weighted A*, not admissible, with the bound `FAR_HEURISTIC_WEIGHT_BP / 909` ≈ 1.6× (`shared/sim/src/grid/pathSearch.ts`). `shared/sim/test/grid/path-bound.spec.ts` compares `findHexPath` with Dijkstra on 120 pairs over three temperate planets: every ratio ≤ the bound, and it pins the measured result (54 suboptimal, worst 1.1679×).

### WE-13 · `findHexPath` with `maxExpansions` between 33 and 95 gives up after 32 expansions

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/path.ts:23-29`, `shared/sim/src/grid/pathSearch.ts:317-319`
- **What happens:** the sealed-goal-pocket check runs after expansion 32 and is deferred when fewer than
  `MAX_POCKET_NODES` (64) of the call's budget remain. The one-shot `findHexPath` never resumes, so with
  `maxExpansions` 40, 60 or 95 a goal behind a wall returns `ok: false, expansions: 32` (probe: with 96 and 120 the
  search spends its full budget; that goal needs 274 expansions). The queue is unaffected (its budget is 2 000 and it resumes next step).
- **Why it is like this:** deferral keeps the budgeted queue and a replay identical; the one-shot wrapper was not
  adjusted.
- **To resolve:** in `findHexPath`, call `continueAStarSearch` with `replay = true` (no deferral), or loop until
  `maxExp` is spent.
- **Found:** 2026-11-01, world/engine review (probe)
- **Fix:** `findHexPath` runs the search with `replay = true` (no deferral), so the whole `maxExpansions` is spent; `HexPathResult.expansions` documents that a goal proven sealed may report up to `MAX_POCKET_NODES` more. Test `shared/sim/test/grid/path-queue.spec.ts` › "a maxExpansions between 33 and 95 is spent in full".

### WE-14 · Default path request ids collide after a cancel

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/pathQueue.ts:110-130` (`seq = totalResolved + queue.length + 1`), `:77` (search
  cache keyed by id), `:133-141` (`cancelPathRequest` by id)
- **What happens:** enqueue A (`path_1`) and B (`path_2`), cancel A, enqueue C: C gets `path_2` too (probe output
  `['path_2', 'path_2']`). The two entries then share one cached search, and a cancel removes the first one only.
- **Why it is like this:** the orchestrator always passes its own unique id (`mv<n>` from `blobs.unitMotion.nextReq`),
  so gameplay is not affected; only tools and tests use the default.
- **To resolve:** keep a `nextSeq` counter in `pathStats` (or require `id`).
- **Found:** 2026-11-01, world/engine review (probe)
- **Fix:** `pathStats.lastSeq` only grows (old snapshots fall back to `totalResolved + queueLength`); default ids come from it. Test `path-queue.spec.ts` › "default ids never repeat after a cancel".

### WE-15 · The `pathEpoch` restart and `cancelPathRequest` have no test

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/pathQueue.ts:186-194`, `shared/sim/src/grid/tileModel.ts:258-261,280,289,306`,
  `shared/sim/src/systems/construction/index.ts:158,323`, `shared/sim/src/systems/dev/index.ts:184`; tests under
  `shared/sim/test/` (no match for `pathEpoch` / `epoch`)
- **What happens:** the rule that keeps a resumed search and a replayed search identical when the ground changes
  (SIM-T-02, SIM-M-01) is untested: no test pauses a search, changes terrain / prep / deposit / a footprint, and checks
  that the live host and a restored copy resolve the same path on the same tick. A writer that forgets
  `bumpPathEpoch` (a future op writing a layer directly) would make the server and a restored or predicting host
  diverge silently.
- **Why it is like this:** the epoch was added late (commits `f6e91e4`, `3cb969f`) with the feature's happy path
  tested only through the orchestrator.
- **To resolve:** add that test (pause with a small budget, place a building or `setTileTerrain` across the route,
  compare live vs `restore(snapshot(...))`), plus one for `cancelPathRequest` while the head search is paused.
- **Found:** 2026-11-01, world/engine review
- **Fix:** tests in `shared/sim/test/grid/path-queue.spec.ts`: a search paused, then a Deep wall (`setTileTerrain`) or a Ridge line (`setTilePrep`) across the route, live vs `restore(snapshot())` taken right after the change and after the next paused step, all equal a fresh search on the new ground; cancelling the paused head and re-enqueuing the same id searches afresh (live and restored).

### WE-16 · A live search keeps the step-cost data it started with; a replay uses the current data

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/src/grid/pathQueue.ts:143-159` (`data` and the `blocked` sets captured at creation),
  `shared/sim/src/host/tuning.ts:37-50`
- **What happens:** a dev `tune terrain.<class>.moveMult …` installs a new pipeline but does not bump
  `meta.pathEpoch`. A search paused across that tune keeps the old multipliers on the host that holds it in cache,
  while any host that rebuilds it (a restored snapshot, the client's prediction clone) replays with the new ones. The
  two can resolve different paths.
- **Why it is like this:** tunes are a dev tool; the epoch only tracks ground writes.
- **To resolve:** bump `meta.pathEpoch` (or clear the search cache) when the pipeline's `dataHash` changes.
- **Found:** 2026-11-01, world/engine review
- **Fix:** a queue entry records the compiled data hash it explored under (`PathQueueEntry.dataHash`); `stepPathQueue` restarts a paused search when the hash differs, on every host alike (`shared/sim/src/grid/pathQueue.ts`). No host change needed. Test `path-queue.spec.ts` › "a new data hash restarts the search on every host alike". Note: a client predicts with the same restart only if its pipeline is recompiled after a live `tune` (reported to FRONTEND-APP).

### WE-17 · Every path search allocates and fills planet-sized arrays; tile lookups re-resolve the grid four times

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/src/grid/pathSearch.ts:248-273`, `:111-116` (`tileStepCostBp`),
  `shared/sim/src/grid/tileModel.ts:137-162,204-217`, `shared/sim/src/grid/pathProfiles.ts:16-25`
- **What happens:** each search allocates seven typed arrays of `count` entries (≈ 300 KB at radius 56, ≈ 1.4 MB at
  radius 120) and fills four, even for a 3-tile walk; `occupiedTiles` rebuilds the footprint set twice per search.
  Each neighbour costs `isValidTileIndex` + `resolveLayers` twice in `isGroundPassable` and twice again in
  `groundMoveMultiplierBp` (object allocation and `in` checks every time). With many units re-planning, the step
  spends far more than the 2 000-expansion budget suggests, and the prediction clone replays paid expansions on every
  clone.
- **Why it is like this:** the search was written for correctness and resumability first; the arrays live in the
  search object so a paused search keeps its state.
- **To resolve:** reuse scratch arrays per radius with a generation counter instead of `fill`, resolve layers once per
  search, and build the occupancy set once per step.
- **Found:** 2026-11-01, world/engine review
- **Fix:** each search resolves the layers and a (terrain, prep) step-cost table once (`searchStepCost`, the table cached per compiled data), drops the four `fill` passes (`mark` byte per tile, `heapPos` stored + 1), and builds the footprint set once per search instead of twice (`pathBlockersFor`). Identical results (before / after compare of 360 one-shot and queued searches; full sim suite green). Still per search, not per step: the orchestrator's per-unit `pathBlockedFor` (`units/movement/orchestrator.ts:169`) is SIM-GAMEPLAY's. The planet-sized arrays stay per search on purpose: WE-29.

## World generation and spawn slots

### WE-18 · Desert landing zones can undo the UO-TF-09 metals guarantee (about 0.7 % of slots)

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/gen/world/stages/landing.ts:57,63-79,88-92`, `shared/sim/src/gen/spawnSlots.ts:226-262`;
  test gap `shared/sim/test/gen/spawnSlots.spec.ts:30` (temperate only)
- **What happens:** on relief planets the landing stage runs `generateSpawnSlots`, then restores the natural heights,
  levels the zone and re-classifies the falloff ring by gradient (and turns low rock into slope). The guaranteed
  metal deposit with a free 2×2 Flat footprint sits up to 8 tiles out, beyond the 7-tile zone, so its footprint tiles
  can end up `slope` again. Probe: 1 000 desert slots (200 seeds) → 7 fail `validateSpawnSlotGuarantee` with "missing
  metals deposit with free 2x2 flat footprint within r<=8" (e.g. seed `g-41`, slot 2). Temperate and ocean: 0 / 150.
- **Why it is like this:** the guarantee was written for the quota (temperate) generator; the desert stage keeps
  natural relief outside the zone.
- **To resolve:** protect the guarantee tiles (`protectedTiles` from `generateSpawnSlots`) from `reclassifyRing` and
  the rock → slope pass, or re-run the deposit guarantees after levelling; run the UO-TF-09 check on all three
  profiles in the spec.
- **Found:** 2026-11-01, world/engine review (probe)
- **Fix:** `generateSpawnSlots` reports the metals 2×2 footprint tiles (`footprintsOut`); the landing stage keeps them out of `reclassifyRing` and the rock → slope pass (`shared/sim/src/gen/world/stages/landing.ts`). Test `shared/sim/test/gen/spawnSlots.spec.ts` › "keeps the UO-TF-09 guarantees on every profile …" (60 desert, 15 temperate, 15 ocean seeds; failed before on desert `g-18` slot 1). `GEN_VERSION` 4; the dev planet's visible ground is unchanged.

### WE-19 · World generation reads its tables raw: `tune worldgen.*` and the spawn / richness rows change nothing

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/gen/world/context.ts:13-16`, `shared/sim/src/gen/spawnSlots.ts:22-35`,
  `shared/sim/src/gen/temperate.ts:11-40`, `shared/sim/src/data/worldgen.ts`, `shared/sim/src/data/terrain.ts:18-35`
- **What happens:** generation imports `data/worldgen.ts` and `data/terrain.ts` directly instead of reading compiled
  data. Both tables are still compiled into every pipeline, so `tune worldgen.desert.duneHeightM 8` or
  `tune terrain.temperate.spawnRingRadius 20` is accepted, changes the data hash, prints success and has no effect,
  not even on `dev.seed` regenerate. The spawn and richness numbers live on the `temperate` row but apply to desert
  and ocean planets too. Only the move multipliers of `terrain` reach the sim through `ctx.data`.
- **Why it is like this:** a planet is generated once, before any pipeline exists; generation must not depend on a
  host's live tunes.
- **To resolve:** decide whether generation numbers are tunable. Recommendation: no; then mark these tables or
  fields non-tunable (reject them in `applyOverrides` with a clear message) and move the spawn / richness fields from
  `terrain.temperate` into the `worldgen` profile rows.
- **Found:** 2026-11-01, world/engine review
- **Fix:** applied the recommendation: generation numbers are not tunable. `TableDef.fixed` (`shared/sim/src/data/_define.ts`, checked in `applyOverrides`) rejects `worldgen.*` and `terrain.*.code` with "cannot be tuned: …". The spawn slot and richness fields moved from `terrain.temperate` to a `worldgen.shared` row, the temperate class shares to `worldgen.temperate` (`shareFlat` …), read through `shared/sim/src/gen/profile.ts` (profile row, else `shared`). `terrain` keeps only runtime numbers (`moveMult`, `passable`, `livingMoveMult`). Same values, same planets. Tests `shared/sim/test/data/generation-data.spec.ts`.

### WE-20 · Desert and ocean deposit richness modifiers are numbers in code

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/gen/temperate.ts:42-54` (`richnessModBp`)
- **What happens:** desert metals / minerals +15 %, ocean oil +20 % and metals −15 % are literals in `richnessModBp`;
  only the temperate modifiers come from `data/terrain.ts`. This breaks the D-35 rule "every balance number is a data
  row" (`shared/sim/README.md` rules).
- **Why it is like this:** the modifiers were added when the desert and ocean profiles landed (D-38), next to the
  existing temperate code path.
- **To resolve:** add `metalsRichnessModBp` / `mineralsRichnessModBp` / `oilRichnessModBp` to each `worldgen` profile
  row and read them there (bump `GEN_VERSION` only if values change).
- **Found:** 2026-11-01, world/engine review
- **Fix:** `metalsRichnessModBp` / `mineralsRichnessModBp` / `oilRichnessModBp` are `worldgen` fields (shared 10000, desert metals / minerals 11500, temperate minerals 11500, ocean oil 12000 / metals 8500), read by `getDepositRichnessBp`. Same values. Test `generation-data.spec.ts` › "desert metals / minerals +15 % …".

### WE-21 · The generation-time performance test uses wall-clock budgets

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/test/gen/world.spec.ts:90-97` (radius 56 < 250 ms, radius 120 < 1.5 s), also
  `shared/sim/test/host/sim-host.spec.ts:186` ("size and speed")
- **What happens:** `performance.now()` budgets pass locally but can fail on a loaded CI runner or a slow laptop
  unrelated to any change.
- **Why it is like this:** the budgets document the D-38 performance target next to the code.
- **To resolve:** move timing checks to a benchmark script, or widen the budgets and run them only with an env flag.
- **Found:** 2026-11-01, world/engine review
- **Fix:** the wall-clock generation test runs only with `SIM_PERF=1` (`shared/sim/test/gen/world.spec.ts`, documented in `docs/dev/DEV_TOOLS.md`); `sim-host.spec.ts` "size and speed" only logs timings and asserts sizes, so it stays.

## Landing planner and presence

### WE-22 · The presence index misses changes made in the same tick as its newest stamp

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/world/presence.ts:112-147` (`storeStamp` = `count:maxChangedAt:removed.length`)
- **What happens:** the cached spatial index is rebuilt only when the entity count, the max `changedAt` or the
  removal count moves. A change to an entity in the same tick as the newest stamp (a unit moving, an HQ dying) leaves
  all three unchanged, so `entitiesNear`, `colonyPresence` and the landing planner's `blockers` keep returning the old
  position or a dead entity, for the rest of the step and, if nothing else changes, in later steps too. Probe: spawn
  an HQ at tick 10, query, `setField(hp, 0, 10)`: `entitiesNear` still returns it with hp 900 and `colonyPresence`
  still counts it.
- **Why it is like this:** the stamp was meant to detect store changes cheaply; `changedAt` is per tick, not per write.
- **To resolve:** key the cache on `meta.tick` too and rebuild whenever the store's newest stamp equals the current
  tick, or keep a write counter on the entity store and compare that.
- **Found:** 2026-11-01, world/engine review (probe)
- **Fix:** the spatial index keeps a copy of the ten columns it reads and is reused only while they are value-for-value identical (`shared/sim/src/world/presence.ts`), so a death or move in the newest stamp's tick, or a write that skips the stamp, rebuilds it. Test `shared/sim/test/world/presence.spec.ts` › "sees changes made in the same tick as the newest stamp" (failed before).

### WE-23 · The runtime Hub-site fallback can take tiles from another colony's territory

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/src/gen/starterSpace.ts:57-79` (line 74), `shared/sim/src/world/landingPlanner.ts:69-75`,
  `shared/sim/src/systems/landing/index.ts:174`, `shared/sim/src/data/hub.ts:36` (`claimRadius: 10`)
- **What happens:** when no ready 3×3 lies within 3 tiles of a landing, `ensureStarterHubSpace` levels one and sets
  every footprint tile owned by another colony to `owner = -1` (leaving `anchors` and `graceUntil` as they were). The
  landing rule only checks the landing tile's owner and keeps 6 tiles from other colonies' structures, while a Hub
  claims 10 tiles, so a landing 7–10 tiles from a foreign Hub, on rough ground, can cut a hole in that colony's
  territory. The fallback also flattens trees / rock without yield and deletes visible deposits.
- **Why it is like this:** the fallback guarantees every landing a Hub site; it was written for generation time,
  when no colony owns anything.
- **To resolve:** at runtime, skip candidate footprints that touch foreign-owned tiles (and refuse the landing with
  `landing_site_taken` if none is left), or make `landingBlock` require the 3×3 search area to be free of foreign
  territory. Add a test with a foreign Hub nearby.
- **Found:** 2026-11-01, world/engine review
- **Fix:** `ensureStarterHubSpace` never levels a footprint that touches another colony's territory and no longer clears foreign ownership; `landingBlock` refuses (`landing_site_taken`) a landing whose every starter Hub footprint touches foreign territory (`starterHubSiteBlocked`, `shared/sim/src/gen/starterSpace.ts`, `world/landingPlanner.ts`), so `spawnColonyLanding` always finds a site. Edge: a landing at the rim where no 3×3 fits the grid is now refused too. Tests `shared/sim/test/gen/starterSpace.spec.ts` › "starter Hub space next to foreign territory". The fallback still flattens trees / rock without yield (by design: it guarantees the Hub site).

## Data tables and tuning

### WE-24 · Alias fields in `hq`, `hub` and `opsBasic`: unit conversion and `tune` hit fields nobody reads

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/hq.ts`, `shared/sim/src/data/hub.ts`, `shared/sim/src/data/ops-basic.ts`;
  readers `shared/sim/src/systems/terraform-basic/queue.ts:65-66`, `shared/sim/src/systems/hq/index.ts:294-296`,
  `shared/sim/src/systems/construction/build.ts:55-62`, `shared/sim/src/systems/landing/index.ts:69-76`,
  `shared/sim/src/systems/territory-claim/index.ts:138-140`
- **What happens:** rows carry the same number under several names, and the converted (`units:`) field is often not
  the one the code reads:
  - `opsBasic`: `timeS` (converted to ticks, never read) / `baseTimeS` (read, seconds) / `designSeconds`; `energy` /
    `energyCostE`; `fromTerrain`, `toTerrain`, `toPrep`, `unlockStage` are never read (the op → terrain mapping is
    hard-coded in `queue.ts:118-136` and `work.ts:35-41`).
  - `hq.t1`: `cellSelfRechargePerS` and `cellFastRechargePerS` (converted, never read) vs
    `designCellSelfRechargePerS` / `selfRechargeEPerS` and `designCellFastRechargePerS` / `hubRechargeEPerS` (read
    in that order); `cellCapacityE`, `designSpeedTilesPerS`, `supply`, `gridDrawPerS`, `maxBuildTier`,
    `selfPreservationHpRatio`, `cellFastRechargeShedGroup` unread. `hq.startingKit.autoPlaceIdleS` unread;
    `podDescentS` is read by comparing the compiled ticks with `designPodDescentS` to guess its unit.
  - `hub.t1`: `buildS` / `designBuildS` / `buildTimeS`, resolved by comparing against the literals 30 and 150;
    `founderCoreGenPerS` / `founderCoreEPerS` / `powerGen`; `footprintD`, `footprintH`, `powerDrainPerS`,
    `pylonSpan`, `pylonMaxLoad` unread.
  So `tune hq.t1.cellSelfRechargePerS 10` or `tune opsBasic.clear.timeS 1` succeeds and changes nothing, and
  `tune hub.t1.buildTimeS 30` after another build-time tune is ignored by the literal comparison.
- **Why it is like this:** rows were merged from several issue branches, each with its own field names; readers fall
  back through all of them.
- **To resolve:** one field per number (the converted one, read as ticks), delete the aliases and the literal
  comparisons, and add a test that every non-`id`/`wave` field of every table is read somewhere (or listed as
  reserved for a later wave).
- **Found:** 2026-11-01, world/engine review
- **Fix (engine side):** `TableDef.fixed` lets a table reject fields nobody may tune (WE-19); `shared/sim/test/data/generation-data.spec.ts` › "every field of the engine-owned tables is read" checks that every field of `dev`, `terrain` and `worldgen` is named in sim code or listed as reserved (negative control: a bogus field fails it).
- **Fix (gameplay side, SIM-GAMEPLAY):** the aliases are gone (one field per value, read through `systems/rows.ts`, compiled units converted back only for display; see XC-01 / GP-25), and `hq`, `hub`, `opsBasic` are in `CHECKED_TABLES` with the later-wave fields listed in `RESERVED`.

## Lint, dead code and docs

### WE-25 · The purity lint misses `**` and locale-dependent APIs

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/eslint.rules.js:23-26` (`ENGINE_MATH`), `:6-12` (`GLOBALS`)
- **What happens:** `Math.pow` is banned as engine-dependent, but the `**` operator (same operation) is not;
  `Intl`, `localeCompare` and `toLocale*` (locale-dependent results) are not banned either. No sim code uses them
  today (grep), but nothing stops a future one.
- **Why it is like this:** the list was written from the `Math` functions ECMAScript leaves to the engine.
- **To resolve:** add `no-restricted-syntax` for `BinaryExpression[operator='**']` /
  `AssignmentExpression[operator='**=']`, `Intl` to the globals, and `localeCompare` / `toLocaleString` to the
  restricted properties; extend `test/lint/purity.spec.ts`.
- **Found:** 2026-11-01, world/engine review
- **Fix:** `shared/sim/eslint.rules.js` bans `**` / `**=` (shared `PURE_SYNTAX`, repeated in every sim `no-restricted-syntax` config), the `Intl` global and `localeCompare` / `toLocale*`. Tests in `shared/sim/test/lint/purity.spec.ts` (five new cases).

### WE-26 · `grid/tileModel.ts` exports an API only tests use

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/tileModel.ts` (`blocksDirectFire`, `terrainMoveMultiplier`,
  `groundMoveMultiplier`, `isTileOwnedBy`, `isTileUnclaimed`, `markTileExplored`, `isTileExplored`,
  `extractTileChanges`, the key ↔ code converters, the `valid` mask in `TileLayersLike`), `shared/sim/src/host/view.ts:76` (`buildView`)
- **What happens:** none of these is used outside its own file except by tests (grep over `shared/sim/src`,
  `frontend`, `backend/app/src`, `scenarios`); no grid ever has a `valid` mask. `markTileExplored` duplicates
  `revealVision`'s bit logic (`systems/hq/index.ts:74-91`).
- **Why it is like this:** the tile model was built as a standalone issue (W01-08) with its own acceptance tests,
  before the systems that would call it.
- **To resolve:** delete what no wave plans to use, or mark the rest as the presentation-safe API for the client.
- **Found:** 2026-11-01, world/engine review
- **Fix:** deleted `terrainMoveMultiplier`, `groundMoveMultiplier`, `isTileOwnedBy`, `isTileUnclaimed`, the `HexGrid` alias and the never-set `valid` mask (`shared/sim/src/grid/tileModel.ts`, tests updated). Kept and documented: `blocksDirectFire` (UO-W-02, combat wave), the key ↔ code converters (terraform ops use them; labels for tools), `markTileExplored` / `isTileExplored` (now used by `revealVision`), `extractTileChanges` (diff inspection for tests and tools). `buildView` (`host/view.ts`) stays while `test/systems/landing.spec.ts` (SIM-GAMEPLAY) imports it; it is an alias of `view` and can go once that spec switches.

### WE-27 · `shared/sim/README.md` lags the code in three places

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/README.md:13,79,90`
- **What happens:** line 13 lists the tile layers without `anchors`, `graceUntil` and the hidden `subDeposit` /
  `subRichness`. Line 79 says stages "seed per sector, never from another sector", but `temperateTerrain` and
  `deposits` rank the whole planet with the global `gen` rng stream, and `reliefDesert` / `classifyDesert` read
  landforms and neighbours across sector borders (only the random draws are per sector). Line 90 says the lint bans
  "non-contracts `@terra/*` imports", while `@terra/ledger` is allowed too (`eslint.rules.js:72`).
- **Why it is like this:** the README sections were written with W00 / early W01 and not revisited.
- **To resolve:** update the three lines.
- **Found:** 2026-11-01, world/engine review
- **Fix:** `shared/sim/README.md`: the tile-layer row lists `anchors`, `graceUntil` and the hidden `subDeposit` / `subRichness`; the generation section says which stages seed per sector and which rank the whole planet with the `gen` stream (and that reads cross sector borders); the lint line names `@terra/contracts` and `@terra/ledger`, `**` and the locale APIs.

## Found during the review-fix round

### WE-28 · A path-queue step budget below 64 never lets a search past 32 expansions

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/pathSearch.ts` (`continueAStarSearch`, `MAX_POCKET_NODES`), `shared/sim/src/grid/pathQueue.ts` (`stepPathQueue`)
- **What happens:** the sealed-goal-pocket check after expansion 32 needs `MAX_POCKET_NODES` (64) of budget left in
  one call and is deferred otherwise. `stepPathQueue(state, budget)` with a budget below 64 therefore defers it every
  step: the head search never gets past 32 expansions and the queue stalls (probe: budget 8 on a 20-tile route).
- **Why it is like this:** deferring (not skipping) keeps a resumed and a replayed search identical; the game always
  passes `PATH_EXPANSION_BUDGET_PER_STEP` (2 000), so the head search always gets a full budget at the start of a step.
- **Workaround / mitigation:** documented on `stepPathQueue`; tests use budgets ≥ 96 (`test/grid/path-queue.spec.ts`).
- **To resolve:** nothing unless a caller needs tiny budgets; then clamp the budget to `MAX_POCKET_NODES`.
- **Found:** 2026-11-01, review-fix round (writing the WE-15 tests)

### WE-29 · Every path search still allocates planet-sized arrays

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/pathSearch.ts` (`createAStarSearch`)
- **What happens:** each search allocates seven typed arrays of `count` entries (≈ 300 KB at radius 56), even for a
  3-tile walk. The WE-17 fix removed the fills and the repeated layer / footprint lookups, not the allocation.
- **Why it is like this:** a paused head-of-queue search owns its arrays across steps, and one sim thread runs many
  planets plus one-shot `findHexPath` calls in between, so a shared scratch buffer would corrupt a paused search.
- **Workaround / mitigation:** typed-array allocation is zero-filled by the engine; no fill pass remains.
- **To resolve:** if profiling shows it matters, pool arrays per radius and hand them back when a search finishes
  (never while it is paused), or size the arrays to a bounding box of the search.
- **Found:** 2026-11-01, review-fix round (WE-17)

## Found in the W02 review (rounds 1–2)

### WE-30 · Unread day-cycle fields in `economyT1Basic.dayCycle`

- **Status:** Open (decision in GP-53)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/economy-t1-basic.ts` (row `dayCycle`), `shared/sim/src/systems/environment/index.ts` (`dayLengthTicksFor`, `getSunriseHour`, `SUNSET_HOUR`), `shared/sim/test/data/generation-data.spec.ts` (`CHECKED_TABLES`)
- **What happens:** `dayCycle.dayLengthS` 1200 / `designDayLengthS` 1200 and `dayCycle.sunriseHour` 6 are read by no sim code (`dayLengthS` only by `test/data/w02-data.spec.ts`); the environment takes the day length from `time.cycle` and computes sunrise as `SUNSET_HOUR` 18 + 24 × night share − 24 (temperate 45 % → 04:48), so the "morning 06:00" the row suggests is 1.2 game hours after the sim's sunrise. `tune economyT1Basic.dayCycle.dayLengthS …` succeeds and changes nothing. The row's other fields (`defaultNightShare`, `nightShareByPlanetType`, `economyRateScale`, …) are read. `economyT1Basic` is not in `CHECKED_TABLES`, so the "every field is read" test does not see it; note that its check is textual and would also pass on the comment in `environment/index.ts` that names `dayCycle.dayLengthS`.
- **To resolve:** after the owner's day-length choice (GP-53), delete the losing fields or read them, and add `economyT1Basic` (and `unitsWorkersBasic`, `time`) to `CHECKED_TABLES` with a `RESERVED` list.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### WE-31 · `RESOURCE_INCOME_TABLE` contradicts the economy rows and is read only by a spec

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/resources.ts` (`RESOURCE_INCOME_TABLE`, exported through `data/index.ts`), `shared/sim/test/systems/w02-resource-harvest-terraform.spec.ts`
- **What happens:** besides the `forest` / `rock` mirrors of the `opsBasic` yields (already `@deprecated`), the table lists rates no system reads: `harvester.metals` 1.875/s, `harvester.minerals` 1.5/s, `harvester.oil` 1.25/s (the row gives 0.5/s: `harvestRatePerS` 2.0 × 0.25), `extractor.metals.t1` 2.5/s (the row gives 1.0/s: `outputPerS` 4.0 × 0.25), `solar.t1` 20 E/s (matches `netOutputPerS` 20) and `command.hub` 8 E/s + 0.5 water/s. Only the spec asserts them; a reader of the table gets the wrong harvester and extractor rates.
- **To resolve:** delete the rate entries (keep the yield mirrors until their callers move to `groundWorkYields`) and drop them from the spec, or derive them from the compiled rows.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)
