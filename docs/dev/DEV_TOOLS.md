# Dev tools reference

Everything a developer or agent uses to run, inspect and test the game locally: URL parameters, the in-game dev console, dev-only pages and REST routes, the mock blockchain, environment variables, debug handles and test commands. Dev tools are **dev-only** (not anti-cheat, D-25): the console, the `/v1/dev/*` routes and the dev pages are off in production builds.

Start the stack with `npm run dev` (Postgres in Docker + app + Vite). Ports come from `TA_PORT_BASE` (default 4000): app `base+1` (4001), client `base+1173` (5173). A wave or issue worktree pins its own base in a gitignored `.env.worktree`, so check that file for the URL (e.g. the W00 worktree uses 4101 / 5273).

## Pages

| URL | What |
|---|---|
| `/` | Hub linking to everything (incl. a "Dev tools" card) |
| `/play.html?scenario=w00` | **Online play flow:** fresh planet from a scenario, hex terrain, HUD, dev console |
| `/play.html?host=local&scenario=w00` | Same, with the engine running in the browser alone (no app, no Postgres) |
| `/play.html?planet=dune&skip=1` | The pre-wave **prototype** (orbit menu → descent → decorative colony); unchanged |
| `/dev/chain/` | **Mock chain explorer:** receipts, balances, NFTs, DAO, escrow, outbox; account filter; 1 s auto-refresh; `CHAIN.PING` button |
| `/dev/parity/` | Engine parity page used by `npm run test:parity` (`window.__parity.run(id)`) |
| `/playground.html`, `/landing.html`, `/design/` | 3D model storybook, landing site, design system (see the main README) |

## URL parameters of `/play.html`

**Online flow** (any of `scenario` / `host` switches the page to it):

| Parameter | Effect |
|---|---|
| `?scenario=<id>` | `POST /v1/dev/scenarios/<id>` creates a **fresh** planet from `scenarios/<id>.ts` (`w00` = flat radius-56 planet + test entity id 1 at tile 0,0) and joins it. Each page load creates a new planet; reconnects in the same page rejoin it |
| `?host=local` | Browser local host: the authoritative engine runs in a Web Worker at 5 TPS; snapshots in IndexedDB (resumed on reload); server-only commands answer `host_unavailable`. Without `scenario`, uses `w00` |
| `&waves=..NN` / `&waves=00,03` | Dev: narrow the enabled waves (never wider than the server's `TA_WAVES`); the flag panel shows the result |
| `&lag=<ms>` | Dev: delay the connection by `ms` each way (tests client-side prediction) |
| `&predict=0` | Turn client-side prediction off: render the server state interpolated 400 ms behind |
| `&as=<name>` | Dev session name (token `dev:<name>`, deterministic player id); default a random `pilot-xxxxxx` |
| `&dev=1` | Mount the dev console in a non-dev build |
| `?devworld` | Install the worker test hook `window.__world` in a non-dev build |
| `?pixel=1\|0` | Experimental pixel-art post-processing shader on/off (all 3D pages) |

**Prototype flow:** `?planet=dune|oceanForest|forestRock`, `&seed=<n>`, `&deploy=1`, `&skip=1`, `&t=<s>` (see the main README).

## Dev console

Open with the **`` ` ``** key (the key under Esc on any layout; click the game first if DevTools has focus). Enter runs a command, ↑/↓ walk the history, Esc closes; commands typed while one runs are queued. It is **not** the browser's DevTools console. Only commands of enabled waves exist: `help` lists them.

| Command | What it does | Host |
|---|---|---|
| `help [name]` / `clear` | List commands / clear the log | both |
| `flags` | Enabled waves and where they came from (server, `?waves=`, default) | both |
| `ping` | No-op sim command; prints the tick it was applied at | both |
| `spawn [q r]` | Insert a test entity (kind 1, drawn as the builder robot) at a tile; prints the ack tick | both |
| `nudge <id> [dq dr]` | Move a test entity by `dev.probe.nudgeTiles` tiles (default +q); predicted on the client | both |
| `teleport <id> <q> <r>` | Set a test entity's tile; predicted | both |
| `teleport! <id> <q> <r>` | Same, but **not** predicted: the client sees it only in the next delta and blends over 150 ms | both |
| `warp <k>` | Time warp ×1…×100 for this planet (`×k` HUD badge; the server lowers it if the sim thread can't keep up) | both |
| `tune <table>.<row>.<field> <value>` | Live balance override (design units, D-35), e.g. `tune dev.probe.nudgeTiles 3`; prints the new data hash | both |
| `tune reset` / `tune export` | Drop live overrides / print them as `balance.overrides.json` | both |
| `scenario <id>` | Create a fresh planet from a scenario and print its id (local host: restart the local planet from it) | both |
| `chain.ping` | Write a ping receipt through the mock chain; prints its `mock:` hash (shows in `/dev/chain/`) | server |
| `local.reset` | Start a fresh local planet (drops the IndexedDB snapshot) | local |

**Adding a command:** a client feature (`frontend/game/features/<id>/index.ts`) lists it in `devCommands` (`{ name, help, run(args, ctx) }`); it can send sim commands (`ctx.services.sendCommand(kind, args)`) or server dev commands (`ctx.services.devServer(name, args)`). A server dev command registers in `DevCommandRegistry` (`backend/app/src/dev/`) with `defineDevCommand({ name, help, args: zod, run })`. The game rule itself goes in `shared/sim` (D-31).

## HUD and overlays (online flow)

- `TICK` chip (top left), `×k` warp badge under it.
- **WAVES** flag panel (top right): one chip per wave, on/off, and the flag source; collapsible.
- **Net stats** overlay (bottom right, dev only): prediction mode (on / off / auto-off), pending commands, rollbacks, last correction in tiles, worker step p95.
- "Connecting…" / "Reconnecting…" / "still trying" banner (top centre) while the socket is down.
- Left click on a tile logs its `q, r` (`window.__online.lastPick`).

## Mock blockchain (NEAR phase 1, D-30)

All NEAR features run on **mock adapters** behind abstract ports (`backend/app/src/near/application/ports/`). Mocks keep their state in Postgres tables `chain.mock_chain_*`, return `ChainReceipt`s with `mock:`-prefixed hashes, wait 300–1 500 ms and can inject failures. Details: [`backend/app/src/near/README.md`](../../backend/app/src/near/README.md).

- **Mocks today:** `ChainReadPort` (receipts, health, `chain.ping`) and `BadgeNftPort` (NEP-171, idempotent by `opId`). Every other port's mock lands with its feature wave.
- **Chain outbox:** every chain write is queued in `chain.chain_outbox` in the same transaction as the game change and relayed with retry/backoff; deterministic `opId`s make retries safe.
- **Explorer:** `/dev/chain/`. Contract tests: `npm run test:contract` (mocks), `npm run contract:real -- --port X` (real adapters, from W23).
- **Selection:** `NEAR_ADAPTER_<PORT>=mock|testnet|mainnet` (anything but the exact strings `testnet`/`mainnet` means mock), `AI_PROVIDER`, `NOTIFY_ADAPTER`. Production refuses mocks unless the matching `*_ALLOW_MOCK_IN_PROD=true` is set, and boot names every mocked port.

## Dev REST routes (404 in production)

| Route | What |
|---|---|
| `GET /v1/healthz`, `/v1/readyz`, `/v1/metrics` | Health, readiness (`{db, simThreads}`), Prometheus metrics (not dev-only) |
| `GET /v1/dev/planets` | Loaded planet ids |
| `GET /v1/dev/scenarios`, `POST /v1/dev/scenarios/:id` | List scenarios / create a fresh planet → `{ planetId, scenario, tick }` |
| `GET /v1/dev/commands`, `POST /v1/dev/commands/:name` | List / run server dev commands (`warp`, `tune`, `scenario`, `chain.ping`) |
| `POST /v1/dev/chain/ping` | Mock chain ping → `ChainReceipt` |
| `GET /v1/dev/chain/{receipts,balances,nfts,dao,escrow,outbox}` | Explorer data (`?account=`, `?limit=`, `?status=`, `?collection=`) |
| `POST /v1/analytics/events` | Analytics intake (`AnalyticsBatchV1`, not dev-only) |

## Environment variables

Real environment wins over `.env.worktree`, which wins over `.env` (template: [`.env.example`](../../.env.example)). Only the exact string `true` turns a boolean flag on. An invalid value aborts boot and names the variable.

| Variable | Default | What |
|---|---|---|
| `TA_PORT_BASE` / `PORT` | 4000 / base+1 | Port base for app, client, e2e |
| `TA_PG_PORT`, `TA_DB_NAME`, `DATABASE_URL` | 15434, `terraagent` | Shared dev Postgres, one database per worktree |
| `TA_HOST`, `CORS_ORIGINS` | 127.0.0.1, — | Bind address; extra allowed web origins |
| `LOG_LEVEL`, `LOG_LEVELS` | info | pino level; per layer, e.g. `sim=warn,http=info` |
| `TA_WAVES` | all | Enabled waves: `all`, `..07`, `00,01,07` |
| `SIM_THREADS` | cores − 1 | Sim worker threads |
| `GAME_DEV_PLANETS` | 0 (1 under `npm run dev`) | Flat dev planets loaded at boot |
| `SNAPSHOT_EVERY_S`, `SNAPSHOTS` | 60, on | Snapshot cadence; `SNAPSHOTS=off` (default off under `NODE_ENV=test`) |
| `DELTA_HZ` | 5 | Deltas per second per joined planet |
| `TA_BALANCE_OVERRIDES` | — | Path to `balance.overrides.json` merged over the data tables (D-35) |
| `WS_HELLO_TIMEOUT_MS`, `WS_IDLE_TIMEOUT_MS` | 5000, 60000 | Socket timeouts |
| `MOCK_LATENCY_MIN_MS`, `MOCK_LATENCY_MAX_MS`, `MOCK_FAIL_RATE`, `MOCK_SEED` | 300, 1500, 0, — | Mock chain behaviour |
| `OUTBOX_RELAY_ENABLED`, `OUTBOX_POLL_MS`, `OUTBOX_LEASE_MS`, `OUTBOX_MAX_ATTEMPTS` | on, 1000, 30000, 8 | Chain outbox relay |
| `NEAR_ADAPTER_<PORT>`, `AI_PROVIDER`, `AI_LIVE`, `NOTIFY_ADAPTER` | mock | Adapter selection (see above) |
| `NEAR_ALLOW_MOCK_IN_PROD`, `AI_ALLOW_MOCK_IN_PROD`, `NOTIFY_ALLOW_MOCK_IN_PROD` | — | Allow mocks in production |
| `ANALYTICS_DISABLED` | — | `true` drops analytics intake |
| `TA_DB_POOL_SIZE` | 20 | Prisma connection pool |

## Debug handles (browser DevTools console)

| Handle | Page | What |
|---|---|---|
| `window.__online` | online flow | Session: `store.latest` (current view: tick, planet, entities `Float32Array` stride 12), `transport`, `commands.send(kind, args)`, `pickAt(x, y)`, `tileToScreen(q, r)`, `lastPick`, `entityMeshes()` |
| `window.__world` | dev builds / `?devworld` | Sim worker test hook (`feed(n)`, `check()`) |
| `window.__track` | dev builds | Analytics: `setConsent(true)`, `track(name, props)`, `flush()` |
| `window.__parity` | `/dev/parity/` | `run(caseId)` |
| `window.__game` | prototype | Game state (`debug`, `setPaused`) |
| `window.__pg` | playground | `select(id)`, `setView(v)`, `contactSheet()` |

## Scripts and tests

| Command | What |
|---|---|
| `npm run dev`, `dev:restart`, `dev:client` | Full stack; restart only the app (SIGTERM → shutdown snapshot → start); Vite only |
| `npm run scenario -- w00 [--ticks N]` | Build and step a scenario headless, print a summary |
| `npm run check`, `npm test`, `npm run ci:fast` | Typecheck + lint + structure + codegen; unit tests; check + unit + build |
| `npm run test:integration`, `test:contract` | Tests on a throwaway Postgres database; NEAR port contract suites |
| `npm run e2e -- --waves ..NN [--hack] [--host local]` | Wave suites in headless Chrome (`--hack`: the hackathon steps; `--host local`: no app); `E2E_REUSE=1` attaches to a running stack |
| `npm run test:parity` | Same scenario + command log for 600 ticks on the server thread host and the browser local host |
| `npm run gen` / `gen:check` | Regenerate registries (command/event kinds, sim systems, data tables, scenarios, Prisma schema) |
| `npm run db:up`, `db:migrate`, `db:reset`, `db:gen -- --name x`, `db:seed` | Database |
| `npm run wave`, `npm run wave -- status`, `npm run wave -- land NN` | Wave pipeline: open/resume the next wave; the board; land a checked wave (e.g. `npm run wave -- land 00`). Single steps `wave:open`, `wave:issue`, `wave:issue:land`, `wave:check` (prints the owner check guide `docs/plan/checks/wNN-check.md`), `wave:land` — see the main README |
