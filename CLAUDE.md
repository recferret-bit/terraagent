# CLAUDE.md

TerraAgent: autonomous colony builder (Vite + TypeScript + Three.js). Read [`AGENTS.md`](./AGENTS.md) first. It holds the mandatory 3D visual rules (4 pillars), skill routing for `.agents/skills/*`, and the page/UI rules. [`README.md`](./README.md) has the page list, URL parameters and controls.

## Commands

```bash
npm run dev        # http://127.0.0.1:5173/  (hub page; links to everything)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + check:structure + vite build → dist/ (must stay warning-free apart from chunk size)
npm run check:structure  # fails on any file > 500 lines or function > 100 lines (frontend/, scripts/)
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

Vite `root` is `frontend/`; code shared by two or more apps lives in `frontend/shared/` (alias `@shared/*`). Architecture limits and layering: `AGENTS.md` §6.

Adding a page: create the HTML, add it to `rollupOptions.input` in `vite.config.ts`, link it from `frontend/index.html`, and load scripts with `<script type="module">`.

## Rules to remember

- **UI chrome follows the design system** (`frontend/design/css/tokens.css` + `base.css`): `--ta-*` variables, chamfered plates (no `border-radius`), orange for action/selection, blue for systems, void text on orange (never white), Chakra Petch / IBM Plex fonts. The 3D scene follows the pillars in `AGENTS.md`, not the UI palette.
- **Any kitbash model change:** run `npm run validate:models -- <id>` (skill `model-geometry-validator`; must be 0 errors and 0 warnings, which includes colour roles, separation between functional groups and surface detail) and `npm run test:models` if you touched the validator. `/playground.html?inspect=<id>&validate=1` (or `V`) outlines the offending parts.
- **Any 3D model or shader change:** activate the matching skill from the `AGENTS.md` routing table, then verify in `/playground.html?inspect=<id>` across iso/front/side/top. Require `minY 0.000` and under 3.5k triangles (several existing archetypes currently exceed this).
- **Game flow QA:** `/play.html?planet=dune|oceanForest|forestRock&skip=1` jumps straight into gameplay. Debug handles: `window.__game`, `window.__pg`.
- **Architecture limits:** no file over 500 lines, no function over 100 lines, no copy/paste, orchestrator classes compose small parts (details and layers in `AGENTS.md` §6). Run `npm run check:structure` after every refactor; `npm run build` runs it too.
- Docs live in `docs/` (index: `docs/README.md`): `game/` design, `spec/` architecture (start with `DECISIONS.md`), `plan/` build plan, `visuals/` 3D rules. Keep the repo root free of loose `.md` files: only `README.md`, `AGENTS.md` and `CLAUDE.md` belong there.
- `docs/spec/` and `docs/plan/` describe the not-yet-built online backend. `docs/spec/CLIENT.md` assumes separate `game.` and root domains; the current local build serves everything from one app.
- Other people or agents may edit this repo at the same time (e.g. `frontend/shared/ui/crt.ts`). Re-read a file before editing it and don't revert changes you didn't make.
- This is a git repository (`main`). Commit only the files you changed: other people's work is often uncommitted in the same tree.
- **Wave build (from W00 on):** each wave is built in its own branch `wave/wNN-<slug>` and worktree `../TerraAgent-wt/wNN`, issues in `issue/WNN-XX` worktrees off it. A wave merges into `main` only after the owner's manual check, then its worktree and branch are deleted and `main` is pushed. See `docs/plan/PRODUCT_WAVES.md` §7.
