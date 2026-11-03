# @terra/sim — the one engine (D-31)

Every game rule lives here. The same code runs on the server (worker threads), in the browser as the replica +
prediction worker, and as the local host (`?host=local`). It is pure and isomorphic (SIM-D-06): no Node or DOM APIs,
no clock, no `Math.random`, no I/O. The `tsconfig.json` has no DOM or Node types; tests use `tsconfig.test.json`.

## Kernel API

| Piece | File | Notes |
|---|---|---|
| `PlanetState` | `src/kernel/state.ts` | `meta`, `rng` (named xoshiro128** streams), `grid` (tile layers), `colonies`, `entities` (SoA store), `blobs` |
| Entity store | `src/ecs/store.ts`, `columns.ts` | Rows in ascending id order; `insertRow`, `removeRow`, `rowOf`, `setField` (stamps `changedAt`) |
| Tile layers | `src/grid/layers.ts` | `terrain`, `prep`, `deposit`, `richness`, `height`, `owner`, `explored`, `anchors`, `graceUntil`, `changedAt`, and the hidden (server-only) `subDeposit` / `subRichness`; `touchTile` after writes |
| Hex math | `src/grid/hex.ts` | Axial coords, `hexIndex(R)` tables, distance, plane ↔ axial (also safe on the client main thread) |
| `step(state, cmds, dt, pipeline)` | `src/kernel/step.ts` | Slot 0 applies commands through handlers, then systems in slot order (0–14), then `tick += dt` |
| Systems | `src/kernel/system.ts` | `defineSystem({ id, slot, wave, run })`; a disabled wave's system does not run |
| Command handlers | `src/kernel/commands.ts` | `defineCommandHandler({ kind, wave, handle })`; return a reject code or `{ code, detail }` (hosts pass `detail` in `cmd.reject.detail`, GP-31), never throw |

## Rules for code in this package

- **Change tracking is the sync contract.** Stamp every change with the tick the step produces (`ctx.tick`):
  `setField` for entity fields, `touchTile(state, i, ctx.tick)` after writing a tile layer, `setBlob` for blobs,
  `colony.changedAt = ctx.tick` for colony records. `diffSince(tick)` sends exactly what was stamped.
- **New state registers, it does not edit the codec or the diff:** `defineEntityColumn`, `defineTileLayer`, or a
  named blob. Codec, diff and clone iterate those tables.
- **Iteration order is fixed:** entities by ascending id, colonies by index. Randomness only from `ctx.rng(stream)`.
- **One rule function per previewable rule (D-37):** building placement is `evaluatePlacement(world, opts)` in `systems/construction/placement.ts` over a read-only `PlacementWorld` (`placementWorldFromState` adapts `SimState`; the client adapts its replica view). Tile meaning (`geoBuildBlock`, `isGroundObstacle`) lives in `grid/geo.ts` and is shared with movement and the starter-site guarantee. The `placeBuilding` handler is the authority on the server and in the local host; the client only previews with the same function.
- **Balance numbers live in `src/data/*.ts` rows** (D-35), never in system code.

## Units: commands, one movement path, no teleports (SIM-M, `src/units/`)

Every unit (today the HQ; any kind registered in `units/mobility.ts`) is driven the same way:

```
input ──► unit command ──► units runner (slot 5) ──► movement orchestrator ──► pathfinding service ──► locomotion
 player handler (moveUnit, stopUnit)   execute()     requestMove(goal band)   grid/pathQueue.ts + A*     the ONLY writer
 work provider (terraform, build)      per step      one live request/unit    2 000 expansions/step       of x, y, q, r
 runner itself (die at 0 HP)                         routes in blobs.unitMotion  (SIM-T-02)
```

| Piece | File | Notes |
|---|---|---|
| Command kinds | `units/types.ts`, `units/commands/*`, `systems/*/work.ts` | `move`, `stop` (immediate), `die` (immediate), `attack`, `build`, `terraform`; plain data in `blobs.units` (`current`, `queue`, `holdUntil`, `skip`) |
| Registry + entry point | `systems/units/registry.ts` | `UNIT_REGISTRY` (commands + work providers in priority order); `issueUnitCommand(state, row, cmd, ctx, { queue })` |
| Runner | `units/runner.ts` | slot 5: think (die / ask providers / `execute`) → move → settle (a command whose route ended this step runs once more); `stepUnitWork` runs each command's `work` in its `phase` slot: build / terraform progress in 6 (`constructionProgress`, before `constructionSite`), damage in 10 (`combat`). HQ cell recharge is in 7 (power) |
| Approach | `units/approach.ts` | "walk until within `[minDist, maxDist]` of a tile": shared first phase of move, build, terraform, attack |
| Orchestrator | `units/movement/orchestrator.ts` | `requestMove` / `cancelMove` / `runMovement`; failed path = failed command, never a straight line; re-plans if the next waypoint becomes blocked |
| Pathfinding service | `grid/pathQueue.ts`, `grid/pathSearch.ts`, `grid/pathProfiles.ts` | FIFO of plain-data requests (profile `ground`, goal band); resumable A*; a restored state replays the paid expansions, so it resolves on the same step |
| Locomotion | `units/movement/locomotion.ts` | Moves at the data speed along waypoints; nothing else may move a live entity |

- **What blocks a ground unit:** `grid/geo.ts` `isGroundMoveBlocked`: uncleared trees and rock, and every resource
  deposit (the ore / crystal / oil nodes stand on the tile); Deep water, ridges and moats by terrain; and building
  footprints (`defineGroundOccupancy`, registered by `systems/construction/occupancy.ts`). A unit standing inside a
  footprint (the HQ when a Hub is placed on it) may only walk out of it, and never works from inside one. A target on
  a blocked tile is rejected `site_blocked`; a target that cannot be reached fails the command (`lastFailure`, player
  commands only, toasted once by the client).
- **Ground changes restart paused searches:** terrain / prep / deposit writes and placing or removing a building bump
  `meta.pathEpoch`; a search paused across steps restarts from scratch on every host when it changed, and so does one
  whose compiled data hash changed (a dev `tune` of the step costs). The A* is weighted past 6 tiles: a path costs at
  most ≈ 1.6× the cheapest (measured worst 1.17×, `test/grid/path-bound.spec.ts`).
- **Client rendering (sync):** the client predicts with this same code; units are drawn from tick-keyed poses at a
  monotonic render clock that follows the newest *confirmed* tick at the measured sim rate
  (`frontend/game/app/online/entityMotion.ts`), so walking speed is constant and the prediction handing over to the
  confirmed state never draws a step back (a walk starts ~0.3 s after the click; panel and target ring react at once). `test/units/sync.spec.ts` checks replica and prediction match the authority each tick.
- **No engine-dependent `Math`** (`sin`, `atan2`, `exp`, …; lint `ENGINE_MATH`): use `kernel/detMath.ts` (`atan2Det`, + − × ÷ only).
- **Never write an entity's position** (`setField(…, 'x'|'y'|'q'|'r')`, `cols.x[row] = …`) outside locomotion. Spawn with
  `placeSpawnedEntity` (`ecs/placement.ts`, throws for an existing row); admin moves (`dev.teleport`, `dev.nudge`, `dev.land`)
  call `adminRelocateEntity`, allowed only in `systems/dev/`. The sim lint enforces this (rule message `SIM-M-01`,
  proven by `test/lint/position-writes.spec.ts`); `test/units/no-teleport.spec.ts` checks no unit ever steps faster than its speed.
- **Systems do not task or move units.** They queue work (a terraform order, a construction order) and a work provider
  turns it into an `auto` command; or they call `issueUnitCommand`. A `player` command replaces auto work; auto work
  resumes when the unit is idle (after `stop`: after `hq.t1.stopHoldS`). Work reach is data (`terraformReach*`, `buildReach*`).
- **A new command kind:** one `defineUnitCommand` file + one entry in `UNIT_REGISTRY`; a new unit kind: one entry in
  `MOBILE_KINDS` with its data row.

## World generation, sectors and hidden ground (D-38, `src/gen/world/`, `src/grid/sectors.ts`)

- `createPlanet` → `generateWorld`: the planet type's profile row (`data/worldgen.ts`) lists stage ids; each stage is a
  small part in `gen/world/stages/` (`reliefDesert`, `classifyDesert`, `temperateTerrain`, `deposits`, `landing`,
  `subsurface` — the hidden subsurface runs last, on the final classes). Add a landform / biome as a new stage
  (`registerWorldStage`) + profile row, never by editing a stage. Random draws of the per-sector stages (relief, desert
  classes, subsurface) seed per sector (`ctx.seed(stage, sectorId)` / `ctx.secretSeed`); their reads may cross sector
  borders (neighbour gradients, landform fields). `temperateTerrain`, `deposits` and the spawn slots rank the whole
  planet with the `gen` rng stream. Bump `GEN_VERSION` when output changes (`test/gen/world.spec.ts` pins a fingerprint
  of every profile).
- Every generation number (relief, class shares, deposit richness, spawn slot guarantees, landing zone, subsurface) is a
  `data/worldgen.ts` row (a profile row, else `shared`, via `gen/profile.ts`). Generation reads the file rows once, so
  the table is `fixed`: `tune worldgen.*` is rejected (WE-19). The `terrain` table holds only runtime numbers.
- `height` is **metres** (the renderer draws it as is). Every spawn slot gets a levelled landing zone and a Hub site.
- Hidden layers (`FieldDef.hidden`: `subDeposit`, `subRichness`) are server-only: client snapshots / diffs use
  `{ forClient: true }`. `revealSubsurface` (Clear / Break) moves a buried deposit into the public layers.
- Sectors: 8×8 axial blocks in a quadtree. Every tile stamp (`touchTile`, `stampTile`, `applyDiff`) keeps the per-sector
  max `changedAt`, which `diffSince` uses to skip untouched sectors. A bulk write to `changedAt` calls `forgetTileStamps`.

## System registry and purity lint (SIM-T-01, SIM-D-06)

- A sim module is a folder `src/systems/<name>/index.ts` whose default export is `defineSimModule({ id, wave, systems?, handlers? })`. `npm run gen` (scripts/gen/sim-systems.gen.mjs) lists them into `src/systems/index.generated.ts` (`SIM_MODULES`); folders starting with `_` are ignored. Commit the generated file.
- `createEngineConfig({ flags, data })` / `createRegistryPipeline(...)` build the default engine from the registry. Slots (0-14) with no system are no-ops; the tick always advances.
- `eslint.rules.js` bans clocks, `Math.random`, engine-dependent `Math` and `**`, locale-dependent APIs (`Intl`, `localeCompare`, `toLocale*`), timers, I/O, host globals, `node:*`, async/await and every `@terra/*` import but `@terra/contracts` and `@terra/ledger` in `src/**`. `test/lint/purity.spec.ts` proves it against `test/lint/banned-apis.fixture.ts` (excluded from `npm run lint`).

## Economy: one door, whole units, postings for the host ledger (`src/economy/`)

Known limitations and open questions of the economy, the host journals and seating: [`docs/questions-and-limitations/economy-ledger.md`](../../docs/questions-and-limitations/economy-ledger.md).

- **One door.** Every change to a colony's resources goes through `treasury(state, ctx).add({...})` or
  `.withdraw({...})` with `colony`, `amounts`, a `reason`, an `actor` and usually a `ref`
  (e.g. `{ reason: 'construction.spend', actor: colonyActor(state, i), ref: 'order:42' }`). Never write `col.stock`.
  Each change that moves something records exactly one balanced posting (`LedgerPosting`: colony ↔ the reason's
  `sys:*` counter, with `reason`, `actor`, `ref` and `at` = `ctx.tick`; capped overflow adds counter → `sys:overflow`
  legs to it); a change that moves nothing (all zeros) records none. Results carry the `posting` when there is one.
  The colony must have a record (`state.colonies[i]`): an unknown index is `invalid_amount` (`detail: 'unknown
  colony'`), so a credit never creates placeholder colonies (GP-24). Records come from landing, `spawnHqUnit` and
  `setColonyStock` (seeding).
- **`TreasuryCtx` rule.** `treasury(state, ctx)` takes a `TreasuryCtx` (`{ tick, record(p) }`). Inside `step()` pass
  the step's `StepContext` (it is one), so the change is stamped with the tick the step produces and its posting
  reaches the host. Code that takes an optional step ctx uses `treasuryCtx(tick, ctx)` (records into the ctx when it
  has `record`, else discards). `unrecorded(tick)` discards postings: only for tests and seeding a planet before it
  runs (`setColonyStock(state, i, target, ctx = unrecorded(state.meta.tick))`), never in gameplay. Construction money
  that moves stock (`spendConstructionSlice`, `refundCancelledConstruction`) takes a `TreasuryCtx`; `payConstructionCost`
  is only the affordability gate. Resources enter a colony only through postings (landing cargo, yields, grants, …):
  tests that spawn an HQ without landing seed the cargo with `setColonyStock(state, i, resolveStartingCargo())`.
- **Whole major units.** Amounts are safe integers; fractions, negatives, unknown keys, bad colony indices and
  disallowed reasons (outside the catalog, wrong direction, or host-only like `ledger.opening`) are rejected with a
  code (`invalid_amount`, `invalid_resource`, `invalid_reason`), never thrown; a credit that would leave the
  safe-integer range is `invalid_amount` (`detail: 'balance overflow'`). `withdraw` is all-or-nothing
  (`insufficient_funds` with the first short resource). A reject changes nothing and records nothing. `checkMove(req,
  direction)` runs the same validation without moving anything (landing checks its cargo with it before it lands).
  Shares go through `@terra/ledger` helpers: `owedAt(total, progress)` for gradual payments (settles exactly at 1.0),
  `shareBp(amount, bp)` for refunds (floor).
- **One amount rule, also for data** (`economy/amounts.ts`): `isWholeAmount` / `amountsProblem` are used by the
  treasury and by the data compiler. A table lists its resource-amount fields in `amounts` (`hq` `cargo`, `hub` `cost`
  and `storageCapPerFamily`, `opsBasic` `yields`); `compileData`, every balance override and every dev `tune`
  throw on a fraction, a negative or an unknown resource key there (`data/_amounts.ts`), naming the field and value.
- **One affordability check.** `findShortfall(stock, cost)` names the first missing resource in `SHORTFALL_ORDER`
  (metals, minerals, biomass, water, then the higher bio tiers); the build waiting reason and
  `insufficient_funds` use it (placement never rejects for cost: an unaffordable building is accepted and waits, GP-30).
- **Refused credits are visible.** A system whose expected change is refused (terraform yield, construction refund,
  a construction spend refused for anything but `insufficient_funds`) calls `reportTreasuryReject(ctx, …)`: a
  `treasuryRejected` warn event (`TreasuryCtx.emit`, passed through by `treasuryCtx(tick, stepCtx)`).
- **Storage caps.** `add({ clampToCap: true })` credits what fits under the family caps (`getColonyCaps`; `capsOf` for
  a view record; before a Hub `initialCaps(data)` = `hq.startingKit.storageCaps`, metals 600 / minerals 500 / bio 500)
  and returns the rest as `overflow`, which the colony loses: the same posting moves it from the counter account to
  `sys:overflow` (`OVERFLOW_ACCOUNT`), so the journal shows every capped loss (LED-11). A completed Hub raises each cap
  to `hub.t1.storageCapPerFamily` and never lowers one (GP-11). `terraform.yield` is capped and reports the overflow in `obstacleRemoved.data.overflow`;
  `production.tick` must be capped too when it exists. Landing cargo, `construction.refund` (returns part of what was
  paid, which already fitted) and `dev.grant` (dev tool, existing colonies only) are uncapped.
- **Reasons catalog.** `LEDGER_REASONS` (`reasons.ts`) is closed: each reason names its allowed directions and its
  counter account (`landing.cargo` ↔ `sys:cargo`, `terraform.yield` ↔ `sys:world`, `construction.spend`/`.refund` ↔
  `sys:construction`, `dev.grant` ↔ `sys:dev`, `admin.correction` ↔ `sys:admin`, …). `sys:*` accounts may go
  negative (sources/sinks, `isSystemAccount`); `colony:<i>` accounts may not. Actors: `colonyActor(state, i)`
  (`player:<id>` or `colony:<i>`), `systemActor(name)`, `DEV_ACTOR`.
- **State is the balance, the journal is the host's.** `col.stock` (zero-filled) is the colony's balance and, with the
  `col.resources` family summary, all the sim keeps and syncs; there is no ledger blob in state. Postings leave the
  step in `StepResult.postings` (`SimHost.onPostings` for listeners) and are host-only, clients never receive them.
  Every host journals them with the same class, `PlanetJournal` (`host/journal.ts`); only persistence differs: the
  server writes Postgres rows and restores from SQL-summed balances, the local host (`?host=local`) keeps a bounded
  tail and saves the journal inside its IndexedDB snapshot (same tick as the planet bytes). A `@terra/ledger`
  `Ledger` (negative policy `isSystemAccount`) fed with every posting has `colony:<i>` balances equal to `col.stock`
  at every tick (`test/economy/hub-build.ledger.spec.ts`).
- **A step that throws** (LED-09). `step()` wraps a system exception in a `StepError` carrying the step's `outcomes`,
  `postings` and `events` so far; `SimHost.step` hands those outcomes and postings to its listeners (the treasury
  already changed `col.stock` for them) and rethrows. The planet is then half-stepped (`meta.tick` not advanced): the
  host decides whether to stop it (BE-12).
- **Reads and seeding.** `getColonyStock(state, i)` is the one reader (zero-filled `Stock`). `setColonyStock(state, i,
  target, ctx?)` moves a colony to an exact stock with at most one withdraw and one add `admin.correction` posting by
  `system:admin` (scenarios, tests); gameplay never uses it.

## Landing (`systems/landing/`, `systems/dev/land.ts`)

- `checkColonyLanding` validates, `spawnColonyLanding` validates first and changes **nothing** when rejected; it
  returns `{ ok: true, podEntityId, q, r }` or `{ ok: false, code }`. `system.spawnColony` and `dev.land` return the code.
- A colony lands once (`already_landed`), so its `landing.cargo` is credited once (when the pod is created, not when it
  opens). A planet takes `MAX_COLONIES_PER_PLANET` (8) colonies, one `explored` bit each: index 8 or more is
  `planet_full` (GP-17). The cargo is validated with `checkMove` before anything changes: a cargo the
  treasury would refuse (bad data) is `invalid_args` and lands nothing (no pod, no colony record, no landing record).
- **Where a colony lands is decided by the landing planner** (`world/landingPlanner.ts`, D-39):
  `nextLandingSite(state, colony, { slotIndex?, q?, r?, beyondSlots? })`. Explicit `(q, r)` is checked by
  `landingBlock`: off the map `invalid_args`; water, another colony's tile or slot, or within
  `hq.startingKit.minLandingSeparation` (6) of **any landing ever made** (`blobs.landingHistory`, kept after a colony
  is gone) or of another colony's pod / HQ / structure: `landing_site_taken`. Without `(q, r)` the colony takes its
  preferred slot (`slotIndex ?? colonyId`) if free, else the first free slot; a planet with slots then answers
  `landing_site_taken` (capacity) unless `beyondSlots`, a slotless planet searches the map (planet centre first).
  `spawnColonyLanding` appends the landing to the history (`recordLanding`); no position is ever landed on twice.
- **Presence** (`world/presence.ts`): `colonyPresence`, `faunaPositions`, `entitiesNear`, `nearestEntity`,
  `presenceView` (plain data for an AI orchestrator). New entity kinds register a role with `registerPresenceRole`.
- `dev.land` acts for the caller's colony only (`colonyIndex`; none → `not_own_colony`): a colony without a pod lands
  and opens at once; a descending pod opens now, moved to `(q, r)` first through the same `landingBlock` rule (never
  onto / near an earlier landing or another colony, never on water): `landing_site_taken`, off the map `invalid_args`
  (pod untouched); a valid move updates that colony's landing record. An opened pod is `already_landed` (GP-26).
- `landPod` (player, FA-08): opens the caller's descending pod once it has descended `hq.startingKit.podLandMinS` (5 s,
  the client's touchdown animation) instead of the full `podDescentS` (6 s); asked earlier it opens at that minimum,
  later at once. `already_landed` when open, `unknown_entity` without a pod.

## Gameplay rules (`systems/terraform-basic`, `systems/construction`, `systems/hq`)

Known limitations and open questions: [`docs/questions-and-limitations/sim-gameplay.md`](../../docs/questions-and-limitations/sim-gameplay.md).

- **Data rows** (`systems/rows.ts`, XC-01 / XC-02): one field per value, read with `w01Row` / `rowNum`, which throw on a
  missing row or field (no literal fallbacks). Fields in a table's `units` are compiled (ticks, per tick):
  `ticksToSeconds` / `perTickToPerSecond` convert back only where seconds are shown (order `buildTimeS`, job
  `baseTimeS`, prep bills). The op → terrain rule is the `opsBasic` rows' `fromTerrain` / `toTerrain` / `toPrep`.
- **Commands** (`systems/command.ts`, GP-18 / GP-19): handlers parse `args` with the contract schema (`parseArgs`); a
  colony-scoped command (player or dev) acts for `cmd.colonyIndex` and is `not_own_colony` without one. A handler may
  reject with `{ code, detail }` (`placeBuilding` passes the placement block text, GP-31).
- **Terraform rule** (`terraform-basic/rules.ts`, GP-32): `evaluateTerraform(world, opts)` / `evaluateTerraformTile`
  over a read-only `TerraformWorld` (`terraformWorldFrom(placementWorld, colony, data)`; the client builds it from its
  ghost world). Own tiles; before the colony owns territory, unclaimed tiles within
  `hq.startingKit.preHubTerraformRadius` of its pod (GP-03); linked Hub prep any unclaimed tile. Each `(op, q, r)` is
  queued once per colony (duplicates in a request and already-queued jobs are skipped, GP-01), and a job is checked
  again when picked and before it completes: a tile that changed is dropped with no yield. Lane limits
  `hq.t1.terraformMaxOrders` / `terraformMaxJobs` → `queue_full` (GP-02).
- **Orders** (GP-08 / GP-09 / GP-10): `blobs.terraformTasks = { byColony }`, `blobs.constructionQueue = { orders }`,
  written with `setBlob` (readers `terraformOrdersOf` / `constructionOrdersOf` work on view blobs too). Order ids are
  sim-made (`tf#<n>`, `build#<n>`, prep `build#<n>/prep`; counter `blobs.orderSeq`); `taskId` keeps the client's
  command id, which may name only one open order (`invalid_args` when reused). `cancelTask { taskId }` cancels in
  its own lane: an order id, a task id or a building's entity id; `'active'` = the first manual terraform order,
  `'current'` = the open construction order; a Hub's linked prep cancels the Hub; no match → `unknown_entity`.
  Completed orders leave the queue. Unknown building kinds are `invalid_args` (GP-05).
- **Player work jobs** (`terraform-basic/{workOrder,workJobs,workTile,workSystem,chain,resourceSpawn}.ts`,
  `blobs.workJobs`): `enqueueTask { terraform: { op: 'work', intent?, tiles, workerId? } }` (the direct `task` form and
  `enqueueTerraformOrder(op: 'work')` go through the same `enqueueWorkOrder`). `intent: 'repair'` repairs a damaged own
  entity on the tile (none → `site_blocked`); `intent: 'terraform'` only works the ground; no intent = repair if
  damaged, else terraform. The ground tile obeys the territory rule (`terraformOwnershipBlock`) and must not be under a
  building, anchored or a deposit (`classifyGroundWorkTile`, checked on enqueue, by the chain and again on completion:
  a tile that changed meanwhile is dropped without yield, GP-01). A command id naming an open job or order is
  `invalid_args`; a multi-tile order's jobs (`<id>:<i>`) carry `chainRootId: <id>`. A finished terraform job makes the
  tile `flat` + `prepared`, levels it, pays THE terraform yield (`opsBasic.<op>.yields`: forest = Clear's, rock =
  Break's; `terraformYields` / `groundWorkYields`), reveals buried deposits (`groundRevealed`), emits
  `obstacleRemoved { op: 'clear' | 'break' }` or `tilePrepared`, then rolls `terraformFinds.deposit`
  (`data/terraform-finds.ts`, tunable; read with `terraformFindSpec(data)`: 1% chance; family uniform
  metals/minerals/oil; tier t1 50% / t2 35% / t3 15%; `ctx.rng('misc')`) for a full deposit when the tile has none and
  no unit stands on it (`setTileDeposit(..., tier)` writes the visible `depositTier` layer, 0 = legacy t1; event
  `resourceSpawned`; Harvester and Metals Extractor pay `depositFamilyAndKey(code, tier)`). `dev.spawndeposit` places
  one. Terraform jobs **chain**: the worker's next job is the obstacle (forest, rock, slope, hole, uneven flat;
  never level grass) it may terraform and nobody targets that is closest to the tile the player clicked
  (`chainOrigin`), then closest to the tile just finished, then the lowest tile index, so it clears the area around
  the order ring by ring; id `<rootId>~<n>`. An unreachable follow-up is skipped silently until the chain finishes
  another tile, then tried again (only the ordered tile reports `no_path`); a tile still an obstacle after its own job
  is never picked again (`chainGiveUp`). `moveUnit` / `stopUnit`,
  `cancelTask` (root id, `…~n`, `unit:<id>`, `all`), a new terraform work order naming the worker, its death or no
  eligible tile end the chain. Repair jobs never chain; a repair for the chain worker queues behind its current tile
  and the chain goes on after it. While a worker has a work job no unit work provider or dispatch hands it other work
  (`systems/units/registry.ts`). A worked job draws `energyCost` evenly over its work time from the colony grid
  (`workJobDrawPerS`; walking draws nothing; no grid before the Hub = unmetered): the power core adds it to demand as
  shed group 1 (`power-core/workLoad.ts`, `ColonyPowerSummary.workDemand`), and a job the brownout shed
  (`shedWorkJobIds`) waits `power` with its progress kept until the grid carries it (GP-45). Their yields / repair
  costs / refunds use the W02 `economy/ledger.ts` helpers, not the treasury (LED-16).
- **Placement** (GP-06, GP-23, GP-30): a Hub stands within `hq.startingKit.hubMaxDistFromLanding` of its pod and not
  closer to another colony's pod or Hub (`farFromLanding` / `nearOtherColony` → `site_blocked`); an unaffordable Hub is
  accepted and waits. `occupiesGround` (alive buildings) is the one footprint rule for placement and ground paths.
- **Work** (GP-04, GP-12, GP-16, GP-21): providers are asked linked prep → construction → manual terraform. A build
  short of stock mid-way is `waiting_resources` and resumes once stock covers the slice; `statusTextOf` derives the
  text. Unit state is the units runner's (commands set it through `setUnitActivity`); failed auto work is skipped
  `retryBlockedS`, doubling per consecutive failure up to `retryBlockedMaxS`.
- **Sync** (GP-07, GP-15): queues, `blobs.hq` (`{ byColony }`) and colony records are stamped only when they change,
  so an idle planet sends no gameplay blobs. Blob state is not filtered per colony (SIMULATION §6, GP-36).
- **Planetary solar clock** (`systems/time/index.ts`, `data/time.ts`, GP-40): `time.cycle` (slot 1, wave `W00`) maintains
  `blobs.planetTime` (`{ basePhase, anchorTick, realHoursPerDay, timeScale, timeOfDay, day, daylight }`). Rather than
  broadcasting a blob diff every 200 ms tick, `setBlob(state, 'planetTime', ...)` is stamped only on initialization,
  when `setPlanetTime` / `dev.time` mutates the clock, or when live `tune time.cycle.*` overrides change the defaults;
  clients and read-only queries interpolate continuously between anchor updates via `getPlanetTimeAnchor` +
  `computePlanetTimeAtTick` (and `previewPlanetTimePatch` for unstepped previews, D-37).
