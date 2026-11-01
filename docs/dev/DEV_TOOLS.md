# Dev tools reference

Everything a developer or agent uses to run, inspect and test the game locally: URL parameters, the in-game dev console, dev-only pages and REST routes, the mock blockchain, environment variables, debug handles and test commands. Dev tools are **dev-only** (not anti-cheat, D-25): a production build never mounts the console, and the `/v1/dev/*` routes answer 404 there (`DevOnlyGuard`); the dev pages (`/dev/chain/`, `/dev/parity/`) are still built, but their data routes are those `/v1/dev/*` routes.

Start the stack with `npm run dev` (Postgres in Docker + app + Vite). Ports come from `TA_PORT_BASE` (default 4000): app `base+1` (4001), client `base+1173` (5173). A wave or issue worktree pins its own base in a gitignored `.env.worktree`, so check that file for the URL (e.g. the W00 worktree uses 4101 / 5273).

## Pages

| URL | What |
|---|---|
| `/` | Hub linking to everything (`01 · Landing`, `02 · Planet Selection`, `03 · Play`, `04 · Playground`, plus Design System & Dev Tools) |
| `/play.html?planet=dune\|oceanForest\|forestRock` | **3D Planet Selection & Atmospheric Drop-Pod Descent:** 3D orbital planet selector → atmospheric pod-falling animation → seamless touchdown into the live online colony on the selected biome; sets URL to `/play.html` on touchdown (`Esc → Return to orbit` sets URL back to `/play.html?planet=<kind>`) |
| `/play.html` | **Fast-start online play flow (W01+):** skips the 3D orbital planet selector and atmospheric drop animation (`POST /v1/auth/guest` + `GET /v1/me/home` + instant landing into colony view; a new colony is seated on the dev planet family of the remembered orbit pick, sent as `?type=` (desert `pl_dev` when there is none); an existing colony keeps its planet) |
| `/play.html?scenario=w01` | **Online scenario flow:** fresh temperate planet (`w01-landfall`) with colony 0's pod descending at spawn slot 0 (cargo credited at once; the HQ drone deploys when the pod opens), HUD, Terraform & Construction menus, dev console |
| `/play.html?scenario=w00` | **W00 scenario:** flat radius-56 planet + test entity id 1 at tile 0,0 |
| `/play.html?host=local&scenario=w01` | Same (`w00` or `w01`), with the engine running in the browser alone (no app, no Postgres) |
| `/play.html?planet=dune&seed=1&skip=1` | The pre-wave **decorative prototype** (used for visual QA when `seed` + `skip=1` or `qat`/`t` is set) |
| `/dev/chain/` | **Mock chain explorer:** receipts, balances, NFTs, DAO, escrow, outbox; account filter; 1 s auto-refresh; `CHAIN.PING` button |
| `/dev/parity/` | Engine parity page used by `npm run test:parity` (`window.__parity.run(id)`) |
| `/playground.html`, `/landing.html`, `/design/` | 3D model storybook, landing site, design system (see the main README) |

## URL parameters of `/play.html`

**Online flow** (default on `/play.html` in W01+, or any of `scenario` / `host` / `join`, or after touchdown from `?planet=<kind>`):

| Parameter | Effect |
|---|---|
| *(none)* | Fast-start guest boot flow (W01+): orbital splash → `POST /v1/auth/guest` → `GET /v1/me/home` (seats a **new** colony on the dev planet family of the orbit pick, sent as `GET /v1/me/home?type=desert|ocean|temperate`: desert `pl_dev`, `pl_dev_2`, …; ocean `pl_dev_ocean`, `pl_dev_ocean_2`, …; temperate `pl_dev_temperate`, …; no pick → desert; an existing colony keeps its planet, use a fresh guest `?as=<x>` (dev builds: its own device secret `ta_device_secret:<x>`) to try another type; a dev planet saved by an older world generator, or of another type than its family, is wiped and recreated on app start, D-38) → joins planet → auto-lands immediately into colony view (`Esc → Return to orbit` returns to `/play.html?planet=<kind>`). The access token (15 min) is renewed a minute before it expires (`POST /v1/auth/refresh`, else a guest login) and sent as `reauth` on the open socket; a reconnect after `4000`/`4003` renews it first. `/me/home` answers 503 `HOME_UNAVAILABLE` and 429 are retried with backoff (0.5–4 s, 5 tries); a failed boot (other HTTP errors, retries used up, or no server in a production build) shows the error on the splash with **Retry**. A `NEW`, `ELIMINATED` or `PLANET_ENDED` home shows an error splash naming the state. `bye 4003 not_your_planet` shows "Not your colony's planet" (terminal, no dev fallback). Dev builds only: when no game server answers (network error, or a 5xx without the server's error envelope, e.g. from the Vite proxy), or the socket gives up before the first view, the colony runs on an in-browser planet instead, with an **OFFLINE · LOCAL** badge (bottom centre) and no connection banner; it is lost on reload. That planet runs on the same engine as `?host=local` (`LocalHostCore`, in-process on the page instead of a Worker, FA-07): same command precheck and rejects, 5 TPS scheduler, a step that throws is restored from its last in-memory snapshot (every 10 s), and the dev console's `warp`, `tune`, `scenario`, `ledger` go to it (other server commands answer `host_unavailable`) |
| `?planet=dune\|oceanForest\|forestRock` | Opens the **3D Orbital Planet Selector** on that biome (`&deploy=1` launches the 3D atmospheric drop-pod descent immediately). Each DEPLOY COLONY in a **dev build** starts a fresh guest (new `ta_device_secret`), so the colony lands on a planet of the picked type; a production build keeps the guest, whose existing colony keeps its planet. The live online game mounts as the pod falls; at touchdown the browser URL switches to `/play.html` |
| `?scenario=<id>` | `POST /v1/dev/scenarios/<id>` creates a **fresh** planet from `scenarios/<id>.ts` (`w00` = flat radius-56 planet + test entity id 1 at tile 0,0; `w01` / `w01-landfall` = temperate radius-56 planet with colony 0's pod descending at spawn slot 0, stock 600/350/200/200 from the start; the HQ (800/800 E) deploys when the pod opens: the client's `landPod` or `land`) and joins it. Each page load creates a new planet; reconnects in the same page rejoin it |
| `?host=local` | Browser local host: the authoritative engine runs in a Web Worker at 5 TPS; snapshots in IndexedDB (resumed on reload); the worker also keeps the resource ledger journal (`PlanetJournal`, saved inside each snapshot; console `ledger`; never sent to the page's store); server-only commands answer `host_unavailable`. Needs `scenario` (`?host=local&scenario=w00\|w01`): `?host=local` alone opens the prototype world picker |
| `?join=<planetId>` | Join an **existing** planet instead of creating one — how a second player (another browser profile, with `&as=b`) joins the first player's scenario planet. The dev console `planet [name]` prints the ready link. Only `dev:` sessions may join a planet that is not their own colony's (guest JWT sessions: WS-12, `bye 4003 not_your_planet`); a dev session plays colony 0 on a scenario planet without colony rows |
| `&waves=..NN` / `&waves=00,03` | Dev: narrow the enabled waves (never wider than the server's `TA_WAVES`); the flag panel shows the result |
| `&lag=<ms>` | Dev: delay the connection by `ms` each way (tests client-side prediction); the command confirm timeout grows by the round trip (`5 s + 2 × ms`), so slow-link commands are not rolled back as timed out |
| `&predict=0` | Turn client-side prediction off: views are the confirmed server state. Every entity (`devProbe`, HQ, pod, Hub) is drawn by the one renderer `EntityMeshes`, 1.5 ticks (300 ms) behind the newest confirmed tick with or without prediction |
| `&as=<name>` | Dev session name: on `?scenario=` / `?join=` the token `dev:<name>` (deterministic player id; default a random `pilot-xxxxxx`); on the guest boot flow (dev builds) its own device secret `ta_device_secret:<name>`, i.e. a separate guest per name in one browser profile |
| `&dev=1` | Mount the dev console in a non-dev build of another mode (e.g. staging); a `production`-mode build never mounts it |
| `?devworld` | Install the worker test hook `window.__world` in a non-dev build |
| `&skip=1` | With `?planet=`: deploy at once without the descent cinematic. On the online boot (`/play.html`, `?scenario=`, `?join=`): skip the drop-pod descent animation and show the colony view at once; the HQ still deploys after `hq.startingKit.podLandMinS` (5 s) through `landPod` (the console `land` is instant) |
| `&t=<s>` | With `?planet=`: deploy at once and fast-forward the prototype's descent by `s` seconds (visual QA captures; runs the prototype gameplay, not the online engine) |
| `?autodeploy=<ms>` | Prototype QA: open the orbit picker and press DEPLOY after `ms` (default 1500); `&qat=<s>` then advances the prototype `s` seconds. Runs the prototype gameplay, not the online engine |
| `?menutime=<s>` | Prototype QA: start the orbit picker's animation clock at `s` seconds (for repeatable screenshots) |
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
| `tune <table>.<row>.<field> <value>` | Live balance override (design units, D-35), e.g. `tune dev.probe.nudgeTiles 3`; prints the new data hash. Resource amounts (`hq.startingKit.cargo`, `hub.t1.cost`, `hub.t1.storageCapPerFamily`, `opsBasic.<op>.yieldAmount`) must be whole, non-negative units with known resource keys: `tune opsBasic.break.yieldAmount 10.5` is rejected with the field and value named, and the planet keeps its data. Generation numbers are not tunable: `tune worldgen.*` (and `terrain.<class>.code`) is rejected with "cannot be tuned" (a planet is generated once from `data/worldgen.ts`) | both |
| `tune reset` / `tune export` | Drop live overrides / print them as `balance.overrides.json`. Every client of the planet follows a `tune` from its `dev.tuned` event: a `set` rebuilds the prediction's data in place (and the placement ghost's `simData`), a `reset` makes the client re-join for a fresh welcome | both |
| `planet [name]` | Print this planet's id and a link that joins it as another player (`?join=<id>&as=<name>`, default `b`); open it in a second browser profile | server |
| `scenario <id>` | Create a fresh planet from a scenario and print its id (local host: restart the local planet from it) | both |
| `planet.wipe <planetId>` | Server dev command `planet.wipe`: delete a held (unloaded) planet with its snapshots, ledger rows and colony rows so the next seat or boot starts it fresh; a loaded planet is refused (409) | server |
| `chain.ping` | Write a ping receipt through the mock chain; prints its `mock:` hash (shows in `/dev/chain/`) | server |
| `local.reset` | Start a fresh local planet (drops the IndexedDB snapshot) | local |
| `grant <resource> <n>` | Add `<n>` whole units to colony stock (`metals`/`metals.t1`, `minerals`/`minerals.t1`, `biomass`/`bio.biomass`, `water`/`bio.water`: the console maps the shorthands, `dev.grant` itself takes only a full `ResourceKey`; bypasses storage cap); a negative `<n>` withdraws, clamped to the balance. `<n>` must be an integer (the console rejects `2.5`). Only for an existing colony (a colony index with no record is rejected `invalid_args`, no placeholder colony is created). Posts a `dev.grant` ledger entry (W01) | both |
| `ledger [n] [account]` | Print the last `n` (default 10) resource-ledger journal entries touching `account` (default your `colony:<i>`; e.g. `sys:construction`, `sys:dev`), one per line (`#seq t=tick reason actor ref  account asset ±delta · …`), then that account's balance; `ledger colony:1` works too. The journal lives on the host only (clients get `col.stock`, never postings), so the command asks it: online `GET /v1/dev/planets/:planetId/ledger`; `?host=local` the worker's journal (dev message `ledger`, last 1024 entries, reset on a new planet); the no-server fallback its in-process one. All hosts run the same `PlanetJournal` (`@terra/sim`). A fresh scenario planet's journal starts with its setup postings (the real `landing.cargo`, on both hosts). `?host=local` saves the journal inside its IndexedDB snapshot (same tick as the planet), so a reload continues it: `landing.cargo`, grants and spends stay visible and `seq` goes on. Only when that saved journal is missing (an older save), malformed or does not reconcile with the planet's `col.stock` (reported as a host error) does the resumed host open each colony's stock with one `ledger.opening` entry (`sys:opening` → `colony:<i>`, by `system:resume`); the no-server fallback's journal starts with the postings of seating its colony (the real `landing.cargo`). After an opening, `sys:*` totals count only what happened since (W01) | both |
| `cell <n>` | Set the colony's HQ power cell to `<n>` E (`<n>` ≥ 0, clamped to the cell capacity `hq.t1.cellCapacity` = 800; a negative value is `invalid_args`); a colony without an HQ is `unknown_entity` (never another colony's HQ) (W01) | both |
| `reveal` | Mark every hex tile on the planet explored for the colony (W01) | both |
| `seed <s\|n>` | Regenerate the current planet's ground (terrain, heights, deposits, hidden subsurface) from seed `<s>` with the planet type's world-generation profile (D-38); colonies and entities stay, every construction order is cancelled (refund rules) and every terraform order dropped, territory / anchors / fog are reset and re-made by active Hubs and by HQ / pod vision (W01) | both |
| `tp [id] <q> <r>` | Teleport entity `id` (default: the colony's HQ drone; none → `unknown_entity`, never another colony's HQ; another colony's entity → `not_own_colony`) to tile `(q, r)`; `id`, `q`, `r` must be whole numbers (the console rejects `1.5`) (W01). Admin only: `dev.teleport` / `dev.nudge` / `dev.land` are the only commands that may set a position directly (SIM-M-01); the HQ drops its current route and re-plans from the new tile | both |
| `land [q r]` | Skip drop-pod descent immediately for your colony: opens its descending pod (the HQ drone deploys), or, with no pod yet, lands one and opens it at once (the pod's cargo is credited when the pod is created) (W01); with `q r` (both whole numbers) it lands on / moves the pod to that tile, a single coordinate is an error. `dev.land` rejects `already_landed` when the colony's pod is already open, `system.spawnColony` when the colony already has a pod or a landing; `landing_site_taken` (slot used, or closer than `hq.startingKit.minLandingSeparation` to another colony) and `planet_full` (8 colonies); the HUD toasts them. Players (also in production) use `landPod` instead, which opens the pod after `hq.startingKit.podLandMinS` (5 s) | both |
| `border-hatch [on\|off]` | Toggle colour-blind hatch pattern on territory borders (W01) | both |

**Adding a command:** a client feature (`frontend/game/features/<id>/index.ts`) lists it in `devCommands` (`{ name, help, run(args, ctx) }`); it can send sim commands (`ctx.services.sendCommand(kind, args)`), server dev commands (`ctx.services.devServer(name, args)`) or ask the host's ledger (`ctx.services.ledgerQuery(account, limit)`). A server dev command registers in `DevCommandRegistry` (`backend/app/src/dev/`) with `defineDevCommand({ name, help, args: zod, run })`. The game rule itself goes in `shared/sim` (D-31).

## HUD and overlays (online flow)

- `TICK` chip (top left), `×k` warp badge under it.
- **Minimal HUD** (top centre, W01): colony name, `MM:SS` game clock, family stock & caps (`Metals`, `Minerals`, `Bio` with `Water` + `Biomass` tooltip, `Supply`), HQ power cell bar (`800 / 800 E`; `— E` until a view carries the HQ), and command reject toasts (one per reject cause, worded per command kind; no shortfall numbers: the sim never rejects for cost, an unaffordable Hub is accepted and its order waits, GP-30; toasts are buttons, announced politely to screen readers).
- **HQ Status Panel** (top left, W01): HQ T1 Commander Drone hull HP (`900 / 900`), power cell bar, current job (`idle`, `moving`, `working`, `constructing`, or `waiting` for queued work it cannot start yet), and queue count; left-click selects HQ, right-click orders `moveUnit`, **X** stops the selected HQ (`stopUnit`). A move to a walled-in tile ends with one `No path` toast. Server ingress: more than 20 commands/s (bursts of 40) per player are rejected `rate_limited`.
- **Terraform Menu v1** (bottom left, W01): `GRADE [G]`, `CLEAR [C]`, `BREAK [B]` arm the brush (pressing the armed op's button again, **Esc** or a right click on the map disarms it; hotkeys are ignored while typing, on auto-repeat and while the Hub ghost is open). Only an armed brush paints: a left click (single `1×1`) or a drag (area box; a box over the contract's tile limit is not sent: `Area too large`) sends one `enqueueTask`; while armed, map clicks do not select or move the HQ. The status line previews `Queued N jobs · M skipped` with the sim's own terraform rule (`evaluateTerraform`, same as the host); a multi-tile Grade prepares each tile with the op it needs. `CANCEL` cancels the active order shown in the view by its host id (disabled when there is none). Tile-state overlay: `OVERLAY: ON/OFF [V]` (Wild / Flat / Prepared counts).
- **Construction Menu v0** (bottom right, W01): `Command Hub [H]` button, 3×3 placement ghost with green/red validity tint and live prep bill (tiles to prepare, Grade/Clear/Break breakdown, time at HQ `1.5×`, E cost, lump yields), `CONFIRM` / `CANCEL [ESC]`, a translucent 3D ghost in the scene (9 footprint hexes tinted per tile + a Command Hub proxy, green valid / red invalid, re-picked when the pointer moves and every 150 ms while it rests; renderer `hub-ghost-3d`), and `CANCEL ORDER` (75% refund if already in progress; enabled only while the colony has an open Hub order, sent with that order's id). While the ghost is open it owns the map clicks: left click confirms, right click or **Esc** cancels (neither moves the HQ nor pauses the game); **H** ignores auto-repeat. Button cost and the bill's `HQ n×` label come from the live `hub.t1` / `hq.t1` rows. Validity comes from the shared `evaluatePlacement` (same function as the `placeBuilding` handler, D-37): trees, rock, water, slopes and deposits are red with the reason; to test the server check directly, run `__online.commands.send('placeBuilding', { building: 'commandHub', q, r })` in the browser DevTools console.
- **WAVES** flag panel (top right): one chip per wave, on/off, and the flag source; collapsible. Below it: `BORDER: SOLID / HATCH` toggle (W01; the choice is remembered per browser in `localStorage` `terra.borderHatch`).
- **Net stats** overlay (bottom right, dev only): prediction mode (on / off / auto-off), pending commands, rollbacks, last correction in tiles (the largest jump a confirmed view applied to an already drawn, predicted pose), worker step p95.
- "Connecting…" / "Reconnecting…" / "still trying" banner (top centre) while the socket is down.
- The last picked tile is kept in `window.__online.lastPick` (`q, r, i`; picks are not logged to the console).

## Mock blockchain (NEAR phase 1, D-30)

All NEAR features run on **mock adapters** behind abstract ports (`backend/app/src/near/application/ports/`). Mocks keep their state in Postgres tables `chain.mock_chain_*`, return `ChainReceipt`s with `mock:`-prefixed hashes, wait 300–1 500 ms and can inject failures. Details: [`backend/app/src/near/README.md`](../../backend/app/src/near/README.md).

- **Mocks today:** `ChainReadPort` (receipts, health, `chain.ping`) and `BadgeNftPort` (NEP-171, idempotent by `opId`). Every other port's mock lands with its feature wave.
- **Chain outbox:** every chain write is queued in `chain.chain_outbox` in the same transaction as the game change and relayed with retry/backoff; deterministic `opId`s make retries safe.
- **Explorer:** `/dev/chain/`. Contract tests: `npm run test:contract` (mocks), `npm run contract:real -- --port X` (real adapters, from W23).
- **Selection:** `NEAR_ADAPTER_<PORT>=mock|testnet|mainnet` (anything but the exact strings `testnet`/`mainnet` means mock), `AI_PROVIDER`, `NOTIFY_ADAPTER`. Production refuses mocks unless the matching `*_ALLOW_MOCK_IN_PROD=true` is set, and boot names every mocked port.

## REST routes (auth, home & dev; `/v1/dev/*` 404 in production)

| Route | What |
|---|---|
| `GET /v1/healthz`, `/v1/readyz`, `/v1/metrics` | Health, readiness (`{db, simThreads}`; not ready while any sim thread is down: a dead thread is restarted, at most 3 times per 10 min, and its planets restored from their latest snapshots), Prometheus metrics (not dev-only) |
| `POST /v1/auth/guest`, `/v1/auth/refresh`, `/v1/auth/logout` | Guest device-secret auth, refresh token rotation (`httpOnly` cookie), session logout (W01, not dev-only) |
| `GET /v1/me/home[?type=desert\|ocean\|temperate]` | Player home state (`NEW` auto-seats on the first dev planet with a free seat of the asked type, default desert: `pl_dev`, `pl_dev_2` … / `pl_dev_ocean` … / `pl_dev_temperate` … → returns `ACTIVE` with `planet` and `colony`; `type` is ignored once the player has a colony). The landing site is the planet's own sim's answer (`nextLandingSite`); an existing home's planet is loaded (restored from its snapshot) before `ACTIVE` is answered, 503 `HOME_UNAVAILABLE` when it cannot be (held). New colony ids are `co_<ULID>` (W01, not dev-only) |
| `GET /v1/dev/planets` | Loaded planet ids |
| `GET /v1/dev/scenarios`, `POST /v1/dev/scenarios/:id` | List scenarios / create a fresh planet → `{ planetId, scenario, tick }` |
| `GET /v1/dev/commands`, `POST /v1/dev/commands/:name` | List / run server dev commands (`warp`, `tune`, `scenario`, `chain.ping`, `planet.wipe`). `planet.wipe {planetId}` deletes a held planet (not loaded: corrupt snapshots or from a newer build) with its snapshots, ledger rows and colony rows, so the next seat or boot starts it fresh; 409 for a loaded planet (W01) |
| `GET /v1/dev/planets/:planetId/ledger?account=colony:0&limit=10` | The planet's resource ledger (Postgres; in memory with `SNAPSHOTS=off` or under tests) for one account → `{ planetId, account, balances, entries }`: non-zero balances and the last `limit` journal entries touching it (`{ seq, at, reason, actor, ref?, legs }`, oldest first). 404 when the planet is not loaded, 400 for a bad account, 503 `LEDGER_UNAVAILABLE` while the planet's journal is still restoring (answered after at most 2 s) or its restore was abandoned. Used by the console `ledger` (W01) |
| `POST /v1/dev/chain/ping` | Mock chain ping → `ChainReceipt` |
| `GET /v1/dev/chain/{receipts,balances,nfts,dao,escrow,outbox}` | Explorer data (`?account=`, `?limit=`, `?status=`, `?collection=`) |
| `POST /v1/analytics/events` | Analytics intake (`AnalyticsBatchV1`, not dev-only) |

## Environment variables

Real environment wins over `.env.worktree`, which wins over `.env` (template: [`.env.example`](../../.env.example)). Only the exact string `true` turns a boolean flag on (exception: `AI_LIVE=1`). An invalid value aborts boot and names the variable.

| Variable | Default | What |
|---|---|---|
| `TA_PORT_BASE` / `PORT` | 4000 / base+1 | Port base for app, client, e2e |
| `TA_PG_PORT`, `TA_DB_NAME`, `DATABASE_URL` | 15434, `terraagent` | Shared dev Postgres, one database per worktree |
| `TA_HOST`, `CORS_ORIGINS` | 127.0.0.1, — | Bind address; extra allowed web origins |
| `JWT_ACCESS_SECRET` | dev literal (not in production) | HMAC secret for access JWTs (≥ 16 chars). Production refuses to boot without it or with the public dev default |
| `AUTH_RATE_PER_MIN` | 30 | Per client IP: `POST /v1/auth/guest` and `GET /v1/me/home` requests per minute (each route, same burst); over it 429 `rate_limited` |
| `TA_TRUST_PROXY` | — | Express `trust proxy` (`loopback`, `1`, …). Set it behind a reverse proxy, else every client shares the proxy's IP in the per-IP throttle |
| `LOG_LEVEL`, `LOG_LEVELS` | info | pino level; per layer, e.g. `sim=warn,http=info` |
| `TA_WAVES` | all | Enabled waves: `all`, `..07`, `00,01,07` |
| `SIM_THREADS` | cores − 1 | Sim worker threads |
| `GAME_DEV_PLANETS` | 0 (1 under `npm run dev`) | Dev planets loaded at boot (the desert `pl_dev…` family with W01 on; the flat W00 planet without W01) |
| `SNAPSHOT_EVERY_S`, `SNAPSHOTS` | 60, on | Snapshot cadence; `SNAPSHOTS=off` (default off under `NODE_ENV=test`). The ledger journal and the planet/colony rows (`core.planet`, `core.colony`) follow the same switch: off keeps them in memory. Players and sessions use Postgres whenever it is configured |
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
| `window.__online` | online flow (also `window.__game`) | Session: `store.latest` (current view: tick, planet, entities `Float32Array` stride 12, `colonies[i].stock` (zero-filled, whole units; the ledger journal stays on the host, see console `ledger`)), `transport`, `commands.send(kind, args)`, `pickAt(x, y)`, `tileToScreen(q, r)`, `lastPick`, `entityMeshes()` |
| `window.__world` | dev builds / `?devworld` | Sim worker test hook (`feed(n)`, `check()`) |
| `window.__track` | dev builds | Analytics: `setConsent(true)`, `track(name, props)`, `flush()` |
| `window.__parity` | `/dev/parity/` | `run(caseId)` |
| `window.__game` | prototype | Game state (`debug`, `setPaused`) |
| `window.__pg` | playground | `select(id)`, `setView(v)`, `contactSheet()`, `setBuild(0\|0.33\|0.66\|1)` (construction scaffold stage); URL `&hexterrain=1&hatch=1&build=33&work=1` shows the hex terrain sample, border hatch, scaffold and work pose (README → URL parameters) |

## Scripts and tests

| Command | What |
|---|---|
| `npm run dev`, `dev:restart`, `dev:client` | Full stack; restart only the app (SIGTERM → shutdown snapshot → start); Vite only |
| `npm run scenario -- w00 [--ticks N]` | Build and step a scenario headless, print a summary |
| `npm run check`, `npm test`, `npm run ci:fast` | Typecheck + lint + structure + codegen; unit tests; check + unit + build |
| `npm run test:integration`, `test:contract` | Tests on a throwaway Postgres database; NEAR port contract suites |
| `npm run e2e -- --waves ..NN [--hack] [--host local]` | Wave suites in headless Chrome (`--hack`: the hackathon steps; `--host local`: no app); `E2E_REUSE=1` attaches to a running stack |
| `SIM_PERF=1 npx vitest run --project @terra/sim test/gen/world.spec.ts` | Also runs the wall-clock world generation budget (radius 56 < 250 ms, radius 120 < 1.5 s); skipped without `SIM_PERF=1` so a loaded runner cannot fail it |
| `npm run test:parity` | Same scenario + command log for 600 ticks on the server thread host and the browser local host |
| `npm run gen` / `gen:check` | Regenerate registries (command/event kinds, sim systems, data tables, scenarios, Prisma schema) |
| `npm run db:up`, `db:migrate`, `db:reset`, `db:gen -- --name x`, `db:seed` | Database |
| `npm run wave`, `npm run wave -- status`, `npm run wave -- land NN` | Wave pipeline: open/resume the next wave; the board; land a checked wave (e.g. `npm run wave -- land 00`). Single steps `wave:open`, `wave:issue`, `wave:issue:land`, `wave:check` (prints the owner check guide `docs/plan/checks/wNN-check.md`), `wave:land` — see the main README |
