# Test coverage reference

Snapshot of unit-test coverage (vitest + v8) on branch `wave/w01-landfall` at commit `615fb72`, 2026-11-01, taken before the
review-fix round. Use it as a baseline: compare a new run against it, don't edit it by hand. Integration (`*.int.spec.ts`,
Postgres) and e2e (Playwright) suites are not included.

Regenerate: per package `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary` (exclude
specs, `test/`, `*.d.ts`, `index.generated.ts`), then update this file.

## Totals per package

| Package | Lines | Statements | Branches | Functions | Files |
|---|---|---|---|---|---|
| `shared/sim` | 96.4% (3613/3748) | 93.6% (4363/4662) | 82.7% (2583/3124) | 95.1% (660/694) | 107 |
| `shared/ledger` | 100.0% (149/149) | 100.0% (194/194) | 100.0% (162/162) | 100.0% (45/45) | 7 |
| `shared/contracts` | 91.7% (155/169) | 89.4% (178/199) | 53.3% (32/60) | 90.3% (28/31) | 42 |
| `shared/config` | 84.0% (21/25) | 87.5% (28/32) | 69.2% (9/13) | 83.3% (10/12) | 5 |
| `scenarios` | 92.1% (70/76) | 86.0% (98/114) | 77.1% (54/70) | 90.0% (27/30) | 9 |
| `backend/app` | 79.8% (2010/2517) | 77.1% (2406/3120) | 63.5% (1144/1801) | 78.1% (694/889) | 130 |
| `frontend/game` | 67.3% (4156/6179) | 60.7% (4726/7782) | 58.2% (2335/4009) | 55.8% (788/1411) | 133 |
| `frontend/render` | 18.9% (903/4785) | 16.6% (1092/6565) | 15.3% (323/2114) | 13.7% (116/845) | 132 |

## Per file (lowest line coverage first)


### `shared/sim`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `shared/sim/src/ecs/columns.ts` | 50.0% (5/10) | 0.0% | 33.3% |
| `shared/sim/src/systems/construction/validate.ts` | 63.6% (21/33) | 35.3% | 85.7% |
| `shared/sim/src/grid/layers.ts` | 66.7% (10/15) | 0.0% | 60.0% |
| `shared/sim/src/units/commands/move.ts` | 80.0% (4/5) | 100.0% | 50.0% |
| `shared/sim/src/systems/terraform-basic/index.ts` | 87.5% (28/32) | 70.3% | 100.0% |
| `shared/sim/src/units/book.ts` | 88.0% (22/25) | 86.7% | 90.9% |
| `shared/sim/src/grid/pathQueue.ts` | 88.9% (56/63) | 90.2% | 80.0% |
| `shared/sim/src/systems/dev/index.ts` | 90.4% (75/83) | 74.6% | 100.0% |
| `shared/sim/src/systems/construction/build.ts` | 90.8% (99/109) | 65.4% | 100.0% |
| `shared/sim/src/systems/terraform-basic/queue.ts` | 91.9% (158/172) | 82.8% | 94.7% |
| `shared/sim/src/systems/landing/index.ts` | 92.9% (105/113) | 75.5% | 93.3% |
| `shared/sim/src/codec/snapshot.ts` | 93.8% (30/32) | 86.1% | 100.0% |
| `shared/sim/src/ecs/placement.ts` | 93.8% (15/16) | 50.0% | 100.0% |
| `shared/sim/src/gen/spawnSlots.ts` | 93.8% (241/257) | 83.5% | 96.4% |
| `shared/sim/src/host/scheduler.ts` | 93.8% (61/65) | 80.6% | 86.7% |
| `shared/sim/src/systems/hq/index.ts` | 95.2% (177/186) | 73.0% | 90.5% |
| `shared/sim/src/units/movement/orchestrator.ts` | 95.2% (80/84) | 77.9% | 84.6% |
| `shared/sim/src/systems/construction/index.ts` | 96.4% (162/168) | 82.8% | 89.5% |
| `shared/sim/src/systems/territory-claim/index.ts` | 96.5% (56/58) | 57.4% | 100.0% |
| `shared/sim/src/units/commands/attack.ts` | 96.9% (31/32) | 75.0% | 75.0% |
| `shared/sim/src/grid/pathSearch.ts` | 97.5% (156/160) | 92.2% | 100.0% |
| `shared/sim/src/host/SimHost.ts` | 97.5% (39/40) | 93.3% | 85.7% |
| `shared/sim/src/systems/construction/placement.ts` | 97.8% (87/89) | 80.2% | 92.6% |
| `shared/sim/src/gen/starterSpace.ts` | 97.9% (46/47) | 80.5% | 100.0% |
| `shared/sim/src/units/runner.ts` | 97.9% (95/97) | 87.2% | 100.0% |
| `shared/sim/src/gen/temperate.ts` | 98.5% (129/131) | 91.7% | 100.0% |
| `shared/sim/src/grid/tileModel.ts` | 99.3% (140/141) | 73.2% | 97.1% |
| `shared/sim/src/systems/terraform-basic/work.ts` | 100.0% (92/92) | 86.1% | 100.0% |
| `shared/sim/src/grid/sectors.ts` | 100.0% (74/74) | 93.8% | 100.0% |
| `shared/sim/src/world/presence.ts` | 100.0% (69/69) | 78.5% | 100.0% |
| `shared/sim/src/world/landingPlanner.ts` | 100.0% (64/64) | 95.3% | 100.0% |
| `shared/sim/src/gen/world/stages/reliefDesert.ts` | 100.0% (63/63) | 100.0% | 100.0% |
| `shared/sim/src/economy/treasury.ts` | 100.0% (58/58) | 100.0% | 100.0% |
| `shared/sim/src/gen/world/stages/landing.ts` | 100.0% (56/56) | 95.8% | 100.0% |
| `shared/sim/src/host/journal.ts` | 100.0% (51/51) | 100.0% | 100.0% |
| `shared/sim/src/data/_overrides.ts` | 100.0% (49/49) | 91.8% | 94.7% |
| `shared/sim/src/ecs/store.ts` | 100.0% (48/48) | 87.0% | 88.9% |
| `shared/sim/src/host/diff.ts` | 100.0% (48/48) | 89.5% | 100.0% |
| `shared/sim/src/units/movement/locomotion.ts` | 100.0% (47/47) | 88.9% | 100.0% |
| `shared/sim/src/systems/construction/prep.ts` | 100.0% (41/41) | 87.1% | 100.0% |
| `shared/sim/src/systems/dev/land.ts` | 100.0% (35/35) | 85.1% | 100.0% |
| `shared/sim/src/index.ts` | 100.0% (34/34) | 100.0% | 100.0% |
| `shared/sim/src/units/approach.ts` | 100.0% (33/33) | 89.2% | 100.0% |
| `shared/sim/src/systems/construction/work.ts` | 100.0% (32/32) | 90.3% | 100.0% |
| `shared/sim/src/gen/world/noise.ts` | 100.0% (31/31) | 100.0% | 100.0% |
| `shared/sim/src/grid/hex.ts` | 100.0% (31/31) | 100.0% | 100.0% |
| `shared/sim/src/kernel/rng.ts` | 100.0% (29/29) | 66.7% | 100.0% |
| `shared/sim/src/kernel/step.ts` | 100.0% (29/29) | 93.8% | 100.0% |
| `shared/sim/src/systems/units/handlers.ts` | 100.0% (28/28) | 91.7% | 100.0% |
| `shared/sim/src/data/_compile.ts` | 100.0% (24/24) | 93.8% | 100.0% |
| `shared/sim/src/gen/world/stages/classifyDesert.ts` | 100.0% (20/20) | 100.0% | 100.0% |
| `shared/sim/src/gen/world/stages/subsurface.ts` | 100.0% (20/20) | 100.0% | 100.0% |
| `shared/sim/src/gen/world/context.ts` | 100.0% (18/18) | 91.7% | 87.5% |
| `shared/sim/src/gen/world/index.ts` | 100.0% (17/17) | 75.0% | 80.0% |
| `shared/sim/src/host/view.ts` | 100.0% (17/17) | 62.5% | 100.0% |
| `shared/sim/src/units/mobility.ts` | 100.0% (17/17) | 90.0% | 100.0% |
| `shared/sim/src/economy/amounts.ts` | 100.0% (16/16) | 100.0% | 100.0% |
| `shared/sim/src/economy/caps.ts` | 100.0% (16/16) | 100.0% | 100.0% |
| `shared/sim/src/grid/geo.ts` | 100.0% (16/16) | 90.6% | 100.0% |
| `shared/sim/src/gen/flat.ts` | 100.0% (15/15) | 100.0% | 100.0% |
| `shared/sim/src/grid/pathProfiles.ts` | 100.0% (14/14) | 90.9% | 100.0% |
| `shared/sim/src/codec/migrations/index.ts` | 100.0% (13/13) | 70.0% | 83.3% |
| `shared/sim/src/kernel/state.ts` | 100.0% (12/12) | 100.0% | 100.0% |
| `shared/sim/src/data/_amounts.ts` | 100.0% (11/11) | 100.0% | 100.0% |
| `shared/sim/src/economy/store.ts` | 100.0% (11/11) | 100.0% | 100.0% |
| `shared/sim/src/codec/values.ts` | 100.0% (10/10) | 100.0% | 83.3% |
| `shared/sim/src/host/tuning.ts` | 100.0% (10/10) | 50.0% | 75.0% |
| `shared/sim/src/grid/subsurface.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `shared/sim/src/kernel/detMath.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `shared/sim/src/kernel/system.ts` | 100.0% (9/9) | 84.6% | 100.0% |
| `shared/sim/src/systems/registry.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `shared/sim/src/systems/construction/occupancy.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `shared/sim/src/economy/accounts.ts` | 100.0% (8/8) | 100.0% | 100.0% |
| `shared/sim/src/units/types.ts` | 100.0% (8/8) | 50.0% | 100.0% |
| `shared/sim/src/units/commands/die.ts` | 100.0% (8/8) | 50.0% | 100.0% |
| `shared/sim/src/units/commands/stop.ts` | 100.0% (8/8) | 100.0% | 100.0% |
| `shared/sim/src/data/_hash.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `shared/sim/src/grid/path.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `shared/sim/src/host/index.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `shared/sim/src/systems/construction/placementWorld.ts` | 100.0% (7/7) | 66.7% | 100.0% |
| `shared/sim/src/economy/index.ts` | 100.0% (6/6) | 100.0% | 100.0% |
| `shared/sim/src/gen/createPlanet.ts` | 100.0% (6/6) | 92.3% | 100.0% |
| `shared/sim/src/gen/generators.ts` | 100.0% (6/6) | 50.0% | 100.0% |
| `shared/sim/src/systems/units/index.ts` | 100.0% (6/6) | 100.0% | 100.0% |
| `shared/sim/src/kernel/colonies.ts` | 100.0% (5/5) | 100.0% | 100.0% |
| `shared/sim/src/kernel/constants.ts` | 100.0% (5/5) | 100.0% | 100.0% |
| `shared/sim/src/economy/reasons.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `shared/sim/src/gen/world/stages/temperate.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `shared/sim/src/systems/units/registry.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `shared/sim/src/codec/index.ts` | 100.0% (3/3) | 100.0% | 100.0% |
| `shared/sim/src/data/index.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `shared/sim/src/economy/report.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `shared/sim/src/kernel/types.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `shared/sim/src/data/_define.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/sim/src/host/clone.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/sim/src/kernel/commands.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/sim/src/kernel/config.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/sim/src/systems/define.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/sim/src/systems/finalize/index.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/sim/src/data/dev.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `shared/sim/src/data/hq.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `shared/sim/src/data/hub.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `shared/sim/src/data/ops-basic.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `shared/sim/src/data/terrain.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `shared/sim/src/data/worldgen.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `shared/sim/src/kernel/context.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `shared/sim/src/kernel/events.ts` | 100.0% (0/0) | 100.0% | 100.0% |

### `shared/ledger`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `shared/ledger/src/post.ts` | 100.0% (53/53) | 100.0% | 100.0% |
| `shared/ledger/src/journal.ts` | 100.0% (39/39) | 100.0% | 100.0% |
| `shared/ledger/src/balances.ts` | 100.0% (23/23) | 100.0% | 100.0% |
| `shared/ledger/src/ledger.ts` | 100.0% (21/21) | 100.0% | 100.0% |
| `shared/ledger/src/amount.ts` | 100.0% (12/12) | 100.0% | 100.0% |
| `shared/ledger/src/index.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/ledger/src/types.ts` | 100.0% (0/0) | 100.0% | 100.0% |

### `shared/contracts`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `shared/contracts/src/precheck.ts` | 6.7% (1/15) | 0.0% | 0.0% |
| `shared/contracts/src/flags/index.ts` | 100.0% (25/25) | 100.0% | 100.0% |
| `shared/contracts/src/ws/sim.ts` | 100.0% (18/18) | 100.0% | 100.0% |
| `shared/contracts/src/ws/client.ts` | 100.0% (10/10) | 100.0% | 100.0% |
| `shared/contracts/src/ws/server.ts` | 100.0% (10/10) | 100.0% | 100.0% |
| `shared/contracts/src/index.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `shared/contracts/src/ids/index.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `shared/contracts/src/rest/home.ts` | 100.0% (8/8) | 100.0% | 100.0% |
| `shared/contracts/src/ws/wire.ts` | 100.0% (8/8) | 85.7% | 100.0% |
| `shared/contracts/src/envelope/index.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `shared/contracts/src/errors/index.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `shared/contracts/src/rest/auth.ts` | 100.0% (5/5) | 100.0% | 100.0% |
| `shared/contracts/src/rest/analytics.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `shared/contracts/src/ws/index.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `shared/contracts/src/rest/index.ts` | 100.0% (3/3) | 100.0% | 100.0% |
| `shared/contracts/src/commands/cancel-task.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/define.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-cell.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-grant.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-land.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-nudge.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-ping.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-reveal.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-seed.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-spawn.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/dev-teleport.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/enqueue-task.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/move-unit.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/place-building.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/stop-unit.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/commands/system-spawn-colony.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/building-completed.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/colony-founded.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/define.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/dev-pong.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/dev-tuned.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/dev-warp.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/ground-revealed.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/hq-landed.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/obstacle-removed.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/tile-prepared.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `shared/contracts/src/events/treasury-rejected.ts` | 100.0% (1/1) | 100.0% | 100.0% |

### `shared/config`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `shared/config/src/files.ts` | 0.0% (0/4) | 0.0% | 0.0% |
| `shared/config/src/section.ts` | 100.0% (12/12) | 83.3% | 100.0% |
| `shared/config/src/core.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `shared/config/src/flag.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `shared/config/src/index.ts` | 100.0% (0/0) | 100.0% | 100.0% |

### `scenarios`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `scenarios/index.ts` | 0.0% (0/2) | 100.0% | 100.0% |
| `scenarios/w01-landfall.ts` | 60.0% (3/5) | 100.0% | 50.0% |
| `scenarios/_loader.ts` | 92.0% (23/25) | 66.7% | 84.6% |
| `scenarios/parity/compare.ts` | 100.0% (35/35) | 81.8% | 100.0% |
| `scenarios/parity/_define.ts` | 100.0% (4/4) | 80.0% | 100.0% |
| `scenarios/parity/index.ts` | 100.0% (3/3) | 100.0% | 100.0% |
| `scenarios/_define.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `scenarios/w00-empty.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `scenarios/parity/w00-empty.parity.ts` | 100.0% (0/0) | 100.0% | 100.0% |

### `backend/app`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `backend/app/src/game/thread/sim-thread.ts` | 0.0% (0/36) | 0.0% | 0.0% |
| `backend/app/src/main.ts` | 0.0% (0/10) | 0.0% | 100.0% |
| `backend/app/src/near/application/outbox/index.ts` | 0.0% (0/3) | 100.0% | 100.0% |
| `backend/app/src/near/infrastructure/dev/mock-chain-read.ts` | 0.0% (0/3) | 0.0% | 0.0% |
| `backend/app/src/analytics/analytics.controller.ts` | 16.7% (3/18) | 0.0% | 50.0% |
| `backend/app/src/game/ledger/prisma-ledger-store.ts` | 16.7% (3/18) | 0.0% | 8.3% |
| `backend/app/src/near/application/outbox/op-id.ts` | 16.7% (1/6) | 0.0% | 0.0% |
| `backend/app/src/analytics/analytics.service.ts` | 20.0% (1/5) | 100.0% | 50.0% |
| `backend/app/src/near/infrastructure/adapters/chain-read/mock-chain-read.adapter.ts` | 23.5% (4/17) | 0.0% | 20.0% |
| `backend/app/src/analytics/analytics.counters.ts` | 28.6% (2/7) | 0.0% | 66.7% |
| `backend/app/src/near/infrastructure/mock/nep171.base.ts` | 29.8% (14/47) | 42.9% | 12.5% |
| `backend/app/src/near/infrastructure/dev/chain-dev.controller.ts` | 33.3% (1/3) | 100.0% | 50.0% |
| `backend/app/src/near/infrastructure/dev/chain-explorer.controller.ts` | 34.1% (14/41) | 0.0% | 10.0% |
| `backend/app/src/near/application/outbox/chain-outbox.repository.ts` | 35.3% (6/17) | 0.0% | 44.4% |
| `backend/app/src/near/application/outbox/outbox-relay.ts` | 48.6% (17/35) | 17.9% | 50.0% |
| `backend/app/src/near/infrastructure/mock/mock-chain.base.ts` | 50.0% (17/34) | 32.2% | 35.7% |
| `backend/app/src/core/auth/auth.repository.ts` | 51.3% (40/78) | 48.3% | 92.8% |
| `backend/app/src/game/persistence/snapshot-store.ts` | 53.8% (14/26) | 25.0% | 55.5% |
| `backend/app/src/core/home/home.repository.ts` | 54.9% (84/153) | 53.0% | 62.2% |
| `backend/app/src/game/thread/planet-host.ts` | 60.7% (68/112) | 38.6% | 63.6% |
| `backend/app/src/ws/home-provider.ts` | 62.5% (10/16) | 48.3% | 100.0% |
| `backend/app/src/ws/sim-command-ingress.ts` | 69.0% (29/42) | 61.2% | 62.5% |
| `backend/app/src/core/logging/nest-logger.ts` | 69.2% (9/13) | 66.7% | 50.0% |
| `backend/app/src/core/errors/core-exception.ts` | 77.8% (7/9) | 73.3% | 60.0% |
| `backend/app/src/db/db.module.ts` | 77.8% (7/9) | 100.0% | 80.0% |
| `backend/app/src/near/application/outbox/outbox.module.ts` | 78.3% (18/23) | 45.0% | 76.9% |
| `backend/app/src/dev/chain-ping.command.ts` | 80.0% (4/5) | 100.0% | 75.0% |
| `backend/app/src/flags/flags.module.ts` | 80.0% (4/5) | 50.0% | 100.0% |
| `backend/app/src/core/metrics.registry.ts` | 83.3% (5/6) | 100.0% | 75.0% |
| `backend/app/src/core/auth/auth-token.service.ts` | 83.7% (41/49) | 75.0% | 100.0% |
| `backend/app/src/ws/connection.ts` | 85.3% (116/136) | 64.1% | 81.8% |
| `backend/app/src/near/__contract__/chain-read.contract.ts` | 86.2% (25/29) | 33.3% | 80.0% |
| `backend/app/src/game/game-planets.service.ts` | 86.7% (124/143) | 70.9% | 77.1% |
| `backend/app/src/game/progression-events.service.ts` | 89.5% (85/95) | 63.9% | 72.0% |
| `backend/app/src/core/auth/auth.controller.ts` | 89.5% (17/19) | 33.3% | 100.0% |
| `backend/app/src/ws/command-rate-limit.ts` | 90.0% (18/20) | 80.0% | 100.0% |
| `backend/app/src/core/auth/bearer-auth.guard.ts` | 90.5% (19/21) | 75.0% | 100.0% |
| `backend/app/src/scenarios/scenarios.service.ts` | 90.9% (10/11) | 75.0% | 85.7% |
| `backend/app/src/core/errors/map-error.ts` | 92.0% (23/25) | 79.5% | 100.0% |
| `backend/app/src/ws/rooms.ts` | 92.3% (24/26) | 72.4% | 80.0% |
| `backend/app/src/core/logging/logger.ts` | 92.8% (13/14) | 93.3% | 100.0% |
| `backend/app/src/game/seat-colony.ts` | 94.6% (35/37) | 86.7% | 85.7% |
| `backend/app/src/near/__contract__/harness.ts` | 95.0% (19/20) | 75.0% | 92.8% |
| `backend/app/src/bus/event-bus.ts` | 95.5% (21/22) | 87.5% | 91.7% |
| `backend/app/src/core/auth/auth.service.ts` | 95.7% (44/46) | 72.7% | 100.0% |
| `backend/app/src/ws/session-verifier.ts` | 95.7% (22/23) | 78.6% | 100.0% |
| `backend/app/src/game/game.module.ts` | 95.9% (47/49) | 50.0% | 88.2% |
| `backend/app/src/game/sim-thread-pool.ts` | 96.2% (50/52) | 76.0% | 84.4% |
| `backend/app/src/core/home/home.service.ts` | 96.7% (88/91) | 81.2% | 90.0% |
| `backend/app/src/game/persistence/snapshot.service.ts` | 97.4% (74/76) | 91.9% | 70.6% |
| `backend/app/src/ws/ws.gateway.ts` | 97.6% (41/42) | 84.2% | 90.0% |
| `backend/app/src/game/persistence/snapshot-scheduler.ts` | 98.0% (49/50) | 78.8% | 90.5% |
| `backend/app/src/game/ledger/planet-ledger.service.ts` | 99.2% (134/135) | 96.0% | 97.4% |
| `backend/app/src/game/ledger/in-memory-ledger-store.ts` | 100.0% (52/52) | 89.5% | 100.0% |
| `backend/app/src/near/__contract__/nft.suite.ts` | 100.0% (25/25) | 100.0% | 100.0% |
| `backend/app/src/near/testing/in-memory-badge-nft.ts` | 100.0% (21/21) | 90.9% | 100.0% |
| `backend/app/src/game/ledger/ledger-book.ts` | 100.0% (18/18) | 92.8% | 100.0% |
| `backend/app/src/app.ts` | 100.0% (16/16) | 85.7% | 100.0% |
| `backend/app/src/game/dev-planets.ts` | 100.0% (16/16) | 100.0% | 100.0% |
| `backend/app/src/core/readiness.registry.ts` | 100.0% (15/15) | 50.0% | 90.0% |
| `backend/app/src/game/persistence/retention.ts` | 100.0% (15/15) | 91.7% | 100.0% |
| `backend/app/src/near/testing/in-memory-cargo-token.ts` | 100.0% (15/15) | 88.9% | 100.0% |
| `backend/app/src/game/ledger/dev-ledger.controller.ts` | 100.0% (14/14) | 100.0% | 100.0% |
| `backend/app/src/ports/adapters.ts` | 100.0% (14/14) | 84.6% | 100.0% |
| `backend/app/src/near/infrastructure/mock/mock-chain.config.ts` | 100.0% (13/13) | 100.0% | 100.0% |
| `backend/app/src/core/errors/all-exceptions.filter.ts` | 100.0% (12/12) | 83.3% | 100.0% |
| `backend/app/src/near/application/ports/index.ts` | 100.0% (12/12) | 100.0% | 100.0% |
| `backend/app/src/near/domain/types.ts` | 100.0% (12/12) | 100.0% | 100.0% |
| `backend/app/src/ports/binding.ts` | 100.0% (12/12) | 100.0% | 100.0% |
| `backend/app/src/discovery.ts` | 100.0% (11/11) | 91.7% | 100.0% |
| `backend/app/src/game/persistence/dev-planet-verdict.ts` | 100.0% (11/11) | 88.9% | 100.0% |
| `backend/app/src/near/testing/in-memory-chain.ts` | 100.0% (11/11) | 100.0% | 100.0% |
| `backend/app/src/ports/prod-guard.ts` | 100.0% (11/11) | 100.0% | 100.0% |
| `backend/app/src/dev/dev-command.registry.ts` | 100.0% (10/10) | 87.5% | 100.0% |
| `backend/app/src/near/infrastructure/near-infrastructure.module.ts` | 100.0% (10/10) | 100.0% | 100.0% |
| `backend/app/src/near/infrastructure/mock/tx-hash.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `backend/app/src/dev/tune.command.ts` | 100.0% (8/8) | 92.3% | 100.0% |
| `backend/app/src/game/balance-overrides.ts` | 100.0% (8/8) | 66.7% | 100.0% |
| `backend/app/src/ws/ws.module.ts` | 100.0% (8/8) | 100.0% | 100.0% |
| `backend/app/src/core/health.controller.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `backend/app/src/core/logging/request-id.ts` | 100.0% (7/7) | 83.3% | 100.0% |
| `backend/app/src/game/bus-bridge.ts` | 100.0% (7/7) | 66.7% | 100.0% |
| `backend/app/src/dev/dev.controller.ts` | 100.0% (6/6) | 100.0% | 100.0% |
| `backend/app/src/near/testing/in-memory-chain-read.ts` | 100.0% (6/6) | 100.0% | 100.0% |
| `backend/app/src/scenarios/scenarios.controller.ts` | 100.0% (6/6) | 100.0% | 100.0% |
| `backend/app/src/core/cors.ts` | 100.0% (5/5) | 100.0% | 100.0% |
| `backend/app/src/core/auth/index.ts` | 100.0% (5/5) | 100.0% | 100.0% |
| `backend/app/src/dev/warp.command.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `backend/app/src/flags/flags.service.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `backend/app/src/game/dev-planets.controller.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `backend/app/src/near/infrastructure/adapter-selection.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `backend/app/src/near/testing/index.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `backend/app/src/scenarios/scenarios.module.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `backend/app/src/ai/ai.module.ts` | 100.0% (3/3) | 100.0% | 0.0% |
| `backend/app/src/core/home/index.ts` | 100.0% (3/3) | 100.0% | 100.0% |
| `backend/app/src/near/__contract__/badge-nft.contract.ts` | 100.0% (3/3) | 100.0% | 50.0% |
| `backend/app/src/near/domain/errors.ts` | 100.0% (3/3) | 100.0% | 100.0% |
| `backend/app/src/near/infrastructure/adapters/badge-nft/mock-badge-nft.adapter.ts` | 100.0% (3/3) | 100.0% | 100.0% |
| `backend/app/src/notify/notify.module.ts` | 100.0% (3/3) | 100.0% | 0.0% |
| `backend/app/src/ai/ai-selection.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `backend/app/src/core/tokens.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `backend/app/src/core/errors/zod.pipe.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `backend/app/src/core/home/home.controller.ts` | 100.0% (2/2) | 75.0% | 100.0% |
| `backend/app/src/notify/notify-selection.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `backend/app/src/ports/index.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `backend/app/src/analytics/analytics.module.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `backend/app/src/core/core.module.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `backend/app/src/core/errors/index.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `backend/app/src/game/persistence/persistence-enabled.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `backend/app/src/game/thread/assign.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `backend/app/src/near/near.module.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `backend/app/src/ws/command-ingress.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `backend/app/src/bus/bus.module.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/bus/channels.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/dev/dev.module.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/game/ledger/ledger-store.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/game/thread/protocol.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/agent-wallet.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/badge-nft.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/cargo-token.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/chain-read.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/deed-nft.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/escrow.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/identity.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/intents.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/relayer.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/staking.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/near/application/ports/treasury-dao.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/ports/llm-provider.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `backend/app/src/ports/notifier.port.ts` | 100.0% (0/0) | 100.0% | 100.0% |

### `frontend/game`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `frontend/game/app/Game.ts` | 0.0% (0/258) | 0.0% | 0.0% |
| `frontend/game/app/Gameplay.ts` | 0.0% (0/97) | 0.0% | 0.0% |
| `frontend/game/descent/DescentRunner.ts` | 0.0% (0/94) | 0.0% | 0.0% |
| `frontend/game/descent/parts/SkyRig.ts` | 0.0% (0/85) | 0.0% | 0.0% |
| `frontend/game/dev/explorer/main.ts` | 0.0% (0/69) | 0.0% | 0.0% |
| `frontend/game/descent/fx/Plasma.ts` | 0.0% (0/51) | 0.0% | 0.0% |
| `frontend/game/descent/parts/CameraRig.ts` | 0.0% (0/49) | 0.0% | 0.0% |
| `frontend/game/descent/parts/Touchdown.ts` | 0.0% (0/40) | 0.0% | 0.0% |
| `frontend/game/ui/hud.ts` | 0.0% (0/40) | 0.0% | 0.0% |
| `frontend/game/ui/menu.ts` | 0.0% (0/38) | 0.0% | 0.0% |
| `frontend/game/dev/parity/runLocal.ts` | 0.0% (0/32) | 0.0% | 0.0% |
| `frontend/game/descent/fx/Canopy.ts` | 0.0% (0/29) | 100.0% | 0.0% |
| `frontend/game/app/colonyLayout.ts` | 0.0% (0/27) | 0.0% | 0.0% |
| `frontend/game/main.ts` | 0.0% (0/26) | 0.0% | 0.0% |
| `frontend/game/dev/explorer/columns.ts` | 0.0% (0/26) | 0.0% | 0.0% |
| `frontend/game/descent/parts/ReentryFx.ts` | 0.0% (0/25) | 0.0% | 0.0% |
| `frontend/game/net/ConnectionBanner.ts` | 0.0% (0/23) | 0.0% | 0.0% |
| `frontend/game/dev/explorer/table.ts` | 0.0% (0/20) | 0.0% | 0.0% |
| `frontend/game/store/devHook.ts` | 0.0% (0/20) | 0.0% | 0.0% |
| `frontend/game/app/groundPick.ts` | 0.0% (0/19) | 0.0% | 0.0% |
| `frontend/game/descent/parts/Trajectory.ts` | 0.0% (0/19) | 100.0% | 0.0% |
| `frontend/game/descent/parts/GroundFx.ts` | 0.0% (0/16) | 100.0% | 0.0% |
| `frontend/game/descent/parts/RetroFlames.ts` | 0.0% (0/15) | 100.0% | 0.0% |
| `frontend/game/descent/parts/HeatShield.ts` | 0.0% (0/14) | 0.0% | 0.0% |
| `frontend/game/descent/parts/ChuteFx.ts` | 0.0% (0/13) | 0.0% | 0.0% |
| `frontend/game/descent/fx/Streaks.ts` | 0.0% (0/12) | 100.0% | 0.0% |
| `frontend/game/descent/parts/CarrierBay.ts` | 0.0% (0/12) | 0.0% | 0.0% |
| `frontend/game/descent/parts/FrameState.ts` | 0.0% (0/12) | 100.0% | 0.0% |
| `frontend/game/descent/fx/CloudDeck.ts` | 0.0% (0/11) | 100.0% | 0.0% |
| `frontend/game/dev/explorer/api.ts` | 0.0% (0/9) | 0.0% | 0.0% |
| `frontend/game/ui/worldCard.ts` | 0.0% (0/7) | 0.0% | 0.0% |
| `frontend/game/dev/parity/main.ts` | 0.0% (0/6) | 0.0% | 0.0% |
| `frontend/game/store/local/localHost.worker.ts` | 0.0% (0/6) | 0.0% | 0.0% |
| `frontend/game/store/worker/sim.worker.ts` | 0.0% (0/3) | 100.0% | 0.0% |
| `frontend/game/descent/createDescent.ts` | 0.0% (0/1) | 100.0% | 0.0% |
| `frontend/game/features/define.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/game/features/index.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/game/dev/console/DevConsole.ts` | 1.4% (1/72) | 0.0% | 0.0% |
| `frontend/game/descent/fx/GroundFX.ts` | 5.0% (1/20) | 0.0% | 0.0% |
| `frontend/game/core/analytics/browser.ts` | 17.4% (4/23) | 0.0% | 0.0% |
| `frontend/game/descent/timeline.ts` | 17.6% (6/34) | 9.1% | 16.7% |
| `frontend/game/features/hud-min/hudIcons.ts` | 18.2% (6/33) | 21.4% | 33.3% |
| `frontend/game/features/entities/EntityLayer.ts` | 19.6% (9/46) | 0.0% | 25.0% |
| `frontend/game/features/localhost/index.ts` | 20.0% (1/5) | 0.0% | 0.0% |
| `frontend/game/app/online/hexSurface.ts` | 25.0% (1/4) | 100.0% | 20.0% |
| `frontend/game/app/online/viewportHelper.ts` | 29.2% (21/72) | 29.5% | 36.8% |
| `frontend/game/app/warmup.ts` | 36.4% (8/22) | 60.0% | 30.0% |
| `frontend/game/store/local/snapshotStore.ts` | 39.3% (11/28) | 35.3% | 25.0% |
| `frontend/game/dev/console/index.ts` | 40.0% (2/5) | 38.5% | 25.0% |
| `frontend/game/app/RTSCamera.ts` | 51.2% (41/80) | 11.0% | 44.4% |
| `frontend/game/core/analytics/index.ts` | 54.5% (6/11) | 37.5% | 0.0% |
| `frontend/game/app/online/unitControl.ts` | 55.5% (10/18) | 20.0% | 50.0% |
| `frontend/game/net/netStats.ts` | 60.0% (3/5) | 100.0% | 33.3% |
| `frontend/game/descent/math.ts` | 64.3% (9/14) | 50.0% | 66.7% |
| `frontend/game/features/devtools/index.ts` | 65.6% (21/32) | 66.7% | 83.3% |
| `frontend/game/app/online/OnlineSession.ts` | 68.3% (203/297) | 46.3% | 48.1% |
| `frontend/game/features/landfall/index.ts` | 71.4% (15/21) | 94.7% | 50.0% |
| `frontend/game/features/terraform-basic/dom.ts` | 76.3% (100/131) | 55.5% | 57.7% |
| `frontend/game/app/online/PauseOverlay.ts` | 77.8% (35/45) | 0.0% | 28.6% |
| `frontend/game/net/LagTransport.ts` | 80.0% (28/35) | 90.0% | 68.2% |
| `frontend/game/features/territory-border/index.ts` | 80.9% (55/68) | 59.1% | 75.0% |
| `frontend/game/features/hub-placement/dom.ts` | 83.2% (129/155) | 61.8% | 67.8% |
| `frontend/game/features/entities/index.ts` | 83.3% (5/6) | 25.0% | 33.3% |
| `frontend/game/app/online/bootOnline.ts` | 83.7% (108/129) | 68.0% | 68.4% |
| `frontend/game/app/online/PodTouchdownFx.ts` | 84.1% (132/157) | 78.4% | 78.9% |
| `frontend/game/features/hub-placement/index.ts` | 84.7% (61/72) | 70.7% | 64.5% |
| `frontend/game/features/hub-placement/GhostEvaluator.ts` | 85.5% (47/55) | 82.4% | 86.7% |
| `frontend/game/features/landfall/selection.ts` | 86.3% (151/175) | 63.5% | 93.9% |
| `frontend/game/net/LocalTransport.ts` | 87.0% (40/46) | 84.0% | 61.9% |
| `frontend/game/features/terraform-basic/BrushController.ts` | 87.5% (154/176) | 64.7% | 89.7% |
| `frontend/game/net/WsTransport.ts` | 88.0% (81/92) | 66.0% | 69.0% |
| `frontend/game/app/online/featureHud.ts` | 88.9% (40/45) | 71.4% | 75.0% |
| `frontend/game/store/prediction/stepTimes.ts` | 88.9% (8/9) | 100.0% | 83.3% |
| `frontend/game/features/terraform-basic/index.ts` | 89.8% (53/59) | 91.5% | 75.0% |
| `frontend/game/store/local/LocalHostController.ts` | 90.0% (18/20) | 72.2% | 85.7% |
| `frontend/game/features/hud-min/index.ts` | 90.9% (10/11) | 93.3% | 83.3% |
| `frontend/game/store/WorldStore.ts` | 91.2% (156/171) | 74.0% | 79.6% |
| `frontend/game/net/devServer.ts` | 91.3% (21/23) | 66.7% | 72.7% |
| `frontend/game/features/hud-min/MinimalHud.ts` | 91.8% (201/219) | 71.1% | 76.9% |
| `frontend/game/store/worker/SimWorkerController.ts` | 92.5% (49/53) | 75.7% | 100.0% |
| `frontend/game/app/online/onlineMode.ts` | 92.8% (13/14) | 88.0% | 100.0% |
| `frontend/game/app/online/EntityMeshes.ts` | 92.9% (224/241) | 80.4% | 88.0% |
| `frontend/game/app/online/BootOverlay.ts` | 94.0% (125/133) | 58.3% | 90.0% |
| `frontend/game/features/hub-placement/HubPlacementMenu.ts` | 94.8% (255/269) | 70.6% | 91.9% |
| `frontend/game/features/flags/index.ts` | 95.2% (40/42) | 58.3% | 55.5% |
| `frontend/game/features/entities/blend.ts` | 95.7% (22/23) | 92.8% | 85.7% |
| `frontend/game/features/terraform-basic/TerraformMenu.ts` | 96.0% (95/99) | 83.7% | 75.0% |
| `frontend/game/store/local/LocalHostCore.ts` | 96.4% (134/139) | 72.4% | 90.2% |
| `frontend/game/app/online/sessionTarget.ts` | 96.5% (28/29) | 82.6% | 88.9% |
| `frontend/game/core/analytics/client.ts` | 97.0% (32/33) | 87.5% | 88.9% |
| `frontend/game/store/prediction/Predictor.ts` | 97.2% (103/106) | 77.5% | 85.2% |
| `frontend/game/features/terraform-basic/TileOverlay.ts` | 97.3% (147/151) | 71.2% | 87.5% |
| `frontend/game/features/hub-placement/GhostRig3D.ts` | 98.3% (57/58) | 77.8% | 100.0% |
| `frontend/game/app/online/PodImpactRig.ts` | 99.0% (204/206) | 92.6% | 100.0% |
| `frontend/game/features/landfall/HqPanel.ts` | 100.0% (92/92) | 88.9% | 100.0% |
| `frontend/game/app/online/entityMotion.ts` | 100.0% (64/64) | 87.5% | 100.0% |
| `frontend/game/store/replica/ReplicaCore.ts` | 100.0% (38/38) | 81.5% | 100.0% |
| `frontend/game/features/dev-console/commands.ts` | 100.0% (36/36) | 94.4% | 100.0% |
| `frontend/game/features/entities/interp.ts` | 100.0% (27/27) | 90.9% | 100.0% |
| `frontend/game/store/replica/viewCodec.ts` | 100.0% (27/27) | 65.0% | 100.0% |
| `frontend/game/dev/console/runner.ts` | 100.0% (26/26) | 81.2% | 88.9% |
| `frontend/game/features/netstats/index.ts` | 100.0% (26/26) | 87.5% | 80.0% |
| `frontend/game/core/hud/HudRoot.ts` | 100.0% (25/25) | 100.0% | 100.0% |
| `frontend/game/dev/console/parse.ts` | 100.0% (25/25) | 100.0% | 100.0% |
| `frontend/game/descent/fx/Flames.ts` | 100.0% (24/24) | 100.0% | 100.0% |
| `frontend/game/net/commandBus.ts` | 100.0% (24/24) | 87.5% | 88.9% |
| `frontend/game/store/replica/testModule.ts` | 100.0% (22/22) | 100.0% | 100.0% |
| `frontend/game/features/dev-console/ledger.ts` | 100.0% (21/21) | 100.0% | 100.0% |
| `frontend/game/features/warp/index.ts` | 100.0% (20/20) | 94.4% | 100.0% |
| `frontend/game/features/tune/index.ts` | 100.0% (16/16) | 85.7% | 100.0% |
| `frontend/game/core/registry/select.ts` | 100.0% (12/12) | 90.9% | 100.0% |
| `frontend/game/core/flags/resolve.ts` | 100.0% (11/11) | 92.8% | 66.7% |
| `frontend/game/features/tick/index.ts` | 100.0% (10/10) | 100.0% | 100.0% |
| `frontend/game/store/local/hostJournal.ts` | 100.0% (10/10) | 75.0% | 100.0% |
| `frontend/game/core/flags/store.ts` | 100.0% (9/9) | 100.0% | 100.0% |
| `frontend/game/descent/constants.ts` | 100.0% (8/8) | 100.0% | 100.0% |
| `frontend/game/net/backoff.ts` | 100.0% (7/7) | 100.0% | 100.0% |
| `frontend/game/net/closeCodes.ts` | 100.0% (6/6) | 100.0% | 100.0% |
| `frontend/game/net/warpFeed.ts` | 100.0% (5/5) | 92.3% | 100.0% |
| `frontend/game/app/online/localHost.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `frontend/game/core/flags/index.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `frontend/game/net/bannerText.ts` | 100.0% (4/4) | 61.1% | 100.0% |
| `frontend/game/net/emitter.ts` | 100.0% (4/4) | 100.0% | 100.0% |
| `frontend/game/core/registry/index.ts` | 100.0% (3/3) | 100.0% | 100.0% |
| `frontend/game/core/registry/types.ts` | 100.0% (2/2) | 100.0% | 100.0% |
| `frontend/game/store/bytes.ts` | 100.0% (2/2) | 75.0% | 100.0% |
| `frontend/game/core/flags/data.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `frontend/game/features/dev-console/index.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `frontend/game/features/entities/services.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/game/net/services.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/game/net/types.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/game/store/local/protocol.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/game/store/worker/protocol.ts` | 100.0% (0/0) | 100.0% | 100.0% |

### `frontend/render`

| File | Lines | Branches | Functions |
|---|---|---|---|
| `frontend/render/kitbash/validate/math.ts` | 0.0% (0/148) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/units/robots.ts` | 0.0% (0/140) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/buildings/power.ts` | 0.0% (0/119) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/buildings/tech.ts` | 0.0% (0/101) | 0.0% | 0.0% |
| `frontend/render/core/createColonyViewport.ts` | 0.0% (0/97) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/checks/animation.ts` | 0.0% (0/94) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/poses.ts` | 0.0% (0/93) | 0.0% | 0.0% |
| `frontend/render/lighting/PlanetaryLightingSystem.ts` | 0.0% (0/91) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/buildings/hub.ts` | 0.0% (0/90) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/units/ships.ts` | 0.0% (0/84) | 0.0% | 0.0% |
| `frontend/render/kitbash/KitbashRegistry.ts` | 0.0% (0/80) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/buildings/industry.ts` | 0.0% (0/77) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/units/nature.ts` | 0.0% (0/76) | 0.0% | 0.0% |
| `frontend/render/ui/pixelDialog.ts` | 0.0% (0/74) | 0.0% | 0.0% |
| `frontend/render/visuals/terrain/heightfields.ts` | 0.0% (0/72) | 0.0% | 0.0% |
| `frontend/render/ui/crt.ts` | 0.0% (0/70) | 0.0% | 0.0% |
| `frontend/render/orbit/deploy/DeployFlight.ts` | 0.0% (0/68) | 0.0% | 0.0% |
| `frontend/render/lighting/LightningStrikeSystem.ts` | 0.0% (0/67) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/satellites.ts` | 0.0% (0/65) | 0.0% | 0.0% |
| `frontend/render/kitbash/greebles/unitParts.ts` | 0.0% (0/64) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/relation.ts` | 0.0% (0/64) | 0.0% | 0.0% |
| `frontend/render/visuals/space/SunFlare.ts` | 0.0% (0/64) | 0.0% | 0.0% |
| `frontend/render/core/pixelArtPass.ts` | 0.0% (0/63) | 0.0% | 0.0% |
| `frontend/render/orbit/OrbitalStage.ts` | 0.0% (0/57) | 0.0% | 0.0% |
| `frontend/render/orbit/stage/StageGlobes.ts` | 0.0% (0/56) | 0.0% | 0.0% |
| `frontend/render/planets/globe/ColonyStructures.ts` | 0.0% (0/54) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/checks/overlaps.ts` | 0.0% (0/51) | 0.0% | 0.0% |
| `frontend/render/planets/PlanetGlobe.ts` | 0.0% (0/50) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/buildings/kit.ts` | 0.0% (0/49) | 0.0% | 0.0% |
| `frontend/render/planets/surface/SurfaceContext.ts` | 0.0% (0/49) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/appearance/colorChecks.ts` | 0.0% (0/47) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/appearance/detail.ts` | 0.0% (0/46) | 0.0% | 0.0% |
| `frontend/render/visuals/space/SpaceBackdrop.ts` | 0.0% (0/45) | 0.0% | 0.0% |
| `frontend/render/ui/pixelArt.ts` | 0.0% (0/44) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/buildings/rocket.ts` | 0.0% (0/42) | 100.0% | 0.0% |
| `frontend/render/visuals/space/placeholders.ts` | 0.0% (0/40) | 0.0% | 0.0% |
| `frontend/render/descent/dropRig.ts` | 0.0% (0/38) | 0.0% | 0.0% |
| `frontend/render/kitbash/catalog.ts` | 0.0% (0/38) | 0.0% | 0.0% |
| `frontend/render/core/perfConfig.ts` | 0.0% (0/35) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/extract.ts` | 0.0% (0/35) | 0.0% | 0.0% |
| `frontend/render/orbit/deploy/DeployPlan.ts` | 0.0% (0/33) | 0.0% | 0.0% |
| `frontend/render/ui/fps.ts` | 0.0% (0/33) | 0.0% | 0.0% |
| `frontend/render/orbit/deploy/DeploySequence.ts` | 0.0% (0/31) | 0.0% | 0.0% |
| `frontend/render/visuals/terrain/landform/plateau.ts` | 0.0% (0/30) | 0.0% | 0.0% |
| `frontend/render/orbit/stage/SunRig.ts` | 0.0% (0/29) | 100.0% | 0.0% |
| `frontend/render/visuals/space/parallax/asteroids.ts` | 0.0% (0/28) | 0.0% | 0.0% |
| `frontend/render/core/StageHost.ts` | 0.0% (0/27) | 0.0% | 0.0% |
| `frontend/render/orbit/Moons.ts` | 0.0% (0/27) | 0.0% | 0.0% |
| `frontend/render/visuals/space/flareTextures.ts` | 0.0% (0/27) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/checks/floating.ts` | 0.0% (0/26) | 0.0% | 0.0% |
| `frontend/render/visuals/space/parallax/stars.ts` | 0.0% (0/25) | 0.0% | 0.0% |
| `frontend/render/core/DiagnosticTurntable.ts` | 0.0% (0/24) | 0.0% | 0.0% |
| `frontend/render/visuals/terrain/landforms.ts` | 0.0% (0/24) | 0.0% | 0.0% |
| `frontend/render/visuals/terrain/landform/spires.ts` | 0.0% (0/24) | 0.0% | 0.0% |
| `frontend/render/visuals/space/parallax/nebulae.ts` | 0.0% (0/23) | 0.0% | 0.0% |
| `frontend/render/visuals/terrain/landform/ridge.ts` | 0.0% (0/23) | 0.0% | 0.0% |
| `frontend/render/orbit/stage/Satellites.ts` | 0.0% (0/22) | 100.0% | 0.0% |
| `frontend/render/kitbash/validate/context.ts` | 0.0% (0/21) | 0.0% | 0.0% |
| `frontend/render/planets/applyPlanetLook.ts` | 0.0% (0/21) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/appearance/measure.ts` | 0.0% (0/20) | 0.0% | 0.0% |
| `frontend/render/planets/surface/biomes/oceanForest.ts` | 0.0% (0/19) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/appearance/context.ts` | 0.0% (0/18) | 0.0% | 0.0% |
| `frontend/render/orbit/stage/StageMoons.ts` | 0.0% (0/18) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/units/common.ts` | 0.0% (0/17) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/ModelValidator.ts` | 0.0% (0/17) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/appearance/color.ts` | 0.0% (0/17) | 0.0% | 0.0% |
| `frontend/render/planets/surface/biomes/dune.ts` | 0.0% (0/17) | 0.0% | 0.0% |
| `frontend/render/visuals/UnifiedColonyMaterial.ts` | 0.0% (0/17) | 0.0% | 0.0% |
| `frontend/render/kitbash/archetypes/buildings/index.ts` | 0.0% (0/16) | 100.0% | 0.0% |
| `frontend/render/planets/surface/index.ts` | 0.0% (0/16) | 0.0% | 0.0% |
| `frontend/render/visuals/space/parallax/planets.ts` | 0.0% (0/16) | 100.0% | 0.0% |
| `frontend/render/orbit/stage/math.ts` | 0.0% (0/14) | 0.0% | 0.0% |
| `frontend/render/planets/surface/biomes/forestRock.ts` | 0.0% (0/14) | 0.0% | 0.0% |
| `frontend/render/visuals/space/ParallaxLayers.ts` | 0.0% (0/14) | 100.0% | 0.0% |
| `frontend/render/visuals/terrain/Particles.ts` | 0.0% (0/14) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/format.ts` | 0.0% (0/13) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/appearance/palette.ts` | 0.0% (0/13) | 0.0% | 0.0% |
| `frontend/render/planets/globe/ColonyBeams.ts` | 0.0% (0/13) | 100.0% | 0.0% |
| `frontend/render/kitbash/validate/checks/process.ts` | 0.0% (0/12) | 0.0% | 0.0% |
| `frontend/render/visuals/terrain/TerrainMesh.ts` | 0.0% (0/12) | 0.0% | 0.0% |
| `frontend/render/visuals/terrain/landform/dome.ts` | 0.0% (0/12) | 0.0% | 0.0% |
| `frontend/render/planets/globe/materials.ts` | 0.0% (0/11) | 0.0% | 0.0% |
| `frontend/render/visuals/unified/shaderChunks.ts` | 0.0% (0/10) | 100.0% | 0.0% |
| `frontend/render/orbit/stage/idle.ts` | 0.0% (0/9) | 100.0% | 0.0% |
| `frontend/render/kitbash/validate/appearance.ts` | 0.0% (0/8) | 100.0% | 0.0% |
| `frontend/render/kitbash/validate/checks/sanity.ts` | 0.0% (0/8) | 0.0% | 0.0% |
| `frontend/render/orbit/stage/NebulaTint.ts` | 0.0% (0/7) | 100.0% | 0.0% |
| `frontend/render/visuals/space/parallax/shaders.ts` | 0.0% (0/7) | 100.0% | 100.0% |
| `frontend/render/visuals/terrain/landform/types.ts` | 0.0% (0/6) | 100.0% | 0.0% |
| `frontend/render/visuals/unified/registries.ts` | 0.0% (0/6) | 0.0% | 0.0% |
| `frontend/render/kitbash/validate/checks/appearanceStage.ts` | 0.0% (0/5) | 0.0% | 0.0% |
| `frontend/render/visuals/space/backdropShaders.ts` | 0.0% (0/4) | 100.0% | 100.0% |
| `frontend/render/kitbash/validate/index.ts` | 0.0% (0/3) | 0.0% | 0.0% |
| `frontend/render/visuals/biomes.ts` | 0.0% (0/3) | 100.0% | 100.0% |
| `frontend/render/kitbash/index.ts` | 0.0% (0/2) | 100.0% | 100.0% |
| `frontend/render/planets/globe/lodDetail.ts` | 0.0% (0/2) | 100.0% | 100.0% |
| `frontend/render/ui/crtEntry.ts` | 0.0% (0/2) | 100.0% | 0.0% |
| `frontend/render/kitbash/validate/types.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/orbit/deploy/types.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/planets/globe/atmFrag.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/planets/globe/cloudFrag.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/planets/globe/globeVert.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/planets/globe/surfaceFrag.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/planets/surface/biomes/index.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/visuals/space/glslNoise.ts` | 0.0% (0/1) | 100.0% | 100.0% |
| `frontend/render/visuals/terrain/TerrainGrid.ts` | 10.4% (7/67) | 0.0% | 8.3% |
| `frontend/render/visuals/TerrainAndWaterShaders.ts` | 22.7% (5/22) | 0.0% | 25.0% |
| `frontend/render/planets/globe/terraform.ts` | 46.1% (6/13) | 0.0% | 0.0% |
| `frontend/render/visuals/ProceduralTextureRegistry.ts` | 61.9% (109/176) | 80.0% | 77.8% |
| `frontend/render/visuals/terrain/Scatter.ts` | 73.6% (81/110) | 68.2% | 80.0% |
| `frontend/render/visuals/terrain/Liquids.ts` | 77.8% (14/18) | 100.0% | 75.0% |
| `frontend/render/planets/hex/planetKind.ts` | 80.0% (4/5) | 0.0% | 50.0% |
| `frontend/render/visuals/terrain/noise.ts` | 81.0% (34/42) | 71.4% | 50.0% |
| `frontend/render/planets/hex/createHexTerrain.ts` | 93.0% (120/129) | 69.0% | 85.2% |
| `frontend/render/planets/hex/chunkMesh.ts` | 98.0% (149/152) | 83.6% | 100.0% |
| `frontend/render/planets/hex/hexWater.ts` | 98.1% (104/106) | 89.5% | 100.0% |
| `frontend/render/planets/hex/chunkPropScatter.ts` | 100.0% (98/98) | 90.7% | 100.0% |
| `frontend/render/planets/hex/territoryBorder.ts` | 100.0% (97/97) | 90.3% | 100.0% |
| `frontend/render/planets/hex/hexMath.ts` | 100.0% (17/17) | 90.9% | 100.0% |
| `frontend/render/visuals/terrain/terrainShader.ts` | 100.0% (16/16) | 100.0% | 100.0% |
| `frontend/render/planets/hex/chunks.ts` | 100.0% (11/11) | 75.0% | 100.0% |
| `frontend/render/planets/hex/heightSampler.ts` | 100.0% (11/11) | 100.0% | 100.0% |
| `frontend/render/planets/hex/hexEdges.ts` | 100.0% (8/8) | 100.0% | 100.0% |
| `frontend/render/visuals/terrain/terrainMaterial.ts` | 100.0% (8/8) | 50.0% | 100.0% |
| `frontend/render/planets/PlanetSpec.ts` | 100.0% (3/3) | 100.0% | 0.0% |
| `frontend/render/visuals/terrain/glsl.ts` | 100.0% (1/1) | 100.0% | 100.0% |
| `frontend/render/descent/types.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/render/kitbash/archetypes/units.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/render/orbit/types.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/render/planets/hex/index.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/render/planets/surface/types.ts` | 100.0% (0/0) | 100.0% | 100.0% |
| `frontend/render/visuals/space/parallax/types.ts` | 100.0% (0/0) | 100.0% | 100.0% |
