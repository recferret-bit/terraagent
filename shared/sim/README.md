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
- **Balance numbers live in `src/data/*.ts` rows** (D-35), never in system code.

## System registry and purity lint (SIM-T-01, SIM-D-06)

- A sim module is a folder `src/systems/<name>/index.ts` whose default export is `defineSimModule({ id, wave, systems?, handlers? })`. `npm run gen` (scripts/gen/sim-systems.gen.mjs) lists them into `src/systems/index.generated.ts` (`SIM_MODULES`); folders starting with `_` are ignored. Commit the generated file.
- `createEngineConfig({ flags, data })` / `createRegistryPipeline(...)` build the default engine from the registry. Slots (0-14) with no system are no-ops; the tick always advances.
- `eslint.rules.js` bans clocks, `Math.random`, timers, I/O, host globals, `node:*`, async/await and non-contracts `@terra/*` imports in `src/**`. `test/lint/purity.spec.ts` proves it against `test/lint/banned-apis.fixture.ts` (excluded from `npm run lint`).
