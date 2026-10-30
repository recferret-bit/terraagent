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
| D-12 | Planet lifecycle numbers: capacity 5, admission 24 h, lifetime 14 d | Accepted (2026-10-29), amended: seat refill within first 2 h |
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
| D-23 | Launch infra: single region, 4 vCPU / 8 GB host, Cloudflare TLS, R2 backups, FastNEAR, no HSTS preload | Accepted (2026-10-29); one app per D-24 |
| D-24 | Simplified server simulation in **one Node app + Postgres** (no NATS, no leases, no bit-exact replay; coarse ticking for empty planets) | Accepted (2026-10-30) |
| D-25 | No anti-cheat and no anti-bot machinery | Accepted (2026-10-30) |
| D-26 | NEAR economy features F1–F8; cargo tokens open (swappable for NEAR/USDC) in beta | Accepted (2026-10-30) |
| D-27 | Hackathon build: solo + AI agents, 14-day demo cut, build order with a cut line; amended: per-issue `H` tags (option B) | Accepted (2026-10-30) |
| D-28 | Battle system v1: plain HP/damage, time-based projectile impact checks, lasers, rockets, AoE, range/view rings | Proposed (2026-10-30) |
| D-29 | Player page, 20 × 3-tier achievements, XP and levels, minimap + global planet map | Proposed (2026-10-30) |
| D-30 | Ports & adapters; all NEAR features mocked in phase 1 (galaxyqube patterns + shared contract tests) | Proposed (2026-10-30) |
| D-31 | One shared game engine (`@terra/sim`) in three hosts: server simulation, browser single-player local host (testing), client-side prediction; state synced as engine snapshots and diffs | Accepted (2026-10-30) |
| D-32 | Frontend layout: apps `frontend/{game,landing,playground,design}`, 3D render engine `frontend/render` (`@terra/render`), cross-tier packages `shared/{contracts,config,db,sim}`, `backend/app`; enforced layering and size limits | Accepted (2026-10-30) |
| D-33 | Three planet types, as on the landing page: Desert (Kharon Dunes, `dune`), Ocean (Thalassa Verde, `oceanForest`), Temperate (Granite Hollow, `forestRock`) | Accepted (2026-10-30) |
| D-34 | Resources: three stored families Metals, Minerals, Bio, each with T1/T2/T3 sub-resources; T2/T3 unlock by terraforming (colony threshold **and** terraformed deposit ground); Energy stays grid power | Accepted (2026-10-30) |
| D-35 | Every balance number lives in data tables and can be tuned at runtime in playtests (overrides file + dev console), without a rebuild | Accepted (2026-10-30) |
| D-36 | HUD and menus are vanilla DOM + Faction Plate CSS (no React/Zustand), built on the prototype's `frontend/game/ui/` | Accepted (2026-10-30) |

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

## D-12 — Planet lifecycle numbers

**Decision.** `PLANET_CAPACITY=5`, `PLANET_ADMISSION_WINDOW_H=24`, `PLANET_LIFETIME_D=14`, seats on sealed planets never refill, warm pool 1 per type, global cap 200 active planets. Owner's example ("5 players on the planet for days → no new players") is satisfied by either gate.

**Resolved (2026-10-29).** Planets seal at 24 h even with only 1–2 colonies. A seat freed by elimination is refilled only within the first 2 h of a recruiting planet. Matchmaking join fallback: auto-place on the same planet type.

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
