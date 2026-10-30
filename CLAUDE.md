# CLAUDE.md

TerraAgent: autonomous colony builder (Vite + TypeScript + Three.js). Read [`AGENTS.md`](./AGENTS.md) first. It holds the mandatory 3D visual rules (4 pillars), skill routing for `.agents/skills/*`, and the page/UI rules. [`README.md`](./README.md) has the page list, URL parameters and controls.

## Commands

```bash
npm run dev        # http://127.0.0.1:5173/  (hub page; links to everything)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build → dist/ (must stay warning-free apart from chunk size)
```

There is no test suite. Verify changes by loading the pages in a browser or headless Chrome.

## Pages (one Vite app, multiple HTML entries)

| URL | Purpose | Code |
|---|---|---|
| `/` | Hub linking to all pages | `index.html` |
| `/landing.html` | Landing site | `landing.html`, `frontend/design/js/landing.js` |
| `/play.html` | Game (orbit menu → descent → colony) | `src/main.ts`, `src/game/`, `src/ui/` |
| `/playground.html` | 3D model storybook / visual QA | `src/playground/main.ts` |
| `/frontend/design/` | Faction Plate design system docs | `frontend/design/` |

Adding a page: create the HTML, add it to `rollupOptions.input` in `vite.config.ts`, link it from `index.html`, and load scripts with `<script type="module">`.

## Rules to remember

- **UI chrome follows the design system** (`frontend/design/css/tokens.css` + `base.css`): `--ta-*` variables, chamfered plates (no `border-radius`), orange for action/selection, blue for systems, void text on orange (never white), Chakra Petch / IBM Plex fonts. The 3D scene follows the pillars in `AGENTS.md`, not the UI palette.
- **Any 3D model or shader change:** activate the matching skill from the `AGENTS.md` routing table, then verify in `/playground.html?inspect=<id>` across iso/front/side/top. Require `minY 0.000` and under 3.5k triangles (several existing archetypes currently exceed this).
- **Game flow QA:** `/play.html?planet=dune|oceanForest|forestRock&skip=1` jumps straight into gameplay. Debug handles: `window.__game`, `window.__pg`.
- `frontend/design/landing.html` is a design mock-up. The live landing page is the root `landing.html`.
- `docs/spec/` and `docs/plan/` describe the not-yet-built online backend. `docs/spec/CLIENT.md` assumes separate `game.` and root domains; the current local build serves everything from one app.
- Other people or agents may edit this repo at the same time (e.g. `src/ui/crt.ts`). Re-read a file before editing it and don't revert changes you didn't make.
- The project is not a git repository, so there is no commit history to fall back on.
- **Wave build (from W00 on):** each wave is built in its own branch `wave/wNN-<slug>` and worktree `../TerraAgent-wt/wNN`, issues in `issue/WNN-XX` worktrees off it. A wave merges into `main` only after the owner's manual check, then its worktree and branch are deleted and `main` is pushed. See `docs/plan/PRODUCT_WAVES.md` §7.
