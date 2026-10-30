# TerraAgent

Autonomous colony builder in the browser: drop one robot on a live planet, set priorities, and the colony keeps mining, building and defending while you are away. Web client is **Vite + TypeScript + Three.js**. The online backend (NEAR, planet workers, AI Director) is specified in [`docs/`](./docs/) and not implemented yet.

## Quick start

```bash
npm install
npm run dev        # http://127.0.0.1:5173/
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build → dist/
npm run validate:models -- <id|--category robot|--all>   # geometry + colour + detail check of kitbash models (see "Adding a 3D model")
npm run test:models                                    # self-test of the geometry validator
```

Open http://127.0.0.1:5173/. That page is the **hub** and links to everything below.

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
| Playground | `?inspect=<archetype id>` | Select a model, e.g. `robot.hero`, `building.commandHub`, `ship.carrier`. |
| Playground | `&biome=dune\|oceanForest\|forestRock` | Pedestal / sky / weathering biome. |
| Playground | `&view=iso\|front\|side\|top` | Camera view. |
| Playground | `&turntable=1`, `&surface=1` | Auto-rotate; real planet surface instead of the pedestal. |

### Controls

- **Game:** LMB move hero · WASD / edge pan · MMB drag · wheel zoom · Q/E rotate · Home focus hero · Esc pause. During the descent: Esc / Space skips.
- **Playground:** `[` `]` cycle models · `1`–`4` views · `T` turntable · `F` focus · `G` grid · `W` wireframe · `B` bloom · `R` spawn the whole category in a row · `V` validate (outline floating/overlapping parts) · `/` search · double-click to refocus.
- **Landing and Game:** `F9` toggles the CRT overlay ([`frontend/shared/ui/crt.ts`](./frontend/shared/ui/crt.ts)).

## Design system: Faction Plate

Defined in [`frontend/design/css/tokens.css`](./frontend/design/css/tokens.css) (`--ta-*` variables) and [`base.css`](./frontend/design/css/base.css) (buttons, plates, inputs, badges). Every page imports both.

- **Colour ratio 60 / 25 / 10 / 5:** void black `#07080A` · hull white `#F2F4F7` · ignition orange `#FF6A13` (action, selection, player faction) · signal blue `#1E5BFF` (systems, AI, reference). Support: `--ta-energy` (power), `--ta-terra` (ok), `--ta-fault` (error).
- **Never white text on orange** (2.9:1). Use void text on orange.
- **Chamfered plates, never rounded corners:** `.plate`, `.plate-sm`, `.plate-lg`, `.btn`.
- **Type:** Chakra Petch (display, readouts), IBM Plex Sans (body), IBM Plex Mono (labels, telemetry, data).

The in-world 3D look (models, shaders, lighting) follows the 4 visual pillars in [`AGENTS.md`](./AGENTS.md).

## Project layout

```
frontend/                 One Vite app (root of vite.config.ts); URLs mirror the file layout
  index.html  landing.html  play.html  playground.html   Page entries (hub, landing, game, 3D playground)
  design/                 Faction Plate design system: tokens, base components, docs pages
  landing/                Landing site: main.ts (LandingPage) + sections/, hero/, colony/, resources/
  game/                   Game: main.ts, app/ (Game, Gameplay, RTS camera), ui/ (menu, HUD), descent/ (cinematic, parts/, fx/)
  playground/             3D playground: PlaygroundApp + stage/, content/, camera/, panels/
  shared/                 Used by 2+ apps (alias @shared/*)
    engine/               core (viewport, StageHost), kitbash (+validate/), visuals, planets, orbit, lighting
    ui/                   CRT overlay
scripts/                  check-structure.mjs (500-line / 100-line limits)
.agents/skills/           Agent skills for 3D work (see AGENTS.md)
docs/                     game design (game/), online architecture (spec/), build plan (plan/), 3D rules (visuals/)
```

## Adding a 3D model

1. Register an archetype in `frontend/shared/engine/kitbash/archetypes/…` (via `ArchetypeCatalog.register`) following the `procedural-kitbash-3d` skill.
2. Open `/playground.html?inspect=<your.id>`. It appears in the sidebar automatically.
3. Run `npm run validate:models -- <your.id>`: it must report 0 errors and 0 warnings (floating parts, gaps, z-fighting, parts cutting through each other, animated parts hitting something, wheels/chassis/arm in one colour, a solar panel that is a flat slab, blank faces). Name your parts; roles come from names. Add `&validate=1` to the playground URL (or press `V`) to see offending parts outlined and numbered.
4. Check all four views, ground contact (`minY 0.000` ✔) and the triangle count against the 3.5k budget. Export a 4-view sheet if needed.

## Docs

Everything that is not code is in [`docs/`](./docs) (index: [`docs/README.md`](./docs/README.md)).

- [`AGENTS.md`](./AGENTS.md): rules for AI agents (visual pillars, skill routing, pages). [`CLAUDE.md`](./CLAUDE.md): Claude Code entry point.
- [`docs/game/`](./docs/game): game design, economy, units and the NEAR features.
- [`docs/spec/`](./docs/spec): online architecture; start with `DECISIONS.md`. Not implemented yet.
- [`docs/plan/`](./docs/plan): the hackathon cut and the 101-task build plan.
- [`docs/visuals/`](./docs/visuals): 3D coding rules, the AI-mesh pipeline, procedural textures, shaders and lighting.
