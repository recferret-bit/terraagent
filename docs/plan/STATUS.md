# Status Board — TerraAgent Online Build

> **Orchestrator:** [`EXECUTION_ORCHESTRATOR.md`](./EXECUTION_ORCHESTRATOR.md) · **Architecture:** [`../spec/ARCHITECTURE.md`](../spec/ARCHITECTURE.md)
> **Legend:** `[ ] Todo` · `[~] In Progress (Agent-N)` · `[x] Done` · `[!] Blocked (reason)`

## Summary

**2026-10-29:** plan drafted; 0/80 done. Decisions D-01..D-15 awaiting owner review.

| Epic | Domain | Waves | Total | Todo | In Progress | Done | Blocked |
|---|---|---|---|---|---|---|---|
| [`TA-01`](./issues/TA-01-monorepo-and-shared-contracts.md) | Monorepo, Tooling & Shared Contracts | W0 | 7 | 7 | 0 | 0 | 0 |
| [`TA-02`](./issues/TA-02-infra-nats-postgres-nginx.md) | Infra: Postgres, NATS, nginx, Deploy | W0, W1, W2, W3, W4 | 6 | 6 | 0 | 0 | 0 |
| [`TA-03`](./issues/TA-03-database-and-persistence.md) | Database & Persistence | W0 | 3 | 3 | 0 | 0 | 0 |
| [`TA-04`](./issues/TA-04-core-api-auth-and-home.md) | Core API: Auth, Players, Home, Tickets, Lobby WS | W1, W2, W3, W4 | 7 | 7 | 0 | 0 | 0 |
| [`TA-05`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Matchmaking & Planet Lifecycle | W2, W3, W4 | 6 | 6 | 0 | 0 | 0 |
| [`TA-06`](./issues/TA-06-simulation-core.md) | Simulation Core (`@terra/sim`) | W1, W2, W3, W4 | 11 | 11 | 0 | 0 | 0 |
| [`TA-07`](./issues/TA-07-planet-worker.md) | Planet Worker | W1, W2, W3, W4 | 8 | 8 | 0 | 0 | 0 |
| [`TA-08`](./issues/TA-08-continuity-offline-and-resume.md) | Continuity: Offline Play & Resume | W3, W4 | 5 | 5 | 0 | 0 | 0 |
| [`TA-09`](./issues/TA-09-ai-orchestrator.md) | AI Orchestrator (Z.ai glm-5.3) | W1, W2, W3, W4 | 5 | 5 | 0 | 0 | 0 |
| [`TA-10`](./issues/TA-10-near-gateway.md) | NEAR Gateway | W1, W2, W3, W4 | 5 | 5 | 0 | 0 | 0 |
| [`TA-11`](./issues/TA-11-game-client.md) | Game Client | W1, W2, W3, W4 | 8 | 8 | 0 | 0 | 0 |
| [`TA-12`](./issues/TA-12-landing.md) | Landing | W1, W4 | 2 | 2 | 0 | 0 | 0 |
| [`TA-13`](./issues/TA-13-qa-observability-and-load.md) | QA, Observability & Load | W0, W5 | 7 | 7 | 0 | 0 | 0 |
| **Total** | | | **80** | **80** | **0** | **0** | **0** |

## Per-wave counts

| Wave | Tasks | Done |
|---|---|---|
| W0 | 12 | 0 |
| W1 | 16 | 0 |
| W2 | 16 | 0 |
| W3 | 17 | 0 |
| W4 | 13 | 0 |
| W5 | 6 | 0 |

## Task tracker

| Task | Title | Wave | Lane | Status |
|---|---|---|---|---|
| [`TA-01.1`](./issues/TA-01-monorepo-and-shared-contracts.md) | npm-workspaces skeleton: root `package.json`, `tsconfig.base.json`, ESLint/Prettier, Vitest, `npm run check` | W0 | Lead | `[ ] Todo` |
| [`TA-01.2`](./issues/TA-01-monorepo-and-shared-contracts.md) | `@terra/contracts`: WS envelope + worker/lobby message schemas v1 | W0 | Lead | `[ ] Todo` |
| [`TA-01.3`](./issues/TA-01-monorepo-and-shared-contracts.md) | `@terra/contracts`: NATS subjects, stream/KV definitions & payload schemas | W0 | Lead | `[ ] Todo` |
| [`TA-01.4`](./issues/TA-01-monorepo-and-shared-contracts.md) | `@terra/contracts`: REST DTOs, error codes, planet-ticket claims | W0 | Lead | `[ ] Todo` |
| [`TA-01.5`](./issues/TA-01-monorepo-and-shared-contracts.md) | `scripts/ci-fast.sh`, root `ci:fast`, contract drift test | W0 | Lead | `[ ] Todo` |
| [`TA-01.6`](./issues/TA-01-monorepo-and-shared-contracts.md) | `@terra/config`: zod env loader, `TA_NS` + lane port helpers, `.env.example` convention | W0 | Lead | `[ ] Todo` |
| [`TA-01.7`](./issues/TA-01-monorepo-and-shared-contracts.md) | `@terra/sim` public API facade (`api.ts`) + stub implementation | W0 | Lead | `[ ] Todo` |
| [`TA-02.1`](./issues/TA-02-infra-nats-postgres-nginx.md) | Dev compose: Postgres 16 + NATS JetStream + nats-box, lane test DB init | W0 | Lead | `[ ] Todo` |
| [`TA-02.2`](./issues/TA-02-infra-nats-postgres-nginx.md) | JetStream streams & KV bootstrap generated from contracts | W1 | L5 | `[ ] Todo` |
| [`TA-02.3`](./issues/TA-02-infra-nats-postgres-nginx.md) | Multi-stage Dockerfiles for 4 backend apps + 2 static frontends | W1 | L5 | `[ ] Todo` |
| [`TA-02.4`](./issues/TA-02-infra-nats-postgres-nginx.md) | nginx: apex/www/game/api/ws server blocks, WS upgrade, worker map, rate limits, security headers | W2 | L5 | `[ ] Todo` |
| [`TA-02.5`](./issues/TA-02-infra-nats-postgres-nginx.md) | Prod compose + TLS + deploy/rollback script with worker drain | W3 | L5 | `[ ] Todo` |
| [`TA-02.6`](./issues/TA-02-infra-nats-postgres-nginx.md) | Local prod-like stack on `*.terraagent.localhost` + smoke script | W4 | L5 | `[ ] Todo` |
| [`TA-03.1`](./issues/TA-03-database-and-persistence.md) | Prisma schema v1 (`core`/`world`/`ai`/`chain`) + `0001_init` | W0 | Lead | `[ ] Todo` |
| [`TA-03.2`](./issues/TA-03-database-and-persistence.md) | `@terra/db`: client, repository base, seed, lane test-DB harness | W0 | Lead | `[ ] Todo` |
| [`TA-03.3`](./issues/TA-03-database-and-persistence.md) | Snapshot store: compressed `bytea`, retention policy, load-latest | W0 | Lead | `[ ] Todo` |
| [`TA-04.1`](./issues/TA-04-core-api-auth-and-home.md) | Core Nest skeleton: config, pino, Prisma, NATS, `/healthz` `/readyz` `/metrics` | W1 | L1 | `[ ] Todo` |
| [`TA-04.2`](./issues/TA-04-core-api-auth-and-home.md) | Guest auth: device login, access/refresh JWT, logout revoke | W1 | L1 | `[ ] Todo` |
| [`TA-04.3`](./issues/TA-04-core-api-auth-and-home.md) | NEAR wallet link & sign-in via `near.verify` (NEP-413) | W3 | L1 | `[ ] Todo` |
| [`TA-04.4`](./issues/TA-04-core-api-auth-and-home.md) | Players & `GET /v1/me/home` state machine (`NEW`/`QUEUED`/`ACTIVE`/`ELIMINATED`/`PLANET_ENDED`) | W1 | L1 | `[ ] Todo` |
| [`TA-04.5`](./issues/TA-04-core-api-auth-and-home.md) | Planet ticket issuer (Ed25519) + worker directory from KV | W2 | L1 | `[ ] Todo` |
| [`TA-04.6`](./issues/TA-04-core-api-auth-and-home.md) | Lobby WebSocket gateway (`/ws`): planets & queue topics | W3 | L1 | `[ ] Todo` |
| [`TA-04.7`](./issues/TA-04-core-api-auth-and-home.md) | Admin/ops API: planets, queue, workers, force-seal/end, drain | W4 | L1 | `[ ] Todo` |
| [`TA-05.1`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Planet lifecycle state machine + static placement on a live worker | W2 | L1 | `[ ] Todo` |
| [`TA-05.2`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Planet browser API: `RECRUITING` list + "new planet" per type | W2 | L1 | `[ ] Todo` |
| [`TA-05.3`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Match queue: enqueue/cancel/status, seat reservation with TTL | W2 | L1 | `[ ] Todo` |
| [`TA-05.4`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Matchmaker leader loop: assign/create planets, warm pool, sealing | W3 | L1 | `[ ] Todo` |
| [`TA-05.5`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Planet scheduler: capacity-aware placement, lease reconcile, failover reassignment | W3 | L1 | `[ ] Todo` |
| [`TA-05.6`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Managed queue controls: caps, backpressure, pause, priority, metrics | W4 | L1 | `[ ] Todo` |
| [`TA-06.1`](./issues/TA-06-simulation-core.md) | Deterministic kernel: tick, seeded PRNG, fixed-point, ECS store, command application, state hash | W1 | L2 | `[ ] Todo` |
| [`TA-06.2`](./issues/TA-06-simulation-core.md) | Hex grid & planet generator (Temperate/Desert), deposits, spawn sites | W1 | L2 | `[ ] Todo` |
| [`TA-06.3`](./issues/TA-06-simulation-core.md) | Territory claim & immutable border collision | W2 | L2 | `[ ] Todo` |
| [`TA-06.4`](./issues/TA-06-simulation-core.md) | Economy: resources, storage caps, MVP building catalog, construction & upgrades | W2 | L2 | `[ ] Todo` |
| [`TA-06.5`](./issues/TA-06-simulation-core.md) | Power grid: generation, pylons, connectivity, brownout shedding | W3 | L2 | `[ ] Todo` |
| [`TA-06.6`](./issues/TA-06-simulation-core.md) | Robots: Miner/Builder/Combat T1, supply cap, task queue, pathfinding | W2 | L2 | `[ ] Todo` |
| [`TA-06.7`](./issues/TA-06-simulation-core.md) | Rule engine (utility AI) + player priorities + directive application | W3 | L2 | `[ ] Todo` |
| [`TA-06.8`](./issues/TA-06-simulation-core.md) | Hazards (lightning, meteor) + fauna (1 species, nests) | W4 | L2 | `[ ] Todo` |
| [`TA-06.9`](./issues/TA-06-simulation-core.md) | Snapshot codec, fog-of-war view & delta diff | W1 | L2 | `[ ] Todo` |
| [`TA-06.10`](./issues/TA-06-simulation-core.md) | Rocket build/launch & colony transfer to a new planet | W4 | L2 | `[ ] Todo` |
| [`TA-06.11`](./issues/TA-06-simulation-core.md) | Basic PvP raids (combat bots vs. foreign buildings) | W4 | L2 | `[ ] Todo` |
| [`TA-07.1`](./issues/TA-07-planet-worker.md) | Worker Nest skeleton, registration & heartbeat in `{ns}_workers` | W1 | L3 | `[ ] Todo` |
| [`TA-07.2`](./issues/TA-07-planet-worker.md) | Planet host: load/unload, drift-free multi-planet tick scheduler, fault quarantine | W1 | L3 | `[ ] Todo` |
| [`TA-07.3`](./issues/TA-07-planet-worker.md) | Planet WS gateway: ticket verify, welcome snapshot, 5 Hz deltas, takeover, backpressure | W2 | L3 | `[ ] Todo` |
| [`TA-07.4`](./issues/TA-07-planet-worker.md) | Command ingestion: WS + `planet.{id}.cmd` stream → validated, tick-stamped, acked | W2 | L3 | `[ ] Todo` |
| [`TA-07.5`](./issues/TA-07-planet-worker.md) | Planet leases (KV CAS) + `planet/worker .ctl` handlers + graceful drain | W1 | L3 | `[ ] Todo` |
| [`TA-07.6`](./issues/TA-07-planet-worker.md) | Snapshot persistence & failover restore (snapshot + replay + hash check) | W3 | L3 | `[ ] Todo` |
| [`TA-07.7`](./issues/TA-07-planet-worker.md) | Significant-event emission to `{NS}_PLANET_EVENTS` | W2 | L3 | `[ ] Todo` |
| [`TA-07.8`](./issues/TA-07-planet-worker.md) | Worker metrics: tick duration, planets, sockets, lag; load shedding | W4 | L3 | `[ ] Todo` |
| [`TA-08.1`](./issues/TA-08-continuity-offline-and-resume.md) | Presence tracking (`{ns}_presence`, `lastSeenAt`) | W3 | L3 | `[ ] Todo` |
| [`TA-08.2`](./issues/TA-08-continuity-offline-and-resume.md) | Away-mode autopilot policy & safety rules | W4 | L3 | `[ ] Todo` |
| [`TA-08.3`](./issues/TA-08-continuity-offline-and-resume.md) | "While you were away" digest | W3 | L3 | `[ ] Todo` |
| [`TA-08.4`](./issues/TA-08-continuity-offline-and-resume.md) | Resume flow in core: home → ticket → reconnect; failover retry; device takeover | W3 | L1 | `[ ] Todo` |
| [`TA-08.5`](./issues/TA-08-continuity-offline-and-resume.md) | Elimination, planet end & re-entry flows | W4 | L1 | `[ ] Todo` |
| [`TA-09.1`](./issues/TA-09-ai-orchestrator.md) | AI service skeleton + Z.ai `glm-5.3` client behind `LlmProviderPort` + mock provider | W1 | L4 | `[ ] Todo` |
| [`TA-09.2`](./issues/TA-09-ai-orchestrator.md) | Trigger intake from `{NS}_AI_REQUESTS`, per-colony rate limits, dedupe, daily budget | W2 | L4 | `[ ] Todo` |
| [`TA-09.3`](./issues/TA-09-ai-orchestrator.md) | Prompt builder (compact state) + `DirectiveV1` JSON schema & validation | W3 | L4 | `[ ] Todo` |
| [`TA-09.4`](./issues/TA-09-ai-orchestrator.md) | Directive publish to command stream, decision log, timeouts & fallback | W3 | L4 | `[ ] Todo` |
| [`TA-09.5`](./issues/TA-09-ai-orchestrator.md) | Cost controls & ops: token accounting, kill switch, eval harness | W4 | L4 | `[ ] Todo` |
| [`TA-10.1`](./issues/TA-10-near-gateway.md) | NEAR gateway skeleton: network config, key management, RPC client | W1 | L4 | `[ ] Todo` |
| [`TA-10.2`](./issues/TA-10-near-gateway.md) | NEP-413 verification on `{ns}.near.verify` | W1 | L4 | `[ ] Todo` |
| [`TA-10.3`](./issues/TA-10-near-gateway.md) | Colony account provisioning job + relayer (meta-tx, NEP-366) | W2 | L4 | `[ ] Todo` |
| [`TA-10.4`](./issues/TA-10-near-gateway.md) | `colony-registry` contract + milestone writes | W3 | L4 | `[ ] Todo` |
| [`TA-10.5`](./issues/TA-10-near-gateway.md) | Inter-colony trades: offer/accept saga, in-game settlement, on-chain receipt | W4 | L4 | `[ ] Todo` |
| [`TA-11.1`](./issues/TA-11-game-client.md) | Game app shell: Vite/TS, router, auth bootstrap, API client, React HUD root | W1 | L5 | `[ ] Todo` |
| [`TA-11.2`](./issues/TA-11-game-client.md) | Planet picker & queue UI (lobby WS / polling fallback) | W2 | L5 | `[ ] Todo` |
| [`TA-11.3`](./issues/TA-11-game-client.md) | Home routing & resume UX: dive-in, retry, away digest modal | W3 | L5 | `[ ] Todo` |
| [`TA-11.4`](./issues/TA-11-game-client.md) | Planet WS client: snapshot/delta store, interpolation buffer, reconnect | W2 | L5 | `[ ] Todo` |
| [`TA-11.5`](./issues/TA-11-game-client.md) | Diorama viewport & hex terrain renderer (Pillar 4) | W2 | L5 | `[ ] Todo` |
| [`TA-11.6`](./issues/TA-11-game-client.md) | Instanced entity rendering: robots & buildings (Pillars 1/3) | W3 | L5 | `[ ] Todo` |
| [`TA-11.7`](./issues/TA-11-game-client.md) | HUD: resources, power, task queue, priorities, event log | W3 | L5 | `[ ] Todo` |
| [`TA-11.8`](./issues/TA-11-game-client.md) | Building placement & upgrade UX → commands | W4 | L5 | `[ ] Todo` |
| [`TA-12.1`](./issues/TA-12-landing.md) | Landing page: hero, loop explainer, CTA, live planet stats | W1 | L5 | `[ ] Todo` |
| [`TA-12.2`](./issues/TA-12-landing.md) | Landing SEO/meta, legal placeholders, analytics opt-in | W4 | L5 | `[ ] Todo` |
| [`TA-13.1`](./issues/TA-13-qa-observability-and-load.md) | Integration test harness with per-lane isolation (`test:integration --suite …`) | W0 | Lead | `[ ] Todo` |
| [`TA-13.2`](./issues/TA-13-qa-observability-and-load.md) | Observability: dashboards, alerts, log correlation | W5 | L4 | `[ ] Todo` |
| [`TA-13.3`](./issues/TA-13-qa-observability-and-load.md) | E2E journeys: first visit → play → leave → return | W5 | L5 | `[ ] Todo` |
| [`TA-13.4`](./issues/TA-13-qa-observability-and-load.md) | Failover determinism suite (kill worker mid-tick) | W5 | L2 | `[ ] Todo` |
| [`TA-13.5`](./issues/TA-13-qa-observability-and-load.md) | Load test: planets/worker & sockets/worker capacity | W5 | L3 | `[ ] Todo` |
| [`TA-13.6`](./issues/TA-13-qa-observability-and-load.md) | Matchmaking soak: 200 synthetic players | W5 | L1 | `[ ] Todo` |
| [`TA-13.7`](./issues/TA-13-qa-observability-and-load.md) | Launch checklist & production smoke (after the other W5 tasks) | W5 | L5 | `[ ] Todo` |
