# docs/plan — TerraAgent online build plan

Docs only. Nothing here is implemented yet (2026-10-29). Plan and spec are drafts for owner review.

**Start here:** [`EXECUTION_ORCHESTRATOR.md`](./EXECUTION_ORCHESTRATOR.md) — the root file. It schedules 80 tasks across 6 waves (`W0`–`W5`) and 5 parallel lanes (`L1`–`L5`), with file ownership, per-lane DB/NATS/port isolation and barrier gates.

| File | Purpose |
|---|---|
| [`EXECUTION_ORCHESTRATOR.md`](./EXECUTION_ORCHESTRATOR.md) | **Root orchestration:** coordination protocol, wave board, lane ownership, per-wave lane task lists, barrier commands, how to run with Claude Code subagents |
| [`STATUS.md`](./STATUS.md) | Status board: per-epic counters, per-wave counts, one row per task |
| [`OWNER_TASKS.md`](./OWNER_TASKS.md) | What only the owner can do: domains/DNS, TLS, servers, NEAR accounts, Z.ai key, decisions to confirm |
| [`issues/`](./issues/) | 13 epic files. Every task has **Analytics** (problem, constraints, risks, rejected alternatives, telemetry), **Architecture**, **DoR**, **DoD**, target files and a verify command |

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
| [`TA-10`](./issues/TA-10-near-gateway.md) | NEAR gateway: NEP-413, colony accounts, registry contract, trades | L4 |
| [`TA-11`](./issues/TA-11-game-client.md) | Game app (`game.terraagent.com`) | L5 |
| [`TA-12`](./issues/TA-12-landing.md) | Landing app (`terraagent.com`) | L5 |
| [`TA-13`](./issues/TA-13-qa-observability-and-load.md) | Test harness, E2E, failover, load, soak, observability, launch | Lead (W0), all lanes (W5) |

## Specs ([`../spec/`](../spec/))

| File | Purpose |
|---|---|
| [`ARCHITECTURE.md`](../spec/ARCHITECTURE.md) | **Source of truth for cross-service contracts:** apps, domains, ports, NATS subjects/KV, resume path, lifecycle summary, tunables |
| [`DECISIONS.md`](../spec/DECISIONS.md) | D-01..D-15 with alternatives (all `Proposed` — grill these first) |
| [`PROTOCOL.md`](../spec/PROTOCOL.md) | WebSocket (worker + lobby) and NATS message contracts |
| [`DATA_MODEL.md`](../spec/DATA_MODEL.md) | Prisma model, invariants, retention |
| [`MATCHMAKING.md`](../spec/MATCHMAKING.md) | Planet lifecycle, picker, managed queue |
| [`CONTINUITY.md`](../spec/CONTINUITY.md) | Home states, offline autopilot, away digest, resume, failover |
| [`SIMULATION.md`](../spec/SIMULATION.md) | Determinism, tick pipeline, content scope, worker host model |
| [`AI_ORCHESTRATOR.md`](../spec/AI_ORCHESTRATOR.md) | Triggers, budgets, prompts, `DirectiveV1`, cost model |
| [`NEAR.md`](../spec/NEAR.md) | Sign-in, invisible accounts, registry contract, trades |
| [`CLIENT.md`](../spec/CLIENT.md) | Game client flows, WS state machine, rendering, product analytics |
| [`DEPLOYMENT.md`](../spec/DEPLOYMENT.md) | nginx/subdomains, TLS, prod compose, backups, deploy with worker drain |

Gameplay design stays in the root files ([`autonomous-colony-spec.md`](../../autonomous-colony-spec.md), [`colony-economy-and-buildings-spec.md`](../../colony-economy-and-buildings-spec.md), [`units-orders-and-progression-spec.md`](../../units-orders-and-progression-spec.md)); 3D visual rules stay in [`AGENTS.md`](../../AGENTS.md) and `.agents/skills/`.
