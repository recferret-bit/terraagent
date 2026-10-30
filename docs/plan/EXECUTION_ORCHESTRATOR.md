# TerraAgent — Parallel Execution Orchestrator (root)

> **⛔ SUPERSEDED (2026-10-30) by [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md)** — the plan is now 26 product waves / 859 issues ([`ISSUE_INDEX.md`](./ISSUE_INDEX.md)). This file and `issues/TA-*.md` are kept only for traceability (each wave issue lists the TA ids it replaces). Do not schedule work from here.
>
> **⚠ 2026-10-30, D-24..D-27 apply.** The hackathon (11-01 → 11-14, solo) follows **[`HACKATHON_CUT.md`](./HACKATHON_CUT.md)**. Architecture is now **one NestJS app + Postgres** with a simplified server sim, no anti-cheat and no anti-bot. **Obsolete → Future:** TA-01.3 (NATS subjects/streams/KV), TA-02.2 (JetStream/KV bootstrap), TA-05.5 (lease reconcile + failover reassignment), TA-07.1 (worker registration/heartbeat in KV), TA-07.5 (planet leases + drain), TA-07.9 (catch-up ticking), TA-13.4 (failover determinism suite). **Need simplification before use:** TA-02.1 (Postgres only, no NATS), TA-02.3 (one app image), TA-02.4 (one WS endpoint, no worker map, no rate limits), TA-02.5 (no worker drain), TA-04.5 (ticket without worker directory), TA-05.4 (no leader election), TA-06.1 (floats allowed, no state hash), TA-06.9 (delta diff only, no fog-of-war view), TA-07.4 / TA-07.7 (in-process commands/events), TA-07.6 (snapshot resume + coarse fast-run, no replay/hash), TA-08.1 (in-process presence), TA-09.2 (in-process intake, budget cap only). Everything else in this plan is **post-hackathon**.
>
> **⚠ 2026-10-30, D-28..D-30 apply.**
> - **D-28 battle v1:** TA-14.4 rescoped; new TA-14.10 (rings + projectile visuals).
> - **D-29:** new epic **TA-15**: player page, achievements, XP, minimap, global map.
> - **D-30:** ports & adapters, **all NEAR features mocked in phase 1**. New TA-10.8 (foundation, W1) and TA-10.9–10.12 (F1–F8 on mocks, W2–W4). Real adapters are phase 2 (TA-10.1/10.3 in W4; TA-10.2/10.4/10.6/10.7/10.13 in W5). TA-10.5 is obsolete.
> - TA-07 is read through its D-24 mapping table.
> - Lane paths under D-24 are listed in §3.
>
> **How to use:** point the lead agent at **`docs/plan/EXECUTION_ORCHESTRATOR.md`** ("work on docs/plan/EXECUTION_ORCHESTRATOR.md").
> This file schedules all **116 tasks** of the 15 epics in [`issues/`](./issues) across **6 waves** (`W0`–`W5`) and **5 stable lanes** (`L1`–`L5`), with file ownership, isolation and barrier gates so up to 5 agents can work at once without collisions.
>
> **Architecture contract:** [`../spec/ARCHITECTURE.md`](../spec/ARCHITECTURE.md) · **Decisions:** [`../spec/DECISIONS.md`](../spec/DECISIONS.md) · **Status board:** [`STATUS.md`](./STATUS.md) · **Owner tasks:** [`OWNER_TASKS.md`](./OWNER_TASKS.md)
>
> **State (2026-10-30):** nothing implemented. All tasks are `[ ] Todo`. The owner answered every open question on 2026-10-29: **D-16 is Accepted** (MVP = stages S0–S7, 9 unit types), and D-17..D-23 record the remaining answers (hard offline mode + notifications, Settled colony + NEAR staking, NEAR Intents, catch-up ticking, per-pylon load, client scope, infra). They added epic **TA-14** and 12 tasks in existing epics. D-01..D-15 are otherwise unchanged.

---

## 1. Coordination protocol (mandatory for every agent)

### 1.1 Roles
- **Lead (integrator):** runs every **Wave Pre-Step** alone, owns shared paths (§1.3), merges lane branches at the barrier, runs the barrier gate, updates the boards.
- **Lane agent (`L1`..`L5`):** works only on its lane's tasks in the current wave, only inside its owned paths, in its own git worktree/branch `w{N}-l{K}` (Claude Code: `Agent` with `isolation: "worktree"`).

### 1.2 Wave rules
1. **Never cross a barrier early.** All lanes of wave `N` are `[x] Done` **and** the wave's barrier command exits `0` on the merged `main` before any lane starts wave `N+1`.
2. **Wave 0 is single-lane** (lead only): it creates the repo, shared packages, schema and harness every lane depends on.
3. **Lane order is binding.** Tasks inside a lane run top to bottom; a task may start only when its `Depends On` tasks are `[x] Done` (earlier waves) or earlier in the same lane.
4. **Cross-lane dependencies inside one wave are contract-only.** If `L3` needs something `L1` builds in the same wave, both code against the `@terra/contracts` schema landed in the pre-step and meet at the barrier integration test. Never import another lane's in-progress code.
5. **Blocked?** Mark the task `[!] Blocked` with the reason in all three places (§1.6), continue with the next unblocked task in your lane, and tell the lead.

### 1.3 Shared paths — lead only, in the Wave Pre-Step
These paths are **forbidden to every lane** during a wave. A lane that needs a change writes a **change request** in its task's DoR; the lead batches them into the next pre-step (or a mid-wave pre-step if the whole wave is blocked).

- `shared/contracts/**` (WS/NATS/REST schemas — the cross-lane contract)
- `shared/db/**` (Prisma schema + migrations — see §1.4)
- `shared/config/**`
- `shared/sim/src/api.ts` (the public sim facade; the implementation behind it is L2's)
- root `package.json`, `package-lock.json`, `tsconfig.base.json`, `scripts/**`, `docs/spec/**`
- `tests/integration/barrier/**` — the barrier suites (`--suite w1..w4`) are written by the lead in each wave's pre-step from the barrier description, so every lane can run them before reporting

**Dependencies:** a lane may add dependencies to **its own** workspace `package.json`. `package-lock.json` is never hand-merged: the lead regenerates it (`npm install`) when merging lanes at the barrier.

### 1.4 Migration serialization
At most **one** Prisma migration per wave, created by the lead in the pre-step from all lanes' change requests. Lanes never run `prisma migrate dev`. Migrations are forward-only.

### 1.5 Isolation per lane (local + CI)
| Lane | Domain | `TEST_DATABASE_URL` | `TA_NS` | Ports (core / worker / worker-2 / ai / near / game / landing) |
|---|---|---|---|---|
| `L1` | Core & Matchmaking | `postgresql://terra:terra_dev_password@127.0.0.1:15434/terraagent_lane1_test` | `l1` | 4101 / 4102 / 4112 / 4103 / 4104 / 4105 / 4106 |
| `L2` | Simulation | `…/terraagent_lane2_test` | `l2` | 4201 / 4202 / 4212 / 4203 / 4204 / 4205 / 4206 |
| `L3` | Planet Worker & Continuity | `…/terraagent_lane3_test` | `l3` | 4301 / 4302 / 4312 / 4303 / 4304 / 4305 / 4306 |
| `L4` | AI & NEAR (edge services) | `…/terraagent_lane4_test` | `l4` | 4401 / 4402 / 4412 / 4403 / 4404 / 4405 / 4406 |
| `L5` | Clients & Infra | `…/terraagent_lane5_test` | `l5` | 4501 / 4502 / 4512 / 4503 / 4504 / 4505 / 4506 |

- One shared dev NATS (`nats://127.0.0.1:14222`) and Postgres (`127.0.0.1:15434`) from `infra/docker-compose.yml`; lanes are separated by `TA_NS` and database name.
- `near-sandbox` (port `13030`) runs **only in L4**. Real Z.ai calls run **only in L4** and only with `AI_LIVE=1`; every other lane uses the mock LLM provider.
- The nginx/`*.terraagent.localhost` stack (ports 80/443) runs **only in L5** and at the barrier.

### 1.6 Three-place status sync
When a task's DoD passes, mark it `[x] Done` in:
1. this file (lane task list),
2. the epic issue file in [`issues/`](./issues),
3. [`STATUS.md`](./STATUS.md) (task row + epic counters).

If observable behaviour or a contract changed, the lead also updates the relevant `docs/spec/*.md` in the merge commit.

### 1.7 Common DoR / DoD (applies to every task)
**DoR (common):** depends-on tasks are `[x] Done`; the linked spec sections are read; any contract/schema change the task needs is already landed by the pre-step; the agent works in its own worktree with its lane's isolation env.

**DoD (common):**
- `npm run check` (lint + typecheck + unit) is green for the touched workspaces.
- Every new handler/service/adapter has a unit test; every Postgres repository has an integration test on the lane DB; every NATS handler has a contract test against `@terra/contracts` schemas.
- New env keys are added to the app's own `src/config/env.schema.ts` (which extends the base schema from `@terra/config`), the app's `.env.example` and `infra/deploy/.env.example`. Only **base** keys shared by all apps (`TA_NS`, `DATABASE_URL`, `NATS_URL`, `LOG_LEVEL`, …) need a lead pre-step.
- The task's own DoD items and **Verify** command pass; metrics/events listed under the task's **Telemetry** exist and are asserted in at least one test.
- Metric names follow `ta_{service}_{name}_{unit}` (Prometheus base units: `_seconds`, `_bytes`, `_total`) and are registered in `shared/contracts/src/metrics.ts` (lead pre-step); dashboards/alerts (TA-13.2) may only reference registered names. **Telemetry names in the issue files are working names** written by different authors (some lack the `ta_` prefix or use `_ms`); the lead normalizes them when registering — e.g. `mm_queue_depth` → `ta_core_match_queue_depth`, `ta_worker_tick_duration_ms` → `ta_worker_tick_duration_seconds`, `ai_requests_total` → `ta_ai_requests_total`.
- No deploy. Report "ready for barrier".

---

## 2. Master wave board

| Wave | Milestone | Lanes | Tasks | Status | Barrier gate command |
|---|---|---|---|---|---|
| **W0** | **Foundation** — monorepo, contracts, config, schema, dev stack, harness | Lead only | 12 | `[ ] Todo` | `npm run check && npm run infra:up && npm run db:migrate && npm run test:integration -- --suite smoke` |
| **W1** | **Skeletons** — every service boots & is healthy; sim kernel deterministic; landing + game shell build; NEAR ports + mocks + contract suites | L1–L5 | 15 | `[ ] Todo` | `npm run check && npm run test:integration -- --suite w1` |
| **W2** | **First playable online** — guest → picker → queue → seat → live planet over WS; HQ prepares ground and builds the Hub; order lanes | L1–L5 | 19 | `[ ] Todo` | `npm run check && npm run test:integration -- --suite w2 && npm run test:e2e -- --grep @w2` |
| **W3** | **Persistent world** — leave & colony keeps running, resume with digest, failover + catch-up, matchmaker leader, AI director, power grid + pylon load, stages, goals & truces, progression/XP + profile API, minimap, F2/F3/F4 on mocks | L1–L5 | 26 | `[ ] Todo` | `npm run check && npm run test:integration -- --suite w3 && npm run test:e2e -- --grep @w3 && npm run test:integration -- --suite worker --grep failover` |
| **W4** | **Game depth & ops** — combat model + walls, hazards, fauna, PvP, rocket → Settled colony, Intents trades, hard offline mode + notifications, parties, mobile, admin, queue controls, prod-like stack, battle v1 visuals, `/me` + achievements + global map, F6–F8 on mocks, real F5 adapters | L1–L5 | 29 | `[ ] Todo` | `npm run check && npm run test:integration -- --suite w4 && npm run test:e2e -- --grep "@w2\|@w3\|@w4" && npm run stack:local:smoke` |
| **W5** | **Launch readiness** — balance harness, account claim + staking, live landing hero, notification opt-in UX, E2E, failover, load, soak, observability, prod smoke, real F1/F2 + remaining real adapters, badge art | L1–L5 | 15 | `[ ] Todo` | `npm run test:ci:full && npm run test:load -- --profile baseline && npm run test:soak:mm` |

```mermaid
flowchart TD
  W0["W0 Foundation (lead)<br/>workspaces · contracts · config · Prisma v1 · compose · harness · sim facade"] --> W1
  W1["W1 Skeletons<br/>L1 core+auth+home · L2 sim kernel+grid+codec · L3 worker host+leases · L4 ai+near skeletons · L5 infra images+landing+game shell"] --> W2
  W2["W2 First playable online<br/>L1 lifecycle+picker API+queue+tickets · L2 territory+data+economy+ground prep+units+lanes · L3 WS gateway+cmds+events · L4 near accounts+ai triggers · L5 nginx+picker+WS client+viewport"] --> W3
  W3["W3 Persistent world<br/>L1 matchmaker+scheduler+NEAR link+lobby WS+resume · L2 power+rule engine · L3 snapshots/failover+presence+digest · L4 prompts+directives+registry · L5 resume UX+entities+HUD+prod deploy"] --> W4
  W4["W4 Depth & ops<br/>L1 queue ops+admin+elimination · L2 hazards/fauna+rocket+PvP · L3 away policy+metrics · L4 ai ops+trades · L5 placement+SEO+local prod stack"] --> W5
  W5["W5 Launch readiness<br/>L1 mm soak · L2 failover suite · L3 load · L4 observability · L5 e2e+launch"]
```

---

## 3. Lane ownership (stable across waves)

| Lane | Owned paths (all waves) | Extra owned paths in W5 | Always forbidden |
|---|---|---|---|
| `L1` Core & Matchmaking | `backend/core/**`, `tests/integration/core/**` | `tests/load/matchmaking/**` | §1.3 shared paths; other lanes' paths |
| `L2` Simulation | `shared/sim/**` **except** `shared/sim/src/api.ts` | `tests/failover/**` | §1.3; `backend/**`, `frontend/**` |
| `L3` Planet Worker & Continuity | `backend/planet-worker/**`, `tests/integration/worker/**` | `tests/load/planet/**` | §1.3; `shared/sim/**` |
| `L4` AI & NEAR | `backend/ai-orchestrator/**`, `backend/near-gateway/**`, `backend/near-contracts/**`, `tests/integration/edge/**` | `infra/monitoring/**` | §1.3 |
| `L5` Clients & Infra | `frontend/**`, `infra/**` (except `infra/monitoring/**` in W5), `tests/e2e/**` | — | §1.3; `backend/**` |

**D-24 paths (one app):**
- `L1` also owns `backend/app/src/{api,lobby,notify,progression}/**`.
- `L3` owns `backend/app/src/game/**`.
- `L4` owns `backend/app/src/{ai,near}/**` and `backend/near-contracts/**`.
- `L2` and `L5` are unchanged.
- Shared `backend/app/src/{main.ts,app.module.ts}` and `shared/db/prisma/schema.prisma` are lead-only (§1.3).

Continuity (TA-08) tasks are split by path: core-side tasks run in `L1`, worker-side tasks in `L3`, client UX in `L5` (TA-11.3).

---

## 4. Wave schedule

### WAVE 0 — Foundation (lead only, sequential)
**Goal:** a repo every lane can branch from: workspaces, the cross-lane contracts, env loader, Prisma v1 schema + migration, dev compose (Postgres + NATS), sim facade with stub, integration harness with lane isolation, CI script.
**Migration:** `0001_init` (TA-03.1).

- **Status:** `[ ] Todo`
- **Owned paths:** everything (no lanes active).
- **Tasks (in order):**
  - [ ] [`TA-01.1`](./issues/TA-01-monorepo-and-shared-contracts.md) — npm-workspaces skeleton: root `package.json`, `tsconfig.base.json`, ESLint/Prettier, Vitest, `npm run check`
  - [ ] [`TA-01.6`](./issues/TA-01-monorepo-and-shared-contracts.md) — `@terra/config`: zod env loader, `TA_NS` + lane port helpers, `.env.example` convention
  - [ ] [`TA-01.2`](./issues/TA-01-monorepo-and-shared-contracts.md) — `@terra/contracts`: WS envelope + worker/lobby message schemas v1
  - [ ] [`TA-01.3`](./issues/TA-01-monorepo-and-shared-contracts.md) — `@terra/contracts`: NATS subjects, stream/KV definitions & payload schemas
  - [ ] [`TA-01.4`](./issues/TA-01-monorepo-and-shared-contracts.md) — `@terra/contracts`: REST DTOs, error codes, planet-ticket claims
  - [ ] [`TA-01.7`](./issues/TA-01-monorepo-and-shared-contracts.md) — `@terra/sim` public API facade (`api.ts`) + stub implementation
  - [ ] [`TA-02.1`](./issues/TA-02-infra-nats-postgres-nginx.md) — Dev compose: Postgres 16 + NATS JetStream + nats-box, lane test DB init
  - [ ] [`TA-03.1`](./issues/TA-03-database-and-persistence.md) — Prisma schema v1 (`core`/`world`/`ai`/`chain`) + `0001_init`
  - [ ] [`TA-03.2`](./issues/TA-03-database-and-persistence.md) — `@terra/db`: client, repository base, seed, lane test-DB harness
  - [ ] [`TA-03.3`](./issues/TA-03-database-and-persistence.md) — Snapshot store: compressed `bytea`, retention policy, load-latest
  - [ ] [`TA-13.1`](./issues/TA-13-qa-observability-and-load.md) — Integration test harness with per-lane isolation (`test:integration --suite …`)
  - [ ] [`TA-01.5`](./issues/TA-01-monorepo-and-shared-contracts.md) — `scripts/ci-fast.sh`, root `ci:fast`, contract drift test
- **Verify:** W0 barrier command.

> **W0 BARRIER:** `npm run check && npm run infra:up && npm run db:migrate && npm run test:integration -- --suite smoke` exits `0`; `git tag w0-done`.

---

### WAVE 1 — Skeletons
**Goal:** each service boots in compose and reports ready; sim kernel steps deterministically; landing and game shell build; images build.
**Pre-step:** lead lands any W1 contract change requests (expected: none).
**Migration:** none.

#### W1 — `L1` Core & Matchmaking
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-04.1`](./issues/TA-04-core-api-auth-and-home.md) — Core Nest skeleton: config, pino, Prisma, NATS, `/healthz` `/readyz` `/metrics`
  - [ ] [`TA-04.2`](./issues/TA-04-core-api-auth-and-home.md) — Guest auth: device login, access/refresh JWT, logout revoke
  - [ ] [`TA-04.4`](./issues/TA-04-core-api-auth-and-home.md) — Players & `GET /v1/me/home` state machine (`NEW`/`QUEUED`/`ACTIVE`/`ELIMINATED`/`PLANET_ENDED`)
- **Verify:** `TA_NS=l1 TEST_DATABASE_URL=…/terraagent_lane1_test npm run test -w @terra/core && npm run test:integration -- --suite core`

#### W1 — `L2` Simulation
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-06.1`](./issues/TA-06-simulation-core.md) — Deterministic kernel: tick, seeded PRNG, fixed-point, ECS store, command application, state hash
  - [ ] [`TA-06.2`](./issues/TA-06-simulation-core.md) — Hex grid & planet generator (Temperate/Desert), deposits, spawn sites
  - [ ] [`TA-06.9`](./issues/TA-06-simulation-core.md) — Snapshot codec, fog-of-war view & delta diff
- **Verify:** `npm run test -w @terra/sim && npm run sim:determinism -w @terra/sim -- --ticks 10000 --runs 3`

#### W1 — `L3` Planet Worker & Continuity
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-07.1`](./issues/TA-07-planet-worker.md) — Worker Nest skeleton, registration & heartbeat in `{ns}_workers`
  - [ ] [`TA-07.5`](./issues/TA-07-planet-worker.md) — Planet leases (KV CAS) + `planet/worker .ctl` handlers + graceful drain
  - [ ] [`TA-07.2`](./issues/TA-07-planet-worker.md) — Planet host: load/unload, drift-free multi-planet tick scheduler, fault quarantine
- **Verify:** `TA_NS=l3 npm run test -w @terra/planet-worker && npm run test:integration -- --suite worker`

#### W1 — `L4` AI & NEAR
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-09.1`](./issues/TA-09-ai-orchestrator.md) — AI service skeleton + Z.ai `glm-5.3` client behind `LlmProviderPort` + mock provider
  - [ ] [`TA-10.8`](./issues/TA-10-near-gateway.md) — Ports & mocks foundation (D-30): 11 NEAR port classes, binding module, fail-closed adapter selection, Postgres mocks, `chain_outbox`, contract suites
- **Verify:** `TA_NS=l4 npm run test -w @terra/ai-orchestrator -w @terra/near-gateway && npm run test:integration -- --suite edge`

#### W1 — `L5` Clients & Infra
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-02.2`](./issues/TA-02-infra-nats-postgres-nginx.md) — JetStream streams & KV bootstrap generated from contracts
  - [ ] [`TA-02.3`](./issues/TA-02-infra-nats-postgres-nginx.md) — Multi-stage Dockerfiles for 4 backend apps + 2 static frontends
  - [ ] [`TA-11.1`](./issues/TA-11-game-client.md) — Game app shell: Vite/TS, router, auth bootstrap, API client, React HUD root
  - [ ] [`TA-12.1`](./issues/TA-12-landing.md) — Landing page: hero, loop explainer, CTA, live planet stats
- **Verify:** `npm run nats:bootstrap -- --ns l5 && npm run build -w @terra/game -w @terra/landing && npm run images:build`

> **W1 BARRIER:** `npm run check && npm run test:integration -- --suite w1` — all four backend services start against one NATS/PG, become ready, a worker registers in `{ns}_workers`, loads a stub planet and holds its lease; core issues a guest token and `/me/home` returns `NEW`; sim determinism check passes.

---

### WAVE 2 — First playable online
**Goal:** a guest opens `game.terraagent.localhost`, sees planets, joins (queue → seat), and watches their founder robot mine and build on a live server-side planet over WebSocket.
**Pre-step:** contract additions requested by W2 DoRs (expected: `PlanetSummary` fields, `MatchTicket` DTOs, command kinds for building/robots, trade command kinds + trade events and the reservation model for TA-06.4; **D-16:** `UnitId`, `TerraformOp`, tile `terrain`/`prep` enums, `enqueueTask` variants per units spec §7 rows 6 and 14, the queue view DTO, reject codes `worker_tier_locked`, `stage_locked`, `would_isolate`). **Migration:** `0002_*` only if requested.

#### W2 — `L1` Core & Matchmaking
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-05.1`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) — Planet lifecycle state machine + static placement on a live worker
  - [ ] [`TA-05.2`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) — Planet browser API: `RECRUITING` list + "new planet" per type
  - [ ] [`TA-05.3`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) — Match queue: enqueue/cancel/status, seat reservation with TTL
  - [ ] [`TA-04.5`](./issues/TA-04-core-api-auth-and-home.md) — Planet ticket issuer (Ed25519) + worker directory from KV
- **Verify:** `npm run test -w @terra/core && npm run test:integration -- --suite core`

#### W2 — `L2` Simulation
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-06.3`](./issues/TA-06-simulation-core.md) — Territory claim & immutable border collision
  - [ ] [`TA-14.1`](./issues/TA-14-units-orders-progression.md) — Data tables: units, weapons (battle v1), stages, terrain & terraform ops, fauna, Wall Gate & Aero Hangar rows
  - [ ] [`TA-06.4`](./issues/TA-06-simulation-core.md) — Economy: resources, storage caps, MVP building catalog, construction & upgrades
  - [ ] [`TA-14.3`](./issues/TA-14-units-orders-progression.md) — Ground & terraform: terrain, spawn guarantee, 9 ops with energy, linked prep, Prepared-ground rule, walls, meteor holes
  - [ ] [`TA-06.6`](./issues/TA-06-simulation-core.md) — Units & production (D-16): HQ, workers, MVP combat units, Hub/Factory production, supply cap, wall-aware pathfinding
  - [ ] [`TA-14.2`](./issues/TA-14-units-orders-progression.md) — Order lanes & queue: pay-on-start, dispatch + earmarks, precedence, worker-tier gate, HQ rules
- **Verify:** `npm run test -w @terra/sim && npm run sim:determinism -w @terra/sim -- --ticks 36000 --scenario founder && npm run sim:determinism -w @terra/sim -- --ticks 6000 --scenario landfall --runs 3`
- **Load warning:** 6 tasks, the heaviest lane-wave in the plan (see §6).

#### W2 — `L3` Planet Worker & Continuity
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-07.3`](./issues/TA-07-planet-worker.md) — Planet WS gateway: ticket verify, welcome snapshot, 5 Hz deltas, takeover, backpressure
  - [ ] [`TA-07.4`](./issues/TA-07-planet-worker.md) — Command ingestion: WS + `planet.{id}.cmd` stream → validated, tick-stamped, acked
  - [ ] [`TA-07.7`](./issues/TA-07-planet-worker.md) — Significant-event emission to `{NS}_PLANET_EVENTS`
- **Verify:** `npm run test -w @terra/planet-worker && npm run test:integration -- --suite worker`

#### W2 — `L4` AI & NEAR
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-10.9`](./issues/TA-10-near-gateway.md) — F5 + F1 on mocks: named accounts, relayed actions, cargo Export/Import + mint caps
  - [ ] [`TA-09.2`](./issues/TA-09-ai-orchestrator.md) — Trigger intake from `{NS}_AI_REQUESTS`, per-colony rate limits, dedupe, daily budget
- **Verify:** `npm run test -w @terra/ai-orchestrator -w @terra/near-gateway && npm run test:integration -- --suite edge`

#### W2 — `L5` Clients & Infra
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-02.4`](./issues/TA-02-infra-nats-postgres-nginx.md) — nginx: apex/www/game/api/ws server blocks, WS upgrade, worker map, rate limits, security headers
  - [ ] [`TA-11.2`](./issues/TA-11-game-client.md) — Planet picker & queue UI (lobby WS / polling fallback)
  - [ ] [`TA-11.4`](./issues/TA-11-game-client.md) — Planet WS client: snapshot/delta store, interpolation buffer, reconnect
  - [ ] [`TA-11.5`](./issues/TA-11-game-client.md) — Diorama viewport & hex terrain renderer (Pillar 4)
- **Verify:** `npm run test -w @terra/game && npm run build -w @terra/game && npm run nginx:test`

> **W2 BARRIER:** `npm run check && npm run test:integration -- --suite w2 && npm run test:e2e -- --grep @w2` — headless browser: first visit → `NEW` → picker lists ≥ 1 `RECRUITING` planet → join → seat confirmed → WS `welcome` → ≥ 10 deltas → founder robot position changes → the HQ prepares the Hub site and builds the Hub on its own cell → a `placeBuilding` on forest is acked, creates linked prep, and the building appears.

---

### WAVE 3 — Persistent world
**Goal:** the owner's core promise: close the tab, the colony keeps working; come back and continue with a "while you were away" summary; kill a worker and the planet resumes elsewhere; the matchmaker fills and seals planets; the AI director acts.
**Pre-step:** contracts for `DirectiveV1`, digest DTO, presence, `core.catchUp` marker (D-20), `stageReached` + `spawnColony.unlockStage`, diplomacy commands/events (`UO-DIP`); spec follow-ups for D-20 (SIM-C-10) and D-21 (SIMULATION §7.4); migration `0003_*` if requested (digest, ai decision log fields).

#### W3 — `L1` Core & Matchmaking
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-05.4`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) — Matchmaker leader loop: assign/create planets, warm pool, sealing
  - [ ] [`TA-05.5`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) — Planet scheduler: capacity-aware placement, lease reconcile, failover reassignment
  - [ ] [`TA-08.4`](./issues/TA-08-continuity-offline-and-resume.md) — Resume flow in core: home → ticket → reconnect; failover retry; device takeover
  - [ ] [`TA-04.6`](./issues/TA-04-core-api-auth-and-home.md) — Lobby WebSocket gateway (`/ws`): planets & queue topics
  - [ ] [`TA-04.3`](./issues/TA-04-core-api-auth-and-home.md) — NEAR wallet link & sign-in via `near.verify` (NEP-413)
  - [ ] [`TA-15.1`](./issues/TA-15-player-profile-achievements-maps.md) — Progression service: Facts, AchievementUnlock, XpLedger, level curve, evaluation + catch-up
  - [ ] [`TA-15.2`](./issues/TA-15-player-profile-achievements-maps.md) — Profile API: `/me/profile`, `/me/history`, `/me/achievements`
- **Verify:** `npm run test -w @terra/core && npm run test:integration -- --suite core && npm run test -w @terra/app -- progression api/me`

#### W3 — `L2` Simulation
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-06.5`](./issues/TA-06-simulation-core.md) — Power grid: generation, pylons, connectivity, brownout shedding
  - [ ] [`TA-06.12`](./issues/TA-06-simulation-core.md) — Per-pylon max load: capacity-limited power routing, overload trips (D-21)
  - [ ] [`TA-06.7`](./issues/TA-06-simulation-core.md) — Rule engine (utility AI) + canonical priorities (economy/expansion/defense/power/terraform) + directive application
  - [ ] [`TA-14.5`](./issues/TA-14-units-orders-progression.md) — Progression: unlock/threat stages, triggers + dwell, stage-scaled raids, newcomer shield
  - [ ] [`TA-14.6`](./issues/TA-14-units-orders-progression.md) — HQ goals & diplomacy in sim: goal breakdown + budgets, truces
- **Verify:** `npm run test -w @terra/sim && npm run sim:determinism -w @terra/sim -- --ticks 72000 --scenario unattended-24h-compressed`

#### W3 — `L3` Planet Worker & Continuity
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-07.6`](./issues/TA-07-planet-worker.md) — Snapshot persistence & failover restore (snapshot + replay + hash check)
  - [ ] [`TA-07.9`](./issues/TA-07-planet-worker.md) — Catch-up ticking after failover/restore: bounded fast-forward of downtime (D-20)
  - [ ] [`TA-08.1`](./issues/TA-08-continuity-offline-and-resume.md) — Presence tracking (`{ns}_presence`, `lastSeenAt`)
  - [ ] [`TA-08.3`](./issues/TA-08-continuity-offline-and-resume.md) — "While you were away" digest
- **Verify:** `npm run test -w @terra/planet-worker && npm run test:integration -- --suite worker`

#### W3 — `L4` AI & NEAR
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-09.3`](./issues/TA-09-ai-orchestrator.md) — Prompt builder (compact state) + `DirectiveV1` JSON schema & validation
  - [ ] [`TA-09.4`](./issues/TA-09-ai-orchestrator.md) — Directive publish to command stream, decision log, timeouts & fallback
  - [ ] [`TA-10.10`](./issues/TA-10-near-gateway.md) — F2 on mocks: market stalls + owner fees, order book = message bus, paired `token_diff` via `IntentsPort`
  - [ ] [`TA-10.11`](./issues/TA-10-near-gateway.md) — F3 + F4 on mocks: Orbital Guild NPCs + pricing + ship visits; colony director key
- **Verify:** `npm run test -w @terra/ai-orchestrator && npm run test -w @terra/app -- near-contract near/market near/guild near/director`

#### W3 — `L5` Clients & Infra
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-11.3`](./issues/TA-11-game-client.md) — Home routing & resume UX: dive-in, retry, away digest modal
  - [ ] [`TA-11.6`](./issues/TA-11-game-client.md) — Instanced entity rendering: robots & buildings (Pillars 1/3)
  - [ ] [`TA-14.9`](./issues/TA-14-units-orders-progression.md) — Visuals: MVP archetypes, Prepared pad, Ridge/Moat terrain, terraform VFX
  - [ ] [`TA-15.6`](./issues/TA-15-player-profile-achievements-maps.md) — Minimap: cached tile canvas, unit dots, camera footprint, click/drag pan, alert pulses
  - [ ] [`TA-11.7`](./issues/TA-11-game-client.md) — HUD: resources, power, task queue, priorities, event log
  - [ ] [`TA-02.5`](./issues/TA-02-infra-nats-postgres-nginx.md) — Prod compose + TLS + deploy/rollback script with worker drain
- **Verify:** `npm run test -w @terra/game && npm run build -w @terra/game && npm run deploy:dry-run`

> **W3 BARRIER:** `npm run check && npm run test:integration -- --suite w3 && npm run test:e2e -- --grep @w3 && npm run test:integration -- --suite worker --grep failover` — (a) player joins, closes the socket, 10 min (compressed clock) later the colony's resources and buildings have grown and the AI decision log has ≥ 1 entry; (b) reopening the game goes straight to `/play` with an away digest; (c) `kill -9` of the planet's worker → planet resumes on the other worker within 30 s with matching `stateHash`, then catches up the downtime (D-20); (d) 6 synthetic players for one planet type → 5 seated on planet A (sealed), 6th on a new planet B.

---

### WAVE 4 — Game depth & ops
**Goal:** the game is worth leaving running (hazards, fauna, PvP, rocket → new planet, trades) and operable (queue controls, admin, elimination/end flows, prod-like local stack).
**Pre-step:** contracts for trades, hazards/fauna events, admin DTOs, rocket transfer, `colonySettled`, `Autopilot` v2 (away budget, autoTrade, raid opt-in), notification DTOs, party DTOs, `DirectiveV1` v2, unit `arc`/`armor` view fields; spec follow-ups for D-17, D-18, D-19, D-22 (CONTINUITY, NEAR §7 Intents, MATCHMAKING parties, CLIENT mobile); migration `0004_*` (party, notification subscriptions + outbox, plus anything requested).

#### W4 — `L1` Core & Matchmaking
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-05.6`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) — Managed queue controls: caps, backpressure, pause, priority, metrics
  - [ ] [`TA-05.7`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) — Party tickets + seat refill only within the first 2 h (D-22, D-12 amended)
  - [ ] [`TA-04.7`](./issues/TA-04-core-api-auth-and-home.md) — Admin/ops API: planets, queue, workers, force-seal/end, drain
  - [ ] [`TA-08.5`](./issues/TA-08-continuity-offline-and-resume.md) — Elimination, planet end & re-entry flows
  - [ ] [`TA-08.7`](./issues/TA-08-continuity-offline-and-resume.md) — Notification service in core: Web Push + Telegram bot (D-17)
  - [ ] [`TA-15.8`](./issues/TA-15-player-profile-achievements-maps.md) — BadgeMint outbox through `BadgeNftPort` (mock)
- **Verify:** `npm run test -w @terra/core && npm run test:integration -- --suite core`

#### W4 — `L2` Simulation
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-14.4`](./issues/TA-14-units-orders-progression.md) — Battle v1 (D-28): plain HP/damage, projectile impact-at-time, lasers/rockets/AoE, evasive, line of fire, wall-aware nav, fauna siege, Brute
  - [ ] [`TA-06.8`](./issues/TA-06-simulation-core.md) — Hazards (lightning, meteor) + fauna (1 species, nests)
  - [ ] [`TA-06.11`](./issues/TA-06-simulation-core.md) — PvP raids with army groups: gate pathing, newcomer shield & truce checks (D-16)
  - [ ] [`TA-06.10`](./issues/TA-06-simulation-core.md) — Rocket build/launch & colony transfer to a new planet
  - [ ] [`TA-06.13`](./issues/TA-06-simulation-core.md) — Settled colony: rocket gate (own territory 100 % Living), inert Settled state (D-18)
- **Verify:** `npm run test -w @terra/sim && npm run sim:determinism -w @terra/sim -- --ticks 72000 --scenario hostile`

#### W4 — `L3` Planet Worker & Continuity
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-08.2`](./issues/TA-08-continuity-offline-and-resume.md) — Away-mode autopilot policy & safety rules
  - [ ] [`TA-08.6`](./issues/TA-08-continuity-offline-and-resume.md) — Hard offline mode: away budget, autoTrade, opt-in AI raids, elimination-while-away safety (D-17)
  - [ ] [`TA-07.8`](./issues/TA-07-planet-worker.md) — Worker metrics: tick duration, planets, sockets, lag; load shedding
- **Verify:** `npm run test -w @terra/planet-worker && npm run test:integration -- --suite worker`

#### W4 — `L4` AI & NEAR
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-09.5`](./issues/TA-09-ai-orchestrator.md) — Cost controls & ops: token accounting, kill switch, eval harness
  - [ ] [`TA-09.6`](./issues/TA-09-ai-orchestrator.md) — `DirectiveV1` v2: units, goals, truces; brief stage fields; raw logs 14 d (D-16, D-17, D-09)
  - [ ] [`TA-10.12`](./issues/TA-10-near-gateway.md) — F6 + F7 + F8 on mocks: Colony Deed + staking panel, planet treasury DAO, bounty escrow
  - [ ] [`TA-10.1`](./issues/TA-10-near-gateway.md) — *Phase 2:* real chain infra: network config, key store, RPC, real `ChainReadPort`
  - [ ] [`TA-10.3`](./issues/TA-10-near-gateway.md) — *Phase 2:* real `IdentityPort` + `RelayerPort` (F5)
  - ~~[`TA-10.5`](./issues/TA-10-near-gateway.md) — Inter-colony trade saga~~ **obsolete (D-30)**, replaced by TA-10.10; nothing to do
- **Verify:** `npm run test -w @terra/ai-orchestrator && npm run test -w @terra/app -- near-contract near/deed near/staking near/treasury near/bounty` (+ the real-adapter contract suites for Identity/Relayer/ChainRead, manual)

#### W4 — `L5` Clients & Infra
- **Lane Status:** `[ ] Todo`
- **Tasks (in order):**
  - [ ] [`TA-11.8`](./issues/TA-11-game-client.md) — Placement, upgrade & ground-prep UX: ghost footprint with prep bill, tile-state overlay → commands (D-16)
  - [ ] [`TA-14.8`](./issues/TA-14-units-orders-progression.md) — Client order menus, queue panel (reasons/ETA/earmarks), tile overlay, goal/stage/truce UI
  - [ ] [`TA-14.10`](./issues/TA-14-units-orders-progression.md) — Battle v1 client: range rings, projectile visuals, impact + AoE decals
  - [ ] [`TA-15.3`](./issues/TA-15-player-profile-achievements-maps.md) — Player page UI `/me` (Faction Plate)
  - [ ] [`TA-15.4`](./issues/TA-15-player-profile-achievements-maps.md) — Achievement flip cards + tier ladders (20 × 3)
  - [ ] [`TA-15.7`](./issues/TA-15-player-profile-achievements-maps.md) — Global planet map: layers, zoom, click-to-fly
  - [ ] [`TA-11.9`](./issues/TA-11-game-client.md) — Full gameplay on phones: landscape fullscreen, touch camera & orders (D-22)
  - [ ] [`TA-12.2`](./issues/TA-12-landing.md) — Landing SEO/meta, legal placeholders, analytics opt-in
  - [ ] [`TA-02.6`](./issues/TA-02-infra-nats-postgres-nginx.md) — Local prod-like stack on `*.terraagent.localhost` + smoke script
- **Verify:** `npm run test -w @terra/game && npm run stack:local:smoke`

> **W4 BARRIER:** `npm run check && npm run test:integration -- --suite w4 && npm run test:e2e -- --grep "@w2\|@w3\|@w4" && npm run stack:local:smoke` — includes: lightning severs a pylon and a builder repairs it while the player is away; a raid damages a neighbour, but a ground army is stopped by a Ridge ring while artillery fires over it; truce partners cannot damage each other; a trade settles on both planets via NEAR Intents on sandbox; a `colonyCritical` event produces a Web Push + Telegram notification (mock adapters); a party of 3 lands on one planet; a fully terraformed colony launches and becomes Settled; an eliminated player lands on the picker; admin can seal a planet and drain a worker with zero lost commands.

---

### WAVE 5 — Launch readiness
**Goal:** prove the system under load and failure, wire observability, ship to production.
**Pre-step:** spec follow-up for NEAR claim + staking (D-18) before TA-10.7.

| Lane | Task | Verify |
|---|---|---|
| `L1` | [ ] [`TA-13.6`](./issues/TA-13-qa-observability-and-load.md) — Matchmaking soak: 200 synthetic players | `npm run test:soak:mm` |
| `L2` | [ ] [`TA-14.7`](./issues/TA-14-units-orders-progression.md) — Balance harness: duels + reference-player bot S0→S7 + stage telemetry (first) | `npm run sim:duels -w @terra/sim && npm run sim:reference-bot -w @terra/sim -- --seeds 5` |
| `L2` | [ ] [`TA-13.4`](./issues/TA-13-qa-observability-and-load.md) — Failover determinism suite (kill worker mid-tick) | `npm run test:failover` |
| `L3` | [ ] [`TA-13.5`](./issues/TA-13-qa-observability-and-load.md) — Load test: planets/worker & sockets/worker capacity | `npm run test:load -- --profile baseline` |
| `L4` | [ ] [`TA-10.6`](./issues/TA-10-near-gateway.md) — *Phase 2:* real `CargoTokenPort` (NEP-245) + real `IntentsPort` (mainnet, dry-run first) (first) | `npm run test -w @terra/app -- near-contract --adapter real --grep "CargoToken|Intents"` |
| `L4` | [ ] [`TA-10.2`](./issues/TA-10-near-gateway.md) — *Phase 2:* NEP-413 wallet link (real) | `npm run test -w @terra/app -- near/wallet-link` |
| `L4` | [ ] [`TA-10.4`](./issues/TA-10-near-gateway.md) — *Phase 2:* real `DeedNftPort` / `BadgeNftPort` (NEP-171) | `npm run near:contract:test` |
| `L4` | [ ] [`TA-10.7`](./issues/TA-10-near-gateway.md) — *Phase 2:* real `StakingPort` + claimable colony accounts (D-18) | `npm run test:integration -- --suite edge --grep claim` |
| `L4` | [ ] [`TA-10.13`](./issues/TA-10-near-gateway.md) — *Phase 2:* real `AgentWalletPort`, `TreasuryDaoPort`, `EscrowPort` | `npm run test -w @terra/app -- near-contract --adapter real` |
| `L4` | [ ] [`TA-13.2`](./issues/TA-13-qa-observability-and-load.md) — Observability: dashboards, alerts, log correlation | `npm run monitoring:check` |
| `L5` | [ ] [`TA-12.3`](./issues/TA-12-landing.md) — Live Three.js mini-diorama hero with poster fallback (D-22) (first) | `npm run lighthouse -w @terra/landing` |
| `L5` | [ ] [`TA-11.10`](./issues/TA-11-game-client.md) — Notification opt-in UX: Web Push service worker + Telegram link (D-17) | `npm run test:e2e -- --grep @notify` |
| `L5` | [ ] [`TA-13.3`](./issues/TA-13-qa-observability-and-load.md) — E2E journeys: first visit → play → leave → return | `npm run test:e2e` |
| `L5` | [ ] [`TA-15.5`](./issues/TA-15-player-profile-achievements-maps.md) — Badge art generator: hex medallion, tier rims, locked variant | `node frontend/design/achievements/generate.mjs` |
| `L5` | [ ] [`TA-13.7`](./issues/TA-13-qa-observability-and-load.md) — Launch checklist & production smoke (after the other W5 tasks) | `npm run smoke:prod` |

> **W5 BARRIER (launch gate):** `npm run test:ci:full && npm run test:load -- --profile baseline && npm run test:soak:mm` green; `WORKER_MAX_PLANETS` updated from measured capacity on the 4 vCPU / 8 GB launch host (D-23); balance report `AC-01/02/04` green; owner signs off `OWNER_TASKS.md` launch items.

---

## 5. Running the waves with Claude Code

1. Lead: "work on `docs/plan/EXECUTION_ORCHESTRATOR.md`" → finds the first wave not `[x] Done`.
2. Lead performs the wave **Pre-Step** (contracts/schema/lockfile), commits to `main`.
3. Lead spawns one subagent per active lane (`Agent`, `isolation: "worktree"`), each briefed with: lane id, isolation env from §1.5, the lane's task list, its owned/forbidden paths from §3, and the issue file links.
4. Lanes report "ready for barrier" with their Verify output. Lead merges `w{N}-l{K}` branches, regenerates `package-lock.json`, runs the barrier gate, fixes integration breaks (or reopens lane tasks), then updates §2, `STATUS.md` and tags `w{N}-done`.
5. Never auto-start the next wave if the barrier is red; report to the owner instead.

---

## 6. Load and risk notes after the owner answers (2026-10-30)

| Lane | W2 | W3 | W4 | W5 | Note |
|---|---|---|---|---|---|
| `L1` | 4 | **7** | **6** | 1 | Parties and notifications land in W4; progression + profile API in W3 (TA-15.1/15.2), badge outbox in W4 |
| `L2` | **6** | **5** | **5** | 2 | The sim is the critical path: 9 of the 21 new tasks are sim tasks |
| `L3` | 3 | 4 | 3 | 1 | — |
| `L4` | 2 | **4** | **6** | **6** | Mock-first (D-30) makes W2–W4 cheap. Phase 2 real adapters pile up in W4–W5; TA-10.5 in W4 is obsolete (no work) |
| `L5` | 4 | **6** | **9** | **5** | **Overloaded after D-28/D-29:** rings + projectiles, `/me`, achievements and global map all land in W4 |

- **L2 overload.** If W2 or W3 slips, the lead may split `L2` into `L2a` (economy/ground/queue: TA-06.3/06.4/06.5/06.12, TA-14.1/14.2/14.3) and `L2b` (units/combat/progression: TA-06.6/06.7/06.8/06.11, TA-14.4–14.6). Both stay inside `shared/sim/**` with disjoint sub-folders (`systems/{economy,power,terraform}` vs `systems/{combat,fauna,progression,goals}`). They need a sixth isolation row (`l6`, ports 46xx). That requires a lead pre-step change to §1.5 and §3.
- **L5 overload.** Mobile (TA-11.9), notifications UX (TA-11.10), the live landing hero (TA-12.3), battle visuals (TA-14.10) and the TA-15 client tasks were added to an already full lane (9 tasks in W4).
  - **Recommended:** split `L5` into `L5a` (game client & HUD: `frontend/game/**`) and `L5b` (landing, infra, `/me` pages: `frontend/landing/**`, `infra/**`, `frontend/game/src/pages/me/**`). This needs a seventh isolation row, set in a lead pre-step.
  - Fallback order if W4/W5 slip: TA-15.5 badge art → glyphs; TA-15.7 → 4 required layers only; TA-12.3 → poster-only hero; TA-11.10 → push only.
- **NEAR phase 2 (D-30).** A real adapter merges only after its contract suite passes against the real chain (manual or nightly job). Swap order: F5 → F1 → F2 → F3/F4 → F6 → F7 → F8. The README keeps a mock/real table.
- **NEAR Intents in MVP (D-19).** This adds a token contract and solver latency to the trade saga. TA-10.6 keeps a `TRADE_SETTLEMENT=intents|receipt` flag, so W4 can pass on receipts if Intents is not stable.
- **Hard offline mode (D-17) + catch-up ticking (D-20)** make failover and offline balance user-visible. TA-13.4 and TA-14.7 must run the `unattended-stages` scenario through a catch-up.
- **4 vCPU / 8 GB launch host (D-23)** roughly halves the earlier capacity estimate. TA-13.5 must set `WORKER_MAX_PLANETS` and the matchmaking caps (TA-05.6) from measurements before launch.
