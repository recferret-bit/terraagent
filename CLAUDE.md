# CLAUDE.md

TerraAgent: autonomous colony builder (Vite + TypeScript + Three.js). Read [`AGENTS.md`](./AGENTS.md) first. It holds the mandatory 3D visual rules (4 pillars), skill routing for `.agents/skills/*`, and the page/UI rules. [`README.md`](./README.md) has the page list, URL parameters and controls.

## Commands

```bash
npm run dev        # http://127.0.0.1:5173/  (hub page; links to everything)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + check:structure + vite build → dist/ (must stay warning-free apart from chunk size)
npm run check:structure  # fails on any file > 500 lines or function > 100 lines (frontend/, scripts/)
npm run wave       # open/resume the next ready wave in its worktree and start Claude Code there; `-- status`, `-- land` after your check
npm run validate:models -- <id|--category robot|--all>   # geometry validator for kitbash models
npm run test:models                                    # self-test of that validator
```

There is no test suite. Verify changes by loading the pages in a browser or headless Chrome.

## Pages (one Vite app, multiple HTML entries)

| URL | Purpose | Code |
|---|---|---|
| `/` | Hub linking to all pages | `frontend/index.html` |
| `/landing.html` | Landing site | `frontend/landing.html`, `frontend/landing/` (`main.ts` → `LandingPage`) |
| `/play.html` | Game (orbit menu → descent → colony) | `frontend/game/` (`main.ts`, `app/`, `ui/`, `descent/`) |
| `/playground.html` | 3D model storybook / visual QA | `frontend/playground/` (`PlaygroundApp`) |
| `/design/` | Faction Plate design system docs | `frontend/design/` |

Vite `root` is `frontend/`; the 3D render engine used by two or more apps lives in `frontend/render/` (alias `@terra/render/*`); from W00, code used by frontend and backend lives in top-level `shared/{contracts,config,db,sim}`. Architecture limits and layering: `AGENTS.md` §6.

Adding a page: create the HTML, add it to `rollupOptions.input` in `vite.config.ts`, link it from `frontend/index.html`, and load scripts with `<script type="module">`.

## Rules to remember

- **UI chrome follows the design system** (`frontend/design/css/tokens.css` + `base.css`): `--ta-*` variables, chamfered plates (no `border-radius`), orange for action/selection, blue for systems, void text on orange (never white), Chakra Petch / IBM Plex fonts. The 3D scene follows the pillars in `AGENTS.md`, not the UI palette.
- **Any kitbash model change:** run `npm run validate:models -- <id>` (skill `model-geometry-validator`; must be 0 errors and 0 warnings, which includes colour roles, separation between functional groups and surface detail) and `npm run test:models` if you touched the validator. `/playground.html?inspect=<id>&validate=1` (or `V`) outlines the offending parts.
- **Any 3D model or shader change:** activate the matching skill from the `AGENTS.md` routing table, then verify in `/playground.html?inspect=<id>` across iso/front/side/top. Require `minY 0.000` (or `-0.100` for a building's sunk foundation-plinth skirt; the panel shows `✔`) and under 3.5k triangles (all archetypes are under 3.5k; several have < 1 % headroom).
- **Game flow QA:** `/play.html?planet=dune|oceanForest|forestRock&skip=1` jumps straight into the prototype gameplay; `/play.html?scenario=w00` runs the online flow (server sim), `?host=local&scenario=w00` the browser-only engine. Debug handles: `window.__game`, `window.__pg`, `window.__online`.
- **Dev tools:** every URL parameter, dev console command (`` ` `` key), dev page/route, mock-chain detail, env variable and debug handle is in [`docs/dev/DEV_TOOLS.md`](./docs/dev/DEV_TOOLS.md). Update it in the same commit when you add or change one.
- **Building placement is one shared function (D-37):** `evaluatePlacement` (`shared/sim/src/systems/construction/placement.ts`, tile meaning in `grid/geo.ts`) is called by the `placeBuilding` handler (server and `?host=local` Worker) and by the client ghost (`frontend/game/features/hub-placement/GhostEvaluator.ts` only adapts replica data). Trees, rock, water, slope, hole, ridge and deposits are `terrain_unbuildable` until the player terraforms them; the client never mutates state, it sends one `placeBuilding` and shows the host's reject. Change a placement rule only there, and run `frontend/game/features/hub-placement/placement-parity.spec.ts` + `shared/sim/test/systems/placement-rules.spec.ts`.
- **Units never teleport (SIM-M-01):** bot input is a unit command (`move`, `stop`, `die`, `attack`, `build`, `terraform`; `issueUnitCommand` or a work provider in `shared/sim/src/systems/units/registry.ts`). Units walk via the movement orchestrator → pathfinding service → locomotion, the only writer of `x/y/q/r`; the sim lint enforces it. Test with `shared/sim/test/units/*.spec.ts`. See `shared/sim/README.md` → Units.
- **Planet ground is generated once, in the sim (D-38):** `shared/sim/src/gen/world/` (orchestrator + stages, profile rows in `shared/sim/src/data/worldgen.ts`). `height` is metres and the renderer draws it as is; hidden layers (`FieldDef.hidden`, e.g. `subDeposit`) never leave the host: send clients `snapshot(s, { forClient: true })` / `diffSince(s, t, { forClient: true })`. Tile stamps go through `touchTile` / `stampTile` (they keep the per-sector `changedAt` index of `grid/sectors.ts` that `diffSince` uses). Changing generator output: bump `GEN_VERSION` (`gen/generators.ts`).
- **Who is where, and where to land (D-39):** read positions through `shared/sim/src/world/presence.ts` (`colonyPresence`, `faunaPositions`, `entitiesNear`, `presenceView` for AI); landing sites only through `nextLandingSite` / `landingBlock` (`world/landingPlanner.ts`). Landings are recorded forever in `blobs.landingHistory`; never land within `minLandingSeparation` of one. New entity kinds call `registerPresenceRole`.
- **Known limitations and open questions:** when you leave something undone or traded off, skip a review finding, or pick a default for a question only the owner can decide, add/update an entry in `docs/questions-and-limitations/<area>.md` in the same change (format: its `README.md`; AGENTS.md §5). Read the area's file before working there; mark fixed entries `Resolved (<commit>)`. When you delegate, have subagents report such items and record them; name the new entries in your final message.
- **Architecture limits:** no file over 500 lines, no function over 100 lines, no copy/paste, orchestrator classes compose small parts (details and layers in `AGENTS.md` §6). Run `npm run check:structure` after every refactor; `npm run build` runs it too.
- Docs live in `docs/` (index: `docs/README.md`): `game/` design, `spec/` architecture (start with `DECISIONS.md`), `plan/` build plan, `visuals/` 3D rules, `dev/` dev tools reference, `questions-and-limitations/` known gaps and open questions. Keep the repo root free of loose `.md` files: only `README.md`, `AGENTS.md` and `CLAUDE.md` belong there.
- `docs/spec/` and `docs/plan/` describe the not-yet-built online backend. `docs/spec/CLIENT.md` assumes separate `game.` and root domains; the current local build serves everything from one app.
- Other people or agents may edit this repo at the same time (e.g. `frontend/render/ui/crt.ts`). Re-read a file before editing it and don't revert changes you didn't make.
- This is a git repository (`main`). Commit only the files you changed: other people's work is often uncommitted in the same tree.
- **Wave build (from W00 on):** each wave is built in its own branch `wave/wNN-<slug>` and worktree `../TerraAgent-wt/wNN`, issues in `issue/WNN-XX` worktrees off it. A wave opens only after every wave it depends on is in `main`, and merges into `main` only after the owner's manual check. The wave lead ends every wave with an **owner check guide** `docs/plan/checks/wNN-check.md` (format: `docs/plan/checks/README.md`, example `w00-check.md`: exact URLs with the worktree's ports, where to type, what to see) and pastes it as its final message. The owner lands the wave with **`npm run wave -- land NN`** (e.g. `npm run wave -- land 00`), which merges, tags `wave-NN`, pushes and deletes the worktree and branch. See `docs/plan/PRODUCT_WAVES.md` §7.
