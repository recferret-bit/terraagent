# TerraAgent — Architecture Decisions

> Numbered, append-only. Status: `Proposed` (awaiting owner grill) · `Accepted` · `Superseded by D-NN`.
> Each decision lists the alternatives so the owner can overturn it with full context. Agents must not silently deviate; propose a new decision instead.

| ID | Decision | Status |
|---|---|---|
| D-01 | Server-authoritative deterministic simulation in planet workers | Proposed |
| D-02 | Planet is the unit of isolation and scaling | Proposed |
| D-03 | npm-workspaces monorepo modelled on `../freightchain` | Proposed |
| D-04 | One Prisma schema, Postgres namespaces per service, forward-only migrations in wave pre-steps | Proposed |
| D-05 | NATS (JetStream + KV) is the only inter-service transport | Proposed |
| D-06 | Path-based worker routing `ws.terraagent.com/w/{workerId}` | Proposed |
| D-07 | `TA_NS` namespace prefix for subjects/streams/buckets | Proposed |
| D-08 | Matchmaking lives in core with Postgres as the source of truth and a single leader | Proposed |
| D-09 | Z.ai `glm-5.3` via OpenAI-compatible API, behind a provider port | Proposed — model id to confirm |
| D-10 | Guest-first auth, optional NEAR wallet link (NEP-413) | Proposed |
| D-11 | Trades settle in-game in MVP with on-chain receipt; real NEAR Intents later | Proposed |
| D-12 | Planet lifecycle numbers: capacity 5, admission 24 h, lifetime 14 d | Proposed — tunable |
| D-13 | Planets always tick at full rate (no dormant fast-forward in MVP) | Proposed |
| D-14 | All backend services are NestJS | Proposed |
| D-15 | MVP gameplay scope for the online build | Proposed — robot list superseded by D-16 if accepted |
| D-16 | Unit roster (14 types), order lanes & queue, staged learning curve; MVP = stages S0–S6 | Proposed |

---

## D-01 — Server-authoritative deterministic simulation in planet workers

**Context.** `tech-stack-spec.md` puts the simulation in a browser Web Worker. The owner requires that the colony keeps working when the player leaves and that the game is online/multiplayer (PvP, trades, shared territory borders). A browser sim stops when the tab closes and cannot be trusted for PvP.

**Decision.** `@terra/sim` is a pure, deterministic TypeScript package. It runs **authoritatively** inside `planet-worker` at 10 TPS. The browser receives fog-of-war-filtered snapshots/deltas and only interpolates. Determinism (integer math, seeded PRNG, stable ordering) gives us failover by snapshot + command replay and reproducible tests.

**Alternatives.** (a) Client sim + server validation — rejected: dies when tab closes. (b) Server sim, non-deterministic with frequent full snapshots — rejected: failover loses up to one snapshot interval and tests become flaky. (c) Lockstep P2P — rejected: offline play impossible.

**Consequences.** Client cannot predict outcomes beyond cosmetic interpolation; command latency ≈ RTT + ≤ 100 ms. The sim must never import Node or browser APIs.

## D-02 — Planet is the unit of isolation and scaling

**Decision.** One planet = one sim state = one lease = one command stream subject. A worker hosts up to `WORKER_MAX_PLANETS` planets on one event loop with a drift-free scheduler; an exception in one planet's step quarantines that planet (marks it `FAULTED`, snapshots last good state, alerts) without stopping others.

**Alternatives.** One process per planet (too heavy for 200+ planets), one `worker_thread` per planet (memory overhead; can be added later behind the same host interface).

## D-03 — npm-workspaces monorepo modelled on `../freightchain`

**Decision.** Keep freightchain's top-level split (`backend/`, `frontend/`, `infra/`, `docs/plan`, `docs/spec`, `tests/`, `scripts/`) and root scripts that delegate (`npm run check`, `ci:fast`), but use **npm workspaces** (freightchain uses `--prefix`) because four backend apps and two frontends share `shared/contracts`, `shared/sim`, `shared/db`, `shared/config`.

**Alternatives.** pnpm + turborepo (faster, but one more tool for agents), Nx (heavy). Can migrate later without moving folders.

## D-04 — One Prisma schema, namespaced, migrations in wave pre-steps

**Decision.** `shared/db/prisma/schema.prisma` with `multiSchema` (`core`, `world`, `ai`, `chain`). Only the wave lead edits it, in the **wave pre-step**, exactly like freightchain's Prisma serialization rule. Services only write their namespace.

**Alternatives.** Database-per-service (cleaner ownership, but 4 migration pipelines and cross-service joins for admin) — revisit if teams split.

## D-05 — NATS is the only inter-service transport

**Decision.** Request/reply for synchronous control (`ctl`, `near.verify`), JetStream for durable ordered logs (`PLANET_CMDS`, `PLANET_EVENTS`) and work queues (`AI_REQUESTS`, `NEAR_JOBS`), KV for leases/heartbeats/presence. No service-to-service HTTP.

**Why.** Command durability before ack gives RPO = 0 for failover; KV TTL gives leases without Redis/etcd.

## D-06 — Path-based worker routing

**Decision.** `wss://ws.terraagent.com/w/{workerId}`; nginx `map $worker_id $worker_upstream` → `planet-worker-{n}:3100`. Each worker owns its own WebSocket server as required.

**Alternatives.** Subdomain per worker (`pw-2.ws.terraagent.com`) — needs wildcard DNS + cert, nicer for CDN; Cloudflare supports it, so it remains an easy switch. Single WS gateway that proxies to workers over NATS — extra hop and a stateful bottleneck; rejected.

## D-07 — `TA_NS` namespace

**Decision.** Every subject/stream/bucket is prefixed by `TA_NS` (default `ta`) so up to 5 parallel agent lanes (`l1`..`l5`) and CI share one NATS server without cross-talk.

## D-08 — Matchmaking in core, Postgres truth, single leader

**Decision.** Match tickets and seat reservations are Postgres rows (`SELECT … FOR UPDATE SKIP LOCKED`), so a seat can never be double-assigned. A single matchmaker loop runs on the core replica that holds the Postgres advisory lock `pg_try_advisory_lock(hashtext('ta.matchmaker'))`; other replicas serve API only. NATS `mm.changed` only notifies.

**Alternatives.** JetStream work-queue as the queue (no transactional seat counting), Redis sorted sets (extra store), a separate matchmaking service (premature; extractable later because it is a self-contained Nest module).

## D-09 — Z.ai `glm-5.3`

**Decision.** `AI_MODEL=glm-5.3`, `AI_BASE_URL=https://api.z.ai/api/paas/v4` (OpenAI-compatible `chat/completions`), JSON-mode output validated by zod. Implemented behind `LlmProviderPort` so a mock provider (tests) and other providers (fallback) plug in.

**Open.** Owner said "z.ai 5.3". Public listings name the native model id `glm-5.3`; confirm against the Z.ai console and whether the general (`/api/paas/v4`) or coding-plan endpoint is used. Tracked in `OWNER_TASKS.md`.

## D-10 — Guest-first auth, NEAR link optional

**Decision.** First visit creates a guest player bound to a device secret (httpOnly refresh cookie on `api.terraagent.com`, `SameSite=None; Secure`). Players can link a NEAR wallet (NEP-413 signed nonce) to make the colony portable across devices. Chain stays invisible for gameplay.

**Alternatives.** Wallet-required (friction, contradicts "chain is invisible"), email magic link (extra provider; can be added later as another `AuthIdentity` kind).

## D-11 — Trades: in-game settlement + on-chain receipt in MVP

**Decision.** Offer/accept flows through core; settlement = paired commands to both planets' command streams in one transaction-like saga with compensation; `near-gateway` writes a receipt to `colony-registry`. Real NEAR Intents (solver network) is a follow-up epic once resources are tokenized.

## D-12 — Planet lifecycle numbers

**Decision.** `PLANET_CAPACITY=5`, `PLANET_ADMISSION_WINDOW_H=24`, `PLANET_LIFETIME_D=14`, seats on sealed planets never refill, warm pool 1 per type, global cap 200 active planets. Owner's example ("5 players on the planet for days → no new players") is satisfied by either gate.

**Open for grill.** Should a planet with 1–2 colonies after 24 h be merged/kept recruiting? (Current: sealed; small planets are fine because the AI/fauna provide pressure.)

## D-13 — Planets always tick at full rate

**Decision.** No "dormant fast-forward" in MVP: every live planet ticks at 10 TPS regardless of presence. Simpler, deterministic, and the load test sizes worker capacity accordingly.

**Later.** If cost requires it, a planet with zero connected players for > 10 min could tick at 2 TPS with scaled rates — requires sim support for variable `dt` and breaks bit-exact replay unless the rate change is itself a command.

## D-14 — All backend services are NestJS

**Decision.** core, planet-worker, ai-orchestrator, near-gateway are NestJS (shared config/logging/NATS/Prisma modules, same testing style as freightchain). The planet-worker's hot loop (tick scheduler + `ws` server) is plain TypeScript owned by a Nest provider, outside the request pipeline, so Nest adds no per-tick overhead.

## D-15 — MVP gameplay scope for the online build

**Decision.** Follows `autonomous-colony-spec.md` §12, constrained to: 2 planet types (Temperate, Desert); 5 resources; T1 of Command Hub, Claim Beacon, Pylon, Capacitor, Solar, Wind, Coal/Oil, Mine, Water Pump, Supply Depot, Drone Control Array, Robotics Factory, Turret; T2 of Hub/Beacon/Solar/Mine; robots Miner/Builder/Combat T1; 1 fauna species; 2 hazards (lightning, meteor); basic raid PvP; rocket → new planet transfer. Everything else in `colony-economy-and-buildings-spec.md` stays data-driven and can be enabled later without architecture changes.

## D-16 — Unit roster, order lanes and staged learning curve

**Context.** D-15 kept three generic robots (Miner, Builder, Combat) in three tiers each. The owner asked for a short, fixed roster: an HQ Commander drone, T1 specialist workers, T2/T3 multitask workers, rock–paper–scissors ground and air combat, player menus for construction, terraform and unit orders that feed a local queue, and a strict learning curve. Total Annihilation / Supreme Commander is the reference.

**Decision.** Adopt [`units-orders-and-progression-spec.md`](../../units-orders-and-progression-spec.md):
- 14 unit types. Combat types have no tiers.
- An HQ Drone that alone builds and upgrades the Command Hub, and whose tier follows the Hub's.
- A worker-tier tech gate.
- Lanes (Construction, Terraform, Units) plus HQ goals. Orders are paid when work starts. Dispatch uses anti-starvation earmarks.
- A damage-type × armor-class counter matrix.
- An Aero Hangar building for air units.
- 11 progression stages, with threat scaled by colony stage and a newcomer PvP shield.
- `ECONOMY_RATE_SCALE = 0.25`.

MVP ships stages S0–S6 with 8 unit types: HQ, Harvester, Builder, Terraformer, Multitask T2, Recon, Tank, Artillery. The air layer, radar and T3 stay in the data tables with `enabled: false`.

**Alternatives.**
- (a) Keep D-15's tiered generic robots: no counters and no learning curve.
- (b) Tiered combat units (Mk.I–III): more types for the player to learn and less tactical variety.
- (c) MVP-lite with 6 types (drop Multitask T2 and the Terraformer): fallback if the schedule slips.

**Consequences.** Changes `SIM-C-03/04`, SIMULATION §7.2–7.7, PROTOCOL `enqueueTask`, `DirectiveV1` (v2), the canonical priority sliders, and `AW-04`; the full list is in the spec's §7. Adds epic TA-14 (9 tasks). TA-06.6, TA-06.7, TA-06.11 and TA-11.8 are rescoped.
