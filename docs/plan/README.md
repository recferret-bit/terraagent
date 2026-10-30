# docs/plan — TerraAgent online build plan

Docs only. Nothing here is implemented yet (2026-10-30).

**Start with [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md)** (2026-10-30). It is the plan: **26 product waves, 862 issues (≈ 625 agent-days)**, listed in [`ISSUE_INDEX.md`](./ISSUE_INDEX.md), with one file per wave in [`waves/`](./waves/).
- **Every wave ships a working app.** Each wave has a flag, a git tag, a seed scenario and its own e2e suite, so it can be tested on its own and you can go back and forward.
- **Waves run in parallel** on five tracks after the spine (W00–W02).
- **Each wave has its own branch and worktree** and reaches `main` only after the owner's manual check; then the worktree and branch are deleted and `main` is pushed ([`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md) §7).
- **The old layer-based plan** (`EXECUTION_ORCHESTRATOR.md`, `STATUS.md`, `issues/TA-*.md`) is superseded and kept only for traceability.

**Hackathon (2026-11-01 → 11-14):** option B: the `H` column in each wave file tags the must set (384 issues, ≈ 294 units). [`HACKATHON_CUT.md`](./HACKATHON_CUT.md) has what ships, the pace check and the drop order; [`HACKATHON_SCHEDULE.md`](./HACKATHON_SCHEDULE.md) has the generated critical path and start order. Decisions D-24..D-30 apply:
- one NestJS app + Postgres, a simplified server sim, no anti-cheat or anti-bot;
- NEAR features F1–F8, **all on mock adapters behind real ports in phase 1** (D-30), with real adapters swapped in phase 2 (F5 → F1 → F2);
- battle v1 (D-28);
- player page, achievements, XP, minimap and global map (D-29).

*(Superseded)* The 116-task layer plan below is kept for traceability only; [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md) is the plan.

**Obsolete under D-24 (kept as "Future"):** TA-01.3 (NATS subjects/streams/KV), TA-02.2 (JetStream/KV bootstrap), TA-05.5 (lease reconcile + failover reassignment), TA-07.1 (worker registration/heartbeat in KV), TA-07.5 (planet leases + drain), TA-07.9 (catch-up ticking), TA-13.4 (failover determinism suite). **Obsolete under D-30:** TA-10.5 (trade saga, replaced by TA-10.10). **Rescoped to phase 2 (real adapters):** TA-10.1, 10.2, 10.3, 10.4, 10.6, 10.7.
**Needs simplification before use:** TA-02.1 (Postgres only, no NATS), TA-02.3 (one app image), TA-02.4 (one WS endpoint, no worker map, no rate limits), TA-02.5 (no worker drain), TA-04.5 (ticket without worker directory), TA-05.4 (no leader election), TA-06.1 (floats allowed, no state hash), TA-06.9 (delta diff only, no fog-of-war view), TA-07.4 / TA-07.7 (in-process commands/events), TA-07.6 (snapshot resume + coarse fast-run, no replay/hash), TA-08.1 (in-process presence), TA-09.2 (in-process intake, budget cap only).

*(Superseded)* [`EXECUTION_ORCHESTRATOR.md`](./EXECUTION_ORCHESTRATOR.md) — the old root file. It schedules 116 tasks across 6 waves (`W0`–`W5`) and 5 parallel lanes (`L1`–`L5`), with file ownership, per-lane DB/NATS/port isolation and barrier gates.

| File | Purpose |
|---|---|
| [`HACKATHON_CUT.md`](./HACKATHON_CUT.md) | **14-day solo hackathon plan:** scope, day-by-day deliverables with "done when" checks, D10 hard gate, submission checklist, post-hackathon list, risks |
| [`EXECUTION_ORCHESTRATOR.md`](./EXECUTION_ORCHESTRATOR.md) | **Post-hackathon root orchestration:** coordination protocol, wave board, lane ownership, per-wave lane task lists, barrier commands, how to run with Claude Code subagents |
| [`STATUS.md`](./STATUS.md) | Status board: per-epic counters, per-wave counts, one row per task |
| [`OWNER_TASKS.md`](./OWNER_TASKS.md) | What only the owner can do: domains/DNS, TLS, servers, NEAR accounts, Z.ai key, decisions to confirm |
| [`issues/`](./issues) | 15 epic files. Every task has **Analytics** (problem, constraints, risks, rejected alternatives, telemetry), **Architecture**, **DoR**, **DoD**, target files and a verify command |

## Epics

| Epic | Domain | Lane(s) |
|---|---|---|
| [`TA-01`](./issues/TA-01-monorepo-and-shared-contracts.md) | Monorepo, tooling, `@terra/contracts`, `@terra/config`, sim facade | Lead (W0) |
| [`TA-02`](./issues/TA-02-infra-nats-postgres-nginx.md) | Postgres, NATS JetStream, Dockerfiles, nginx subdomains, prod deploy | Lead (W0), L5 |
| [`TA-03`](./issues/TA-03-database-and-persistence.md) | Prisma schema, `@terra/db`, snapshot store | Lead (W0) |
| [`TA-04`](./issues/TA-04-core-api-auth-and-home.md) | Core API (NestJS): auth, players, `/me/home`, planet tickets, lobby WS, admin | L1 |
| [`TA-05`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Planet lifecycle, picker API, managed queue, matchmaker, planet scheduler | L1 |
| [`TA-06`](./issues/TA-06-simulation-core.md) | Deterministic simulation (`@terra/sim`) | L2 |
| [`TA-07`](./issues/TA-07-planet-worker.md) | Planet worker: multi-planet host, own WebSocket, leases, snapshots, failover | L3 |
| [`TA-08`](./issues/TA-08-continuity-offline-and-resume.md) | Offline play, presence, away digest, resume, elimination/end flows | L3, L1 |
| [`TA-09`](./issues/TA-09-ai-orchestrator.md) | AI orchestrator on Z.ai `glm-5.3` | L4 |
| [`TA-10`](./issues/TA-10-near-gateway.md) | NEAR integration (D-30): ports + Postgres mocks + contract suites, F1–F8 on mocks, phase-2 real adapters | L4 |
| [`TA-11`](./issues/TA-11-game-client.md) | Game app (`game.terraagent.com`) | L5 |
| [`TA-12`](./issues/TA-12-landing.md) | Landing app (`terraagent.com`) | L5 |
| [`TA-13`](./issues/TA-13-qa-observability-and-load.md) | Test harness, E2E, failover, load, soak, observability, launch | Lead (W0), all lanes (W5) |
| [`TA-14`](./issues/TA-14-units-orders-progression.md) | Units, order lanes, ground prep & walls, truces, battle v1, learning curve (D-16, D-28) | L2, L5 (W2–W5) |
| [`TA-15`](./issues/TA-15-player-profile-achievements-maps.md) | Player page `/me`, 20 × 3 achievements, XP/levels, minimap, global planet map (D-29) | L1, L5 (W3–W5) |

## Specs ([`../spec/`](../spec))

| File | Purpose |
|---|---|
| [`ARCHITECTURE.md`](../spec/ARCHITECTURE.md) | **Source of truth for cross-service contracts:** apps, domains, ports, NATS subjects/KV, resume path, lifecycle summary, tunables |
| [`DECISIONS.md`](../spec/DECISIONS.md) | D-01..D-30 with alternatives (D-16 Accepted; D-17..D-23 = owner answers of 2026-10-29; D-24..D-27 = one app / no anti-cheat / NEAR features / hackathon; D-28..D-30 = battle v1 / player page & maps / ports & mocks) |
| [`PROTOCOL.md`](../spec/PROTOCOL.md) | WebSocket (worker + lobby) and NATS message contracts |
| [`DATA_MODEL.md`](../spec/DATA_MODEL.md) | Prisma model, invariants, retention |
| [`MATCHMAKING.md`](../spec/MATCHMAKING.md) | Planet lifecycle, picker, managed queue |
| [`CONTINUITY.md`](../spec/CONTINUITY.md) | Home states, offline autopilot, away digest, resume, failover |
| [`SIMULATION.md`](../spec/SIMULATION.md) | Determinism, tick pipeline, content scope, worker host model |
| [`AI_ORCHESTRATOR.md`](../spec/AI_ORCHESTRATOR.md) | Triggers, budgets, prompts, `DirectiveV1`, cost model |
| [`NEAR.md`](../spec/NEAR.md) | Sign-in, invisible accounts, registry contract, trades |
| [`CLIENT.md`](../spec/CLIENT.md) | Game client flows, WS state machine, rendering, product analytics |
| [`DEPLOYMENT.md`](../spec/DEPLOYMENT.md) | nginx/subdomains, TLS, prod compose, backups, deploy with worker drain |

Gameplay design lives in [`docs/game/`](../game) ([`autonomous-colony-spec.md`](../game/autonomous-colony-spec.md), [`colony-economy-and-buildings-spec.md`](../game/colony-economy-and-buildings-spec.md), [`units-orders-and-progression-spec.md`](../game/units-orders-and-progression-spec.md), [`near-economy-features-spec.md`](../game/near-economy-features-spec.md), [`player-profile-and-achievements-spec.md`](../game/player-profile-and-achievements-spec.md)); 3D visual rules stay in [`AGENTS.md`](../../AGENTS.md) and `.agents/skills/`.
