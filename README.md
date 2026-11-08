# TerraAgent

Autonomous colony builder in the browser: drop one robot on a live planet, set priorities, and the colony keeps mining, building and defending while you are away. One shared game engine (`@terra/sim`) runs on the server, in the browser as a replica with client-side prediction, and as a single-player local host. The economy runs on NEAR (mocked in phase 1, D-30).

**Stack:** Vite + TypeScript + Three.js (WebGL2) client with a vanilla-DOM HUD · one NestJS app with sim worker threads · PostgreSQL (Prisma) · npm workspaces.

> **Status:** waves W00 (platform skeleton), W01 (landfall), W02 (first light), and W26 (public hosts) landed — the rails, first playable loop, a living economy (resources, power, day/night, order queue), and the hosting front door. Gameplay and on-chain features arrive across 27 product waves (`W00`–`W26`) ([`docs/plan/PRODUCT_WAVES.md`](./docs/plan/PRODUCT_WAVES.md)).

## Quick start: do X → see Y

Needs Node 22+ (24 tested), npm 10+, Docker (for Postgres on port 15434), and Chrome for the e2e and parity suites.

```bash
npm ci
npm run dev            # → Postgres (docker, :15434), the app (:4001) and the client (:5173) start together
```

| Do | See |
|---|---|
| `curl 127.0.0.1:4001/v1/healthz` and `/v1/readyz` | `{"ok":true}` and `{"db":"ok","simThreads":N}` (N = cores − 1 unless `SIM_THREADS` is set) |
| Open http://127.0.0.1:5173/play.html?scenario=w00 | A flat hex planet; the HUD `TICK` chip rises about 5 per second |
| Press `` ` `` and type `warp 10` (`warp 1` to undo) | The tick rate rises to about 50/s and a `×10` badge appears |
| Add `&waves=..00` to the URL | `W00` on, every later wave off |
| `npm run dev:restart` while the page is open | "Reconnecting…", then the tick continues from the saved snapshot, not 0 |
| Open http://127.0.0.1:5173/dev/chain/ in a second tab, then run `chain.ping` in the play page's dev console (or press `CHAIN.PING` on the explorer) | A `mock:` receipt appears in the explorer after 300–1 500 ms |
| Stop the app; open `/play.html?host=local&scenario=w00` | The same planet runs in the browser alone; a reload resumes from IndexedDB |
| `/play.html?scenario=w00&lag=300`, then `nudge 1` in the console (the scenario's test entity) | The robot moves on the next frame (client-side prediction); `teleport! 1 6 0` (server-only) blends over 150 ms |
| `npm run ci:fast` / `npm run e2e -- --waves ..00` | Green checks / the W00 demo in headless Chrome |

The wave file [`docs/plan/waves/W00-platform-skeleton.md`](./docs/plan/waves/W00-platform-skeleton.md) has the full demo story. **Every URL parameter, dev console command, dev page, mock-chain detail, env variable and debug handle is in [`docs/dev/DEV_TOOLS.md`](./docs/dev/DEV_TOOLS.md).**

## Commands

```bash
npm run dev            # Postgres + app + Vite (ports from TA_PORT_BASE: app base+1, client base+1173)
npm run dev:restart    # restart only the app (SIGTERM → snapshot → start), Vite keeps running
npm run dev:client     # Vite only, no backend (prototype pages, playground, landing)
npm run check          # typecheck + lint + check:structure + gen:check
npm test               # unit tests (no Postgres)
npm run test:integration   # tests against a fresh, throwaway Postgres database
npm run test:contract  # NEAR port contract suites against the mocks
npm run e2e -- --waves ..00 [--hack] [--host local]   # headless-Chrome wave suites
npm run test:parity    # same scenario + command log on the server host and the browser host
npm run ci:fast        # check + unit + build
npm run build          # typecheck + check:structure + vite build → frontend/dist/
npm run gen            # regenerate registries (command/event kinds, sim systems, data tables, Prisma schema)
npm run db:up | db:gen -- --name x | db:migrate | db:reset | db:seed
npm run scenario -- w00    # run a scenario headless
npm run wave           # work on the next wave of the build plan (see "Building the game: waves")
npm run wave:land -- <NN>              # Mode 1 ("merge wave into main"): 3-iteration audit/test/E2E loop, auto-heal conflicts, merge --no-ff to main, tag wave-NN, push, cleanup + future-wave propagation
npm run wave:sync -- <NN|--all> [--sync-issues]  # Mode 2 ("merge main into wave"): merge updated main into WIP wave worktree (and active issue/WNN-XX worktrees) with 3-iteration verification
npm run wave:audit -- <NN> [--sync]    # semantic collision scan (ECS codes, migrations, Q&L/Decision IDs, unlanded issues) + as-built scope delta
npm run wave:propagate -- <NN> [--add-issue WMM ...]  # post-merge self-review feature audit & safe issue injection into downstream future wave plans (`docs/plan/waves/W*.md`)
npm run validate:wave -- [NN] [--gates] [--strict]   # pre-landing wave validator (task parity, AST duplication, orchestrator/service split, client+server wiring)
npm run validate:models -- <id|--category robot|--all>   # kitbash geometry/colour/detail validator
```

Open http://127.0.0.1:5173/. That page is the **hub** and links to everything below.

## Repository layout

The repository root follows the clean root rule (D-41), keeping only agentic files (`.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`), `README.md`, git files (`.git`, `.github/`, `.gitignore`), `LICENSE`, `package.json` (`package-lock.json`), and the 7 domain directories:

```
shared/        code used by frontend and backend (D-32)
  contracts/   @terra/contracts — zod schemas: WS envelope + messages, command/event kinds (one file each), REST DTOs
  config/      @terra/config    — zod env loader merged per module, fail-closed flags, shared eslint/prettier configs
  db/          @terra/db        — Prisma schema per module (merged), numbered migrations, client, test-DB harness
  ledger/      @terra/ledger    — double-entry resource accounting types and math
  sim/         @terra/sim       — the one engine (D-31): kernel, systems registry, data tables, codec, SimHost
backend/app/   @terra/app — the one NestJS app (D-24): modules auto-discovered from src/<name>/<name>.module.ts
               core · db · flags · bus · game (sim threads, scheduler, deltas, snapshots) · ws · dev · near · ai · notify · analytics
frontend/      one Vite app (root of frontend/vite.config.ts); URLs mirror the file layout
  game/        @terra/game — net/ (transport) · store/ (sim worker) · core/ (registry, HUD, flags) · features/ · dev/ · app/
  render/      @terra/render — 3D render engine (viewport, kitbash, terrain, planets incl. hex/, orbit, descent, lighting)
  landing/  playground/  pitchdeck/  whitepaper/  design/
tests/         test suites and test configs
  e2e/         Playwright headless-Chrome harness + one suite per wave (`tests/e2e/`)
  scenarios/   seed scenarios (`tests/scenarios/`, `?scenario=wNN`, `npm run scenario`)
  vitest*.config.ts  unit, integration, and contract test configs
infra/         docker-compose (dev Postgres), environment templates (`infra/.env.example`, `infra/.env.worktree`), nginx hosts
scripts/       dev runner, codegen, structure check, wave pipeline
docs/          game design, specs (start with docs/spec/DECISIONS.md), build plan, 3D rules
```

## Integrations: mock or real

Every NEAR feature, the LLM director and notifications sit behind ports (abstract classes) with fail-closed adapter selection (`NEAR_ADAPTER_<PORT>=mock|testnet|mainnet`, `AI_PROVIDER`, `NOTIFY_ADAPTER`; production refuses mocks unless `*_ALLOW_MOCK_IN_PROD=true`). Details: [`backend/app/src/near/README.md`](./backend/app/src/near/README.md).

| Port | Feature | Adapter today | Real adapter |
|---|---|---|---|
| ChainRead | receipts, health | mock (Postgres) | W23 |
| BadgeNft | achievements | mock (Postgres, NEP-171) | W23 |
| Identity, Relayer | F5 accounts, gasless tx | mock (Postgres) | W23 |
| CargoToken | F1 cargo (NEP-245) | — (W10 mock) | W23 |
| Intents | F2 markets | — (W13 mock) | W23 |
| AgentWallet | F3/F4 | — (W15 mock) | W23 |
| DeedNft, Staking | F6 | — (W20 mock) | W23 |
| TreasuryDao, Escrow | F7/F8 | — (W22 mock) | W23 |
| LlmProvider | AI director | — (W16) | Z.ai `glm-5.3` |
| Notifier | push / Telegram | — (W09) | Web Push, Telegram |

W25 finalises this table for the submission. W06's adapter variables and their defaults are in [`docs/dev/ENVS.md`](./docs/dev/ENVS.md).

## Pages

All pages are entries of one Vite app (see `rollupOptions.input` in [`frontend/vite.config.ts`](./frontend/vite.config.ts)) and share the **Faction Plate** design system.

| URL | File | What it is | Code |
|---|---|---|---|
| `/` | [`frontend/index.html`](./frontend/index.html) | **Hub.** Cards linking to Landing, Play, Playground and the design system, with deep links to each world and a few models. Static HTML + CSS, no JS. | — |
| `/landing.html` | [`frontend/landing.html`](./frontend/landing.html) | **Landing** (terraagent.com): hero = the game's real orbit stage (morphs between the 3 worlds every 10 s, terraforming each in 4 steps; `?world=<kind>` picks the start), Canvas 2D hex colony, economy, planets, AI Director, FAQ. Planet cards render the real `PlanetGlobe`; sections 07 Roadmap (scroll-driven flight plan, `frontend/landing/sections/roadmap.ts`) and 08 Road to market (route + split-flap lane board); the economy section has resource tabs (Metals default) with a live 3D model and technical sheet. | [`frontend/landing/`](./frontend/landing/) (`main.ts` → `LandingPage`; `sections/`, `hero/`, `colony/`, `resources/`), CSS [`landing.css`](./frontend/landing/landing.css) |
| `/play.html` | [`frontend/play.html`](./frontend/play.html) | **Game**: orbital world picker → drop-pod descent cinematic → colony diorama with RTS camera and HUD. | [`frontend/game/main.ts`](./frontend/game/main.ts) → [`frontend/game/app/Game.ts`](./frontend/game/app/Game.ts), UI in [`frontend/game/ui/`](./frontend/game/ui/) |
| `/playground.html` | [`frontend/playground.html`](./frontend/playground.html) | **3D playground**, a storybook for 3D models: every registered kitbash archetype on a calibrated pedestal, 4 diagnostic views, biome switch, triangle budget and ground-contact checks. | [`frontend/playground/PlaygroundApp.ts`](./frontend/playground/PlaygroundApp.ts) |
| `/design/` | [`frontend/design/index.html`](./frontend/design/index.html) | **Design system** reference: Foundations, Storybook (UI components), Motion. | [`frontend/design/`](./frontend/design/) |

### URL parameters

| Page | Parameter | Effect |
|---|---|---|
| Landing | `?hero=robot\|world\|director` | Hero headline variant. |
| Play | `?planet=dune\|oceanForest\|forestRock` | Preselect a world in the orbit menu. |
| Play | `&seed=<n>` | World seed (default per planet: 1101 / 2202 / 3303). |
| Play | `&deploy=1` | Deploy immediately (plays the descent). |
| Play | `&skip=1` | Deploy and skip the descent, straight into gameplay. |
| Play | `&t=<seconds>` | Deploy and fast-forward the descent by `t` seconds. |
| Play (online) | `?scenario=<id>` | Online flow: create a fresh planet from `tests/scenarios/<id>` (e.g. `w00`) and join it; skips the prototype menu and descent. |
| Play (online) | `?host=local` | Run the engine in the browser alone (no app or Postgres); snapshots in IndexedDB. Needs `&scenario=w00\|w01`: `?host=local` alone opens the prototype world picker. |
| Play (online) | `&waves=..NN` / `&waves=00,03` | Dev: narrow the enabled waves (never wider than the server's set). |
| Play (online) | `&lag=<ms>` | Dev: delay the connection both ways (prediction testing). |
| Play (online) | `&predict=0` | Turn client-side prediction off (interpolate 400 ms behind). |
| Play (online) | `&as=<name>` | Dev session name (`dev:<name>` token). |
| Play (online) | `&dev=1` | Dev console in a non-dev build. |
| Playground | `?inspect=<archetype id>` | Select a model, e.g. `robot.hero`, `building.commandHub`, `ship.carrier`. |
| Playground | `&biome=dune\|oceanForest\|forestRock` | Pedestal / sky / weathering biome. |
| Playground | `&view=iso\|front\|side\|top` | Camera view. |
| Playground | `&turntable=1`, `&surface=1`, `&pixel=1` | Auto-rotate; real planet surface instead of the pedestal; pixel-art shader. |
| Playground | `&hexterrain=1` | Hex terrain sample scene instead of the pedestal (every tile class, deposits, Prepared tiles drawn as plain flat ground (RN-29), a tier 1/2/3 Metals deposit row at axial (-4,4) / (-3,4) / (-2,4) in front of the model, two colonies' borders). |
| Playground | `&build=0\|33\|66`, `&work=1`, `&workTarget=<kind>` | Construction scaffold stage of the shown models (toolbar `build` cycles it); biped work pose (`uWorkWeight` 1) + 3D object-of-interaction particle emitter (`tree\|rock\|dune\|hole\|flat\|metals\|minerals\|oil\|repair`). |
| Playground | `&depositStage=full\|half\|depleted` (alias `&stage=`), `&tileState=prepared\|irrigated\|living\|mixed` (alias `&tilestate=`), `&lights=1` | Preview 3-stage resource deposit depletion (`full`, `half`, `depleted`); preview hex terrain preparation states (`prepared`, `irrigated`, `living`, `mixed`); open the interactive 3D `LIGHTS` editor panel (`[L]`). |
| Playground | `&faunaScene=blackAnt\|blueBeetle\|greenSpitter\|mixed`, `&faunaMode=passive\|aggressive\|gallery\|bugs\|robots`, `&faunaSeed=<int>` | Seeded W07 hive-life scene fixtures (`blackAnt`, `blueBeetle`, `greenSpitter`, `mixed`) with **Bugs attack / Robot attacks** radios (bugs attack by default), state-driven melee/spit/hit/death animation, deterministic tick stepping (`PAUSE`/`STEP`/`RESET`), a stationary **SHOOTING GALLERY** (five unit/turret–bug pairs), passive/aggressive life, and `ACID PREVIEW`. Legacy `turrets`/`units` URLs open the gallery. |
| Playground | `&march=own\|together`, `&marchRock=1` | Group march: 30 units (29 HQ drones and one tank) walk to one hex through the sim `moveGroup` order. `together` holds them to the slowest unit. `marchRock=1` blocks that hex with rock so they stand around it. Panel: OWN PACE, TOGETHER, ROCK, ORDER, PAUSE, +1 STEP, RESET. |
| All 3D pages | `?pixel=1\|0`, `?shadow=1\|0`, `?crt=1\|0`, `?daynight=1\|0` | Enable or disable the pixel-art post-processing shader, dynamic sun shadows, CRT scanline overlay, or orbital day/night cycle. |

### Controls

- **Game (online, dev):** `` ` `` opens the dev console (`help` lists the commands of the enabled waves: `warp`, `time`, `spawn`, `nudge`, `teleport`, `tune`, `scenario`, `chain.ping`, `flags`, …). LMB on a tile logs its `q, r`. Command dock (bottom left): `B` Build · `U` Production · `T` Terraform tab; `G` TERRAFORM · `R` REPAIR (rotates a building ghost while one is up) · `X` DISMANTLE (X also stops the selected unit) arm the terraform tool, Esc / right-click disarms it; `Q` collapses the queue. Full list: [`docs/dev/DEV_TOOLS.md`](./docs/dev/DEV_TOOLS.md) → HUD and overlays.
- **Game (prototype):** LMB move hero · WASD / edge pan · MMB drag · wheel zoom · Q/E rotate · Home or F re-follows hero (any manual pan stops following) · Esc pause. Online colony: right-click moves the selected HQ · X stops it. During the descent: Esc / Space skips.
- **Playground:** `[` `]` cycle models · `1`–`4` views · `T` turntable · `F` focus · `WASD` move · `Q`/`E` rotate · `B` bloom · `P` pixel art · `R` spawn the whole category in a row · `V` validate (outline floating/overlapping parts) · `/` search · double-click to refocus. Wireframe and the 1.8 m human are Look-tab buttons. CRT, PIXEL, SHADOW and F8 sit at the bottom-left of the picture, the same switches as the game. The left sidebar tabs are HIVE, MARCH and UNITS. The calibration grid stays on.
- **Landing, Playground and Game:** `F7` toggles dynamic sun shadows ([`frontend/render/core/shadowConfig.ts`](./frontend/render/core/shadowConfig.ts)) · `F9` toggles the CRT overlay ([`frontend/render/ui/crt.ts`](./frontend/render/ui/crt.ts)) · `F10` toggles the Pixel-Art shader ([`frontend/render/ui/pixelArt.ts`](./frontend/render/ui/pixelArt.ts), [`frontend/render/core/pixelArtPass.ts`](./frontend/render/core/pixelArtPass.ts)) · `F8` (or `Shift+P`) opens/closes the floating 7-tab Visual Shader Lab dialog (`CRT`, `PIXEL`, `SHADOW`, `DAY/NIGHT`, `WIND`, `WATER`, `PERF`; [`frontend/render/ui/visualLabTabs.ts`](./frontend/render/ui/visualLabTabs.ts), [`frontend/render/ui/pixelDialog.ts`](./frontend/render/ui/pixelDialog.ts), [`frontend/render/core/dayNightConfig.ts`](./frontend/render/core/dayNightConfig.ts)).

## Design system: Faction Plate

Defined in [`frontend/design/css/tokens.css`](./frontend/design/css/tokens.css) (`--ta-*` variables) and [`base.css`](./frontend/design/css/base.css) (buttons, plates, inputs, badges). Every page imports both.

- **Colour ratio 60 / 25 / 10 / 5:** void black `#07080A` · hull white `#F2F4F7` · ignition orange `#FF6A13` (action, selection, player faction) · signal blue `#1E5BFF` (systems, AI, reference). Support: `--ta-energy` (power), `--ta-terra` (ok), `--ta-fault` (error).
- **Never white text on orange** (2.9:1). Use void text on orange.
- **Chamfered plates, never rounded corners:** `.plate`, `.plate-sm`, `.plate-lg`, `.btn`.
- **Type:** Chakra Petch (display, readouts), IBM Plex Sans (body), IBM Plex Mono (labels, telemetry, data).

The in-world 3D look (models, shaders, lighting) follows the 4 visual pillars in [`AGENTS.md`](./AGENTS.md).

## Building the game: waves

The online game is built in **27 product waves** (`W00`–`W26`) ([`docs/plan/PRODUCT_WAVES.md`](./docs/plan/PRODUCT_WAVES.md), one file per wave in [`docs/plan/waves/`](./docs/plan/waves/)). Every wave ends in a working, tested app and lands in `main` only after you have played its demo. The waves build on the existing 3D renderer in `frontend/render` and the prototype views in `frontend/game`; they extend them, never replace them (PRODUCT_WAVES §4 "One renderer").

**Two commands:**

```bash
npm run wave            # lands completed waves whose dependencies are in main, then resumes the open wave or opens the next one whose dependencies have all landed in main
npm run wave -- status  # full board: state, issue progress (done/total), preset (runner:model, effort, parallel) & track
```

**Single steps** (the same pipeline, one command each; add `--dry-run` to preview, `--root <dir>` or `TA_WAVE_ROOT` to run against a sandbox clone, `npm run test:wave` tests them in one):

```bash
npm run wave:open -- 07              # open (only once every dependency is in main) or resume the wave worktree; no agent started
npm run wave:issue -- W07-03         # ../TerraAgent-wt/W07-03 on issue/W07-03 from the wave branch (node_modules cloned)
npm run wave:issue:land -- W07-03    # gates, then `git merge --no-ff` as "W07-03: <title>"; removes worktree + branch; stops on a conflict
npm run wave:validate -- 07          # full 2-iteration pre-landing review & fix loop (or `npm run validate:wave -- 07 [--gates]`; or tell your agent: "validate the wave")
npm run wave:check -- 07             # merge main in, ci:fast + e2e --waves ..07 --hack, prints the demo story and ?scenario=w07 URL
npm run wave:land -- 07              # Mode 1 ("merge wave into main"): refuses unless every depended-on wave is in main; runs 3-iteration semantic audit + ci:fast + e2e loop, auto-heals generated files, merges --no-ff to main, tags wave-07 (or wave-07.k), pushes, cleans up, and propagates self-review feature extensions into future wave plans
npm run wave:sync -- 07 [--sync-issues]  # Mode 2 ("merge main into wave", alias `wave -- merge-main 07` or `--all`): saves recovery ref `refs/wave-sync-backup/W07`, merges updated main into WIP wave worktree (and active `issue/W07-XX` worktrees) with generated-file auto-heal, runs 3-iteration verification, and reports new/modified `W07-XX` issues from main
npm run wave:audit -- 07 [--sync]    # scan ECS codes, Prisma migrations, Q&L/Decision IDs, unlanded issue branches, and as-built scope deltas
npm run wave:propagate -- 07 [--add-issue WMM ...]  # inspect self-review extensions in W07 and inject new integration issues into downstream future waves (`docs/plan/waves/W*.md` + `index_waves.py --write`)
```

Every worktree these scripts create gets a gitignored `infra/.env.worktree` with its own `TA_PORT_BASE` (4100, 4200, …) and `TA_DB_NAME=terra_<branch>`.

Every wave has a built-in preset in [`scripts/wave/prompt.mjs`](./scripts/wave/prompt.mjs) that automatically selects the runner (`agy`, `claude`, or `grok`), worker + advisor (`agy:argon` with `flash` subagents, `claude:sonnet+opus` for standard waves, or `claude:opus+fable` for complex waves via `--advisor`, using each model's default effort), execution mode (`auto`), parallel subagent factor (`2`–`6`), serial plan gate (`serial-spine` or `contract-first`), and domain skills. Override the runner with `--runner agy|claude|grok`. `--runner grok` maps an opus/fable/argon preset to `grok-4.7` and a sonnet/flash preset to `grok-4.7-build-fast`; pass `--model grok-4.6` (or any id from `grok models`) to pick one yourself. Grok has no advisor flag, and its session starts with a 500k context window.

**Your loop:**

1. Run `npm run wave` and let the wave lead session build its issues.
2. At any point before landing, tell your coding agent **"validate the wave"** (or run `npm run validate:wave` / `npm run wave:validate -- NN`) to execute the 2-iteration pre-landing review-and-fix harness (`wave-landing-validator`: compares against the initial wave task, fixes gaps, eliminates AST duplication, enforces the orchestrator/service split, and verifies client + server + shared sim parity).
3. When it finishes, it hands you an **owner check guide**, `docs/plan/checks/wNN-check.md` (also printed by `npm run wave:check -- NN`): the exact URLs with this worktree's ports, where to type (the in-game dev console is the `` ` `` key), what to see, step by step. Follow it on the running dev stack. Example: [`docs/plan/checks/w00-check.md`](./docs/plan/checks/w00-check.md).
4. All good → land it: tell your coding agent **"merge wave into main"** (or run **`npm run wave:land -- NN`** / **`npm run wave -- land NN`**). That activates `wave-land-and-sync` (Mode 1), auto-heals generated registry/schema conflicts, runs a **3-iteration** semantic collision + test/E2E + as-built audit loop, merges `--no-ff` into `main`, tags `wave-NN`, pushes, removes the worktree and branch, and propagates new self-review features into downstream future wave plans (`docs/plan/waves/W*.md`, `PRODUCT_WAVES.md`, `DEV_TOOLS.md`, `DECISIONS.md`, `questions-and-limitations/*.md`, `ISSUE_INDEX.md`, `HACKATHON_SCHEDULE.md`). Plain `npm run wave` does the same for every completed wave whose dependencies are in `main`, then opens the next ready wave. Something wrong → tell the wave lead which step and what you saw.
5. Whenever `main` advances while a wave is still WIP in `../TerraAgent-wt/wNN`, tell your coding agent **"merge main into wave"** (or run **`npm run wave:sync -- NN [--sync-issues]`** / **`npm run wave:sync -- --all`**). That activates `wave-land-and-sync` (Mode 2), saves a recovery ref (`refs/wave-sync-backup/WNN`), merges updated `main` into `wave/wNN-<slug>` (and active `issue/WNN-XX` sub-worktrees) with generated-file auto-heal, runs the 3-iteration verification loop, and reports any new or updated `WNN-XX` issues added to `WNN` on `main`.

**Plan files:** the hackathon cut and drop order are in [`HACKATHON_CUT.md`](./docs/plan/HACKATHON_CUT.md), the generated start order in [`HACKATHON_SCHEDULE.md`](./docs/plan/HACKATHON_SCHEDULE.md), your to-dos and open decisions in [`OWNER_TASKS.md`](./docs/plan/OWNER_TASKS.md). After editing a wave file, run `python3 scripts/plan/index_waves.py` (must print `problems 0`) and `--write` to regenerate the index and schedule.

## Adding a 3D model

1. Register an archetype in `frontend/render/kitbash/archetypes/…` (via `ArchetypeCatalog.register`) following the `procedural-kitbash-3d` skill.
2. Open `/playground.html?inspect=<your.id>`. It appears in the sidebar automatically.
3. Run `npm run validate:models -- <your.id>`: it must report 0 errors and 0 warnings (floating parts, gaps, z-fighting, parts cutting through each other, animated parts hitting something, wheels/chassis/arm in one colour, a solar panel that is a flat slab, blank faces). Name your parts; colour roles come from names, and a foundation slab or free-ended whip/tendril also needs `role: 'plinth' | 'plinthDetail' | 'whip'` in its part options. Add `&validate=1` to the playground URL (or press `V`) to see offending parts outlined and numbered.
4. Check all four views (`1`–`4`), ground contact (`minY 0.000` ✔) and the triangle count against the 3.5k budget.

## Pre-window baseline (hackathon disclosure)

The NEAR hackathon window opens on 2026-11-01. Everything below existed **before** the window and is disclosed as the pre-window baseline: the `frontend/` prototype as of commit `3fe9952` on `main` (2026-10-30) —

- the pages `/`, `/landing.html`, `/play.html` (orbit menu → drop-pod descent → decorative colony diorama, client-only), `/playground.html`, `/design/`;
- the render engine `frontend/render/` (viewport, kitbash archetypes and their validator, unified material, terrain/water, planets and globes, orbit stage, descent rig, lighting, CRT overlay);
- the landing site and the Faction Plate design system;
- the specs and the build plan in `docs/`.

Everything server-side, the shared engine (`shared/`), the online play flow, the NEAR ports and mocks, the dev tools and the test/CI harness are built inside the window, wave by wave from W00. `git log` shows the history; every wave lands as a tagged merge commit (`wave-NN`).

## Libraries

Three.js · Vite · TypeScript · NestJS · `ws` · Prisma + PostgreSQL · zod · `@msgpack/msgpack` · pino · prom-client · ulid · Vitest · Playwright · ESLint · Prettier · SWC (`@swc-node/register`, `unplugin-swc`) · concurrently/tsx (dev scripts). Fonts: Chakra Petch, IBM Plex Sans/Mono.

## AI-generated code

This project is built with AI coding agents (Claude Code) working from the specs in `docs/`, one issue per agent in its own git worktree, with a human owner reviewing and play-testing every wave before it lands on `main` ([`docs/plan/PRODUCT_WAVES.md`](./docs/plan/PRODUCT_WAVES.md) §7). Commits carry `Co-Authored-By` trailers.

## License

[MIT](./LICENSE).

## Docs

Everything that is not code is in [`docs/`](./docs) (index: [`docs/README.md`](./docs/README.md)).

- [`AGENTS.md`](./AGENTS.md): rules for AI agents (visual pillars, skill routing, pages). [`CLAUDE.md`](./CLAUDE.md): Claude Code entry point.
- [`docs/game/`](./docs/game): game design, economy, units and the NEAR features.
- [`docs/spec/`](./docs/spec): online architecture; start with `DECISIONS.md`. Built wave by wave.
- [`docs/plan/`](./docs/plan): the hackathon cut and the wave plan (27 waves).
- [`docs/hackathon/`](./docs/hackathon): NEAR hackathon strategy pack, pitch deck, whitepaper, rubrics, launch playbook.
- [`docs/coverage/`](./docs/coverage): unit test coverage baseline and reports.
- [`docs/visuals/`](./docs/visuals): 3D coding rules, the AI-mesh pipeline, procedural textures, shaders and lighting.
- [`docs/dev/DEV_TOOLS.md`](./docs/dev/DEV_TOOLS.md): dev tools reference — URL parameters, dev console, dev pages and routes, mock blockchain, env variables, debug handles, test commands.
- [`docs/questions-and-limitations/`](./docs/questions-and-limitations): known limitations, deliberate trade-offs, and open questions per area.
