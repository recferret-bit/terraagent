# TerraAgent — Architecture Decisions

> Numbered, append-only. Status: `Proposed` (awaiting owner grill) · `Accepted` · `Superseded by D-NN`.
> Each decision lists the alternatives so the owner can overturn it with full context. Agents must not silently deviate; propose a new decision instead.

| ID | Decision | Status |
|---|---|---|
| D-01 | Server-authoritative deterministic simulation in planet workers | Amended by D-24 (server sim kept; bit-exact determinism and workers dropped) and D-31 (same engine in the browser for prediction and local play) |
| D-02 | Planet is the unit of isolation and scaling | Amended by D-24 (planets sharded over worker threads in one app) |
| D-03 | npm-workspaces monorepo modelled on `../freightchain` | Proposed; frontend layout fixed by D-32 |
| D-04 | One Prisma schema, Postgres namespaces per service, forward-only migrations in wave pre-steps | Proposed |
| D-05 | NATS (JetStream + KV) is the only inter-service transport | Superseded by D-24 (no NATS; future) |
| D-06 | Path-based worker routing `ws.terraagent.com/w/{workerId}` | Superseded by D-24 (one WS endpoint) |
| D-07 | `TA_NS` namespace prefix for subjects/streams/buckets | Proposed |
| D-08 | Matchmaking lives in core with Postgres as the source of truth and a single leader | Amended by D-24 (module of the one app; no leader election) |
| D-09 | Z.ai `glm-5.3` via OpenAI-compatible API, behind a provider port | Accepted (2026-10-29): general endpoint, 20M tokens/day, raw logs 14 d |
| D-10 | Guest-first auth, optional NEAR wallet link (NEP-413) | Proposed |
| D-11 | Trades settle in-game in MVP with on-chain receipt; real NEAR Intents later | Superseded by D-19 |
| D-12 | Persistent canonical planets and sector founding capacity | Amended by owner 2026-11-04: W11 foundation, W27 scale/navigation; supersedes instance lifetimes/warm pools |
| D-13 | Planets always tick at full rate (no dormant fast-forward in MVP) | Superseded by D-24 (empty planets tick coarse) |
| D-14 | All backend services are NestJS | Amended by D-24 (one NestJS app; sim threads plain TS) |
| D-15 | MVP gameplay scope for the online build | Proposed — robot list superseded by D-16 if accepted |
| D-16 | Unit roster (14 types), order lanes & queue, staged learning curve, prepared ground, truces, terrain walls; MVP = stages S0–S7 (9 types) | **Accepted** (2026-10-29) |
| D-17 | Hard offline mode: colonies can be eliminated while away; player-set away budget; notifications (Web Push + Telegram) | Accepted (2026-10-29) |
| D-18 | Rocket launch gate (own territory 100 % Living), Settled colonies, player NEAR staking, claimable colony accounts | Accepted (2026-10-29) — design follow-up |
| D-19 | NEAR Intents trade settlement in MVP (same-planet trades only) | Accepted (2026-10-29); extended by D-26 |
| D-20 | Failover fast-forwards downtime by deterministic catch-up ticking | Superseded by D-24 (snapshot resume + coarse fast-run) |
| D-21 | Per-pylon max load enforced in MVP | Accepted (2026-10-29) |
| D-22 | Launch client scope: full phone gameplay (landscape fullscreen), live landing diorama, party tickets, WebGL2, no spectators | Accepted (2026-10-29) |
| D-23 | Launch infra: single region, 4 vCPU / 8 GB host, Cloudflare TLS, R2 backups, FastNEAR, no HSTS preload | Accepted (2026-10-29); one app per D-24. **Hosting amended by D-40** (no Cloudflare, no R2, until the simple host is up) |
| D-24 | Simplified server simulation in **one Node app + Postgres** (no NATS, no leases, no bit-exact replay; coarse ticking for empty planets) | Accepted (2026-10-30) |
| D-25 | No anti-cheat and no anti-bot machinery | Accepted (2026-10-30) |
| D-26 | NEAR economy features F1–F8; cargo tokens open (swappable for NEAR/USDC) in beta | Accepted (2026-10-30) |
| D-27 | Hackathon build: solo + AI agents, 14-day demo cut, build order with a cut line; amended: per-issue `H` tags (option B) | Accepted (2026-10-30) |
| D-28 | Battle system v1: plain HP/damage, time-based projectile impact checks, lasers, rockets, AoE, range/view rings | Proposed (2026-10-30) |
| D-29 | Player page, 20 × 3-tier achievements, XP and levels, minimap + global planet map | Proposed (2026-10-30) |
| D-30 | Ports & adapters; all NEAR features mocked in phase 1 (galaxyqube patterns + shared contract tests) | Proposed (2026-10-30) |
| D-31 | One shared game engine (`@terra/sim`) in three hosts: server simulation, browser single-player local host (testing), client-side prediction; state synced as engine snapshots and diffs | Accepted (2026-10-30) |
| D-32 | Frontend layout: apps `frontend/{game,landing,playground,design}`, 3D render engine `frontend/render` (`@terra/render`), cross-tier packages `shared/{contracts,config,db,ledger,sim}`, `backend/app`; enforced layering and size limits; amended by D-41 (root cleanliness and `tests/`) | Accepted (2026-10-30) |
| D-33 | Three planet types, as on the landing page: Desert (Kharon Dunes, `dune`), Ocean (Thalassa Verde, `oceanForest`), Temperate (Granite Hollow, `forestRock`) | Accepted (2026-10-30) |
| D-34 | Resources: three stored families Metals, Minerals, Bio, each with T1/T2/T3 sub-resources; T2/T3 unlock by terraforming (colony threshold **and** terraformed deposit ground); Energy stays grid power | Accepted (2026-10-30) |
| D-35 | Every balance number lives in data tables and can be tuned at runtime in playtests (overrides file + dev console), without a rebuild | Accepted (2026-10-30) |
| D-36 | HUD and menus are vanilla DOM + Faction Plate CSS (no React/Zustand), built on the prototype's `frontend/game/ui/` | Accepted (2026-10-30) |
| D-37 | One shared placement function (`evaluatePlacement`) for the server handler, the browser-local host and the client ghost; buildings cannot be placed on trees, rock, water or deposits (terraform first) | Accepted (2026-11-01, owner) |
| D-38 | World generation orchestrator (profile stages per planet type), heights in metres as the ground truth, hidden subsurface redacted from clients, planet sectors + quadtree; the dev planet is a desert | Accepted (2026-11-01, owner) |
| D-39 | Planet presence read model + landing planner: every colony / fauna position and every landing ever made in one queryable model; `nextLandingSite` picks the next landing; no landing ever reuses (or crowds) a position | Accepted (2026-11-01, owner) |
| D-40 | Public host `terraagent.fun` on one nginx, four compose stacks (infra, frontend, backend, chain), SSH deploy from `DEPLOY_HOST` in `infra/.env`. No Cloudflare and no R2 in this phase | Accepted (2026-11-01) |
| D-41 | Clean root folder modelled on `../freightchain`: root holds only agentic files (`.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`), `README.md`, git files (`.git`, `.github/`, `.gitignore`), `LICENSE`, root `package.json` (`package-lock.json`), and the 7 domain folders (`backend/`, `docs/`, `frontend/`, `infra/`, `scripts/`, `shared/`, `tests/`) | Accepted (2026-11-01, owner) |
| D-42 | W02 economy build rules (as built): the day follows the planet solar clock, W02 building rows go through `evaluatePlacement` and are built on site by the HQ through the W01 `build` command, orders are paid progressively and a cancel refunds 50 % of what was paid, clamped at the family storage cap | Accepted (2026-11-03, W02 review); open points in GP-53..56 and LED-17 |

---

## D-01 — Server-authoritative deterministic simulation in planet workers

**Context.** `docs/spec/tech-stack-spec.md` puts the simulation in a browser Web Worker. The owner requires that the colony keeps working when the player leaves and that the game is online/multiplayer (PvP, trades, shared territory borders). A browser sim stops when the tab closes and cannot be trusted for PvP.

**Decision.** `@terra/sim` is a pure, deterministic TypeScript package. It runs **authoritatively** inside `planet-worker` at 10 TPS. The browser receives fog-of-war-filtered snapshots/deltas and only interpolates. Determinism (integer math, seeded PRNG, stable ordering) gives us failover by snapshot + command replay and reproducible tests.

**Alternatives.** (a) Client sim + server validation — rejected: dies when tab closes. (b) Server sim, non-deterministic with frequent full snapshots — rejected: failover loses up to one snapshot interval and tests become flaky. (c) Lockstep P2P — rejected: offline play impossible.

**Consequences.** Client cannot predict outcomes beyond cosmetic interpolation; command latency ≈ RTT + ≤ 100 ms. The sim must never import Node or browser APIs.

*Amended by D-31 (2026-10-30):* the browser runs the same engine as an exact replica of the server state and predicts the player's own commands; the server still decides every outcome.

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

**Resolved (2026-10-29).** Owner confirmed `glm-5.3` on the general `/api/paas/v4` endpoint, `AI_DAILY_TOKEN_BUDGET = 20M` per day, raw prompt and response logs kept 14 days, and the director's rationale shown in the HUD. Rate limits are still to be checked in the Z.ai console (`OWNER_TASKS.md`). Earlier note: owner said "z.ai 5.3". Public listings name the native model id `glm-5.3`; confirm against the Z.ai console and whether the general (`/api/paas/v4`) or coding-plan endpoint is used. Tracked in `OWNER_TASKS.md`.

## D-10 — Guest-first auth, NEAR link optional

**Decision.** First visit creates a guest player bound to a device secret (httpOnly refresh cookie on `api.terraagent.com`, `SameSite=None; Secure`). Players can link a NEAR wallet (NEP-413 signed nonce) to make the colony portable across devices. Chain stays invisible for gameplay.

**Alternatives.** Wallet-required (friction, contradicts "chain is invisible"), email magic link (extra provider; can be added later as another `AuthIdentity` kind).

## D-11 — Trades: in-game settlement + on-chain receipt in MVP

**Decision.** Offer/accept flows through core; settlement = paired commands to both planets' command streams in one transaction-like saga with compensation; `near-gateway` writes a receipt to `colony-registry`. Real NEAR Intents (solver network) is a follow-up epic once resources are tokenized.

## D-12 — Persistent canonical planets and sector admission

**Owner amendment (2026-11-04).** W11 becomes a small playable version of W27. Three canonical planets, one per existing type, persist from W11 onward. Founding capacity and safe landing slots belong to gameplay sectors; full worlds queue new players. No automatic overflow instances, warm pools, age sealing, lifetime expiry or extinction/all-settled ending. W11 includes small connected sectors and real border crossings; W27 expands scale, streaming and ground-to-globe navigation using the same admission model.

**Superseded history.** The 2026-10-29 decision used capacity five per instance, 24-hour admission, 14-day lifetime, two-hour refill and warm pools. Those numbers are not current W11/W27 requirements. Pre-W11 dev seating remains a compatibility path.

**Detailed policy:** [MATCHMAKING §0](./MATCHMAKING.md#0-persistent-sector-worlds--current-w11w27-policy-2026-11-04). Preserve tickets, atomic reservations, spawn recovery, parties, authorized resume and existing authority boundaries. Full is availability, not permanent sealing; admin maintenance/archival is explicit and audited.

**Still open:** exact small-world sizing, abandoned/founded-seat reclaim, rejoin after elimination and occupied-world enlargement. [WE-33](../questions-and-limitations/sim-world-engine.md#we-33--w11-small-world-rollout-and-persistent-seat-policies) records conservative defaults and required follow-up; no inactivity eviction or automatic save reset is authorized.

## D-13 — Planets always tick at full rate

**Decision.** No "dormant fast-forward" in MVP: every live planet ticks at 10 TPS regardless of presence. Simpler, deterministic, and the load test sizes worker capacity accordingly.

**Later.** If cost requires it, a planet with zero connected players for > 10 min could tick at 2 TPS with scaled rates — requires sim support for variable `dt` and breaks bit-exact replay unless the rate change is itself a command.

## D-14 — All backend services are NestJS

**Decision.** core, planet-worker, ai-orchestrator, near-gateway are NestJS (shared config/logging/NATS/Prisma modules, same testing style as freightchain). The planet-worker's hot loop (tick scheduler + `ws` server) is plain TypeScript owned by a Nest provider, outside the request pipeline, so Nest adds no per-tick overhead.

## D-15 — MVP gameplay scope for the online build

**Decision.** Follows `docs/game/autonomous-colony-spec.md` §12, constrained to: 2 planet types (Temperate, Desert); 5 resources; T1 of Command Hub, Claim Beacon, Pylon, Capacitor, Solar, Wind, Coal/Oil, Mine, Water Pump, Supply Depot, Drone Control Array, Robotics Factory, Turret; T2 of Hub/Beacon/Solar/Mine; robots Miner/Builder/Combat T1; 1 fauna species; 2 hazards (lightning, meteor); basic raid PvP; rocket → new planet transfer. Everything else in `docs/game/colony-economy-and-buildings-spec.md` stays data-driven and can be enabled later without architecture changes.

## D-16 — Unit roster, order lanes and staged learning curve

**Context.** D-15 kept three generic robots (Miner, Builder, Combat) in three tiers each. The owner asked for a short, fixed roster: an HQ Commander drone, T1 specialist workers, T2/T3 multitask workers, rock–paper–scissors ground and air combat, player menus for construction, terraform and unit orders that feed a local queue, and a strict learning curve. Total Annihilation / Supreme Commander is the reference.

**Decision.** Adopt [`docs/game/units-orders-and-progression-spec.md`](../game/units-orders-and-progression-spec.md):
- 14 unit types. Combat types have no tiers.
- An HQ Drone that alone builds and upgrades the Command Hub, and whose tier follows the Hub's.
- A worker-tier tech gate.
- Lanes (Construction, Terraform, Units) plus HQ goals. Orders are paid when work starts. Dispatch uses anti-starvation earmarks.
- A damage-type × armor-class counter matrix.
- An Aero Hangar building for air units.
- 11 progression stages, with threat scaled by colony stage and a newcomer PvP shield.
- `ECONOMY_RATE_SCALE = 0.25`.
- **Terrain walls (reverse terraforming).** Starting at S7, ridges and moats (indestructible and owner-only) block all ground movement; ridges also block direct fire, except over an adjacent parapet. Air units and indirect fire (artillery, bomber) go over. A destructible Wall Gate lets your own units through. Proposed: extend the MVP to S7 (Q12).
- **Prepared ground only.** Every footprint tile must be terraformed first (rock, hole, water, forest, slope; Flat needs a Grade). Terraform ops consume energy (brownout shed group 1). The HQ Drone terraforms from landing on its own power cell, so it can always prepare the site for its own Hub.

MVP ships stages S0–S6 with 8 unit types: HQ, Harvester, Builder, Terraformer, Multitask T2, Recon, Tank, Artillery. It also ships the Prepared-ground rule, all 9 terraform ops (Deep Reclaim of deep water by T2 workers from S5), and HQ-negotiated **truces** (non-aggression pacts with a 10-min cancel notice and a 24 h Oathbreaker mark).

**Owner answers (2026-10-29):** pay on start; scale 0.25 with the rocket in hours; Aero Hangar; worker tier gate kept; HQ reprint (losing both HQ and Hub eliminates the colony); trades + truces in MVP; 8 types; Founder Core +8 E/s; veterans inherit unlocks; strict grading of all ground; deep water reclaimable at T2. See the spec's §9. The air layer, radar and T3 stay in the data tables with `enabled: false`.

**Alternatives.**
- (a) Keep D-15's tiered generic robots: no counters and no learning curve.
- (b) Tiered combat units (Mk.I–III): more types for the player to learn and less tactical variety.
- (c) MVP-lite with 7 types (drop Multitask T2): fallback if the schedule slips.
- (d) Natural Flat ground buildable without a Grade: less busywork, weaker theme.

**Consequences.** Changes `SIM-C-03/04`, SIMULATION §7.2–7.7, PROTOCOL `enqueueTask`, `DirectiveV1` (v2), the canonical priority sliders, and `AW-04`; the full list is in the spec's §7. Adds epic TA-14 (9 tasks). TA-06.6, TA-06.7, TA-06.11 and TA-11.8 are rescoped.

**Status update (2026-10-29): Accepted.** The owner answered all open questions (spec §9). Terrain walls (ridges, moats, Wall Gate, line of fire) were added at S7, and the **MVP extends to S0–S7 with 9 unit types**, adding the Mobile Radar. Plan: epic TA-14.

## D-17 — Hard offline mode and notifications

**Decision.**
- A colony left alone can be **eliminated** by other players, fauna or the environment. "Survive a night offline" is no longer a guarantee.
- The fixed away spend caps (`AW-20`, 40 %/60 %) become a **player-set away budget**, set in the HUD before leaving. Defense and repair spending are not capped by it.
- The AI director acts while the player is away, within the away rules.
- AI-started raids while away are **opt-in per colony, default off**.
- `autoTrade` (pre-approved per-resource limits) ships in MVP.
- An LLM-written "while you were away" story is available behind a flag.
- **Notifications ship in MVP** over Web Push and a Telegram bot: under attack, colony critical, eliminated, rocket ready, truce or trade offer.

**Alternatives.** Gentle mode, where the core always survives (rejected by the owner). Email notifications (rejected: needs contact capture and fights guest-first login).

**Consequences.**
- CONTINUITY `AW-11/13/20` change.
- A notification sender and player channel linking (Telegram, push subscriptions) are needed.
- Units-spec `AC-03` now only asserts that an unattended colony reaches S4 on its own and that every critical event notifies the player within 60 s. It no longer asserts survival.

## D-18 — Rocket launch gate, Settled colonies and NEAR staking

**Decision.**
- The rocket can launch only when the colony's **own territory is 100 % Living**. Wall tiles, deep water and building footprints are excluded.
- The departing colony becomes a **Settled colony** and is not turned into ruins:
  - it stays on the planet, inert and invulnerable;
  - it keeps its frozen border and costs no ticking;
  - it counts toward the player's score.
- Through the colony's NEAR account, the player can **stake their own NEAR** with a whitelisted validator pool. The reward comes from the validator, not from a game treasury.
- Colony accounts are **claimable by the player at launch**: the player adds their key and the game's key is removed.

**Alternatives.** Ruins (simpler). An AI-run legacy colony (costly). Game-treasury rewards (real money from us, needs legal and anti-farming work).

**Consequences.**
- Holding more territory means more land to restore before launching, which is a deliberate trade-off.
- The rocket moves from about 2–4 h to about 3–5 h of active play.
- NEAR.md needs the staking and claim flows designed.
- The sim needs the Settled state and the launch gate.

## D-19 — NEAR Intents settlement in MVP

**Decision.** Trades between colonies settle through **NEAR Intents** in MVP. The receipt-only in-game settlement of D-11 is superseded. Trades stay **same-planet only**; cross-planet trades come later with transport delay. Trade Hub T1 is still required.

**Consequences.** Resources (or trade vouchers) need an on-chain representation, plus a solver/settlement path and failure compensation in the trade saga. This is the largest schedule risk in MVP. NEAR.md §7 must be redesigned before TA-10 work starts.

## D-20 — Failover fast-forwards downtime (catch-up ticking)

**Decision.** After restore and replay, the worker runs the missed ticks back-to-back, faster than real time, until the planet's tick matches the wall clock again. Then it returns to 10 TPS.
- **Bound:** catch-up has a fixed bound and a per-slot tick budget, so other planets on the same worker are not starved.
- **Commands** that arrive during catch-up are tick-marked as usual, so replay stays bit-exact.
- **Wall clock:** game time stays tied to wall clock, which hard offline mode needs: timers and raids keep meaning.

`SIM-C-10` changes. D-13 still holds: there is no dormant slow ticking.

## D-21 — Per-pylon max load in MVP

**Decision.** The pylon capacities in economy spec §1.3 (T1 80, T2 300, T3 1 200 E/s) are enforced in MVP. A branch over capacity browns out by shed order. The deferral in SIMULATION §7.4 is removed.

## D-22 — Launch client scope

**Decision.**
- **Full gameplay on phones** when the phone is rotated to landscape and in fullscreen; portrait shows a rotate prompt.
- A **live Three.js mini-diorama** as the landing hero.
- **WebGL2 + EffectComposer** as the renderer; WebGPU later.
- **Party tickets** (friends join the same planet) are required for launch.
- **No spectators** in v1.
- Player names are generated, with an optional rename.
- No rejoining a planet after elimination.

## D-23 — Launch infrastructure

**Decision.**
- Single region, single host of **4 vCPU / 8 GB**. The global active-planet cap is lowered to match until the load test sets it.
- Cloudflare proxy for TLS, Cloudflare R2 for off-site backups, no HSTS preload at launch.
- FastNEAR RPC with a fallback provider.
- The owner registers `terraagent.testnet` and `terraagent.near` now.
- Tick markers kept; JSON deltas in v1; snapshots in Postgres; first-party analytics.

*Amended by D-40 (2026-11-01):* the Cloudflare proxy, Origin CA and R2 bucket are not part of the current host. Domain, TLS and backups for this phase are D-40. Host size, single region and FastNEAR stay.

## D-24 — Simplified server simulation in one app

**Context.** The owner briefly considered a client-hosted relay, then chose server simulation ("I 100 % need it"), **simplified and more efficient**. The setting is a 14-day solo hackathon build on a 4 vCPU / 8 GB host. The planet must keep running when nobody is connected.

**Decision.**
- **One Node app (NestJS) + Postgres.** Modules: `api` (auth, players, home), `lobby` (matchmaking, parties), `game` (planet host + WebSocket), `ai` (director), `near` (accounts, relayer, tokens, markets), `notify`. **No NATS, no JetStream, no KV leases, no per-worker routing.** One WebSocket endpoint.
- **Simulation in `worker_threads`.** There are `cores − 1` threads (3 on the launch host), and planets are sharded across them by planet id. The main thread owns HTTP/WS and forwards commands and deltas over `MessagePort`. `@terra/sim` stays a pure TypeScript package: fixed system order, seeded PRNG for reproducible tests and the duel harness.
- **Dropped:**
  - bit-exact cross-runtime determinism and integer-only state (`SIM-D-01/02`); floats are allowed;
  - state hashes and hash checkpoints;
  - the tick-marked durable command log (`SIM-C-05..10`) and the catch-up fork `SIM-H-08`;
  - leases and failover replay;
  - server-side fog-of-war views and diffs.
- **Tick rates (config).** A planet with at least one connected player runs at **5 TPS**. An **empty** planet runs **coarse**: 1 step per second with `dt = 5` (all rates are per second, and `compileData` converts design numbers). Hard offline mode (D-17) keeps working because empty planets still advance. Coarse dt makes combat and raids on unattended colonies less granular, which is accepted.
- **Persistence.** Each planet snapshots every **60 s** to Postgres (compressed), and on graceful shutdown. On restart the app loads the latest snapshot and **fast-runs the missed wall-clock time in coarse mode** (cap 24 h), then resumes. Commands are not logged durably, so a crash can lose ≤ 60 s of player actions.
- **Network.** On connect the client gets the **full planet state**, then deltas of changed entities at 5 Hz, as JSON v1. The client draws fog-of-war itself.
- **Capacity target.** ≥ 60 active planets on 3 sim threads, to be confirmed by the load test.

**Future (not built now).** Separate services, NATS, multi-host workers with leases, deterministic replay and anti-cheat audits. The earlier designs stay in git history and these docs as "Future".

**W16 planning amendment (2026-11-04, owner request).** The director runs in a separately deployable `backend/director/` Node/TypeScript worker with a bounded durable Postgres queue (pg-boss) and private authenticated MCP queries/proposals to the Nest game app. This supersedes the one-process/no-work-queue requirement **only for AI orchestration**. Job leases/fences protect AI delivery; they do not introduce planet leases or deterministic sim replay. Game state, authorization, player settings, shared rules and final command application remain in the game authority. No Redis/NATS or additional game service is required. W16 implementation must add workspace/structure-check and deployment support; current runtime is unchanged. [AI_ORCHESTRATOR](./AI_ORCHESTRATOR.md) defines scope, guards and acceptance.

## D-25 — No anti-cheat, no anti-bot

**Decision.**
- **Removed:**
  - rate limits and abuse detection;
  - captchas and bot detection;
  - fog-of-war filtering (the full state is sent);
  - plausibility and replay checks;
  - AI-request throttling per player, except budget.
- **Kept:**
  - zod schema validation at ingress, because malformed input would crash the sim;
  - **a command controls only the sender's own colony**;
  - all game rules (resources, territory, tiers, newcomer shield);
  - LLM spend caps (cost control, D-09).

NPC traders (F3) and the test reference bot are game and test features, not "bots" in this sense, and stay.

**Amended 2026-11-01 (review fix BE-05/BE-08).** Two limits exist as crash and load protection, not anti-cheat: a
per-player command token bucket at the WebSocket ingress (20 commands/s, bursts of 40, `cmd.reject rate_limited`,
PROTOCOL WS-16) and a per-IP throttle of guest sign-up and `/me/home` seating (`AUTH_RATE_PER_MIN`, 429
`rate_limited`), because each new guest can make the server generate another planet.

## D-26 — NEAR economy features

**Decision.** Build the features in [`docs/game/near-economy-features-spec.md`](../game/near-economy-features-spec.md):
- F1 cargo tokens (NEP-245) minted on export at the Trade Hub;
- F2 player-owned markets settled with NEAR Intents `token_diff`; the game server is the message bus;
- F3 Orbital Guild NPC traders with sub-account wallets;
- F4 a capped key for the colony director;
- F5 social login, named accounts and gasless meta-transactions;
- F6 dynamic Colony Deed NFT + own-NEAR staking;
- F7 Planet Treasury DAO;
- F8 bounties and mercenary NPCs.

**Cargo tokens are open in beta:** they can be swapped for NEAR or USDC. The **server simulation is the mint authority** (export only from simulated stock), so production cannot be faked by a client. Mint caps stay as **economic pacing**, not security. Players and farm bots can still play for value, which is accepted for beta (D-25).

## D-27 — Hackathon build plan

**Decision.**
- **Team.** Solo developer plus AI agents. **Window.** 2026-11-01 → 2026-11-14 23:59 UTC.
- **Demo cut:**
  - one app (D-24) and a Temperate planet;
  - stages **S0–S4** plus **terrain walls** (unlocked early in the demo build);
  - NEAR in build order **F5 → F1 → F2 → F3 → F4**, with a **cut line after F4**, then F6 → F7 → F8 only if ahead of schedule.
- **Repo.** The existing prototype in `src/` is pre-window baseline and must be disclosed in the README.
- **Submission.** A public repo with LICENSE, and a README written as "do X → see Y" for the Claude Code / Codex screening (libraries and AI-generated code listed).
- **Day plan:** [`docs/plan/HACKATHON_CUT.md`](../plan/HACKATHON_CUT.md).
- **Post-hackathon:** every issue not tagged `H`/`H2` in [`docs/plan/waves/`](../plan/waves/).

**Amendment (2026-10-30, option B).** The cut is expressed per issue: column `H` in every wave file (`H` must, `H+` stretch, `H2` real NEAR after the D10 gate). Every hackathon wave keeps its contracts, core slice and e2e (`@hack` steps), so each still ends in a working app. The `H` set is 387 issues, ≈ 293 units, with a 21.0-unit critical path (after the 2026-10-30 review); it fits 13 build days only at ≥ 2.2 units per agent per day with 12 agents. Waves land in the value order W00 W01 W02 W06 W10 W13 W03 W07 W05 W15 W12 W08 W04 W09 W20 W22 W14 W11 W25, and the drop order in HACKATHON_CUT §3 applies when behind. This replaces the F-number cut line above: F6–F8 sit late in the value order and are dropped first.

*Amendment (2026-11-01, D-40).* W26 (sites) is in the H set: 10 issues, 9 units, value order places it just after W00. W25-02 and W25-07 left the H set (image hardening and the rollback deploy). The H set is 395 issues, ≈ 299.5 units, critical path still 21.0. With 12 agents the wall-clock is 29.5 units.

## D-28 — Battle system v1

**Decision.** Combat uses **plain HP and plain damage**; there are no armor classes or multipliers, and the old matrix is kept as Future.
- **Weapon kinds:**
  - **Bullets, shells and rockets** are projectiles. Each is aimed once at a lead point, with no homing and no flight or collision simulation. Hit or miss is decided **when the flight time ends**: `distance(target, aim) ≤ aoe + radius`.
  - **Lasers** hit instantly.
- **AoE** deals 50 % splash to other enemies.
- **Evasive units** (Recon, air) change heading every 0.5 s, so slow shells miss them while lasers and fast rockets do not.
- **One common unit:** 1 tile = 2 m, used for every range, view, AoE and speed value.
- **Client:** draws weapon-range, min-range and view rings, and animates projectiles. The server decides every hit.
- **Verification:** the duel table is re-run under this model (units spec §5.5), and every counter holds at equal cost and at equal supply. AA vs Bomber at equal supply is a narrow win.

## D-29 — Player page, achievements, XP, maps

**Decision.**
- **Player page `/me`:** pilot, progress (level, XP, stage track), planets (current and past), stats, history timeline, achievements, and play (matchmaking and parties).
- **Achievements:** **20 families × 3 tiers** (Bronze / Silver / Gold) with XP. The system follows freightchain's rules (frozen ids, append-only unlocks, `progressOf`, catch-up on profile load, optional soulbound badge through an outbox) and its flip-card ladder, restyled in Faction Plate.
- **XP is cosmetic only.** Level *L* needs `50·L·(L+1)` XP, capped at level 30.
- **Maps:** a minimap in the HUD; clicking it (or pressing `M`) opens a fullscreen global planet map with layers.
- **Specs:** [`player-profile-and-achievements-spec.md`](../game/player-profile-and-achievements-spec.md), CLIENT §8b.

## D-30 — Ports & adapters; NEAR mocked in phase 1

**Decision.**
- **Phase 1 runs every NEAR feature on mock adapters**, behind real interfaces. The patterns come from galaxyqube:
  - abstract-class ports as DI tokens;
  - all bindings in one infrastructure module;
  - fail-closed per-port env selection (`NEAR_ADAPTER_<PORT>=mock|testnet|mainnet`), with mocks refused in production unless explicitly allowed;
  - Postgres-backed mocks with real-shaped receipts, errors, latency and failures;
  - a chain-write outbox with deterministic `opId`s;
  - zod at every boundary.
- **Added beyond galaxyqube:** one **contract test suite per port**, run against both the mock and the real adapter.
- **Swap order:** F5 → F1 → F2 → F3/F4 → F6 → F7 → F8.
- **Details:** [`NEAR.md`](./NEAR.md) §1a.

## D-31 — One shared game engine, three hosts

**Context.** The owner wants one engine used for the server simulation, for single-player play in the browser while testing, and for client-side prediction. Until now the client only interpolated server views and never imported the sim (D-01, CLIENT §7), so command feedback lagged by RTT plus up to 400 ms and every gameplay test needed the whole backend.

**Decision.**
- **One engine.** `@terra/sim` holds every game rule: data tables, systems, generator, rule engine, scenarios. It is isomorphic (no Node or DOM APIs, SIM-D-06) and is exposed through one `SimHost` API: `load`, `step(dt)`, `submit(cmd)`, `snapshot`, `diffSince(tick)`, `applyDiff`, `clone`, `view`, `events`.
- **Three hosts of the same code:**
  1. **Server** (`game` module, worker threads): authoritative, unchanged rules (D-24).
  2. **Client replica + prediction** (a browser Web Worker): holds an exact copy of the server state at tick T, then shows `T + the player's pending commands`, stepped to the estimated server time. Every server delta rebases the prediction; mismatches are corrected (positions blend over 150 ms, discrete fields snap). Rejected commands roll back.
  3. **Local host** (`?host=local`, same Web Worker): runs the engine authoritatively in the browser for single-player testing and sim-only e2e runs, with no app or Postgres. Server-only features (accounts, NEAR, lobby, notifications, progression, LLM) are unavailable there.
- **Sync is engine state, not views.** `welcome` carries the engine snapshot (shared codec) and each delta carries the engine diff of that window (entity rows, tiles, colony records, lanes, PRNG streams) plus events. Clients derive render and HUD views with the engine's `view()`. `welcome` names `simVersion` and `dataHash`; a mismatch makes the client reload.
- **Authority does not move.** The server decides every outcome. Render-only effects (projectiles, VFX) may come from the predicted engine; player-facing events (toasts, alerts, achievements) come only from the server.
- **Parity, not bit-exactness.** D-24 stands: no bit-exact determinism. An engine parity test runs the same scenario and command log on Node and in headless Chrome and requires equal discrete state and positions within 0.01 tile; each gameplay wave adds its scenario.

**Alternatives.** (a) Keep view-only clients with interpolation: no prediction, no local play. (b) A separate client-side "lite" model for prediction: two rule sets that drift. (c) Lockstep with bit-exact determinism: rejected in D-24.

**Consequences.**
- No game rule may live in the server or the client; each wave's rules go into `@terra/sim`.
- Per-wave "delta payload" work becomes registering synced fields.
- The client bundle gains the engine as a lazily loaded worker chunk. Budgets: worker step p95 ≤ 4 ms on an iPhone 13-class phone at MVP scale; above it prediction switches itself off and the client falls back to interpolation. `?predict=0` forces the fallback.
- **Plan:** W00-14, W00-24, W00-26 and the new W00-54 … W00-58 ([`docs/plan/waves/W00-platform-skeleton.md`](../plan/waves/W00-platform-skeleton.md)); PRODUCT_WAVES §4 "One engine" rule.
- **Specs:** [`SIMULATION.md`](./SIMULATION.md) §6 and §6a, [`CLIENT.md`](./CLIENT.md) §7, [`PROTOCOL.md`](./PROTOCOL.md) §4.3, [`ARCHITECTURE.md`](./ARCHITECTURE.md) §9 and §12.

## D-32 — Frontend layout and the render/sim split

**Context.** The prototype was restructured on 2026-10-30 from `src/` into `frontend/` (one Vite app rooted at `frontend/`), following `../freightchain`. The wave plan still used `client/src/…` and `landing/`, and `frontend/shared/` (3D engine) clashed by name with the planned top-level `shared/` packages (game rules, contracts).

**Decision.**
- **Apps:** `frontend/game` (`play.html`; the game client of CLIENT.md, served as `game.terraagent.com`), `frontend/landing` (`terraagent.com`), `frontend/playground` (3D model storybook, dev only), `frontend/design` (Faction Plate tokens and docs). Page URLs stay `/play.html`, `/landing.html`, `/playground.html`, `/design/` in dev.
- **Render engine:** `frontend/render` (`@terra/render`): viewport, kitbash archetypes and validator, unified material, terrain/water, space, planets, orbit stage, descent drop rig, lighting, CRT overlay. It draws; it holds no game rule (D-31).
- **Cross-tier packages:** `shared/{contracts,config,db,sim}` (`@terra/*`) and `backend/app` as in ARCHITECTURE §3. `shared/sim` decides; apps pass its views into `render`.
- **Layering:** `render` imports no app; an app imports `render`, `design` CSS, `shared/*` and itself, never another app. Files ≤ 500 lines, functions ≤ 100 lines. `npm run check:structure` enforces all three ([`AGENTS.md`](../../AGENTS.md) §6).
- Game features live in `frontend/game/features/<feature>/`; core client code in `frontend/game/{net,store,core,dev,camera,maps,mobile,pages}/`.

**Alternatives.** (a) Keep `frontend/shared` next to top-level `shared/` (two folders with the same name and different meaning). (b) Put cross-tier packages in `packages/` (diverges from ARCHITECTURE §3 and every spec's code-home paths).

**Consequences.** W00-04 shrinks to turning the existing folders into npm workspaces. Every wave's owned paths use this layout (`client/src/…` → `frontend/game/…`, `landing/` → `frontend/landing/`, archetypes → `frontend/render/kitbash/archetypes/`).

## D-33 — Three planet types, matching the landing page

**Context.** The specs had two sim types (`temperate`, `desert`, D-15); the landing page, the orbit menu and the render engine already ship three worlds (`frontend/render/planets/PlanetSpec.ts`).

**Decision.** `PlanetType = 'desert' | 'ocean' | 'temperate'`, one-to-one with the existing looks:

| Sim type | World (landing) | Render look (`PlanetKind`) | Traits (landing card) | Generator mix **(proposed)** |
|---|---|---|---|---|
| `desert` | Kharon Dunes | `dune` | solar +35 %, water scarce, sandstorms | slope 30 % (dunes, drawn as sand), rock 12 %, water 1 %; Metals and Minerals deposits richness +15 %; Water Extractor ×0.5 |
| `ocean` | Thalassa Verde | `oceanForest` | hydro +, wood, storms | water 35 % (shallow 20 %, deep 15 %), forest 30 %, rock 5 %; Bio deposits richness +20 %; Metals −15 %; storms ×1.5 frequency |
| `temperate` | Granite Hollow | `forestRock` | minerals +, wood, cold nights | forest 20 %, water 6 %, rock 8 % (as SIMULATION §10); Minerals deposits richness +15 %; night 45 % of the day |

The sim owns the type; the client picks the look from it (`planetType → PlanetKind`), and the landing cards keep their names. Planet names are generated per planet; the landing names are the type showcase.

**Hackathon.** The `H` demo stays on `temperate` (D-27); `desert` and `ocean` generators are post-hackathon rows (W05).

**Consequences.** SIMULATION §7.6/§10 tables gain an Ocean column; MATCHMAKING `type` filter and auto-place accept three types; the W01/W05/W11 plan rows use these names.

## D-34 — Resource families with tiers unlocked by terraforming

**Context.** The specs had five resources (Metals, Minerals, Petroleum, Water, Energy). The owner's model: three families (Metals, Bio, Minerals), each with T1/T2/T3 sub-resources; T1 is available from landing, T2/T3 only after terraforming.

**Decision.**

| Family | T1 (from landing) | T2 | T3 |
|---|---|---|---|
| **Metals** | Iron | Light alloys (copper, aluminium) | Titanium |
| **Minerals** | Silica | Rare earths | Exotic crystal |
| **Bio** | Water and Biomass (two T1 sub-resources) | Petroleum / organics | Gene-stock |

- **Stockpiles:** 10 stored sub-resources, keyed `metals.t1 … metals.t3`, `minerals.t1 … minerals.t3`, `bio.water`, `bio.biomass`, `bio.t2`, `bio.t3`. Storage caps are per family (Depots add to all three). **Energy** is not a family: it stays grid power (E/s), stored only in capacitors.
- **Sources:** Metals Extractor on metal deposits; Minerals Quarry on mineral deposits; Bio: Water Extractor (water), Harvester clearing forest and harvesting Living ground (biomass, gene-stock), Petroleum Well on oil deposits (`bio.t2`).
- **Unlock rule (both gates, owner choice):** an extractor yields its family's T2 sub-resource only when (1) the colony's Terraform % ≥ **30 %** and (2) the extractor's deposit ground is terraformed: ≥ 50 % of the tiles within 2 of its footprint are Irrigated or Living. T3 needs Terraform % ≥ **70 %** and ≥ 50 % Living tiles in that ring. T1 is always produced. Percentages and ring size are data (D-35), all **(proposed)**.
- **Yield split (proposed):** with T2 unlocked, 30 % of an extractor's output becomes T2; with T3 unlocked, 20 % T3 + 30 % T2 + 50 % T1. Extractor tier (Mk.I–III) only scales the rate.
- **Costs:** the economy spec's `M/Min/Pet/W` cost columns are read through a tier rule until each table is rebalanced: a T1 building or unit pays M → `metals.t1`, Min → `minerals.t1`, Pet → `bio.biomass`, W → `bio.water`. A T2 item pays 60 % of M and Min in T1 and 40 % in T2, and its Pet in `bio.t2`. A T3 item pays 40 % T1, 30 % T2, 30 % T3 of M and Min, Pet in `bio.t2`, plus 10 % of its M as `bio.t3`. Terraform ops consume `bio.water` where the old specs said Water.
- **Trading:** each tradable sub-resource is its own cargo token (F1) and market pair (F2); T1 trades from day one, so a colony can buy T2/T3 it cannot yet mine.

**Alternatives.** Keep five flat resources (no tie between terraforming and economy). Colony-wide thresholds only (no reason to terraform around deposits). Per-tile gates only (no colony-wide pacing).

**Consequences.** Rewrite the resource sections of the economy, units, SIMULATION (§7.1–7.3 cost columns, §7.1 storage rows, `SIM-G-RES`), DATA_MODEL, PROTOCOL/contracts (`ResourceKey`), CLIENT (resource bar: three family chips with tier breakdown), NEAR (cargo token ids) and the landing resource tabs (Metals / Minerals / Bio / Energy). The prototype HUD's energy/metal/water/biomass bar becomes the family bar (W02-26).

## D-35 — Balance is data, tunable at runtime

**Decision.** Every balance number (costs, HP, DPS, ranges, view radii, timers, rates, thresholds, AI weights) lives in `shared/sim/src/data/*.ts` rows, never in system code (units spec rule). For playtests the engine loads an optional **overrides file** (`balance.overrides.json`, path from `TA_BALANCE_OVERRIDES`; per planet via the scenario) merged over the tables at `compileData`, and the dev console has `tune <table>.<row>.<field> <value>` / `tune reset` / `tune export`, applied live to the running planet (server and local host) and recorded in the planet's event log. `dataHash` in `welcome` changes with overrides, so clients reload the same numbers. Values marked **(proposed)** in the specs and the defaults in `docs/plan/OWNER_TASKS.md` (B1–B13) are the starting rows.

**Consequences.** One W00 issue for the override loader + `tune` command; every gameplay wave keeps its numbers in data rows (a review check).

## D-36 — HUD is vanilla DOM on the design system

**Context.** ARCHITECTURE §12 and tech-stack-spec named React 19 + Zustand for the HUD; the prototype and every wave build on the vanilla-DOM HUD in `frontend/game/ui/` with Faction Plate CSS.

**Decision.** No React/Zustand. HUD panels are small TypeScript view classes (one per panel) registered by features, rendering into the design-system classes (`--ta-*` tokens, `.plate`, `.btn`), fed by the sim `view()`; state flows one way (sim view → panel). The AGENTS.md §6 rules apply (orchestrator + parts, ≤ 500 / ≤ 100 lines).

**Alternatives.** React + Zustand (bigger bundle, a second UI idiom next to the existing code).

## D-37 — One placement rule set; terraform before you build

**Context.** W01 had two hand-copied placement rule sets (`construction/validate.ts` in the sim, `GhostEvaluator.ts` in the client) that already disagreed (hub-exists check, reason codes, prep-bill constants, deposits ignored by both). Per `UO-TF-03` a Hub could be placed on forest / rock and the linked prep order auto-cleared them; the owner rejected that in the W01 check ("I can place it on trees, on obstacles, on resources").

**Decision.** Placement is one pure function, `evaluatePlacement(world, opts)` in `shared/sim/src/systems/construction/placement.ts`, over a read-only `PlacementWorld` (tile layers + entities). The `placeBuilding` handler builds the world from `SimState` (`placementWorldFromState`): it runs on the server and in the `?host=local` Worker alike, so the authoritative check is identical in multiplayer and single player. The client ghost builds the world from its replica view (`ghostPlacementWorld`) and calls the same function; a parity spec checks both agree on every tile of generated planets. Tile meaning lives in `grid/geo.ts` (`geoBuildBlock`, `isGroundObstacle`), also used by movement and the starter-site guarantee. A footprint tile must be inside the map, owned (or unclaimed for the Hub), free of other buildings, Flat (wild / flat / prepared) and, for the Hub, without a deposit; trees and rock must be cleared / broken by the player first (`terrain_unbuildable`). Linked prep for the Hub is therefore Grade only; Clear / Break stay player terraform ops (and the planner keeps them for W05's linked prep on other terrain classes). The client never mutates world state: confirm sends one `placeBuilding`; a host rejection reopens the ghost red with the host's reason.

**Consequences.** Departs from `UO-TF-03` for W01. W05-09 (linked Level / Fill on slope and hole) and W17-03 (auto-linked ring prep) must be re-read against this when W05 / W17 open: either they add slope / hole as "linked-prep-able" in `geoBuildBlock`'s rule, or they become player ops like Clear / Break.

**Alternatives.** Keep `UO-TF-03` auto-clearing (owner rejected); keep two rule sets with a parity test only (they drift again).

## D-38 — World generation orchestrator, metre heights, hidden ground, sectors

**Context.** The "dune" planet was the temperate dev planet with a sand look painted on: the sim only had one quota-based generator whose heights were sub-metre, and the renderer flattened them further, so the ground was mostly flat. The owner (2026-11-01) wants real dunes, desert plains and mountains, a terraformed-looking landing site, ground that hides things to discover by terraforming, and a structure that stays fast on big planets, shared by client and server.

**Decision.**
- **Orchestrator.** `shared/sim/src/gen/world/` builds every planet: `generateWorld` runs the stage list of the planet type's profile row (`data/worldgen.ts`, D-35): `desert` = `reliefDesert → classifyDesert → deposits → landing → subsurface`; `temperate` / `ocean` = `temperateTerrain` (the W01 quota classifier, ocean with water-rich shares) `→ deposits → landing → subsurface` (the hidden subsurface runs last so it sees the final classes). Stages are small parts in `stages/`, registered by id (`registerWorldStage`); a new landform or biome is a new stage plus a profile row, not an edit of a generator. `createPlanet` stamps `meta.genVersion = GEN_VERSION` (`gen/generators.ts`). The generator ids `temperate`, `desert`, `ocean` all reach the orchestrator, so hosts that pass `type: planet.type` get the right profile.
- **Heights are metres and the sim is the ground truth.** The `height` layer holds metres (desert: dunes up to ~4.5 m, mesas 4.5–11 m, ranges up to ~13 m). The renderer (`frontend/render/planets/hex/chunkMesh.ts`) draws that height and only adds cosmetic class detail and keeps water under the water plane; Flat and Prepared tiles sit at their own level. Placement adds a footprint spread rule (`MAX_FOOTPRINT_SPREAD_M` = 0.6 m, reason `uneven` → `terrain_unbuildable`), shared through `evaluatePlacement` (D-37).
- **Landing zones.** Every spawn slot gets a round, levelled zone (desert: radius 7 tiles, Flat, one height, easing back into the relief over 5 tiles; temperate / ocean: radius 4, heights only) plus the starter Hub guarantee (`ensureStarterHubSpace`, same geo + spread rule).
- **Hidden subsurface.** Server-only tile layers `subDeposit` / `subRichness` (`FieldDef.hidden`) hold buried deposits (veins under rock, dunes, forest roots, plains). `snapshot(s, { forClient: true })` and `diffSince(s, t, { forClient: true })` drop hidden layers; every client-bound path uses them (planet-host welcome + deltas, the local-host worker, the in-process dev hook); persisted snapshots keep them. Clear / Break call `revealSubsurface`, which moves the buried deposit into the public layers and emits `groundRevealed`. The subsurface seeds mix a server-only secret `meta.worldSalt` (random per planet on the server, stripped from client snapshots and diffs like the hidden layers), so a client that knows the public seed still cannot regenerate the buried ground; public ground and spawn slots do not depend on it.
- **Sectors.** `grid/sectors.ts`: 8×8 axial sectors in a quadtree (cached per radius). Generation stages walk sectors with per-sector seeds; every tile stamp keeps a per-sector max `changedAt`, so `diffSince` only scans sectors changed after `fromTick`; render chunks (32×32) are whole blocks of sectors.
- **Dev planet.** One dev planet family per type (owner 2026-11-01): desert `pl_dev`, `pl_dev_2`, … (`DEV_PLANET_TYPE = 'desert'`, the default), ocean `pl_dev_ocean`, …, temperate `pl_dev_temperate`, … (`devPlanetIdFor` / `devPlanetTypeOf` in `@terra/sim`). The orbit pick is sent as `GET /v1/me/home?type=` and seats a NEW colony on that family (an existing colony keeps its planet); the no-server local fallback builds the picked type. The planet look follows the real sim type. Dev planets whose snapshot has another `genVersion`, an unrestorable sim version or another type than their family are wiped on boot (snapshots, ledger rows, colonies, planet row) and recreated; local-host saves with another `genVersion` start fresh (owner: "wipe and recreate").

**Consequences.** Clearing trees or breaking rock inside a planned Hub footprint can uncover a deposit, which then blocks that site (`resource deposit`, D-37): accepted, the player picks another site. Determinism: the sim uses no engine-dependent `Math` functions (`sin`, `cos`, `pow`, `hypot`, `exp`, `log`, …), enforced by the sim purity lint (`ENGINE_MATH` in `shared/sim/eslint.rules.js`, no exceptions; the unit facing `rot` uses the arithmetic-only `atan2Det` from `kernel/detMath.ts`); `GEN_VERSION` is bumped with every output change, pinned by a fingerprint test. Brings the `desert` / `ocean` planet types forward from W05 (D-33 hackathon note superseded for generation; W05 keeps Level / Fill / Reclaim and the remaining biome features). Anything that writes `layers.changedAt` must go through `touchTile` / `stampTile` (or call `noteTileStamp` / `forgetTileStamps`). The render layer may import `@terra/sim/grid/sectors` (pure geometry), like `grid/hex`.

**Alternatives.** Keep the cosmetic sand look on a temperate sim (owner rejected); generate relief only in the renderer (client/server disagree on heights, placement and pathing); a global quadtree of tiles (sectors give the same pruning with flat arrays and cheaper updates).

## D-39 — Planet presence and the landing planner

**Context.** The owner wants the planet to know and remember where every player (colony) and every fauna is, in a form a future AI orchestrator can query; one function that decides where the next player lands; and landing on the same position twice must be impossible. Landing rules lived inside `systems/landing` (slot search, pod separation) and the backend computed its own slot.

**Decision.**
- **Presence** (`shared/sim/src/world/presence.ts`): a pure read model over the authoritative state. Every live entity has a role (`unit`, `structure`, `pod`, `fauna`, `other`; a new kind calls `registerPresenceRole`). Queries: `colonyPresence` (per colony: landing record, HQ, pods, structures, units), `faunaPositions`, `entitiesNear(q, r, radius, filter)` / `nearestEntity` (sector-bucketed, quadtree walk, nearest first, ties by id), and `presenceView` (all of it as plain JSON-safe data for an AI orchestrator or a dev route). The spatial index is derived and rebuilt lazily when the entity store changes; positions persist through the entity store.
- **Landing history** (`blobs.landingHistory`, append-only, written only by `recordLanding` from `spawnColonyLanding`): every landing ever made, kept after a colony is eliminated.
- **Landing planner** (`world/landingPlanner.ts`): `nextLandingSite(state, colony, { slotIndex?, q?, r?, beyondSlots? })` → explicit coordinates checked against the rules, else the preferred / first free spawn slot, else (slotless planet or `beyondSlots`) the best free site found by scoring one candidate per sector (far from everything, level ground). `landingBlock` is the rule: a colony lands once (`already_landed`); a site must be inside the map (`invalid_args`), on land, not another colony's tile or slot, and keep `hq.startingKit.minLandingSeparation` from every landing in the history and from every other colony's pod / HQ / structure (`landing_site_taken`). `checkColonyLanding` / `system.spawnColony` / `dev.land` use it, so the server, the local host and the backend seat flow (which submits the command and rolls the seat back on a reject) all apply the same rule.

**Consequences.** Planets with spawn slots still seat exactly their slots (capacity, D-12) unless a caller passes `beyondSlots`. Pods never land on water. Fauna archetypes register their presence role when they enter the sim (W03+); the AI orchestrator reads `presenceView` host-side (it contains no hidden ground).

**Alternatives.** Keep per-feature scans of the entity columns (each consumer re-implements "who is where"); a persistent per-tile occupancy layer (more state to sync for data the entity store already has).

## D-40 — Simple hosting on terraagent.fun

**Context.** D-23 put the public site behind Cloudflare (proxied DNS, Origin CA, R2 off-site backups) on `terraagent.com`, `game.`, `api.` and `www.`. The owner has the domain `terraagent.fun` and wants every current page, plus a pitch deck and a whitepaper, on its own subdomain. The same nginx and the same compose files must run on a laptop and on one remote host. SSH keys are copied by the owner. Cloudflare, certbot and R2 wait.

**Decision.**

- **Names.** One public suffix, `terraagent.fun`. HTTP on port 80. No Cloudflare, no Origin CA, no certbot, no HSTS and no R2 in this phase.
- **Hosts.** One Vite `frontend/dist/`. nginx chooses the page from `Host`. Unknown hosts return 404.

| Host | Stack | Serves |
|---|---|---|
| `terraagent.fun` | frontend | Landing (`frontend/landing.html`) |
| `pitchdeck.terraagent.fun` | frontend | Pitch deck (new static page) |
| `whitepaper.terraagent.fun` | frontend | Whitepaper rendered from `docs/hackathon/public/whitepaper.md` |
| `design.terraagent.fun` | frontend | Design system, the pages now at `/design/` (`index`, `foundations`, `storybook`, `motion`) |
| `play.terraagent.fun` | frontend | Game (`frontend/play.html`). `/v1` and `/ws` are proxied to the app so the client stays same-origin |
| `playground.terraagent.fun` | frontend | Playground (`frontend/playground.html`) |
| `devchain.terraagent.fun` | chain | Mock-chain explorer (`frontend/dev/chain/`). `/v1/dev/chain` is proxied to the app |
| `api.terraagent.fun` | backend | `/v1/` and `/ws` only. Every other path is 404 |

- **Four compose files**, one project each, brought up together or alone. Infra publishes port 80 and is the only stack that publishes a port. Backend, frontend and chain attach to its network and add a vhost file under `infra/nginx/hosts/`. They do not publish ports.
  - **infra** — nginx and the docker networks. Postgres for the server runs here with profile `server`, on an internal network, with no published port. The laptop keeps today's dev Postgres (`npm run db:up`, host port 15434); the site stack does not start a second database locally.
  - **frontend** — the static image (the Vite `frontend/dist/`) and the vhosts for the six site names above.
  - **backend** — the one NestJS app image (D-24). No extra public service.
  - **chain** — the `devchain` vhost. The mock ledger stays in the app (D-24). This stack does not run a second chain process.
- **Env.** `TA_DOMAIN=terraagent.fun`, `DEPLOY_HOST` (the server's IP) and `DEPLOY_USER` live in `infra/.env` (or `.env`). Deploy reads them on the operator machine. An empty `DEPLOY_HOST` refuses the deploy.
- **SSH.** Deploy runs `ssh` and `rsync` as `DEPLOY_USER@$DEPLOY_HOST` with `BatchMode` (fail if the key is missing). The scripts never generate a key, never copy a key, and never take a `-i` path. The owner copies the key once.
- **Commands.** `npm run stack:local` and `npm run stack:local:{infra,frontend,backend,chain}` on the laptop. `npm run deploy` and `npm run deploy:{infra,frontend,backend,chain}` on the server. `npm run deploy -- --dry-run` prints the plan and does not connect.
- **Local names.** Smoke tests call curl with `--resolve` to `127.0.0.1`, so CI needs no hosts file. `infra/hosts/local.hosts` is the snippet the owner installs so a browser can open the same names.

**Alternatives.** (a) Keep D-23's Cloudflare proxy — rejected for this phase; it can front the same nginx later without renaming hosts. (b) One compose file for everything — rejected: the four stacks must deploy and restart on their own. (c) A separate mock-chain process — rejected for now: it would split the ledger the app already owns. (d) `*.terraagent.localhost` instead of the real names — rejected: local and remote must use one nginx config.

**Consequences.** W26 builds this and can run beside the gameplay waves after W00. W25 keeps monitoring, analytics, load, the README and the submission. Its Cloudflare row, R2 row, image hardening and rollback deploy stay later, on top of W26. ARCHITECTURE §4 and DEPLOYMENT.md follow this table. Cookie `Domain` and `https://` URLs in CLIENT.md stay as they are until the wave that turns TLS on.

## D-41 — Clean root folder and 7-domain layout

**Context.** Loose configuration files (formerly root config files now located at `frontend/vite.config.ts`, `frontend/tsconfig.json`, `shared/tsconfig.base.json`, `shared/config/eslint.config.js`, `shared/config/.prettierrc.json`, `shared/config/.prettierignore`, `infra/.env.example`, `infra/.env.worktree`, `infra/docker/Dockerfile.*.dockerignore`, `tests/vitest*.config.ts`), build/test output folders (formerly root outputs, now `frontend/dist/`, `tests/.out/coverage/`, `tests/.out/test-results/`, and `scripts/dev/.out/`), and top-level test directories (`tests/e2e/`, `tests/scenarios/`, formerly root folders) cluttered the repository root. The owner (2026-11-01) directed a clean root modelled on `../freightchain`: the root folder must hold only agentic files, `README.md`, git files, `LICENSE`, root `package.json`, and the domain directories.

**Decision.**
- **Root files:** `.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` (agentic); `README.md`; `.git`, `.github/`, `.gitignore` (git); `LICENSE`; `package.json` and `package-lock.json` (plus `node_modules/`). No other loose files or runtime output directories live in the root.
- **Seven domain directories:**
  - `backend/` — `backend/app/` (`@terra/app`, the one NestJS server, D-24).
  - `docs/` — all documentation (`game/`, `spec/`, `plan/`, `visuals/`, `dev/`, `hackathon/`, `questions-and-limitations/`, `coverage/`).
  - `frontend/` — `frontend/vite.config.ts` (builds into `frontend/dist/`), `frontend/tsconfig.json`, HTML entries, `game/`, `render/`, `landing/`, `playground/`, `design/`, `pitchdeck/`, `whitepaper/`, `dev/`.
  - `infra/` — `infra/docker-compose.yml` (dev Postgres), `infra/.env.example`, `infra/.env.worktree` (gitignored per-worktree isolation), `infra/compose/`, `infra/docker/` (with BuildKit `infra/docker/Dockerfile.app.dockerignore` and `infra/docker/Dockerfile.frontend.dockerignore`), `infra/hosts/`, `infra/nginx/`.
  - `scripts/` — `check-structure.mjs`, `ci/`, `dev/` (runtime pid in gitignored `scripts/dev/.out/`), `gen/`, `plan/`, `sites/`, `wave/`.
  - `shared/` — `shared/tsconfig.base.json`, `shared/config/` (`@terra/config`, plus monorepo `shared/config/eslint.config.js`, `shared/config/.prettierrc.json`, `shared/config/.prettierignore`), `shared/contracts/`, `shared/db/`, `shared/ledger/`, `shared/sim/`.
  - `tests/` — `tests/vitest.config.ts`, `tests/vitest.integration.config.ts`, `tests/vitest.contract.config.ts` (coverage output in `tests/.out/coverage/`), `tests/e2e/` (Playwright wave suites, harness, engine parity runner, output in `tests/e2e/.out/`), `tests/scenarios/` (`@terra/scenarios` seed scenarios and parity cases).

**Consequences.** Every script, CI workflow, doc, wave plan and spec references the domain paths (`tests/e2e/`, `tests/scenarios/`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `shared/tsconfig.base.json`, `shared/config/eslint.config.js`, `shared/config/.prettierrc.json`, `shared/config/.prettierignore`, `tests/vitest*.config.ts`, `infra/.env.example`, `infra/.env.worktree`). `readEnvSource` and the dev/test env loaders check `infra/.env` and `infra/.env.worktree` first with fallback to root `.env` / `.env.worktree`.

**Alternatives.** Keep tool configs in the repo root (rejected by owner: root must stay clean like `../freightchain`).


## D-42 — W02 economy build rules (as built)

**Context.** W02 added the first economy rows (Metals Extractor, Solar), the order queue and the Harvester on top of the W01 sim. Several deliberate choices depart from the wave doc or from D-37 and must not be "fixed" back by a later wave.

**Decision.**
- **Day length follows the solar clock.** `systems/environment` derives phase and daylight from the authoritative planet time (`systems/time`, `blobs.planetTime`, default `time.cycle.realHoursPerDay = 0.25`, i.e. a 15 min day) and keeps no clock or day counter of its own; the client's day/night clock syncs from it (`dayNightSync.ts`). Night starts at 18:00 and lasts the planet type's night share (`temperate` 45 %). The spec's 20 min day and the `economyT1Basic.dayCycle` fields are not read (GP-53, WE-30).
- **W02 building rows use `evaluatePlacement`** (D-37), through the row's placement rule (`requiresDeposit` for the Extractor, a deposit under any other building is `site_blocked`, an uneven footprint is `terrain_unbuildable` instead of being flattened). W02 rows allow unclaimed ground (GP-54, GP-55 are owner questions). There is no second W02 placement check.
- **The HQ builds on site.** A W02 build is a `build` command job (`job:<entityId>`, linked prep `job:<entityId>/prep`) that the HQ pulls, walks to and works; the Construction lane runs one W02 build per colony at a time and a Harvester never builds or preps (`dispatch/eligibility.ts`, GP-58). Multi-builder choice and pre-emption by `player` entries arrive with the Builder (W03-32).
- **Progressive payment, 50 % cancel refund.** Orders pay their slice of the cost as work advances; cancelling a waiting entry is free, cancelling one in progress refunds 50 % of what was paid (`CANCEL_REFUND_RATE`), demolish and dismantle refund 50 % (`DISMANTLE_REFUND_RATE`). The W01 Command Hub order keeps pay-at-start and its 75 % refund. W02 refunds go through `creditResource` and are **clamped at the family cap** (the rest is lost and counted in `production.capped`); the W01 refund is not (LED-17 asks the owner to unify).

**Consequences.** `UO-Q-01/02`, `SIM-C-03` and `UO-D-03` carry as-built notes. Later waves extend the same queue, placement function and dispatch (W03-12, W03-32, W03-35) instead of adding their own.

**Alternatives.** Pay at start with a 75 % refund (the original `UO-Q-01`; the owner changed it 2026-11-02); a 20 min day with its own environment clock (a second clock that drifts from the planet time); a separate W02 placement check (the drift D-37 removed).

## Amendments — as built, review-fix round 2026-11-01

The log stays append-only; these notes record where the code built in W00–W01 departs from or refines the decisions above.

- **D-02 (fault quarantine).** There is no `FAULTED` state. A step that throws (`StepError`) on the server: the thread journals the step's postings, answers its commands (their outcomes so far, `internal` for the rest), drops the planet and posts `planetFailed`; main closes its sockets (`bye 4012 planet_down`) and restores the latest snapshot, at most 3 times per 10 minutes (`RECOVER_LIMIT`), then holds the planet unloaded (BE-12, SIMULATION `SIM-H-08`).
- **D-23 / D-24 (JSON deltas in v1).** Superseded by D-31: `welcome` and `delta` carry engine snapshot / diff bytes in one MessagePack binary frame; every other message is a JSON text frame (`shared/contracts/src/ws/wire.ts`). Coarse stepping of empty planets and the restart fast-run (D-24) are not built yet (W09).
- **D-37 (placement).** Besides the footprint rules, `evaluatePlacement` blocks a Hub farther than `hq.startingKit.hubMaxDistFromLanding` from the colony's own pod (`farFromLanding`) and a Hub site closer to another colony's pod or Hub than to its own pod (`nearOtherColony`), both `site_blocked` (GP-06). Placement never rejects for cost: an unaffordable building is accepted and its order waits (`waiting_resources`, GP-30).
- **D-38 (tile stamps).** `stampTile` is private to `grid/tileModel.ts`; callers change tiles through the exported setters (`setTilePrep`, `setTileTerrain`, …) or `touchTile`.
- **D-39 (landing history).** `landingHistory` is append-only except for one dev path: `dev.land` moving a pod that has not opened rewrites that colony's latest record (`relocateLanding`). The planner also refuses a site whose starter Hub site would take another colony's territory (`starterHubSiteBlocked`, WE-23).
