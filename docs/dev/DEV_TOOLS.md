# Dev tools reference

Everything a developer or agent uses to run, inspect and test the game locally: URL parameters, the in-game dev console, dev-only pages and REST routes, the mock blockchain, environment variables, debug handles and test commands. Dev tools are **dev-only** (not anti-cheat, D-25): a production build never mounts the console, and the `/v1/dev/*` routes answer 404 there (`DevOnlyGuard`); the dev pages (`/dev/chain/`, `/dev/parity/`, `/dev/mock-oauth`) are still built, but their data routes are those `/v1/dev/*` routes.

Start the stack with `npm run dev` (Postgres in Docker + app + Vite). Ports come from `TA_PORT_BASE` (default 4000): app `base+1` (4001), client `base+1173` (5173). A wave or issue worktree pins its own base in a gitignored `infra/.env.worktree`, so check that file for the URL (e.g. the W00 worktree uses 4101 / 5273).

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
| `/dev/mock-oauth?provider=google\|x&return=<path>` | **Mock login:** plate titled "Google (mock)" or "X (mock)" (anything but `x` is Google). Pick `test-pilot` or type a name (1–64) → `POST /v1/dev/mock-oauth/token` → redirect to `return` with `#mock_token=…` (`encodeURIComponent`). `return` must be a same-origin path (one leading `/`, no `//`, no `://`, no backslash), else `/play.html`. 404 unless the Identity adapter is `mock` and wave `W06` is on |
| `/dev/parity/` | Engine parity page used by `npm run test:parity` (`window.__parity.run(id)`) |
| `/playground.html`, `/landing.html`, `/design/` | 3D model storybook, landing site, design system (see the main README) |

## Public hosts (W26)

`npm run stack:local` serves the eight `terraagent.fun` names from nginx on port 80. That is separate from `npm run dev` (the Vite client and the Nest app on `TA_PORT_BASE`). Curl with `--resolve <host>:80:127.0.0.1`, or install [`infra/hosts/local.hosts`](../../infra/hosts/local.hosts) so a browser can open the names. Only nginx publishes a port. The app container uses the dev Postgres on 15434. `npm run stack:local:down` does not stop that Postgres.

| Host | What |
|---|---|
| `http://terraagent.fun/` | Landing (`/landing.html`) |
| `http://pitchdeck.terraagent.fun/` | Pitch deck |
| `http://whitepaper.terraagent.fun/` | Whitepaper, rendered from `docs/hackathon/public/whitepaper.md` |
| `http://design.terraagent.fun/design/` | Faction Plate index. Tokens: `/design/css/tokens.css` |
| `http://play.terraagent.fun/` | Play page. `/v1/` and `/ws` proxy to the app |
| `http://playground.terraagent.fun/` | Playground |
| `http://devchain.terraagent.fun/dev/chain/` | Mock chain explorer HTML (still 200 if the app is stopped). `/v1/dev/chain/` proxies to the app |
| `http://api.terraagent.fun/v1/healthz` | API only. Any other path, including `/`, is 404 |

## URL parameters of `/play.html`

**Online flow** (default on `/play.html` in W01+, or any of `scenario` / `host` / `join`, or after touchdown from `?planet=<kind>`):

| Parameter | Effect |
|---|---|
| *(none)* | Fast-start guest boot flow (W01+): orbital splash → `POST /v1/auth/guest` → `GET /v1/me/home` (seats a **new** colony on the dev planet family of the orbit pick, sent as `GET /v1/me/home?type=desert|ocean|temperate`: desert `pl_dev`, `pl_dev_2`, …; ocean `pl_dev_ocean`, `pl_dev_ocean_2`, …; temperate `pl_dev_temperate`, …; no pick → desert; an existing colony keeps its planet, use a fresh guest `?as=<x>` (dev builds: its own device secret `ta_device_secret:<x>`) to try another type; a dev planet saved by an older world generator, or of another type than its family, is wiped and recreated on app start, D-38) → joins planet → auto-lands immediately into colony view (`Esc → Return to orbit` returns to `/play.html?planet=<kind>`). The access token (15 min) is renewed a minute before it expires (`POST /v1/auth/refresh`, else a guest login) and sent as `reauth` on the open socket; a reconnect after `4000`/`4003` renews it first. `/me/home` answers 503 `HOME_UNAVAILABLE` and 429 are retried with backoff (0.5–4 s, 5 tries); a failed boot (other HTTP errors, retries used up, or no server in a production build) shows the error on the splash with **Retry**. A `NEW`, `ELIMINATED` or `PLANET_ENDED` home shows an error splash naming the state. `bye 4003 not_your_planet` shows "Not your colony's planet" (terminal, no dev fallback). Dev builds only: when no game server answers (network error, or a 5xx without the server's error envelope, e.g. from the Vite proxy), or the socket gives up before the first view, the colony runs on an in-browser planet instead, with an **OFFLINE · LOCAL** badge (bottom centre) and no connection banner; it is lost on reload. That planet runs on the same engine as `?host=local` (`LocalHostCore`, in-process on the page instead of a Worker, FA-07): same command precheck and rejects, 5 TPS scheduler, a step that throws is restored from its last in-memory snapshot (every 10 s), and the dev console's `warp`, `time`, `tune`, `scenario`, `ledger` go to it (other server commands answer `host_unavailable`) |
| `?planet=dune\|oceanForest\|forestRock` | Opens the **3D Orbital Planet Selector** on that biome (`&deploy=1` launches the 3D atmospheric drop-pod descent immediately). Each DEPLOY COLONY in a **dev build** starts a fresh guest (new `ta_device_secret`), so the colony lands on a planet of the picked type; a production build keeps the guest, whose existing colony keeps its planet. The live online game mounts as the pod falls; at touchdown the browser URL switches to `/play.html` |
| `?scenario=<id>` | `POST /v1/dev/scenarios/<id>` creates a **fresh** planet from `tests/scenarios/<id>.ts` (`w00` = flat radius-56 planet + test entity id 1 at tile 0,0; `w01` / `w01-landfall` = temperate radius-56 planet with colony 0's pod descending at spawn slot 0, stock 600/350/200/200 from the start; the HQ (800/800 E) deploys when the pod opens: the client's `landPod` or `land`) and joins it. Each page load creates a new planet; reconnects in the same page rejoin it |
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
| `?pixel=1\|0`, `?shadow=1\|0`, `?crt=1\|0`, `?daynight=1\|0` | Post-processing / dynamic sun shadow / planetary day-night cycle switches on/off (all 3D pages; bottom-left switches `CRT` [`F9`], `PIXEL` [`F10`], `SHADOW` [`F7`], and `F8` Visual Shader Lab with `'crt'`, `'pixel'`, `'shadow'`, `'daynight'` tabs) |

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
| `time [<hour> \| day <realHours> \| scale <k>]` | Query or configure this planet's authoritative solar clock (`timeOfDay` 0..24h, `realHoursPerDay` 0.005..168h, `timeScale` 0..1000×); synced across server and all connected clients (`setPlanetTime` for a seated colony, `dev.time` without one or via `/v1/dev/commands/time`) | both |
| `tune <table>.<row>.<field> <value>` | Live balance override (design units, D-35), e.g. `tune dev.probe.nudgeTiles 3` or `tune time.cycle.realHoursPerDay 0.5`; prints the new data hash. Resource amounts (`hq.startingKit.cargo`, `hub.t1.cost`, `hub.t1.storageCapPerFamily`, `opsBasic.<op>.yieldAmount`) must be whole, non-negative units with known resource keys: `tune opsBasic.break.yieldAmount 10.5` is rejected with the field and value named, and the planet keeps its data. Generation numbers are not tunable: `tune worldgen.*` (and `terrain.<class>.code`) is rejected with "cannot be tuned" (a planet is generated once from `data/worldgen.ts`) | both |
| `tune reset` / `tune export` | Drop live overrides / print them as `balance.overrides.json`. Every client of the planet follows a `tune` from its `dev.tuned` event: a `set` rebuilds the prediction's data in place (and the placement ghost's `simData`), a `reset` makes the client re-join for a fresh welcome | both |
| `planet [name]` | Print this planet's id and a link that joins it as another player (`?join=<id>&as=<name>`, default `b`); open it in a second browser profile | server |
| `scenario <id>` | Create a fresh planet from a scenario and print its id (local host: restart the local planet from it) | both |
| `planet.wipe <planetId>` | Server dev command `planet.wipe`: delete a held (unloaded) planet with its snapshots, ledger rows and colony rows so the next seat or boot starts it fresh; a loaded planet is refused (409) | server |
| `chain.ping` | Write a ping receipt through the mock chain; prints its `mock:` hash (shows in `/dev/chain/`) | server |
| `near.error <code>` | Force one player-facing NEAR error (`NEAR_PROVIDER_REJECTED` 401, `NEAR_NAME_TAKEN` 409, `NEAR_RELAY_FAILED` 503, `NEAR_RELAY_RECEIVER_NOT_ALLOWED` 403). The HUD toasts that sentence. Any other code is 400 `VALIDATION_ERROR` (W06-19) | server |
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
- **Explorer:** `/dev/chain/`. Contract tests: `npm run test:contract` (mocks; `--port identity,relayer` is a case-insensitive comma list, and an empty `--port` runs every suite), `npm run contract:real -- --port X` (real adapters, from W23).
- **Selection:** `NEAR_ADAPTER_<PORT>=mock|testnet|mainnet` (anything but the exact strings `testnet`/`mainnet` means mock), `AI_PROVIDER`, `NOTIFY_ADAPTER`. Production refuses mocks unless the matching `*_ALLOW_MOCK_IN_PROD=true` is set, and boot names every mocked port.

## REST routes (auth, home & dev; `/v1/dev/*` 404 in production)

| Route | What |
|---|---|
| `GET /v1/healthz`, `/v1/readyz`, `/v1/metrics` | Health, readiness (`{db, simThreads}`; not ready while any sim thread is down: a dead thread is restarted, at most 3 times per 10 min, and its planets restored from their latest snapshots), Prometheus metrics (not dev-only) |
| `POST /v1/auth/guest`, `/v1/auth/refresh`, `/v1/auth/logout` | Guest device-secret auth, refresh token rotation (`httpOnly` cookie), session logout (W01, not dev-only) |
| `GET /v1/me/home[?type=desert\|ocean\|temperate]` | Player home state (`NEW` auto-seats on the first dev planet with a free seat of the asked type, default desert: `pl_dev`, `pl_dev_2` … / `pl_dev_ocean` … / `pl_dev_temperate` … → returns `ACTIVE` with `planet` and `colony`; `type` is ignored once the player has a colony). The landing site is the planet's own sim's answer (`nextLandingSite`); an existing home's planet is loaded (restored from its snapshot) before `ACTIVE` is answered, 503 `HOME_UNAVAILABLE` when it cannot be (held). New colony ids are `co_<ULID>` (W01, not dev-only) |
| `GET /v1/dev/planets` | Loaded planet ids |
| `GET /v1/dev/scenarios`, `POST /v1/dev/scenarios/:id` | List scenarios / create a fresh planet → `{ planetId, scenario, tick }` |
| `GET /v1/dev/commands`, `POST /v1/dev/commands/:name` | List / run server dev commands (`warp`, `time`, `tune`, `scenario`, `chain.ping`, `planet.wipe`, `near.error`). `planet.wipe {planetId}` deletes a held planet (not loaded: corrupt snapshots or from a newer build) with its snapshots, ledger rows and colony rows, so the next seat or boot starts it fresh; 409 for a loaded planet (W01). `near.error` is W06-19 |
| `GET /v1/dev/planets/:planetId/ledger?account=colony:0&limit=10` | The planet's resource ledger (Postgres; in memory with `SNAPSHOTS=off` or under tests) for one account → `{ planetId, account, balances, entries }`: non-zero balances and the last `limit` journal entries touching it (`{ seq, at, reason, actor, ref?, legs }`, oldest first). 404 when the planet is not loaded, 400 for a bad account, 503 `LEDGER_UNAVAILABLE` while the planet's journal is still restoring (answered after at most 2 s) or its restore was abandoned. Used by the console `ledger` (W01) |
| `POST /v1/dev/chain/ping` | Mock chain ping → `ChainReceipt` |
| `POST /v1/dev/mock-oauth/token` | Mock OAuth: `{ provider: 'google'\|'x', subject (1–64), email? }` → `{ token }` (HMAC-SHA256, `MOCK_OAUTH_SECRET`, 5 min). 404 in production, when Identity is not the mock adapter, or when `W06` is off |
| `GET /v1/dev/chain/{receipts,balances,nfts,dao,escrow,outbox}` | Explorer data (`?account=`, `?limit=`, `?status=`, `?collection=`) |
| `POST /v1/analytics/events` | Analytics intake (`AnalyticsBatchV1`, not dev-only) |

## Environment variables

Real environment wins over `infra/.env.worktree`, which wins over `infra/.env` (template: [`infra/.env.example`](../../infra/.env.example)). Only the exact string `true` turns a boolean flag on (exception: `AI_LIVE=1`). An invalid value aborts boot and names the variable.

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
| `PLANET_DAY_HOURS`, `PLANET_TIME_SCALE` | 0.25, 1 | Default real-world hours for 1 full planetary day (24 solar hours) and time-scale multiplier on newly created server planets |
| `TA_BALANCE_OVERRIDES` | — | Path to `balance.overrides.json` merged over the data tables (D-35) |
| `WS_HELLO_TIMEOUT_MS`, `WS_IDLE_TIMEOUT_MS` | 5000, 60000 | Socket timeouts |
| `MOCK_LATENCY_MIN_MS`, `MOCK_LATENCY_MAX_MS`, `MOCK_FAIL_RATE`, `MOCK_SEED` | 300, 1500, 0, — | Mock chain behaviour |
| `MOCK_OAUTH_SECRET` | `terra-dev-mock-oauth-secret` | HMAC secret for the dev mock OAuth token (`signMockToken` / `verifyMockToken`, `/dev/mock-oauth`). Unset or empty uses the default. Not in the Nest boot env schema. Token TTL is 5 minutes |
| `NEAR_KEK` | dev 32-byte `DEV_KEK` (not in production) | Base64 of 32 bytes. Seals ed25519 seeds (AES-256-GCM). Production `loadKekRing` refuses a missing key or `DEV_KEK` |
| `NEAR_KEK_VERSION` | 1 | Integer version stored on new key rows |
| `NEAR_KEK_RING` | — | JSON `{"1":"<base64>",...}` of older keys so a rotated version still decrypts |
| `OUTBOX_RELAY_ENABLED`, `OUTBOX_POLL_MS`, `OUTBOX_LEASE_MS`, `OUTBOX_MAX_ATTEMPTS` | on, 1000, 30000, 8 | Chain outbox relay |
| `NEAR_ADAPTER_<PORT>`, `AI_PROVIDER`, `AI_LIVE`, `NOTIFY_ADAPTER` | mock | Adapter selection (see above) |
| `NEAR_ALLOW_MOCK_IN_PROD`, `AI_ALLOW_MOCK_IN_PROD`, `NOTIFY_ALLOW_MOCK_IN_PROD` | — | Allow mocks in production |
| `ANALYTICS_DISABLED` | — | `true` drops analytics intake |
| `TA_DB_POOL_SIZE` | 20 | Prisma connection pool |
| `TA_DOMAIN` | `terraagent.fun` | Public site domain. `npm run deploy` refuses any other value. Operator `.env`, not the app env schema |
| `DEPLOY_HOST` | empty | SSH host for `npm run deploy`. Empty refuses the deploy and names the variable |
| `DEPLOY_USER` | `deploy` | SSH user. Empty refuses the deploy and names the variable. The script uses the operator's existing key: no `ssh-copy-id`, no `-i` |

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
| `npm run wave`, `npm run wave -- status`, `npm run wave -- land NN` | Wave pipeline: open/resume the next wave and start its runner (`claude`, `agy`, or `grok`; `--runner` overrides, `--model` picks the id); the board; land a checked wave (e.g. `npm run wave -- land 00`). Single steps `wave:open`, `wave:issue`, `wave:issue:land`, `wave:check` (prints the owner check guide `docs/plan/checks/wNN-check.md`), `wave:land` — see the main README |
| `npm run stack:local`, `stack:local:{infra,frontend,backend,chain}` | terraagent.fun on port 80: nginx, static image, app, devchain vhost. No second Postgres. `terra-internal-net` only holds the `terra_internal` network |
| `npm run stack:local:down` | Stop those four compose projects. Leaves the dev Postgres (`terra-pg`, port 15434) running |
| `npm run stack:local:smoke` | DEPLOYMENT §5 curls (`--resolve` to 127.0.0.1), including the explorer page while the app is stopped |
| `npm run deploy`, `deploy:{infra,frontend,backend,chain}` | SSH the stack to `DEPLOY_USER@DEPLOY_HOST`. Compose uses `--env-file /srv/terraagent/.env`. A missing `NODE_ENV` there becomes `production`, and a missing `DATABASE_URL` points at `postgres:5432` on `terra_internal`. Existing keys are left as they are. The operator `.env` is not uploaded. Each stack reloads nginx after its vhosts, then curls. `--dry-run` prints the plan and does not connect. An empty `DEPLOY_HOST` or `DEPLOY_USER` exits non-zero and names the variable |

## W06-14

Account list and receipt detail for the mock chain explorer (`/dev/chain/`). Same guard as the other explorer routes: 404 in production (`DevOnlyGuard`), including when `NEAR_ALLOW_MOCK_IN_PROD=true`, and 404 when ChainRead is not the mock adapter. The Accounts tab lists account id, kind and owner. Balances stay on the Balances tab and are empty until cargo rows exist. The Receipts hash cell links to the receipt page.

| Route or URL | What |
|---|---|
| `GET /v1/dev/chain/accounts` | Player and colony accounts from `chain.mock_chain_account` and `chain.near_colony_account`, one row per account id. Shape `{ accountId, kind, publicKey, ownerAccountId }`. `kind` is the mock row's kind when that row exists (`named` is the player account, `colony` is a colony sub-account). A `near_colony_account` row with `slot` `player` is `named`; any other slot is `colony`, and `ownerAccountId` is that table's owner (null when only the mock row exists). `?account=` is an exact account id. `?limit=` is 1–200, default 50 |
| `GET /v1/dev/chain/tx?hash=` | One receipt. The hash is a query parameter because `mock:` contains a colon. 404 `NOT_FOUND` when no row has that hash. Body: `txHash`, `status` (stored value), `statusLabel` (`FINAL` when stored status is `success`, otherwise the stored status), `signerId`, `receiverId` (payload keys, null when absent), `opId`, `port`, `method`, `blockHeight`, `payload`. Stored status stays `pending`, `success` or `failure` |
| `/dev/chain/tx/<hash>` | Receipt page (`frontend/dev/chain/tx.html`). The hash is URL-encoded (`mock:` → `mock%3A…`). `?hash=` on `/dev/chain/tx` also works. Shows signer, receiver, the `mock:` hash and status `FINAL`. Back link is `/dev/chain/`. Vite dev and preview rewrite `/dev/chain/tx` and `/dev/chain/tx/*` to that page and do not rewrite `/v1` |

## W06-25

Dev console commands for mock-port failure and latency, and for resetting or upgrading a player. They are not player-facing. The client feature is `frontend/game/features/near-dev` (wave `W06`, both hosts). A host with no game server answers `host_unavailable`. The server registers them on `DevCommandRegistry` (`POST /v1/dev/commands/:name`, 404 in production). Port names are case-insensitive (`relayer` matches `Relayer`). An unset port keeps the boot config (`MOCK_FAIL_RATE`, `MOCK_LATENCY_MIN_MS`, `MOCK_LATENCY_MAX_MS`).

| Command | What |
|---|---|
| `near.mock.fail <port> <rate>` | Set the injected fail rate (`0..1`) for one mock port. `1` fails the next call; `0` forces success even when `MOCK_FAIL_RATE` is `1`. |
| `near.mock.latency <port> <minMs> <maxMs>` | Set the sleep range for one mock port. Both bounds are integers ≥ 0, and `maxMs` must be ≥ `minMs` (otherwise 400 `VALIDATION_ERROR`). |
| `account.reset <player>` | Revoke every session of the player (id or handle) and delete that player's `social_identity` rows. The player and their colonies stay. Unknown player: 404 `NOT_FOUND`. |
| `account.upgrade <provider> <subject>` | `provider` is `google` or `x`, `subject` is 1–64 characters. Signs a short-lived mock token and runs social login. Returns `{ playerId, accountId, accessToken }`. When the database is on, this writes `core.social_identity` (W06-06). With the database off, the subject map stays in memory (BE-31). The refresh token is not returned. |

`POST /v1/dev/commands/near.mock.fail` body:

```json
{ "port": "relayer", "rate": 1 }
```

`port` is a non-empty string. `rate` is a number from 0 to 1. `near.mock.fail relayer 0` sends `{ "port": "relayer", "rate": 0 }` and restores success.

A relayer fail rate of 1 throws `NEAR_MOCK_INJECTED_FAILURE` once. The relayer retries once, then the action ends as `NEAR_RELAY_FAILED`. That counts as the action failing.

`POST /v1/dev/commands/near.mock.latency` body is `{ "port": "relayer", "minMs": 0, "maxMs": 0 }`. `account.reset` body is `{ "player": "<id or handle>" }`. `account.upgrade` body is `{ "provider": "google", "subject": "<subject>" }`.

## W06-15

Guest-first pilot chip on the server play page when wave `W06` is on. Hidden on `?host=local` and when `W06` is off.

- **Chip** (`data-testid="pilot-chip"`, top left, order 20): a guest reads `Guest pilot` and has **Save progress** (`data-testid="save-progress"`). After a social login the same chip reads `Pilot ID <accountId>` (`data-testid="pilot-id"`, for example `Pilot ID test-pilot.terraagent.mock`) with no page reload. A copy control is left for W06-16; the id text stays `Pilot ID <accountId>`.
- **Plate**: **Save progress** opens a plate on the page (it does not navigate) with **Continue with Google (mock)** (`data-testid="continue-google"`) and **Continue with X (mock)**.
- **Popup**: either button runs `window.open('/dev/mock-oauth?provider=google|x&return=' + encodeURIComponent(location.pathname + location.search), 'terra-mock-oauth', 'popup,width=480,height=640')`. When that mock page has a same-origin `window.opener`, minting a token `postMessage`s `{ type: 'terra:mock-token', provider, token }` to the opener and `window.close()`s. It does not load the game inside the popup, and it does not navigate the game page. With no opener (the mock page opened directly, or the opener is not same-origin), it still redirects that window to `return#mock_token=…`.
- The play page accepts the message only when `event.origin === location.origin` and `event.source` is the popup it opened, then `POST /v1/auth/social` with `Authorization: Bearer <current access token>` and `credentials: 'include'`. A `200` swaps the session access token (the value later `hello` / `reauth` calls send) and the chip. The already-open socket is not reauthed until its next renewal (FF-34).

## W06-16

The linked pilot chip keeps `Pilot ID <accountId>` (`data-testid="pilot-id"`) and adds **Copy** (`data-testid="pilot-copy"`, `.btn.btn-ghost`). Copy writes only the account id, for example `test-pilot.terraagent.mock`, through `navigator.clipboard.writeText` (a spec can pass another writer into `copyText`). Success sets `data-copied="ok"` on the button. A rejected write sets `data-copied="fail"`, selects the id text, and does not throw. A guest chip still shows `Guest pilot · Save progress` (`data-testid="pilot-chip"`, `data-testid="save-progress"`).

## W06-19

Dev console `near.error <code>` forces one player-facing NEAR error. The client feature is `frontend/game/features/near-errors` (wave `W06`, both hosts). It is hidden when `W06` is off. Open the console with the `` ` `` key on `/play.html` and type, for example, `near.error NEAR_NAME_TAKEN`.

The command calls `POST /v1/dev/commands/near.error` with `{ "code": "<CODE>" }`. The server throws `NearException` for the four codes below. The global filter answers `{ errorCode, error: { code, message }, requestId }` with that code's HTTP status. `error.message` is the toast sentence. Any other code, including other `NEAR_*` codes, is 400 `VALIDATION_ERROR` and is not toasted. A host with no game server (`?host=local`, or the in-browser fallback) answers `host_unavailable` and shows no plate.

The plate is this feature's own HUD slot: bottom left, order 80 (there is no bottom-centre slot). One plate at a time (`data-testid="near-toast"`, `data-code="<CODE>"`). A click dismisses it. The next code replaces it. The sentence is looked up on the client from the same four lines as `NEAR_ERROR_CODES`; it does not mention a wallet, gas, a transaction, a seed, or a private key.

| Code | Status | Toast |
|---|---|---|
| `NEAR_PROVIDER_REJECTED` | 401 | That sign-in could not be confirmed. Try again. |
| `NEAR_NAME_TAKEN` | 409 | That Pilot ID is already in use. |
| `NEAR_RELAY_FAILED` | 503 | Couldn't save to orbit. Retrying. |
| `NEAR_RELAY_RECEIVER_NOT_ALLOWED` | 403 | That save is not allowed for this colony. |

`near.mock.fail`, `near.mock.latency`, `account.reset`, and `account.upgrade` are unchanged (W06-25).

## W06-12

Creating a colony sub-account enqueues one NEP-145 `storage_deposit` in `chain.chain_outbox`, in the same database transaction as the `near_colony_account` row. The player row (`slot` `player`) does not get one. A later login enqueues only when that outbox row is missing (the same `opId` is a no-op). The relay is off when `NODE_ENV=test` unless `OUTBOX_RELAY_ENABLED=true`.

| Field | Value |
|---|---|
| `opId` | `storage-deposit:{colonyAccountId}` from `storageDepositOpId` (for example `storage-deposit:co_….test-pilot.terraagent.mock`) |
| `port` / `method` | `Relayer` / `submitMetaTx` |
| payload `signerId` | `relayer.terraagent.mock` (`MOCK_RELAYER_ACCOUNT`). The relayer pays |
| payload `receiverId` | `res.terraagent.mock` (`MOCK_CARGO_CONTRACT`) |
| payload `signedDelegate` | JSON string `{"action":"storage_deposit","account_id":"<colony account id>"}` |

The relay calls `RelayerPort.submitMetaTx`. The mock receipt `txHash` starts with `mock:`. Its payload signer is the relayer and its receiver is `res.terraagent.mock`. When `signedDelegate` is that JSON, the receipt payload also has `action: "storage_deposit"` and `account_id` set to the colony account id. A non-JSON delegate does not add those fields. Submitting the same caller `opId` again (a relay retry, or a process restart after the receipt committed) does not write a second receipt. `/dev/chain/tx/<hash>` shows that payload (`GET /v1/dev/chain/tx?hash=` because `mock:` contains a colon).
