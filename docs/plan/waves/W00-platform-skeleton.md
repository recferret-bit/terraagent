# W00 — Platform Skeleton

> **Track:** Spine (lead) · **Flag:** `W00` (always on) · **Tag:** `wave-00` · **Scenario:** `scenarios/w00-empty.ts` · **Depends on:** —
> **Specs:**
> - D-03, D-04, D-24, D-25, D-30, D-31, D-35
> - [`AGENTS.md`](../../../AGENTS.md) §6 (frontend layering, `check:structure`)
> - [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §2, §3, §5, §6, §15
> - [`SIMULATION.md`](../../spec/SIMULATION.md) §2 (`SIM-D`), §3 (`SIM-T`), §5 (`SIM-S`), §6 (`SIM-V`), §11 (`SIM-H-01..06`, `SIM-H-08`), §12
> - [`PROTOCOL.md`](../../spec/PROTOCOL.md) §2–§4 (`PR-*`, `WS-*`)
> - [`NEAR.md`](../../spec/NEAR.md) §1a (ports, mocks, outbox, contract tests)
> - [`CLIENT.md`](../../spec/CLIENT.md) §6, §7
> - [`DATA_MODEL.md`](../../spec/DATA_MODEL.md)
> - [`PRODUCT_WAVES.md`](../PRODUCT_WAVES.md) §3–§5
>
> **Owned paths (lead):**
> - root `package.json`, `tsconfig.base.json`, `vite.config.ts`, lint/format config, `frontend/{game,landing,playground,render,design}/package.json`
> - `shared/contracts/src/{envelope,ws,errors,flags}/**`
> - `shared/config/**`, `shared/db/**`
> - `shared/sim/src/{kernel,ecs,codec,data/index.ts}/**`
> - `backend/app/src/{main.ts,app.module.ts,core/**,game/**,ports/**,dev/**}`
> - `frontend/game/{net,store,core/registry,dev}/**`, `frontend/game/app/**` (play-page wiring only)
> - `frontend/render/planets/hex/**` (hex terrain chunks + tile picking)
> - `scenarios/_loader.ts`, `e2e/harness/**`, `.github/workflows/**`, `README.md`, `LICENSE`
>
> **Already there (2026-10-30):** the Vite app already lives in `frontend/` (one app rooted at `frontend/`, alias `@terra/render`, `npm run check:structure`), and `/play.html` is a client-only prototype (orbit menu → descent → decorative colony on a noise heightfield, RTS camera). W00 adds workspaces, the server, the engine and the hex terrain; it does not move files.

## Goal

Lay the rails every later wave runs on. One `npm run dev` gives a running app:
- a NestJS server with one sim worker thread stepping a planet at 5 TPS;
- a client that connects over WebSocket, receives the full state and renders an empty hex planet with a live tick counter.
- one shared engine (`@terra/sim`, D-31): the server steps it authoritatively, the browser runs the same engine as an exact replica with client-side prediction, and `?host=local` runs it as a single-player local host for testing without the backend.

Every mechanism from PRODUCT_WAVES §3–§4 exists and is usable by the next wave without touching shared files:
- feature flags;
- scenario loader, dev console, time warp, state inspector;
- auto-discovered registries (commands, events, sim systems, data tables, client features, server modules, scenarios);
- ports & adapters: all 13 abstract ports, the Postgres mock base, the ChainRead and NEP-171/Badge mocks, a chain outbox and the contract-test harness (each other port's mock lands with its feature wave);
- snapshot save and load;
- CI;
- the headless-Chrome e2e harness.

## Demo story (`e2e/w00.spec.ts`)

1. Run `npm run dev` → **see** Postgres, the app and the client start; `GET /v1/healthz` returns 200 and `/v1/readyz` returns `{db: ok, simThreads: 1+}`.
2. Open `/play.html?scenario=w00` → **see** a flat hex planet render. A HUD chip shows `tick` increasing about 5 per second.
3. Open the dev console (`` ` ``) and type `warp 10` → **see** the tick rate rise to about 50 per second and a `×10` badge appear. `warp 1` restores it.
4. Click any tile with the state inspector on → **see** the tile's JSON (`q, r, terrain, prep`).
5. Open the flag panel → **see** `W00` on and every other wave listed and off for this scenario. `?waves=..00` gives the same.
6. Restart the app (`npm run dev:restart`) → **see** the client show "Reconnecting…", reconnect, and the tick continue from the snapshot value instead of 0.
7. Open `/dev/chain` (mock chain explorer) and run the dev console command `chain.ping` → **see** a `mock:`-prefixed receipt appear in the explorer list after 300–1 500 ms.
8. CI is green: typecheck, lint, unit, contract (enabled ports vs mocks), build, and `e2e --waves ..00`.
9. Stop the app and open `/play.html?host=local&scenario=w00` → **see** the same planet render and tick from the browser alone; `warp 10` works, and a reload resumes from IndexedDB.
10. With the app running, open `/play.html?scenario=w00&lag=300` and run `nudge` on the test entity → **see** it move on the next frame; after the ack the prediction-error overlay stays under 0.05 tile. `npm run test:parity` is green.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–3, 5–10. `W00-50` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** the state inspector (step 4, W00-43), fault quarantine (W00-20), i18n catalog, snapshot migration tooling, `sim:bench`, the contributor guide.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | npm workspaces monorepo; `npm run check`, `ci:fast` (D-03, ARCH §3) | W00-02, W00-03 |
| 2 | Frontend workspaces `frontend/{game,landing,playground,render,design}` that keep the existing URLs (`/`, `/landing.html`, `/play.html`, `/playground.html`, `/design/`) working | W00-04 |
| 3 | `@terra/config`: zod env, `.env.example`, fail-closed boolean helper | W00-05 |
| 4 | Feature-flag system: `TA_WAVES`, `?waves=`, `welcome.flags`, data `wave` filter, `wave_disabled` reject (PRODUCT_WAVES §3) | W00-06, W00-07 |
| 5 | Contracts core: envelope, hello/ready/join/welcome/delta/cmd/ack/reject/ping/pong/bye, `RejectCode`, `CloseCode`, prefixed ULIDs (PR-01..06) | W00-01 |
| 6 | Auto-discovered contracts: `commands/*.ts`, `events/*.ts` → generated `CommandKind`/`EventKind` + JSON-Schema snapshot diffed in CI (PR-06) | W00-08 |
| 7 | One NestJS app, module auto-discovery, `/healthz` `/readyz` `/metrics` (ARCH §3) | W00-09 |
| 8 | Logging (pino, layer rules), `CoreException` + global filters, zod DTO pipe (D-30 rule 7) | W00-10 |
| 9 | Prisma per-module schema merge, migrations, `@terra/db`, test-DB harness (D-04) | W00-11, W00-12 |
| 10 | In-process typed event bus `planet.event` (ARCH §6) | W00-13 |
| 11 | `@terra/sim` kernel: `PlanetState`, SoA store, PRNG streams, `step(state, cmds, dt)`, fixed system order via auto-discovered `systems/*/index.ts`, no-op slots, purity lint (`SIM-D-01..07`, `SIM-T-01`) | W00-14, W00-15 |
| 12 | `compileData()` with design-unit → tick conversion (`SIM-D-03`) and `wave` filter | W00-16 |
| 13 | Snapshot codec (MessagePack + gzip) + round-trip property test (`SIM-S-01`) | W00-17 |
| 14 | Worker-thread pool, planet sharding, MessagePort protocol (`SIM-H-01/02`) | W00-18 |
| 15 | Drift-free scheduler: 5 TPS active step, coarse-step hook (`dt` param), lag metric, fault quarantine (`SIM-H-03..05`, `SIM-H-08`) | W00-19, W00-20 |
| 16 | Empty dev planet (`createPlanet` stub, flat hex radius 56) | W00-21 |
| 17 | WS gateway: upgrade, origin allow-list, `hello` (dev session; JWT in W01), `join`, `welcome` full state, 5 Hz deltas, ping/pong, idle close, 64 KiB cap, resync on backpressure, `bye` codes (WS-01..23) | W00-22, W00-23 |
| 18 | Delta builder: one engine diff per planet per 200 ms (`SIM-V-01..05`, D-31) | W00-24 |
| 19 | Client WS state machine, reconnect backoff, store (full state + delta apply), interpolation buffer (CLIENT §6–§7) | W00-25, W00-26 |
| 20 | Client feature registry (`import.meta.glob`) for menus, HUD panels, renderers, dev commands | W00-27 |
| 21 | Hex terrain built from the snapshot tile grid (CLIENT §8) with the existing terrain shader, viewport and RTS camera + HUD tick chip | W00-28 |
| 22 | Snapshot persistence: `world.planet_snapshot`, 60 s cadence, SIGTERM snapshot, load latest on boot (`SIM-H-06`; fast-run is W09) | W00-29 |
| 23 | Ports & adapters: abstract-class ports for 11 NEAR ports + `LlmProviderPort` + `NotifierPort`; one binding module per integration; fail-closed `NEAR_ADAPTER_<PORT>`; prod mock guard (NEAR §1a rules 1–3) | W00-30, W00-31 |
| 24 | Postgres mock chain base: `mock_chain_*` tables, `mock:` hashes, latency 300–1 500 ms, failure injection, stable `errorCode`s (rule 4) | W00-32 |
| 25 | Mock ChainRead + shared NEP-171/Badge mock (every other mock lands with its feature wave) | W00-33, W00-35 |
| 26 | `chain_outbox` with deterministic `opId`, relay, retry/backoff, idempotency (rule 6) | W00-37 |
| 27 | Contract-test harness `describeNearPortContract(name, makeAdapter)` (LLM and notifier ports reuse it as `describePortContract`) + suites vs mocks in CI (rule 5) | W00-38 |
| 28 | In-memory fakes for unit tests (rule 8) | W00-38 |
| 29 | Mock chain explorer (dev) | W00-39 |
| 30 | Dev console (client overlay + server `dev` module, command registry) | W00-40 |
| 31 | Time warp ×1–×100 | W00-41 |
| 32 | Scenario loader (`scenarios/*.ts` auto-discovered, `?scenario=`, `npm run scenario`) | W00-42 |
| 33 | State inspector + flag panel | W00-43 |
| 34 | First-party `track()` client API + raw intake table (dashboards in W25) | W00-44 |
| 35 | Headless-Chrome e2e harness with helpers and `--waves ..NN` (PRODUCT_WAVES §3) | W00-45 |
| 36 | CI: typecheck, lint, unit, contract, build, e2e with Postgres service | W00-46 |
| 37 | `sim:bench` scaffold with an `mvp-scale` placeholder (`SIM-P`) | W00-47 |
| 38 | README skeleton (hackathon "do X → see Y", baseline disclosure, libraries, AI-generated code) + LICENSE | W00-48 |
| 39 | Contributor guide: how to add a wave/feature (registries, flags, scenario, e2e, contract-first) | W00-49 |
| 41 | Snapshot schema versioning + migrations (SIM-D-07) | W00-51 |
| 42 | i18n message catalog (CLIENT §11) | W00-52 |
| 44 | One engine, three hosts (D-31): server sim thread, client replica + prediction, browser local host for single-player testing; engine parity test | W00-14, W00-24, W00-26, W00-54, W00-55, W00-56, W00-57, W00-58 |
| 43 | Wave development pipeline: branch + worktree per wave, owner check before `main` (PRODUCT_WAVES §7) | W00-53 |
| 45 | Balance overrides (D-35): `TA_BALANCE_OVERRIDES` file merged at `compileData`, dev console `tune`, live on server and local host | W00-59 |
| 40 | Wave e2e + scenario + tag | W00-50 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W00-01 | Contracts core: WS envelope (`v:1`), hello/ready/join/leave/welcome/delta/event/cmd/cmd.ack/cmd.reject/ping/pong/bye schemas, `RejectCode` (incl. `wave_disabled`), `CloseCode`, prefixed ULID ids, sim-sync binary frames (`welcome.state` = engine snapshot, `delta` = engine diff; `simVersion` + `dataHash` in `welcome`, D-31) | contract | M | H | W00-02 | Run `npm test -w @terra/contracts` → see strict parse pass for valid and fail for unknown fields | PR-01..05, WS §4.2–4.3 | TA-01.2, TA-01.4 |
| W00-02 | npm-workspaces root: new packages `shared/{contracts,config,db,sim}` (`@terra/contracts`, `@terra/config`, `@terra/db`, `@terra/sim`) and `backend/app`, plus the `frontend/*` workspaces of W00-04; `tsconfig.base.json`, ESLint/Prettier, Vitest; `npm run check` = typecheck + lint + the existing `check:structure` | ops | M | H | — | Run `npm run check` on a clean clone → see it pass with the empty new packages | D-03, ARCH §3, AGENTS §6 | TA-01.1 |
| W00-03 | Root scripts `dev` (db + app + the Vite frontend), `dev:restart`, `ci:fast`, `scenario`, `e2e`, `sim:bench` | ops | S | H | W00-02 | Run `npm run dev` → see Postgres, app and client start with one command | ARCH §3 | TA-01.5 |
| W00-04 | Frontend workspaces (the move into `frontend/` is already done): give `frontend/{game,landing,playground,render,design}` a `package.json` each (`@terra/game`, `@terra/landing`, `@terra/playground`, `@terra/render`, `@terra/design`); replace the `@terra/render` path alias with the workspace package and resolve `@terra/sim`/`@terra/contracts` the same way in `vite.config.ts` and `tsconfig`; Vite stays one app rooted at `frontend/` with the same HTML entries; `check:structure` layering (render imports no app, no app imports another) unchanged | ops | S | H | W00-02 | Run `npm run dev` → see `/`, `/landing.html`, `/play.html`, `/playground.html` and `/design/` load exactly as before, now served from the workspace packages | AGENTS §6, CLAUDE.md pages | TA-11.1 |
| W00-05 | `@terra/config`: zod env loader merged per module, `.env.example`, `envFlagTrue()` (only the exact string `true` counts), boot fails on invalid env | server | S | H | W00-02 | Start the app with `PORT=abc` → see boot abort with a zod error naming `PORT` | D-30 rule 3 & 7 | TA-01.6 |
| W00-06 | Server flag set: parse `TA_WAVES` (`all`, `..07`, `00,01,07`), `flags.has()`, expose in `ready`/`welcome.flags`; commands of disabled waves → `cmd.reject wave_disabled` | server | S | H | W00-05, W00-01 | Start with `TA_WAVES=..00` and send a W01 command kind → see `cmd.reject {code: wave_disabled}` | PRODUCT_WAVES §3 | — |
| W00-07 | Client flags: read `welcome.flags`; dev override `?waves=..NN`; feature registry skips disabled features; data rows filtered by `wave` | client | S | H | W00-06, W00-27 | Open `?waves=..00` → see the flag panel show only W00 on and no feature menus | PRODUCT_WAVES §3 | — |
| W00-08 | Contract auto-discovery: `commands/*.ts` and `events/*.ts` → generated `CommandKind`/`EventKind` unions + JSON-Schema snapshot; CI fails on an undeclared diff | contract | M | H | W00-01 | Add a file `commands/test.ts` → see `CommandKind` include it after `npm run gen`, and CI fail until the snapshot is committed | PR-06, PRODUCT_WAVES §4 | TA-01.2 |
| W00-09 | NestJS app skeleton: `main.ts`, module list auto-built from `modules/*/`, CORS allow-list, `/v1/healthz`, `/v1/readyz` (db + sim threads), `/v1/metrics` (Prometheus) | server | M | H | W00-05 | `curl /v1/readyz` → see `{db:"ok", simThreads:1}` | ARCH §3 | TA-04.1 |
| W00-10 | Logging & errors: pino with per-layer rules and PII masking; framework-free `CoreException` with stable `errorCode`; global filters (core, zod, prisma, http, fallback); zod DTO pipe | server | M | H | W00-09 | Call a test endpoint that throws `CoreException('TEST_CODE')` → see JSON `{errorCode:"TEST_CODE"}` with the right status and one structured log line | D-30 rule 7 | — |
| W00-11 | Prisma per-module schema: `prisma/<module>.prisma` merged by script into one schema with namespaces `core/world/ai/chain`; forward-only migrations; `0001_init` | server | M | H | W00-02 | Add a model in `prisma/dev.prisma` and run `npm run db:gen` → see it in the merged schema and in a new migration | D-04, DATA_MODEL §4 | TA-03.1 |
| W00-12 | `@terra/db`: Prisma client provider, repository base with `$transaction` helper, seed script, isolated test-DB harness per test run | server | S | H | W00-11 | Run `npm run test:integration` → see a fresh DB created, migrated, used and dropped | DATA_MODEL §9 | TA-03.2, TA-13.1 |
| W00-13 | In-process typed event bus (`planet.event`, module events) built from auto-discovered `events/*.ts`; subscribers per module | server | S | H | W00-08, W00-09 | Emit a test event from the game module → see a test subscriber in another module receive the typed payload | ARCH §6 | TA-07.7 |
| W00-14 | Sim kernel: `PlanetState`, SoA entity store (monotonic ids), PRNG streams (xoshiro128\*\*, named streams), `step(state, cmds, dt)` returning `{events, stats}`; isomorphic: the same package runs in Node worker threads and in browser Web Workers (D-31) | sim | M | H | W00-02 | Run `reproducible.spec.ts` → see same seed + commands give a deep-equal state twice | SIM-D-01..05, SIM-S | TA-06.1, TA-01.7 |
| W00-15 | Sim system registry: auto-discover `systems/*/index.ts` (each declares its pipeline slot 0–14); unimplemented slots are no-ops; ESLint purity rule bans `Date`, `Math.random`, timers and I/O in `shared/sim` | sim | S | H | W00-14 | Use `Math.random` in a sim system → see lint fail | SIM-T-01, SIM-D-06 | TA-06.1 |
| W00-16 | `compileData()`: load `data/*.ts` rows, convert design units (seconds, per-second rates) to ticks via `TICK_MS`, filter rows by `wave` against the flag set | sim | S | H | W00-14, W00-06 | Compile with `..00` → see W01+ rows absent; a 30 s build compiles to 150 ticks | SIM-D-03 | TA-06.4 |
| W00-17 | Snapshot codec: MessagePack (typed arrays as binary) + gzip on the host; `restore(snapshot(s))` round trip; `SIM_VERSION` + migration registry | sim | M | H | W00-14 | Run `roundtrip.property.spec.ts` (1 000 random states) → see every state round-trip deep-equal | SIM-S-01, SIM-D-07 | TA-06.9, TA-03.3 |
| W00-18 | `game` module thread pool: `SIM_THREADS = cores − 1`, planet → thread by `hash(planetId) % n`, MessagePort protocol (`cmd`, `delta`, `event`, `snapshot`, `ctl`) | server | M | H | W00-09, W00-14 | Start with 3 threads and 6 planets → see `/v1/metrics` report 2 planets per thread | SIM-H-01/02 | TA-07.2 |
| W00-19 | Drift-free scheduler per thread: `nextDueMs` per planet, 5 TPS `dt=1` active steps, `dt` hook for coarse stepping (switching logic lands in W09), max 5 catch-up steps per pass, `ta_game_tick_lag_steps` | server | M | H | W00-18 | Block a thread for 2 s in a test → see at most 5 catch-up steps per pass and the lag metric rise and then fall | SIM-H-03..05 | TA-07.2 |
| W00-20 | Fault quarantine: an exception in `step()` stops only that planet, emits `planetFaulted`, retries once from the latest snapshot, then stays `FAULTED` | server | S | H+ | W00-19, W00-29 | Inject a throwing system on planet A → see planet B keep ticking and A marked `FAULTED` after one retry | SIM-H-08 | TA-07.2 |
| W00-21 | Empty dev planet: `createPlanet({type:'flat', seed})` with a flat hex grid (radius 56) and empty colonies; real generator in W01 | sim | S | H | W00-14 | Call `createPlanet` → see 9 577 tiles with `terrain=flat, prep=wild` | SIM-GEN | TA-06.2 |
| W00-22 | WS gateway: `/ws` upgrade, origin allow-list, `hello` within 5 s using a **dev session token** (JWT in W01), `ready`, `join` → `welcome {state (engine snapshot), simVersion, dataHash, tick, tickMs:200, deltaHz:5, flags}`, `leave`, ping/pong, 60 s idle close, 64 KiB inbound cap, `bye` codes `4000/4001/4003/4012` | server | M | H | W00-01, W00-18 | Send `hello` + `join` → see `welcome` with the engine snapshot, `simVersion` and `dataHash` | WS-01..16 | TA-07.3, TA-04.6 |
| W00-23 | Command ingress: zod per kind, colony derived from the session (`not_own_colony`), post to the owning thread, `cmd.ack {appliedAtTick}` / `cmd.reject`; resync with `welcome {reason:"resync"}` when `bufferedAmount` > 1 MiB | server | M | H | W00-22 | Send a `dev.ping` command → see `cmd.ack` with an `appliedAtTick` ≥ the current tick | WS-20..23, SIM-C-01/02 | TA-07.4 |
| W00-24 | Delta builder in the sim thread: every 200 ms one engine diff per planet (`diffSince(tick)`: changed entity rows, tiles, colony records, lanes, PRNG stream states) plus the window's events, broadcast as one binary frame to every socket of the planet (D-31) | sim | M | H | W00-14, W00-17, W00-22 | Move a test entity → see the next delta, applied to a replica, give a state deep-equal to the server's | SIM-V-01..05, D-31 | TA-06.9 |
| W00-25 | Client WS state machine: connect → hello → ready → join → welcome; reconnect with jittered backoff capped at 10 s; "Reconnecting…" banner; "still trying" after 60 s; handling of `bye` codes | client | M | H | W00-22, W00-04 | Kill the app → see "Reconnecting…", then automatic resume when it returns | CLIENT §6.1–6.3 | TA-11.4 |
| W00-26 | Client sim worker (Web Worker) running the `@terra/sim` engine: load the `welcome` snapshot, apply delta diffs in order (an exact replica of the server state at tick T), derive render and HUD views with the engine's `view()`, send them to the main thread as transferable buffers; tick/time display | client | M | H | W00-25, W00-54 | Run the worker test with a recorded delta stream → the replica is deep-equal to the server's state at the last tick | CLIENT §7, D-31 | TA-11.4 |
| W00-27 | Client feature registry: `import.meta.glob` over `frontend/game/features/*/index.ts`; each feature registers menus, HUD panels, renderers, dev commands, analytics events; disabled waves are skipped | client | S | H | W00-04 | Add a stub feature folder → see its HUD panel appear without editing any shared file | PRODUCT_WAVES §4 | — |
| W00-28 | Hex terrain from the sim tile grid (CLIENT §8 Terrain): `frontend/render/planets/hex/` builds 32×32-tile chunks (one merged `BufferGeometry` each, 2 m per tile) from the snapshot and reuses the existing terrain shader (`@terra/render/visuals/terrain`), viewport (`createColonyViewport`) and `frontend/game/app/RTSCamera.ts`; thin hex edge lines; tile picking (ray → `q,r`); HUD chip with live `tick`. The noise heightfield (`planets/surface`) stays for landing, playground and the prototype; with `?scenario=`/`?host=` the play page skips the prototype menu, descent and decorative colony (`colonyLayout.ts`), otherwise the prototype flow is unchanged until W01-38 | client | M | H | W00-26 | Open `/play.html?scenario=w00` → see the flat hex planet with no decorative colony and the tick chip increasing about 5 per second | CLIENT §8, AGENTS Pillar 4 | TA-11.5 |
| W00-29 | Snapshot persistence: `world.planet_snapshot` (compressed `bytea`, `savedAt`, `simVersion`), save every 60 s staggered + on `SIGTERM` (≤ 30 s budget), load the latest on boot (fast-run of the gap is W09) | server | M | H | W00-17, W00-18, W00-11 | Restart the app → see the planet resume from the snapshot tick, not tick 0 | SIM-H-06, DEP-07 | TA-07.6, TA-03.3 |
| W00-30 | Ports, part 1: abstract-class ports (DI tokens with their base methods; extra methods and the zod I/O schemas are added by each port's feature wave in its `-01` contract issue) in `backend/app/src/near/application/ports/*.port.ts` for `IdentityPort`, `RelayerPort`, `CargoTokenPort`, `IntentsPort`, `AgentWalletPort`, `DeedNftPort`, `BadgeNftPort`, `StakingPort`, `TreasuryDaoPort`, `EscrowPort`, `ChainReadPort` (full methods, used by W00-33), plus `LlmProviderPort` and `NotifierPort` in `backend/app/src/ports/` | contract | M | H | W00-10 | `tsc` the ports package → see 13 abstract classes exported and no `any` | NEAR §1a rules 1, 7 | TA-10.8, TA-09.1 |
| W00-31 | Ports, part 2: one binding module per integration (`near-infrastructure.module.ts`, `ai`, `notify`); `nearAdapterFor(port)` reads `NEAR_ADAPTER_<PORT>` (only `testnet`/`mainnet` count; anything else means mock); production refuses mock unless `NEAR_ALLOW_MOCK_IN_PROD=true`; same scheme for `AI_PROVIDER` (`zai` or `mock`; the name AI_ORCHESTRATOR and ARCHITECTURE use) and `NOTIFY_ADAPTER` | server | S | H | W00-30, W00-05 | Start with `NODE_ENV=production` and no allow flag → see boot abort naming the mocked ports | NEAR §1a rule 2–3 | TA-10.8 |
| W00-32 | Mock chain base: `mock_chain_*` tables (accounts, balances, NFTs, intents, DAO, escrow, receipts), base mock class with latency 300–1 500 ms, failure-rate injection (`MOCK_FAIL_RATE`), `mock:` tx hashes, stable error codes (`NEAR_INSUFFICIENT_BALANCE`, `NEAR_INTENT_DIFF_NOT_ZERO`, …) | server | M | H | W00-30, W00-11 | Set `MOCK_FAIL_RATE=1` and call any mock → see `CoreException` with the documented `errorCode` | NEAR §1a rule 4 | TA-10.8 |
| W00-33 | Mock `ChainReadPort` (receipts from the mock ledger, `health`) + dev command `chain.ping`. Every other port's mock adapter lands with its feature wave (W06 identity/relayer, W09 notifier, W10 cargo, W13 intents, W15 agent wallet, W16 LLM, W20 deed/staking, W22 DAO/escrow) | server | S | H | W00-32 | Run `chain.ping` in the dev console → see a `mock:` receipt; the ChainRead contract suite is green | NEAR §1a table | TA-10.8 |
| W00-35 | Shared mock NEP-171 base `BaseNep171MockAdapter` (Postgres `mock_chain_nft`, `mock_chain_nft_meta_history`, idempotent by `opId`) + `MockBadgeNftAdapter` (collection `badge`); `MockDeedNftAdapter` builds on it in W20-03 | server | M | H | W00-32 | Mint twice with the same `opId` → see one NFT row and the same `mock:` receipt | NEAR §1a table | TA-10.8, TA-10.12 (part; was W20-02) |
| W00-37 | `chain_outbox (opId unique, port, payload, status, attempts)`: written in the same transaction as the game change; relay with retry/backoff; deterministic `opId` (e.g. `cargo-export:{colonyId}:{seq}`) | server | M | H | W00-32 | Enqueue the same `opId` twice and kill the relay mid-call → see exactly one mock receipt after restart | NEAR §1a rule 6 | TA-10.8 |
| W00-38 | Contract-test harness: `describeNearPortContract(name, makeAdapter)` (generic `describePortContract` for the LLM and notifier ports) in `near/__contract__/*.contract.ts`; each port's suite (added by the wave that adds its mock) runs against mocks in CI and against real adapters via `npm run contract:real -- --port X`; in-memory fakes (`InMemoryCargoToken extends CargoTokenPort`) for unit tests | test | M | H | W00-33, W00-35 | Run `npm run test:contract` → see the ChainRead and Badge suites green against mocks; later waves add one suite each | NEAR §1a rule 5, 8 | TA-10.8 |
| W00-39 | Mock chain explorer (dev page `/dev/chain`): receipts, balances, NFTs, DAO, escrow, outbox rows, filter by account | client | S | H | W00-32, W00-37 | Run `chain.ping` in the dev console → see the receipt row appear with a `mock:` hash | D-30 | — |
| W00-40 | Dev console: client overlay (backtick key), server `dev` module (disabled in production builds), command registry so each feature adds commands (`help`, `flags`, `chain.ping`, `spawn` stub; `grant` and `reveal` are W01-35's) | client | M | H | W00-23, W00-27 | Type `help` → see the commands registered by enabled features only | PRODUCT_WAVES §3 | — |
| W00-41 | Time warp ×1–×100 (dev only): the scheduler runs `k` steps per due slot; HUD badge `×k`; capped by the thread budget | server | S | H | W00-19, W00-40 | Run `warp 10` → see about 50 ticks per second and the `×10` badge | PRODUCT_WAVES §3 | — |
| W00-42 | Scenario loader: auto-discover `scenarios/*.ts` (`{id, waves, build(planet)}`); `?scenario=wNN` creates a fresh dev planet from it; `npm run scenario wNN` headless; `w00-empty`; scenarios use only the `@terra/sim` API, so the browser local host (W00-55) runs them too | server | M | H | W00-21, W00-40 | Open `?scenario=w00` twice → see two fresh identical planets (same seed) | PRODUCT_WAVES §3 | — |
| W00-43 | State inspector (click → entity/tile JSON, planet stats) and flag panel (current flags; dev-only runtime toggle that restarts the planet with the new set) | client | S | H+ | W00-28, W00-07 | Click a tile with the inspector on → see its JSON (`q, r, terrain, prep`) | PRODUCT_WAVES §3 | — |
| W00-44 | Analytics base: client `track(event, props)` with consent stub, `POST /v1/analytics` intake into `core.analytics_event`, server counters API (funnels and dashboards in W25) | server | S | H | W00-09, W00-27 | Call `track('test_event')` → see one row in `core.analytics_event` | CLIENT §10 | TA-12.2 |
| W00-45 | E2E harness: headless Chrome (Playwright) boots the app + client with a test DB; helpers `login`, `loadScenario`, `waitForTick`, `clickTile`, `devConsole`, `screenshot`; `npm run e2e -- --waves ..NN` runs suites up to NN; `--hack` runs only the steps tagged `@hack` (each wave's Hackathon slice) | test | M | H | W00-42, W00-28 | Run `npm run e2e -- --waves ..00 --hack` → see only the `@hack` steps run headless and pass, with screenshots saved | PRODUCT_WAVES §3 | TA-13.3 |
| W00-46 | CI workflow: Postgres service; jobs typecheck, lint, unit, contract, build (warning-free), e2e by wave; caches; required on `main` | ops | M | H | W00-38, W00-45 | Open a PR with a lint error → see CI fail on the lint job only | PRODUCT_WAVES §4 merge rule | TA-01.5 |
| W00-47 | `sim:bench` scaffold: `mvp-scale` placeholder scenario, reports step mean/p99, snapshot size/time, `welcome` snapshot size | test | S |  | W00-17, W00-42 | Run `npm run sim:bench` → see a table with step ms, snapshot KB and fullState KB | SIM-P | TA-06.1 |
| W00-48 | Rework the existing `README.md` into the submission skeleton + add LICENSE: what/why; "do X → see Y" quickstart; pre-window baseline disclosure (the `frontend/` prototype: pages, render engine, kitbash models, descent, landing, before 2026-11-01); libraries list; AI-generated code note; ports mock/real table placeholder (W25 finalises it) | docs | S | H | W00-03 | Follow the README on a fresh clone → see the W00 demo work | HACKATHON_CUT (Q-002 baseline) | — |
| W00-49 | Contributor guide `docs/plan/HOW_TO_ADD_A_WAVE.md`: contract-first issue, registries, flags, data `wave` column, scenario, e2e, tag, owned paths | docs | S | H+ | W00-27, W00-42 | A new agent follows the guide to add a stub feature → see it appear without editing shared files | PRODUCT_WAVES §4 | — |
| W00-51 | Snapshot migration tooling on top of W00-17's registry: `migrations/<from>-<to>.ts` files, `npm run sim:migrate-check` that loads the latest stored snapshot of every planet through the chain, clear refuse-to-load error when no path exists | sim | S |  | W00-17, W00-29 | Bump `SIM_VERSION` with a no-op migration, restart → every planet loads and the log shows the migration applied | SIMULATION SIM-D-07 | TA-06.9 |
| W00-52 | i18n message catalog: `t(key, vars)` helper, `en` catalog, all UI strings and reject codes go through it, lint rule against hard-coded UI strings in `features/*` | client | S |  | W00-27 | Switch `?lang=xx` to a pseudo-locale → every visible string is bracketed, none raw | CLIENT §11 | TA-11.1 |
| W00-53 | Wave pipeline scripts (PRODUCT_WAVES §7) on top of the existing `npm run wave` (`scripts/wave/`: `next` opens/resumes the next ready wave in its worktree, stacks unlanded deps and starts Claude Code; `status`; `land` merges, tags, pushes and cleans up): add `wave:issue`, `wave:issue:land`, `wave:check`; per-worktree `TA_PORT_BASE` and database `terra_<branch>` in `.env.worktree`; `wave:land` refuses when a depended-on or stacked wave is not in `main`, when gates fail, or when the merge would touch a dirty file in the main checkout; it tags `wave-NN` (or `wave-NN.k`), pushes `main` with tags, removes the worktree and branch, and lists open waves that must merge `main` | ops | M | H | W00-03, W00-45 | Run `wave:land -- 07` before W03 is in `main` → see it refuse and name W03 | PRODUCT_WAVES §7 | — |
| W00-54 | Engine boundary `SimHost` (D-31): `load(snapshot)`, `step(dt)`, `submit(cmd)`, `snapshot()`, `diffSince(tick)`, `applyDiff(diff)`, `clone()`, `view()`, `events`; used unchanged by the server sim thread, the client sim worker and the local host; lint bans Node and DOM imports and globals in `shared/sim` (SIM-D-06) | sim | S | H | W00-14, W00-15, W00-17 | Run `sim-host.spec.ts` → see load / step / diffSince / applyDiff / clone round trips deep-equal | SIM §6a, D-31 | — |
| W00-55 | Single-player local host (testing): `LocalTransport` runs the authoritative engine inside the client sim worker at 5 TPS and speaks the same protocol as `/ws` (`welcome`, deltas, `cmd.ack` / `cmd.reject`), so the rest of the client is unchanged; `?host=local` with `?scenario=` and `?waves=`; dev console, time warp and scenarios run locally; snapshots in IndexedDB; server-only features (accounts, NEAR, lobby, notifications, progression, LLM) report `host_unavailable` and their UI is hidden; `npm run e2e -- --host local` runs sim-only suites without the app | client | M | H | W00-26, W00-41, W00-42 | Stop the app and open `/play.html?host=local&scenario=w00` → see the planet render and tick about 5 per second from the browser | SIM §6a, CLIENT §7, D-31 | — |
| W00-56 | Client-side prediction core: the sim worker keeps the confirmed state (server tick T) and the player's commands not yet applied (`cmd.ack.appliedAtTick` > T); the render shows `predicted = clone(confirmed) + pending commands, stepped to the estimated server now`; every delta rebases (apply, drop applied commands, re-run the rest); `cmd.reject` rolls the command back with its reason; dev `?lag=<ms>` delays the transport both ways | client | M | H | W00-26, W00-23 | With `?lag=300`, run the dev command `nudge` on the test entity → it moves on the next frame instead of about 600 ms later; after the ack the predicted and confirmed positions agree within 0.05 tile | CLIENT §7, D-31 | — |
| W00-57 | Prediction correction and controls: a moving entity that the server places elsewhere blends to it over 150 ms, discrete fields snap; render-only events (projectiles, VFX) come from the predicted engine, player-facing events (toasts, alerts) only from the server; `?predict=0` falls back to plain interpolation 400 ms behind; prediction turns itself off when the worker step p95 exceeds 4 ms; dev overlay shows prediction error and rollbacks | client | S | H | W00-56 | Run the dev command `teleport` on the server side only → see the entity blend to the new spot over 150 ms | CLIENT §7, D-31 | — |
| W00-58 | Engine parity test: the same scenario and command log for 600 ticks on the server host (Node thread) and the local host (headless Chrome) → equal discrete state and positions within 0.01 tile; each later gameplay wave adds its scenario to the parity list | test | M | H | W00-45, W00-55, W00-56 | Run `npm run test:parity` → see `w00-empty` plus the scripted log pass on both hosts | SIM §6a, D-31 | — |
| W00-59 | Balance overrides (D-35): `TA_BALANCE_OVERRIDES` file (`balance.overrides.json`; per planet via the scenario) merged over the data rows at `compileData`, dev console `tune <table>.<row>.<field> <value>` / `tune reset` / `tune export`, applied live on the server and the local host and recorded in the planet's event log; `dataHash` in `welcome` changes with overrides | sim | M | H | W00-16, W00-40 | Run `tune <table>.<row>.<field> <value>` on a field of the W00 test data row that W00-16 compiles → see the running planet use the new value at once and `welcome.dataHash` differ after a reload; `tune reset` restores the old hash | D-35 | — |
| W00-50 | Wave e2e `e2e/w00.spec.ts` (demo story steps 1–10) + scenario `w00-empty` + tag `wave-00` | test | S | H | all above | Run `npm run e2e -- --waves ..00` → see all steps pass; then tag `wave-00` | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w00.spec.ts` passes in CI, headless.
- `?scenario=w00` loads. `?waves=..00` shows no feature menus or panels from later waves.
- The ChainRead and Badge contract suites are green against the mocks (each later wave adds its port's suite).
- `npm run check`, `ci:fast` and the build are warning-free (chunk-size warnings excepted).
- W00 is built by hand with the git commands of PRODUCT_WAVES §7 (W00-53 lands the scripts at the end of the wave); it lands on `main` after the owner's check and is tagged `wave-00` on the merge commit.
- Every row in "Features covered" maps to a closed issue.

## Notes

- **Rescoped in the 2026-10-30 layout review:** W00-04 no longer moves the app (it already lives in `frontend/`); it only turns the five `frontend/` folders into workspaces and wires the `@terra/*` packages, so it shrank from M to S. W00-28 now builds the terrain from the sim's hex tiles as CLIENT §8 requires. Before, it put a hex overlay on the noise heightfield, which would not match the generator's tiles from W01-06 on.
- **Removed in the 2026-10-30 cross-check:** W00-34 (mock Cargo/Intents adapters, built by W10-10 and W13-04/05) and W00-36 (mock DAO/Escrow/LLM/Notifier adapters, built by W22-03, W22-17, W16-02 and W09-20). W00-33 now holds only the ChainRead mock, and W00-35 the shared NEP-171/Badge mock (was W20-02). Each feature wave owns its port's mock and contract suite.
