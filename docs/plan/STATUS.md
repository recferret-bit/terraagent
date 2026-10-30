# Status Board — TerraAgent Online Build

> **⛔ SUPERSEDED (2026-10-30) by [`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md)** — the plan is now 26 product waves / 859 issues ([`ISSUE_INDEX.md`](./ISSUE_INDEX.md)). This file and `issues/TA-*.md` are kept only for traceability (each wave issue lists the TA ids it replaces). Do not schedule work from here.
>
> **Orchestrator:** [`EXECUTION_ORCHESTRATOR.md`](./EXECUTION_ORCHESTRATOR.md) · **Architecture:** [`../spec/ARCHITECTURE.md`](../spec/ARCHITECTURE.md)
> **⚠ 2026-10-30, D-24..D-27 apply.** The hackathon (11-01 → 11-14, solo) follows **[`HACKATHON_CUT.md`](./HACKATHON_CUT.md)**. Architecture is now **one NestJS app + Postgres** with a simplified server sim, no anti-cheat and no anti-bot. **Obsolete → Future:** TA-01.3 (NATS subjects/streams/KV), TA-02.2 (JetStream/KV bootstrap), TA-05.5 (lease reconcile + failover reassignment), TA-07.1 (worker registration/heartbeat in KV), TA-07.5 (planet leases + drain), TA-07.9 (catch-up ticking), TA-13.4 (failover determinism suite). **Need simplification before use:** TA-02.1 (Postgres only, no NATS), TA-02.3 (one app image), TA-02.4 (one WS endpoint, no worker map, no rate limits), TA-02.5 (no worker drain), TA-04.5 (ticket without worker directory), TA-05.4 (no leader election), TA-06.1 (floats allowed, no state hash), TA-06.9 (delta diff only, no fog-of-war view), TA-07.4 / TA-07.7 (in-process commands/events), TA-07.6 (snapshot resume + coarse fast-run, no replay/hash), TA-08.1 (in-process presence), TA-09.2 (in-process intake, budget cap only). Everything else in this plan is **post-hackathon**.
>
> **⚠ 2026-10-30, D-28..D-30 apply.**
> - **D-28:** battle v1. TA-14.4 is rescoped; new client task TA-14.10.
> - **D-29:** player page, achievements, XP, minimap and global map. New epic **TA-15** (8 tasks).
> - **D-30:** ports & adapters, with **all NEAR features mocked in phase 1**. New TA-10.8–10.12 (foundation + F1–F8 on mocks) and TA-10.13 (real Agent / DAO / Escrow). TA-10.1/10.2/10.3/10.4/10.6/10.7 become *phase 2 (real adapters)*. **TA-10.5 is obsolete** (replaced by TA-10.10).
> - TA-07's body text is superseded by D-24; see the mapping table in the epic.
>
> **Legend:** `[ ] Todo` · `[~] In Progress (Agent-N)` · `[x] Done` · `[!] Blocked (reason)`

## Summary

**2026-10-30:** 0/116 done (15 tasks added for D-28..D-30). The owner answered every open question (2026-10-29). D-16 is **Accepted**; D-17..D-23 record the answers. Epic TA-14 and 12 tasks in existing epics were added for them. D-01..D-15 are otherwise unchanged.

| Epic | Domain | Waves | Total | Todo | In Progress | Done | Blocked |
|---|---|---|---|---|---|---|---|
| [`TA-01`](./issues/TA-01-monorepo-and-shared-contracts.md) | Monorepo, Tooling & Shared Contracts | W0 | 7 | 7 | 0 | 0 | 0 |
| [`TA-02`](./issues/TA-02-infra-nats-postgres-nginx.md) | Infra: Postgres, NATS, nginx, Deploy | W0, W1, W2, W3, W4 | 6 | 6 | 0 | 0 | 0 |
| [`TA-03`](./issues/TA-03-database-and-persistence.md) | Database & Persistence | W0 | 3 | 3 | 0 | 0 | 0 |
| [`TA-04`](./issues/TA-04-core-api-auth-and-home.md) | Core API: Auth, Players, Home, Tickets, Lobby WS | W1, W2, W3, W4 | 7 | 7 | 0 | 0 | 0 |
| [`TA-05`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Matchmaking & Planet Lifecycle | W2, W3, W4 | 7 | 7 | 0 | 0 | 0 |
| [`TA-06`](./issues/TA-06-simulation-core.md) | Simulation Core (`@terra/sim`) | W1, W2, W3, W4 | 13 | 13 | 0 | 0 | 0 |
| [`TA-07`](./issues/TA-07-planet-worker.md) | Planet Worker | W1, W2, W3, W4 | 9 | 9 | 0 | 0 | 0 |
| [`TA-08`](./issues/TA-08-continuity-offline-and-resume.md) | Continuity: Offline Play & Resume | W3, W4 | 7 | 7 | 0 | 0 | 0 |
| [`TA-09`](./issues/TA-09-ai-orchestrator.md) | AI Orchestrator (Z.ai glm-5.3) | W1, W2, W3, W4 | 6 | 6 | 0 | 0 | 0 |
| [`TA-10`](./issues/TA-10-near-gateway.md) | NEAR Integration: Ports, Mocks & Real Adapters (D-30) | W1, W2, W3, W4, W5 | 13 | 13 | 0 | 0 | 0 |
| [`TA-11`](./issues/TA-11-game-client.md) | Game Client | W1, W2, W3, W4, W5 | 10 | 10 | 0 | 0 | 0 |
| [`TA-12`](./issues/TA-12-landing.md) | Landing | W1, W4, W5 | 3 | 3 | 0 | 0 | 0 |
| [`TA-13`](./issues/TA-13-qa-observability-and-load.md) | QA, Observability & Load | W0, W5 | 7 | 7 | 0 | 0 | 0 |
| [`TA-14`](./issues/TA-14-units-orders-progression.md) | Units, Orders, Ground, Battle v1 & Learning Curve (D-16, D-28) | W2, W3, W4, W5 | 10 | 10 | 0 | 0 | 0 |
| [`TA-15`](./issues/TA-15-player-profile-achievements-maps.md) | Player Page, Achievements, XP & Maps (D-29) | W3, W4, W5 | 8 | 8 | 0 | 0 | 0 |
| **Total** | | | **116** | **116** | **0** | **0** | **0** |

## Per-wave counts

| Wave | Tasks | Done |
|---|---|---|
| W0 | 12 | 0 |
| W1 | 15 | 0 |
| W2 | 19 | 0 |
| W3 | 26 | 0 |
| W4 | 29 | 0 |
| W5 | 15 | 0 |

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
| [`TA-05.7`](./issues/TA-05-matchmaking-and-planet-lifecycle.md) | Party tickets + seat refill only within the first 2 h (D-22, D-12 amended) | W4 | L1 | `[ ] Todo` |
| [`TA-06.1`](./issues/TA-06-simulation-core.md) | Deterministic kernel: tick, seeded PRNG, fixed-point, ECS store, command application, state hash | W1 | L2 | `[ ] Todo` |
| [`TA-06.2`](./issues/TA-06-simulation-core.md) | Hex grid & planet generator (Temperate/Desert), deposits, spawn sites | W1 | L2 | `[ ] Todo` |
| [`TA-06.3`](./issues/TA-06-simulation-core.md) | Territory claim & immutable border collision | W2 | L2 | `[ ] Todo` |
| [`TA-06.4`](./issues/TA-06-simulation-core.md) | Economy: resources, storage caps, MVP building catalog, construction & upgrades | W2 | L2 | `[ ] Todo` |
| [`TA-06.5`](./issues/TA-06-simulation-core.md) | Power grid: generation, pylons, connectivity, brownout shedding | W3 | L2 | `[ ] Todo` |
| [`TA-06.6`](./issues/TA-06-simulation-core.md) | Units & production (D-16): HQ, workers, MVP combat units, Hub/Factory production, supply cap, wall-aware pathfinding | W2 | L2 | `[ ] Todo` |
| [`TA-06.7`](./issues/TA-06-simulation-core.md) | Rule engine (utility AI) + canonical priorities (economy/expansion/defense/power/terraform) + directive application | W3 | L2 | `[ ] Todo` |
| [`TA-06.8`](./issues/TA-06-simulation-core.md) | Hazards (lightning, meteor) + fauna (1 species, nests) | W4 | L2 | `[ ] Todo` |
| [`TA-06.9`](./issues/TA-06-simulation-core.md) | Snapshot codec, fog-of-war view & delta diff | W1 | L2 | `[ ] Todo` |
| [`TA-06.10`](./issues/TA-06-simulation-core.md) | Rocket build/launch & colony transfer to a new planet | W4 | L2 | `[ ] Todo` |
| [`TA-06.11`](./issues/TA-06-simulation-core.md) | PvP raids with army groups: gate pathing, newcomer shield & truce checks (D-16) | W4 | L2 | `[ ] Todo` |
| [`TA-06.12`](./issues/TA-06-simulation-core.md) | Per-pylon max load: capacity-limited power routing, overload trips (D-21) | W3 | L2 | `[ ] Todo` |
| [`TA-06.13`](./issues/TA-06-simulation-core.md) | Settled colony: rocket gate (own territory 100 % Living), inert Settled state (D-18) | W4 | L2 | `[ ] Todo` |
| [`TA-07.1`](./issues/TA-07-planet-worker.md) | Worker Nest skeleton, registration & heartbeat in `{ns}_workers` | W1 | L3 | `[ ] Todo` |
| [`TA-07.2`](./issues/TA-07-planet-worker.md) | Planet host: load/unload, drift-free multi-planet tick scheduler, fault quarantine | W1 | L3 | `[ ] Todo` |
| [`TA-07.3`](./issues/TA-07-planet-worker.md) | Planet WS gateway: ticket verify, welcome snapshot, 5 Hz deltas, takeover, backpressure | W2 | L3 | `[ ] Todo` |
| [`TA-07.4`](./issues/TA-07-planet-worker.md) | Command ingestion: WS + `planet.{id}.cmd` stream → validated, tick-stamped, acked | W2 | L3 | `[ ] Todo` |
| [`TA-07.5`](./issues/TA-07-planet-worker.md) | Planet leases (KV CAS) + `planet/worker .ctl` handlers + graceful drain | W1 | L3 | `[ ] Todo` |
| [`TA-07.6`](./issues/TA-07-planet-worker.md) | Snapshot persistence & failover restore (snapshot + replay + hash check) | W3 | L3 | `[ ] Todo` |
| [`TA-07.7`](./issues/TA-07-planet-worker.md) | Significant-event emission to `{NS}_PLANET_EVENTS` | W2 | L3 | `[ ] Todo` |
| [`TA-07.8`](./issues/TA-07-planet-worker.md) | Worker metrics: tick duration, planets, sockets, lag; load shedding | W4 | L3 | `[ ] Todo` |
| [`TA-07.9`](./issues/TA-07-planet-worker.md) | Catch-up ticking after failover/restore: bounded fast-forward of downtime (D-20) | W3 | L3 | `[ ] Todo` |
| [`TA-08.1`](./issues/TA-08-continuity-offline-and-resume.md) | Presence tracking (`{ns}_presence`, `lastSeenAt`) | W3 | L3 | `[ ] Todo` |
| [`TA-08.2`](./issues/TA-08-continuity-offline-and-resume.md) | Away-mode autopilot policy & safety rules | W4 | L3 | `[ ] Todo` |
| [`TA-08.3`](./issues/TA-08-continuity-offline-and-resume.md) | "While you were away" digest | W3 | L3 | `[ ] Todo` |
| [`TA-08.4`](./issues/TA-08-continuity-offline-and-resume.md) | Resume flow in core: home → ticket → reconnect; failover retry; device takeover | W3 | L1 | `[ ] Todo` |
| [`TA-08.5`](./issues/TA-08-continuity-offline-and-resume.md) | Elimination, planet end & re-entry flows | W4 | L1 | `[ ] Todo` |
| [`TA-08.6`](./issues/TA-08-continuity-offline-and-resume.md) | Hard offline mode: away budget, autoTrade, opt-in AI raids, elimination-while-away safety (D-17) | W4 | L3 | `[ ] Todo` |
| [`TA-08.7`](./issues/TA-08-continuity-offline-and-resume.md) | Notification service in core: Web Push + Telegram bot (D-17) | W4 | L1 | `[ ] Todo` |
| [`TA-09.1`](./issues/TA-09-ai-orchestrator.md) | AI service skeleton + Z.ai `glm-5.3` client behind `LlmProviderPort` + mock provider | W1 | L4 | `[ ] Todo` |
| [`TA-09.2`](./issues/TA-09-ai-orchestrator.md) | Trigger intake from `{NS}_AI_REQUESTS`, per-colony rate limits, dedupe, daily budget | W2 | L4 | `[ ] Todo` |
| [`TA-09.3`](./issues/TA-09-ai-orchestrator.md) | Prompt builder (compact state) + `DirectiveV1` JSON schema & validation | W3 | L4 | `[ ] Todo` |
| [`TA-09.4`](./issues/TA-09-ai-orchestrator.md) | Directive publish to command stream, decision log, timeouts & fallback | W3 | L4 | `[ ] Todo` |
| [`TA-09.5`](./issues/TA-09-ai-orchestrator.md) | Cost controls & ops: token accounting, kill switch, eval harness | W4 | L4 | `[ ] Todo` |
| [`TA-09.6`](./issues/TA-09-ai-orchestrator.md) | `DirectiveV1` v2: units, goals, truces; brief stage fields; raw logs 14 d (D-16, D-17, D-09) | W4 | L4 | `[ ] Todo` |
| [`TA-10.1`](./issues/TA-10-near-gateway.md) | *Phase 2:* real chain infra: network config, key store, RPC (FastNEAR + fallback), real `ChainReadPort` | W4 | L4 | `[ ] Todo` |
| [`TA-10.2`](./issues/TA-10-near-gateway.md) | *Phase 2:* NEP-413 wallet link (real) | W5 | L4 | `[ ] Todo` |
| [`TA-10.3`](./issues/TA-10-near-gateway.md) | *Phase 2:* real `IdentityPort` (social login + named accounts) + real `RelayerPort` (NEP-366) | W4 | L4 | `[ ] Todo` |
| [`TA-10.4`](./issues/TA-10-near-gateway.md) | *Phase 2:* real `DeedNftPort` / `BadgeNftPort` (NEP-171 contracts), replacing the `colony-registry` | W5 | L4 | `[ ] Todo` |
| [`TA-10.5`](./issues/TA-10-near-gateway.md) | **Obsolete (D-30):** in-game trade saga + receipt, replaced by TA-10.10 | W4 | L4 | `[ ] Obsolete` |
| [`TA-10.6`](./issues/TA-10-near-gateway.md) | *Phase 2:* real `CargoTokenPort` (NEP-245) + real `IntentsPort` (`intents.near`, mainnet, dry-run first) | W5 | L4 | `[ ] Todo` |
| [`TA-10.7`](./issues/TA-10-near-gateway.md) | *Phase 2:* real `StakingPort` (whitelisted pools) + claimable colony accounts; Settled-colony binding (D-18) | W5 | L4 | `[ ] Todo` |
| [`TA-10.8`](./issues/TA-10-near-gateway.md) | Ports & mocks foundation (D-30): 11 NEAR port classes, binding module, fail-closed adapter selection, Postgres mocks, `chain_outbox`, contract suites | W1 | L4 | `[ ] Todo` |
| [`TA-10.9`](./issues/TA-10-near-gateway.md) | F5 + F1 on mocks: named accounts via `IdentityPort`, relayed actions, cargo Export/Import + mint caps | W2 | L4 | `[ ] Todo` |
| [`TA-10.10`](./issues/TA-10-near-gateway.md) | F2 on mocks: market stalls + owner fees, order book = message bus, paired `token_diff` via `IntentsPort`, price board | W3 | L4 | `[ ] Todo` |
| [`TA-10.11`](./issues/TA-10-near-gateway.md) | F3 + F4 on mocks: Orbital Guild NPCs + pricing + ship visits; colony director key with allowance | W3 | L4 | `[ ] Todo` |
| [`TA-10.12`](./issues/TA-10-near-gateway.md) | F6 + F7 + F8 on mocks: Colony Deed + staking panel, planet treasury DAO, bounty escrow | W4 | L4 | `[ ] Todo` |
| [`TA-10.13`](./issues/TA-10-near-gateway.md) | *Phase 2:* real `AgentWalletPort`, `TreasuryDaoPort`, `EscrowPort` | W5 | L4 | `[ ] Todo` |
| [`TA-11.1`](./issues/TA-11-game-client.md) | Game app shell: Vite/TS, router, auth bootstrap, API client, React HUD root | W1 | L5 | `[ ] Todo` |
| [`TA-11.2`](./issues/TA-11-game-client.md) | Planet picker & queue UI (lobby WS / polling fallback) | W2 | L5 | `[ ] Todo` |
| [`TA-11.3`](./issues/TA-11-game-client.md) | Home routing & resume UX: dive-in, retry, away digest modal | W3 | L5 | `[ ] Todo` |
| [`TA-11.4`](./issues/TA-11-game-client.md) | Planet WS client: snapshot/delta store, interpolation buffer, reconnect | W2 | L5 | `[ ] Todo` |
| [`TA-11.5`](./issues/TA-11-game-client.md) | Diorama viewport & hex terrain renderer (Pillar 4) | W2 | L5 | `[ ] Todo` |
| [`TA-11.6`](./issues/TA-11-game-client.md) | Instanced entity rendering: robots & buildings (Pillars 1/3) | W3 | L5 | `[ ] Todo` |
| [`TA-11.7`](./issues/TA-11-game-client.md) | HUD: resources, power, task queue, priorities, event log | W3 | L5 | `[ ] Todo` |
| [`TA-11.8`](./issues/TA-11-game-client.md) | Placement, upgrade & ground-prep UX: ghost footprint with prep bill, tile-state overlay → commands (D-16) | W4 | L5 | `[ ] Todo` |
| [`TA-11.9`](./issues/TA-11-game-client.md) | Full gameplay on phones: landscape fullscreen, touch camera & orders (D-22) | W4 | L5 | `[ ] Todo` |
| [`TA-11.10`](./issues/TA-11-game-client.md) | Notification opt-in UX: Web Push service worker + Telegram link (D-17) | W5 | L5 | `[ ] Todo` |
| [`TA-12.1`](./issues/TA-12-landing.md) | Landing page: hero, loop explainer, CTA, live planet stats | W1 | L5 | `[ ] Todo` |
| [`TA-12.2`](./issues/TA-12-landing.md) | Landing SEO/meta, legal placeholders, analytics opt-in | W4 | L5 | `[ ] Todo` |
| [`TA-12.3`](./issues/TA-12-landing.md) | Live Three.js mini-diorama hero with poster fallback (D-22) | W5 | L5 | `[ ] Todo` |
| [`TA-13.1`](./issues/TA-13-qa-observability-and-load.md) | Integration test harness with per-lane isolation (`test:integration --suite …`) | W0 | Lead | `[ ] Todo` |
| [`TA-13.2`](./issues/TA-13-qa-observability-and-load.md) | Observability: dashboards, alerts, log correlation | W5 | L4 | `[ ] Todo` |
| [`TA-13.3`](./issues/TA-13-qa-observability-and-load.md) | E2E journeys: first visit → play → leave → return | W5 | L5 | `[ ] Todo` |
| [`TA-13.4`](./issues/TA-13-qa-observability-and-load.md) | Failover determinism suite (kill worker mid-tick) | W5 | L2 | `[ ] Todo` |
| [`TA-13.5`](./issues/TA-13-qa-observability-and-load.md) | Load test: planets/worker & sockets/worker capacity | W5 | L3 | `[ ] Todo` |
| [`TA-13.6`](./issues/TA-13-qa-observability-and-load.md) | Matchmaking soak: 200 synthetic players | W5 | L1 | `[ ] Todo` |
| [`TA-13.7`](./issues/TA-13-qa-observability-and-load.md) | Launch checklist & production smoke (after the other W5 tasks) | W5 | L5 | `[ ] Todo` |
| [`TA-14.1`](./issues/TA-14-units-orders-progression.md) | Data tables: units, weapons (battle v1), stages, terrain & terraform ops, fauna, Wall Gate & Aero Hangar rows | W2 | L2 | `[ ] Todo` |
| [`TA-14.3`](./issues/TA-14-units-orders-progression.md) | Ground & terraform: terrain, spawn guarantee, 9 ops with energy, linked prep, Prepared-ground rule, walls, meteor holes | W2 | L2 | `[ ] Todo` |
| [`TA-14.2`](./issues/TA-14-units-orders-progression.md) | Order lanes & queue: pay-on-start, dispatch + earmarks, precedence, worker-tier gate, HQ rules | W2 | L2 | `[ ] Todo` |
| [`TA-14.5`](./issues/TA-14-units-orders-progression.md) | Progression: unlock/threat stages, triggers + dwell, stage-scaled raids, newcomer shield | W3 | L2 | `[ ] Todo` |
| [`TA-14.6`](./issues/TA-14-units-orders-progression.md) | HQ goals & diplomacy in sim: goal breakdown + budgets, truces | W3 | L2 | `[ ] Todo` |
| [`TA-14.9`](./issues/TA-14-units-orders-progression.md) | Visuals: MVP archetypes, Prepared pad, Ridge/Moat terrain, terraform VFX | W3 | L5 | `[ ] Todo` |
| [`TA-14.4`](./issues/TA-14-units-orders-progression.md) | Battle v1 (D-28): plain HP/damage, projectile impact-at-time, lasers/rockets/AoE, evasive, line of fire, wall-aware nav, fauna siege, Brute | W4 | L2 | `[ ] Todo` |
| [`TA-14.8`](./issues/TA-14-units-orders-progression.md) | Client order menus, queue panel (reasons/ETA/earmarks), tile overlay, goal/stage/truce UI | W4 | L5 | `[ ] Todo` |
| [`TA-14.10`](./issues/TA-14-units-orders-progression.md) | Battle v1 client: weapon/min/view range rings, projectile visuals, impact + AoE decals | W4 | L5 | `[ ] Todo` |
| [`TA-14.7`](./issues/TA-14-units-orders-progression.md) | Balance harness: duels (battle v1 model) + reference-player bot S0→S7 + stage telemetry | W5 | L2 | `[ ] Todo` |
| [`TA-15.1`](./issues/TA-15-player-profile-achievements-maps.md) | Progression service: Facts, AchievementUnlock, XpLedger, level curve, evaluation on sim events + catch-up | W3 | L1 | `[ ] Todo` |
| [`TA-15.2`](./issues/TA-15-player-profile-achievements-maps.md) | Profile API: `/me/profile`, `/me/history`, `/me/achievements` | W3 | L1 | `[ ] Todo` |
| [`TA-15.6`](./issues/TA-15-player-profile-achievements-maps.md) | Minimap: cached tile canvas, unit dots, camera footprint, click/drag pan, alert pulses | W3 | L5 | `[ ] Todo` |
| [`TA-15.8`](./issues/TA-15-player-profile-achievements-maps.md) | BadgeMint outbox through `BadgeNftPort` (mock; real in TA-10.4) | W4 | L1 | `[ ] Todo` |
| [`TA-15.3`](./issues/TA-15-player-profile-achievements-maps.md) | Player page UI `/me`: Pilot, Progress, Planets, Stats, History, Play (Faction Plate) | W4 | L5 | `[ ] Todo` |
| [`TA-15.4`](./issues/TA-15-player-profile-achievements-maps.md) | Achievement flip cards + tier ladders (20 × 3) | W4 | L5 | `[ ] Todo` |
| [`TA-15.7`](./issues/TA-15-player-profile-achievements-maps.md) | Global planet map: fullscreen overlay, layers, zoom, click-to-fly, shift-click orders | W4 | L5 | `[ ] Todo` |
| [`TA-15.5`](./issues/TA-15-player-profile-achievements-maps.md) | Badge art generator: hex medallion, 3 tier rims + pips, locked variant, contact sheet | W5 | L5 | `[ ] Todo` |
