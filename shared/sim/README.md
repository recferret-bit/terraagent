# @terra/sim — the one engine (D-31)

Every game rule lives here. The same code runs on the server (worker threads), in the browser as the replica +
prediction worker, and as the local host (`?host=local`). It is pure and isomorphic (SIM-D-06): no Node or DOM APIs,
no clock, no `Math.random`, no I/O. The `tsconfig.json` has no DOM or Node types; tests use `tsconfig.test.json`.

## Kernel API

| Piece | File | Notes |
|---|---|---|
| `PlanetState` | `src/kernel/state.ts` | `meta`, `rng` (named xoshiro128** streams), `grid` (tile layers), `colonies`, `entities` (SoA store), `blobs` |
| Entity store | `src/ecs/store.ts`, `columns.ts` | Rows in ascending id order; `insertRow`, `removeRow`, `rowOf`, `setField` (stamps `changedAt`) |
| Tile layers | `src/grid/layers.ts` | `terrain`, `prep`, `deposit`, `richness`, `height`, `owner`, `explored`, `changedAt`; `touchTile` after writes |
| Hex math | `src/grid/hex.ts` | Axial coords, `hexIndex(R)` tables, distance, plane ↔ axial (also safe on the client main thread) |
| `step(state, cmds, dt, pipeline)` | `src/kernel/step.ts` | Slot 0 applies commands through handlers, then systems in slot order (0–14), then `tick += dt` |
| Systems | `src/kernel/system.ts` | `defineSystem({ id, slot, wave, run })`; a disabled wave's system does not run |
| Command handlers | `src/kernel/commands.ts` | `defineCommandHandler({ kind, wave, handle })`; return a reject code, never throw |

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
| Runner | `units/runner.ts` | think (die / ask providers / execute) → move → settle (a command whose route ended this step runs once more) |
| Approach | `units/approach.ts` | "walk until within `[minDist, maxDist]` of a tile": shared first phase of move, build, terraform, attack |
| Orchestrator | `units/movement/orchestrator.ts` | `requestMove` / `cancelMove` / `runMovement`; failed path = failed command, never a straight line; re-plans if the next waypoint becomes blocked |
| Pathfinding service | `grid/pathQueue.ts`, `grid/pathSearch.ts`, `grid/pathProfiles.ts` | FIFO of plain-data requests (profile `ground`, goal band); resumable A*; a restored state replays the paid expansions, so it resolves on the same step |
| Locomotion | `units/movement/locomotion.ts` | Moves at the data speed along waypoints; nothing else may move a live entity |

- **What blocks a ground unit:** `grid/geo.ts` `isGroundMoveBlocked`: uncleared trees and rock, and every resource
  deposit (the ore / crystal / oil nodes stand on the tile); Deep water, ridges and moats by terrain. A target on such a
  tile is rejected `site_blocked`; a target that cannot be reached fails the command (`lastFailure`, toasted once by the client).
- **Client rendering (sync):** the client predicts with this same code; units are drawn from tick-keyed poses at a
  monotonic render clock (`frontend/game/app/online/entityMotion.ts`), so prediction handing over to the confirmed
  state never draws a step back. `test/units/sync.spec.ts` checks replica and prediction match the authority each tick.
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
  small part in `gen/world/stages/` (`reliefDesert`, `classifyDesert`, `temperateTerrain`, `deposits`, `subsurface`,
  `landing`). Add a landform / biome as a new stage (`registerWorldStage`) + profile row, never by editing a stage.
  Stages seed per sector (`ctx.seed(stage, sectorId)`), never from another sector. Bump `GEN_VERSION` when output changes.
- `height` is **metres** (the renderer draws it as is). Every spawn slot gets a levelled landing zone and a Hub site.
- Hidden layers (`FieldDef.hidden`: `subDeposit`, `subRichness`) are server-only: client snapshots / diffs use
  `{ forClient: true }`. `revealSubsurface` (Clear / Break) moves a buried deposit into the public layers.
- Sectors: 8×8 axial blocks in a quadtree. Every tile stamp (`touchTile`, `stampTile`, `applyDiff`) keeps the per-sector
  max `changedAt`, which `diffSince` uses to skip untouched sectors. A bulk write to `changedAt` calls `forgetTileStamps`.

## System registry and purity lint (SIM-T-01, SIM-D-06)

- A sim module is a folder `src/systems/<name>/index.ts` whose default export is `defineSimModule({ id, wave, systems?, handlers? })`. `npm run gen` (scripts/gen/sim-systems.gen.mjs) lists them into `src/systems/index.generated.ts` (`SIM_MODULES`); folders starting with `_` are ignored. Commit the generated file.
- `createEngineConfig({ flags, data })` / `createRegistryPipeline(...)` build the default engine from the registry. Slots (0-14) with no system are no-ops; the tick always advances.
- `eslint.rules.js` bans clocks, `Math.random`, timers, I/O, host globals, `node:*`, async/await and non-contracts `@terra/*` imports in `src/**`. `test/lint/purity.spec.ts` proves it against `test/lint/banned-apis.fixture.ts` (excluded from `npm run lint`).

## Economy: one door, whole units, postings for the host ledger (`src/economy/`)

- **One door.** Every change to a colony's resources goes through `treasury(state, ctx).add({...})` or
  `.withdraw({...})` with `colony`, `amounts`, a `reason`, an `actor` and usually a `ref`
  (e.g. `{ reason: 'construction.spend', actor: colonyActor(state, i), ref: 'order:42' }`). Never write `col.stock`.
  Each change that moves something records exactly one balanced posting (`LedgerPosting`: colony ↔ the reason's
  `sys:*` counter, with `reason`, `actor`, `ref` and `at` = `ctx.tick`); a change that moves nothing (all zeros, fully
  capped) records none. Results carry the `posting` when there is one.
- **`TreasuryCtx` rule.** `treasury(state, ctx)` takes a `TreasuryCtx` (`{ tick, record(p) }`). Inside `step()` pass
  the step's `StepContext` (it is one), so the change is stamped with the tick the step produces and its posting
  reaches the host. Code that takes an optional step ctx uses `treasuryCtx(tick, ctx)` (records into the ctx when it
  has `record`, else discards). `unrecorded(tick)` discards postings: only for tests and seeding a planet before it
  runs (`setColonyStock(state, i, target, ctx = unrecorded(state.meta.tick))`), never in gameplay. Construction money
  that moves stock (`spendConstructionSlice`, `refundCancelledConstruction`) takes a `TreasuryCtx`; `payConstructionCost`
  is only the affordability gate. Resources enter a colony only through postings (landing cargo, yields, grants, …):
  tests that spawn an HQ without landing seed the cargo with `setColonyStock(state, i, resolveStartingCargo())`.
- **Whole major units.** Amounts are safe integers; fractions, negatives, unknown keys, bad colony indices and
  disallowed reasons are rejected with a code (`invalid_amount`, `invalid_resource`, `invalid_reason`), never thrown;
  a credit that would leave the safe-integer range is `invalid_amount` (`detail: 'balance overflow'`). `withdraw` is
  all-or-nothing (`insufficient_funds` with the first short resource). A reject changes nothing and records nothing.
  Shares go through `@terra/ledger` helpers: `owedAt(total, progress)` for gradual payments (settles exactly at 1.0),
  `shareBp(amount, bp)` for refunds (floor). `add({ clampToCap: true })` credits what fits under the family caps
  (`getColonyCaps`, `INITIAL_CAPS`) and reports `overflow`.
- **Reasons catalog.** `LEDGER_REASONS` (`reasons.ts`) is closed: each reason names its allowed directions and its
  counter account (`landing.cargo` ↔ `sys:cargo`, `terraform.yield` ↔ `sys:world`, `construction.spend`/`.refund` ↔
  `sys:construction`, `dev.grant` ↔ `sys:dev`, `admin.correction` ↔ `sys:admin`, …). `sys:*` accounts may go
  negative (sources/sinks, `isSystemAccount`); `colony:<i>` accounts may not. Actors: `colonyActor(state, i)`
  (`player:<id>` or `colony:<i>`), `systemActor(name)`, `DEV_ACTOR`.
- **State is the balance, the journal is the host's.** `col.stock` (zero-filled) is the colony's balance and, with the
  `col.resources` family summary, all the sim keeps and syncs; there is no ledger blob in state. Postings leave the
  step in `StepResult.postings` (`SimHost.onPostings` for listeners) and are host-only: the server persists them to
  Postgres, the local host (`?host=local`) keeps them in memory, clients never receive them. A `@terra/ledger`
  `Ledger` (negative policy `isSystemAccount`) fed with every posting has `colony:<i>` balances equal to `col.stock`
  at every tick (`test/economy/hub-build.ledger.spec.ts`).
- **Reads and seeding.** `getColonyStock(state, i)` is the one reader (zero-filled `Stock`). `setColonyStock(state, i,
  target, ctx?)` moves a colony to an exact stock with at most one withdraw and one add `admin.correction` posting by
  `system:admin` (scenarios, tests); gameplay never uses it.

## Landing (`systems/landing/`, `systems/dev/land.ts`)

- `checkColonyLanding` validates, `spawnColonyLanding` validates first and changes **nothing** when rejected; it
  returns `{ ok: true, podEntityId, q, r }` or `{ ok: false, code }`. `system.spawnColony` and `dev.land` return the code.
- A colony lands once (`already_landed`, also for `dev.land` with `(q, r)` on a colony that has a pod), so its
  `landing.cargo` is credited once.
- Explicit `(q, r)` on a slot claimed by another colony, or within `hq.startingKit.minLandingSeparation` (6) of another
  colony's pod, is `landing_site_taken`; off the map is `invalid_args`. Without `(q, r)` the colony takes its preferred
  slot (`slotIndex ?? colonyId`) if free, else the first free slot, else `landing_site_taken`; a planet without slots
  lands at (0, 0).
- `dev.land` deploys an undeployed pod now; relocating it to `(q, r)` within the separation of another colony's pod is
  `landing_site_taken`, off the map `invalid_args` (pod untouched).
