# TerraAgent

Autonomous colony builder in the browser: drop one robot on a live planet, set priorities, and the colony keeps mining, building and defending while you are away. One shared game engine (`@terra/sim`) runs on the server, in the browser as a replica with client-side prediction, and as a single-player local host. The economy runs on NEAR (mocked in phase 1, D-30).

**Stack:** Vite + TypeScript + Three.js (WebGL2) client with a vanilla-DOM HUD · one NestJS app with sim worker threads · PostgreSQL (Prisma) · npm workspaces.

> **Status:** wave W00 (platform skeleton) — the rails every later wave runs on. Gameplay arrives wave by wave ([`docs/plan/PRODUCT_WAVES.md`](./docs/plan/PRODUCT_WAVES.md)).

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
| Open the flag panel (top right) or add `&waves=..00` | `W00` on, every later wave off |
| `npm run dev:restart` while the page is open | "Reconnecting…", then the tick continues from the saved snapshot, not 0 |
| Open http://127.0.0.1:5173/dev/chain/ and run `chain.ping` in the dev console | A `mock:` receipt appears after 300–1 500 ms |
| Stop the app; open `/play.html?host=local&scenario=w00` | The same planet runs in the browser alone; a reload resumes from IndexedDB |
| `/play.html?scenario=w00&lag=300`, then `nudge 1` in the console (the scenario's test entity) | The robot moves on the next frame (client-side prediction); `teleport! 1 6 0` (server-only) blends over 150 ms |
| `npm run ci:fast` / `npm run e2e -- --waves ..00` | Green checks / the W00 demo in headless Chrome |

The wave file [`docs/plan/waves/W00-platform-skeleton.md`](./docs/plan/waves/W00-platform-skeleton.md) has the full demo story.

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
npm run build          # typecheck + check:structure + vite build → dist/
npm run gen            # regenerate registries (command/event kinds, sim systems, data tables, Prisma schema)
npm run db:up | db:gen -- --name x | db:migrate | db:reset | db:seed
npm run scenario -- w00    # run a scenario headless
npm run wave           # work on the next wave of the build plan (see "Building the game: waves")
npm run validate:models -- <id|--category robot|--all>   # kitbash geometry/colour/detail validator
```

Open http://127.0.0.1:5173/. That page is the **hub** and links to everything below.

## Repository layout

```
shared/        code used by frontend and backend (D-32)
  contracts/   @terra/contracts — zod schemas: WS envelope + messages, command/event kinds (one file each), REST DTOs
  config/      @terra/config    — zod env loader merged per module, fail-closed flags
  db/          @terra/db        — Prisma schema per module (merged), numbered migrations, client, test-DB harness
  sim/         @terra/sim       — the one engine (D-31): kernel, systems registry, data tables, codec, SimHost
backend/app/   @terra/app — the one NestJS app (D-24): modules auto-discovered from src/<name>/<name>.module.ts
               core · db · flags · bus · game (sim threads, scheduler, deltas, snapshots) · ws · dev · near · ai · notify · analytics
frontend/      one Vite app (root of vite.config.ts); URLs mirror the file layout
  game/        @terra/game — net/ (transport) · store/ (sim worker) · core/ (registry, HUD, flags) · features/ · dev/ · app/
  render/      @terra/render — 3D render engine (viewport, kitbash, terrain, planets incl. hex/, orbit, descent, lighting)
  landing/  playground/  design/
scenarios/     seed scenarios (`?scenario=wNN`, `npm run scenario`)
e2e/           headless-Chrome harness + one suite per wave
infra/         docker-compose (dev Postgres)
scripts/       dev runner, codegen, structure check, wave pipeline
docs/          game design, specs (start with docs/spec/DECISIONS.md), build plan, 3D rules
```

## Integrations: mock or real

Every NEAR feature, the LLM director and notifications sit behind ports (abstract classes) with fail-closed adapter selection (`NEAR_ADAPTER_<PORT>=mock|testnet|mainnet`, `AI_PROVIDER`, `NOTIFY_ADAPTER`; production refuses mocks unless `*_ALLOW_MOCK_IN_PROD=true`). Details: [`backend/app/src/near/README.md`](./backend/app/src/near/README.md).

| Port | Feature | Adapter today | Real adapter |
|---|---|---|---|
| ChainRead | receipts, health | mock (Postgres) | W23 |
| BadgeNft | achievements | mock (Postgres, NEP-171) | W23 |
| Identity, Relayer | F5 accounts, gasless tx | — (W06 mock) | W23 |
| CargoToken | F1 cargo (NEP-245) | — (W10 mock) | W23 |
| Intents | F2 markets | — (W13 mock) | W23 |
| AgentWallet | F3/F4 | — (W15 mock) | W23 |
| DeedNft, Staking | F6 | — (W20 mock) | W23 |
| TreasuryDao, Escrow | F7/F8 | — (W22 mock) | W23 |
| LlmProvider | AI director | — (W16) | Z.ai `glm-5.3` |
| Notifier | push / Telegram | — (W09) | Web Push, Telegram |

W25 finalises this table for the submission.

## Pages

All pages are entries of one Vite app (see `rollupOptions.input` in [`vite.config.ts`](./vite.config.ts)) and share the **Faction Plate** design system.

| URL | File | What it is | Code |
|---|---|---|---|
| `/` | [`frontend/index.html`](./frontend/index.html) | **Hub.** Cards linking to Landing, Play, Playground and the design system, with deep links to each world and a few models. Static HTML + CSS, no JS. | — |
| `/landing.html` | [`frontend/landing.html`](./frontend/landing.html) | **Landing** (terraagent.com): hero = the game's real orbit stage (morphs between the 3 worlds every 10 s, terraforming each in 4 steps; `?world=<kind>` picks the start), Canvas 2D hex colony, economy, planets, AI Director, FAQ. Planet cards render the real `PlanetGlobe`; sections 07 Roadmap (scroll-driven flight plan, `frontend/landing/sections/roadmap.ts`) and 08 Road to market (route + split-flap lane board); the economy section has resource tabs (Metals default) with a live 3D model and technical sheet. | [`frontend/landing/`](./frontend/landing/) (`main.ts` → `LandingPage`; `sections/`, `hero/`, `colony/`, `resources/`), CSS [`landing.css`](./frontend/landing/landing.css) |
| `/play.html` | [`frontend/play.html`](./frontend/play.html) | **Game**: orbital world picker → drop-pod descent cinematic → colony diorama with RTS camera and HUD. | [`frontend/game/main.ts`](./frontend/game/main.ts) → [`frontend/game/app/Game.ts`](./frontend/game/app/Game.ts), UI in [`frontend/game/ui/`](./frontend/game/ui/) |
| `/playground.html` | [`frontend/playground.html`](./frontend/playground.html) | **3D playground**, a storybook for 3D models: every registered kitbash archetype on a calibrated pedestal, 4 diagnostic views, biome switch, triangle budget and ground-contact checks, PNG and 4-view contact-sheet export. | [`frontend/playground/PlaygroundApp.ts`](./frontend/playground/PlaygroundApp.ts) |
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
| Play (online) | `?scenario=<id>` | Online flow: create a fresh planet from `scenarios/<id>` (e.g. `w00`) and join it; skips the prototype menu and descent. |
| Play (online) | `?host=local` | Run the engine in the browser alone (no app or Postgres); snapshots in IndexedDB. Combine with `&scenario=`. |
| Play (online) | `&waves=..NN` / `&waves=00,03` | Dev: narrow the enabled waves (never wider than the server's set). |
| Play (online) | `&lag=<ms>` | Dev: delay the connection both ways (prediction testing). |
| Play (online) | `&predict=0` | Turn client-side prediction off (interpolate 400 ms behind). |
| Play (online) | `&as=<name>` | Dev session name (`dev:<name>` token). |
| Play (online) | `&dev=1` | Dev console in a non-dev build. |
| Playground | `?inspect=<archetype id>` | Select a model, e.g. `robot.hero`, `building.commandHub`, `ship.carrier`. |
| Playground | `&biome=dune\|oceanForest\|forestRock` | Pedestal / sky / weathering biome. |
| Playground | `&view=iso\|front\|side\|top` | Camera view. |
| Playground | `&turntable=1`, `&surface=1`, `&pixel=1` | Auto-rotate; real planet surface instead of the pedestal; pixel-art shader. |
| All 3D pages | `?pixel=1\|0` | Enable or disable the experimental pixel-art post-processing shader. |

### Controls

- **Game (online, dev):** `` ` `` opens the dev console (`help` lists the commands of the enabled waves: `warp`, `spawn`, `nudge`, `teleport`, `tune`, `scenario`, `chain.ping`, `flags`, …). LMB on a tile logs its `q, r`.
- **Game (prototype):** LMB move hero · WASD / edge pan · MMB drag · wheel zoom · Q/E rotate · Home focus hero · Esc pause. During the descent: Esc / Space skips.
- **Playground:** `[` `]` cycle models · `1`–`4` views · `T` turntable · `F` focus · `G` grid · `W` wireframe · `B` bloom · `P` pixel art · `R` spawn the whole category in a row · `V` validate (outline floating/overlapping parts) · `/` search · double-click to refocus.
- **Landing and Game:** `F9` toggles the CRT overlay ([`frontend/render/ui/crt.ts`](./frontend/render/ui/crt.ts)) · `F10` toggles the Pixel-Art shader ([`frontend/render/ui/pixelArt.ts`](./frontend/render/ui/pixelArt.ts), [`frontend/render/core/pixelArtPass.ts`](./frontend/render/core/pixelArtPass.ts)) · `F8` (or `Shift+P`) opens/closes the floating Pixel Shader Lab dialog ([`frontend/render/ui/pixelDialog.ts`](./frontend/render/ui/pixelDialog.ts)).

## Design system: Faction Plate

Defined in [`frontend/design/css/tokens.css`](./frontend/design/css/tokens.css) (`--ta-*` variables) and [`base.css`](./frontend/design/css/base.css) (buttons, plates, inputs, badges). Every page imports both.

- **Colour ratio 60 / 25 / 10 / 5:** void black `#07080A` · hull white `#F2F4F7` · ignition orange `#FF6A13` (action, selection, player faction) · signal blue `#1E5BFF` (systems, AI, reference). Support: `--ta-energy` (power), `--ta-terra` (ok), `--ta-fault` (error).
- **Never white text on orange** (2.9:1). Use void text on orange.
- **Chamfered plates, never rounded corners:** `.plate`, `.plate-sm`, `.plate-lg`, `.btn`.
- **Type:** Chakra Petch (display, readouts), IBM Plex Sans (body), IBM Plex Mono (labels, telemetry, data).

The in-world 3D look (models, shaders, lighting) follows the 4 visual pillars in [`AGENTS.md`](./AGENTS.md).

## Building the game: waves

The online game is built in **26 product waves** ([`docs/plan/PRODUCT_WAVES.md`](./docs/plan/PRODUCT_WAVES.md), one file per wave in [`docs/plan/waves/`](./docs/plan/waves/)). Every wave ends in a working, tested app and lands in `main` only after you have played its demo. The waves build on the existing 3D renderer in `frontend/render` and the prototype views in `frontend/game`; they extend them, never replace them (PRODUCT_WAVES §4 "One renderer").

**Two commands:**

```bash
npm run wave            # auto-lands any completed open wave, then opens/resumes the next wave with its built-in preset
npm run wave -- status  # full board: state, issue progress (done/total), preset (runner:model, effort, parallel) & track
```

**Single steps** (the same pipeline, one command each; add `--dry-run` to preview, `--root <dir>` or `TA_WAVE_ROOT` to run against a sandbox clone, `npm run test:wave` tests them in one):

```bash
npm run wave:open -- 07              # open/resume the wave worktree (no agent started)
npm run wave:issue -- W07-03         # ../TerraAgent-wt/W07-03 on issue/W07-03 from the wave branch (node_modules cloned)
npm run wave:issue:land -- W07-03    # gates, then `git merge --no-ff` as "W07-03: <title>"; removes worktree + branch; stops on a conflict
npm run wave:check -- 07             # merge main in, ci:fast + e2e --waves ..07 --hack, prints the demo story and ?scenario=w07 URL
npm run wave:land -- 07              # refuses unless every depended-on/stacked wave is in main, gates pass and no dirty main-checkout file is touched; tags wave-07 (or wave-07.k), pushes, cleans up
```

Every worktree these scripts create gets a gitignored `.env.worktree` with its own `TA_PORT_BASE` (4100, 4200, …) and `TA_DB_NAME=terra_<branch>`.

Every wave has a built-in preset in [`scripts/wave/prompt.mjs`](./scripts/wave/prompt.mjs) that automatically selects the runner (`agy` or `claude`), worker + advisor (`agy:argon` with `flash` subagents, `claude:sonnet+opus` for standard waves, or `claude:opus+fable` for complex waves via `--advisor`, using each model's default effort), execution mode (`auto`), parallel subagent factor (`2`–`6`), serial plan gate (`serial-spine` or `contract-first`), and domain skills.

**Your loop:**

1. Run `npm run wave` and let the wave lead session build its issues.
2. When it finishes and prints the demo URL, play the demo story from the wave file.
3. Run `npm run wave` again: it sees all in-scope issues (`done/total`) merged on the wave branch, automatically merges into `main`, tags `wave-NN`, pushes, cleans up the worktree and branch, and opens the next ready wave.

**Plan files:** the hackathon cut and drop order are in [`HACKATHON_CUT.md`](./docs/plan/HACKATHON_CUT.md), the generated start order in [`HACKATHON_SCHEDULE.md`](./docs/plan/HACKATHON_SCHEDULE.md), your to-dos and open decisions in [`OWNER_TASKS.md`](./docs/plan/OWNER_TASKS.md). After editing a wave file, run `python3 scripts/plan/index_waves.py` (must print `problems 0`) and `--write` to regenerate the index and schedule.

## Adding a 3D model

1. Register an archetype in `frontend/render/kitbash/archetypes/…` (via `ArchetypeCatalog.register`) following the `procedural-kitbash-3d` skill.
2. Open `/playground.html?inspect=<your.id>`. It appears in the sidebar automatically.
3. Run `npm run validate:models -- <your.id>`: it must report 0 errors and 0 warnings (floating parts, gaps, z-fighting, parts cutting through each other, animated parts hitting something, wheels/chassis/arm in one colour, a solar panel that is a flat slab, blank faces). Name your parts; roles come from names. Add `&validate=1` to the playground URL (or press `V`) to see offending parts outlined and numbered.
4. Check all four views, ground contact (`minY 0.000` ✔) and the triangle count against the 3.5k budget. Export a 4-view sheet if needed.

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
- [`docs/plan/`](./docs/plan): the hackathon cut and the wave plan (26 waves).
- [`docs/visuals/`](./docs/visuals): 3D coding rules, the AI-mesh pipeline, procedural textures, shaders and lighting.
