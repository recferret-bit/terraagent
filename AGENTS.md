# TerraAgent — AI Agent Architecture & 3D Visuals Constitution

Welcome to **TerraAgent** (Autonomous Colony Builder on Web / Three.js / NEAR).

Whenever you are asked to create, modify, or debug **3D models, procedural geometry, `.glb` assets, textures, shaders, lighting, or Three.js scenes**, you MUST follow the **4 Visual Pillars** and activate the corresponding workspace skill in `.agents/skills/`.

---

## 1. Mandatory Skill Routing Table

Before writing any 3D, shader, or asset-pipeline code, read the `SKILL.md` for the relevant domain:

| Task / Domain | Activate Skill | Location |
| :--- | :--- | :--- |
| **Procedural 3D Models in Code** (Robots, Buildings, Turrets, Stations, Greebles, `InstancedMesh` merging) | `procedural-kitbash-3d` | [.agents/skills/procedural-kitbash-3d/SKILL.md](./.agents/skills/procedural-kitbash-3d/SKILL.md) |
| **Insect Fauna Models** (black ants, armored beetles, acid spitters; segmented chitin and six-leg silhouettes) | `procedural-bug-3d` | [.agents/skills/procedural-bug-3d/SKILL.md](./.agents/skills/procedural-bug-3d/SKILL.md) |
| **Insect Animation States & Combat Acting** (idle/tripod locomotion, mandible bites, horn shoves, sac charge/release, hit/death and liquid splash) | `procedural-insect-animation` | [.agents/skills/procedural-insect-animation/SKILL.md](./.agents/skills/procedural-insect-animation/SKILL.md) |
| **Species Hives & Hive-Life Previews** (organic entrances, brood chambers, cosmetic life, seeded playground fixtures) | `procedural-hive-3d` | [.agents/skills/procedural-hive-3d/SKILL.md](./.agents/skills/procedural-hive-3d/SKILL.md) |
| **Procedural 3D Animation & Gaits** (Zero-CPU GPU vertex animation `aPartAnim`, bipedal walk cycles, spider/hexapod alternating gaits, full-body step-reaction suspension `BipedBody`/`SpiderBody`, wheel spin, `uWalkWeight` & `uWorkWeight` blending) | `procedural-animation-3d` | [.agents/skills/procedural-animation-3d/SKILL.md](./.agents/skills/procedural-animation-3d/SKILL.md) |
| **Object-Driven 3D Particle Effects & Tool Beams** (3D instanced debris chunks for tree/rock/dune/hole/flat/deposit/repair interactions, 60/30/10 role hierarchy, ballistic ground-bounce physics, articulated tool cutter beams) | `procedural-particles-3d` | [.agents/skills/procedural-particles-3d/SKILL.md](./.agents/skills/procedural-particles-3d/SKILL.md) |
| **Particle Effect Validation: composition, contrast, physics** (multi-layer 3D chunk variety, 60/30/10 role ratio, primary vs secondary CIE Lab contrast $\Delta E_{76} \ge 15$, HDR bloom $\ge 3.0$, ground bounce, triangle budget; run after ANY particle preset change) | `particle-effect-validator` | [.agents/skills/particle-effect-validator/SKILL.md](./.agents/skills/particle-effect-validator/SKILL.md) |
| **Model Validation: geometry, colours, detail** (floating or disconnected parts, hairline gaps, parts cutting through each other, z-fighting, cables clipping, animated parts hitting something; wheels/chassis/arm in one colour, a solar panel that is a flat slab, blank faces, flat palette; run after ANY kitbash change) | `model-geometry-validator` | [.agents/skills/model-geometry-validator/SKILL.md](./.agents/skills/model-geometry-validator/SKILL.md) |
| **External AI 3D Models & Blender MCP** (2D-to-3D via TRELLIS.2 / Rodin / Tripo, `.glb` optimization, pivot & scale normalization) | `ai-mesh-pipeline` | [.agents/skills/ai-mesh-pipeline/SKILL.md](./.agents/skills/ai-mesh-pipeline/SKILL.md) |
| **Procedural PBR Textures** (Canvas2D / `DataTexture` Normal maps via Sobel filter, Hull panels, Solar hex grids, Hazard stripes) | `procedural-texture-synthesis` | [.agents/skills/procedural-texture-synthesis/SKILL.md](./.agents/skills/procedural-texture-synthesis/SKILL.md) |
| **Shaders, Materials & Terrain/Water** (Unifier Shader, Triplanar grain, Planet dust/frost weathering, Terraforming wave, Hydro water) | `shader-texture-tuning` | [.agents/skills/shader-texture-tuning/SKILL.md](./.agents/skills/shader-texture-tuning/SKILL.md) |
| **Dynamic Lighting & 3D Lightning Hazards** (Orbital day/night solar cycle, time-of-day sun color & shadow modulation, authoritative `@terra/sim` solar clock, Pooled PointLights, 3D jagged lightning bolts, Grid overload arcs) | `planetary-lighting-and-lightning` | [.agents/skills/planetary-lighting-and-lightning/SKILL.md](./.agents/skills/planetary-lighting-and-lightning/SKILL.md) |
| **Scene Viewport, Post-Processing & Visual QA** (28° Telephoto Isometric Diorama, PMREM IBL, Selective Bloom, `F8` 7-Tab Visual Shader Lab (incl. WIND / WATER / PERF), 4-View Screenshot Audit) | `diorama-viewport-auditor` | [.agents/skills/diorama-viewport-auditor/SKILL.md](./.agents/skills/diorama-viewport-auditor/SKILL.md) |
| **Pre-Landing Wave Validation & 2-Iteration Review/Fix Loop (`"validate the wave"`)** (triggers whenever the user says `"validate the wave"`, `"validate wave"`, `"validate WNN"`, or `"review the wave"`: compare wave diff against initial wave task & specs, enforce full Test Pyramid coverage [unit + integration per major feature, backend E2E, and positive/negative/corner cases], AST function/block duplication detection, clean architecture & orchestrator/service split check, client+server+sim wiring parity, 2-iteration autonomous review/fix harness) | `wave-landing-validator` | [.agents/skills/wave-landing-validator/SKILL.md](./.agents/skills/wave-landing-validator/SKILL.md) |
| **Wave Landing, Main Sync & Future-Wave Plan Propagation** (**"merge wave into main"** / **"land wave into main"** → Mode 1 `wave:land` with 3-iteration audit/test/gap loop, generated-file auto-heal & post-merge propagation of self-review features into future wave plans; **"merge main into wave"** / **"sync main into wave"** → Mode 2 `wave:sync` into WIP wave & active issue worktrees) | `wave-land-and-sync` | [.agents/skills/wave-land-and-sync/SKILL.md](./.agents/skills/wave-land-and-sync/SKILL.md) |

---

## 2. Non-Negotiable Visual Quality Guardrails (The 4 Pillars)

**Organic fauna exception (owner-approved 2026-11-05):** insects and species hives follow [.agents/skills/procedural-kitbash-3d/references/organic-fauna.md](./.agents/skills/procedural-kitbash-3d/references/organic-fauna.md). Organic anatomy, procedural surface detail, nonmetallic tissue palettes and explicitly bounded flexible tissue replace mechanical-only appearance prescriptions below. Connectivity, motion/CPU/shadow parity, ground contact, production triangle budgets and visual QA still apply.

1. **Pillar 1 — Modular Kitbashing Over Raw Primitives (`procedural-kitbash-3d` & `procedural-particles-3d`):**
   - **Never** use raw sharp `THREE.BoxGeometry` for hulls or chassis; always use `RoundedBoxGeometry` or beveled profiles so edges catch specular highlights. **Never** use flat 2D sprite templates for interaction particles; always use instanced 3D low-poly chunk meshes (`procedural-particles-3d`) with ground bounce (`bounce >= 0.15`), 60/30/10 primary/secondary/accent role balance, and CIE Lab contrast ($\Delta E_{76} \ge 15$), validated via `npm run validate:particles -- --all` (`particle-effect-validator`).
   - Enforce the **60 / 30 / 10 Material Hierarchy**: 60% Primary Hull (`hullPrimary`), 30% Dark Gunmetal Skeleton (`frameGunmetal`), 10% Faction Accent & HDR Emissive (`hullSecondary` + `energyCyan` / `warningAmber` with `emissiveIntensity >= 3.0`).
   - **Every new or edited kitbash model MUST pass `npm run validate:models -- <archetype id>` (skill `model-geometry-validator`) with 0 errors and 0 warnings before the visual check:** every part overlaps its support by ≥ 1 cm, insets stand proud of their frames, cables end on anchors, and animated parts keep ≥ 1 cm clearance over their whole motion. The same run checks appearance: functional groups (wheels, platform, manipulator) have different colours, a thin inset never shares its base's colour, functional parts show their function in geometry (a solar panel is a cell grid with bus bars, a wheel has a rim and hub) and every large face carries mounted detail. There are no image textures on kitbash models, so colour and detail come from zones and geometry.
   - Every robot or building must combine **$\ge 7$ sub-parts**, include a **silhouette breaker** (sagging `CatmullRomCurve3` cable, angled antenna, radar dish, or solar wing), and merge into a single `BufferGeometry` with zero-CPU GPU animation vertex attributes (`aPartAnim` channels `0..9` and compound codes `18..39`, see `procedural-animation-3d`). Legged walkers must animate their chassis (`BipedBody 8` / `SpiderBody 9`) so the body reacts to every footstep with mass, suspension compression, and inertia.
2. **Pillar 2 — Sanitized 2D-to-3D Asset Pipeline (`ai-mesh-pipeline`):**
   - Never use direct Text-to-3D or load raw `.glb` exports directly.
   - Always generate an isolated white-background orthographic 2D concept (zero cast shadows) $\rightarrow$ reconstruct 3D $\rightarrow$ run `node .agents/skills/ai-mesh-pipeline/scripts/sanitize-glb.mjs` to weld, decimate (`<3.5k` tris), snap pivot to bottom-center (`Y = 0`), compress textures to `512px` WebP, and clamp roughness (`>= 0.45`).
3. **Pillar 3 — The Unifier Shader Architecture (`shader-texture-tuning`):**
   - Apply `createUnifiedColonyMaterial()` so both procedural meshes and imported `.glb` models share **Triplanar surface grain** (bypassing bad AI UVs), **Vertical Ground-Up Biome Weathering** (blending desert dust, ice frost, or temperate moss onto the bottom `0m–1.1m`), and **Fresnel silhouette rim lighting**.
4. **Pillar 4 — Tabletop Diorama Viewport & Visual QA (`diorama-viewport-auditor`):**
   - Render with a `28°` FOV telephoto isometric camera, `ACESFilmicToneMapping`, `RoomEnvironment` PMREM IBL, and selective `UnrealBloomPass` (`threshold: 1.1`).
   - Always visually inspect newly created 3D models or shaders across the 4 diagnostic views (`iso`, `front`, `side`, `top`) to verify ground contact (`minY == 0`, or `-0.1` for a building's sunk foundation-plinth skirt) and part connectivity.

---

## 3. Extension Architecture

All skills are designed as open registries so you can extend the visual system without modifying core engine loops:
- **New Kitbash Greebles & Unit Archetypes:** Register via `KitbashRegistry.registerGreeble()` and `KitbashRegistry.registerArchetype()` in `procedural-kitbash-3d`.
- **New 3D Interaction Particle Presets:** Register via `ParticlePresetRegistry.register()` in `procedural-particles-3d` and validate with `npm run validate:particles -- --all` (`particle-effect-validator`).
- **New AI 3D Providers:** Implement `Ai3dProviderAdapter` and pipe into `sanitizeAiGlb()` in `ai-mesh-pipeline`.
- **New Geometry Checks:** Add to `frontend/render/kitbash/validate/checks/` (one stage per file, wired in `ModelValidator.ts`) plus a known-bad and a known-good fixture in `model-geometry-validator/scripts/self-test.mjs` (`npm run test:models`).
- **New Procedural PBR Texture Patterns:** Register via `ProceduralTextureRegistry.register()` + `heightToNormalTexture()` in `procedural-texture-synthesis`.
- **New Planet Biomes & Shader Effects:** Register via `BiomeMaterialRegistry.registerBiome()` and `ShaderPluginRegistry.registerModifier()` in `shader-texture-tuning`.
- **New Weather States & Lightning/Plasma Arcs:** Register via `WeatherPresetRegistry.register()` and `LightningStrikeSystem` in `planetary-lighting-and-lightning`.

---

## 4. Pages, Dev Server & Visual QA

One Vite app, several HTML entries (`frontend/vite.config.ts` → `rollupOptions.input`, Vite root `frontend/`). Run `npm run dev`; it serves http://127.0.0.1:5173/. Full parameter and control reference: [README.md](./README.md#pages).

| URL | Purpose | Edit here |
| :--- | :--- | :--- |
| `/` (`frontend/index.html`) | **Hub**: links to every page below. Static HTML + CSS. | `frontend/index.html` |
| `/landing.html` | **Landing** (`terraagent.fun`): orbital showcase, `#economics` simulator, scroll-driven `#protocol` (`TerraAgent Protocol` schematic & live `/v1/near/protocol`), and `#chain` contract board. Planet cards deep-link to `/play.html?planet=<kind>`. | `frontend/landing.html`, `frontend/landing/` (`main.ts`, `sections/`, `landing.css`, `protocol.css`) |
| `/play.html` | **Game**: orbit menu → descent → colony diorama. Params: `?planet=dune\|oceanForest\|forestRock&seed=<n>&skip=1\|deploy=1\|t=<s>`. | `frontend/game/app/`, `frontend/game/ui/`, `frontend/game/descent/` |
| `/trade.html` | **Trading terminal**: planet orderbook, depth ladder, swaps, orbital cargo balances & bot keys (`/v1/trade/*`). | `frontend/trade/` |
| `/me.html` | **Player Profile, Achievements & BYOK NEAR.AI**: stage progress, badges, colony history & encrypted `/me` NEAR.AI API key + model config (`/v1/me/ai-settings`). | `frontend/me.html`, `frontend/game/pages/me/` |
| `/deed.html` | **Colony Deed share card**: public OpenGraph milestone history (`/deed/:tokenId`). | `frontend/deed.html`, `frontend/game/pages/deed/`, `frontend/game/features/deed/` |
| `/dev/economy-sim/` | **7-Day Economy Sim**: fast-forward multi-colony trading, war, diplomacy & NEAR.AI TEE viewer. | `frontend/dev/economy-sim/`, `frontend/game/dev/economy-sim/` |
| `/playground.html` | **3D playground**, the model storybook: every `ArchetypeCatalog` entry with 4 diagnostic views, biome switch, tri budget and `minY` checks. Params: `?inspect=<id>&biome=<kind>&view=iso\|front\|side\|top&turntable=1&surface=1&hexterrain=1&build=0\|33\|66&work=1&workTarget=tree\|rock\|dune\|hole\|flat\|metals\|minerals\|oil\|repair&depositStage=full\|half\|depleted&lights=1`. | `frontend/playground/` |
| `/pitchdeck/` (`frontend/pitchdeck/index.html`) | **Pitch deck** (W26): investor / demo presentation slides. | `frontend/pitchdeck/` |
| `/whitepaper/` (`frontend/whitepaper/index.html`) | **Whitepaper** (W26): technical & economic whitepaper. | `frontend/whitepaper/` |
| `/design/` | **Faction Plate** design system docs (foundations, UI storybook, motion). |  `frontend/design/` |

**Page and UI rules:**
- **All HTML/CSS chrome** (menus, HUDs, panels, buttons, overlays) MUST use the Faction Plate tokens from `frontend/design/css/tokens.css` + `base.css`. Use `--ta-*` variables, never raw hex. Corners are chamfered (`.plate*`, `.btn*`), never `border-radius` (planet thumbnails are the only round exception). Orange = action/selection (≈10 %), blue = systems/reference (≈5 %), void text on orange (never white).
- Pages that import `base.css` already get its `.btn`, `.card`, `.input`, `.label` classes. Don't reuse those names for page-specific components (the playground uses `.pg-btn`, the game menu uses `.world-card`).
- A new page MUST be added to `rollupOptions.input`, linked from the hub (`frontend/index.html`), and must use `<script type="module">` (classic scripts are not bundled).
- Debug handles: `window.__game` (game; `__game.debug`, `__game.setPaused(true)`) and `window.__pg` (playground; `__pg.select(id)`, `__pg.setView(v)`, `__pg.setWorkTarget(t)`, `__pg.validateParticles(id?)`, `__pg.setDepositStage(stage)`, `__pg.getLights()`, `__pg.exportLightsCode()`, `__pg.contactSheet()`); the online flow adds `window.__online`.
- **Wave pre-landing validation (`"validate the wave"` / `wave-landing-validator`):** whenever the user says **"validate the wave"** (or **"validate wave"**, **"validate WNN"**, **"review the wave"**), immediately activate [`wave-landing-validator`](./.agents/skills/wave-landing-validator/SKILL.md), run `npm run validate:wave` (auto-detects the current worktree or open wave, or pass `<NN>`), execute the mandatory **2-iteration review-and-fix loop** (fixing every gap and bug, enforcing full Test Pyramid coverage [unit + integration per major feature, backend E2E, and positive/negative/corner cases], eliminating AST function/block duplication, splitting new logic across thin orchestrators and focused services/parts, verifying end-to-end client + server + shared sim parity, and passing all test/domain gates via `npm run validate:wave -- <NN> --gates`), and return the 6-part structured validation summary.
- **Wave landing & main sync (`wave-land-and-sync`):** whenever the user says **"merge wave into main"** (or **"land wave into main"**) or **"merge main into wave"** (or **"sync main into wave"**), immediately activate [`wave-land-and-sync`](./.agents/skills/wave-land-and-sync/SKILL.md):
  - **Mode 1 ("merge wave into main" / `npm run wave:land -- NN`):** auto-detect `WNN` if omitted, merge `main` into `wave/wNN-<slug>` with generated-file auto-heal, run the **3-iteration** semantic collision + test/E2E + as-built audit loop, merge `--no-ff` into `main`, tag `wave-NN`, push, clean up the worktree/branch, and run `npm run wave:propagate -- NN` when wave plans exist.
  - **Mode 2 ("merge main into wave" / `npm run wave:sync -- NN [--sync-issues]`):** auto-detect the open WIP wave (or `--all`), save a recovery ref (`refs/wave-sync-backup/WNN`), merge updated `main` into `wave/wNN-<slug>` (and active `issue/WNN-XX` sub-worktrees) with generated-file auto-heal, and run the **3-iteration** reconciliation + test loop.
- **Developer reference ([`README.md`](./README.md) & [`infra/.env.example`](./infra/.env.example)):** online play URL parameters (`?scenario=`, `?host=local`, `&waves=`, `&lag=`, `&predict=0`, `&as=`, `&daynight=`, `&shadow=`), the in-game dev console (`` ` ``; `help`, `warp`, `time`, `spawn`, `grant`, `stage`, `away`, `back`, `offerTruce`, `chain.ping`, `near.ports`, `near.quote`), dev pages (`/dev/economy-sim/`, `/dev/chain/`, `/dev/parity/`) and `/v1/dev/*` routes, mock/live NEAR adapters, env variables, debug handles, and test commands are documented in [`README.md`](./README.md) and [`infra/.env.example`](./infra/.env.example). Keep both current in the same commit when adding or renaming parameters or env vars.

**Visual QA for 3D work (Pillar 4):** first run `npm run validate:models -- <id>` (numeric geometry check), then open the playground with `&validate=1` (or press `V`) to see offending parts outlined and numbered. The playground *is* the diagnostic turntable. After creating or changing an archetype or shader, open `/playground.html?inspect=<id>` and check `iso`, `front`, `side` and `top` (keys `1`–`4`). The info panel must show `ground contact ✔` (`minY 0.000`, or `minY -0.100 (−0.1 m plinth skirt)` for a building whose only sunk part is its `role: 'plinth'` foundation) and a triangle count under 3.5k. Check all three biomes for weathering. For game-flow changes, use `/play.html?planet=<kind>&skip=1` to land directly in gameplay.

---

## 5. Clean Root & Canonical Documentation (`D-41`)

Following the clean root folder rule (`D-41`), the repository root holds ONLY agentic files (`.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`), [`README.md`](./README.md), [`HACKATHON.md`](./HACKATHON.md), git files (`.git`, `.github/`, `.gitignore`), [`LICENSE`](./LICENSE), `package.json` (`package-lock.json`, `node_modules/`), and the **6 domain directories** (`backend/`, `frontend/`, `infra/`, `scripts/`, `shared/`, `tests/`). Do not add loose `.md` or config files to the repo root.

| Canonical File / Folder | Purpose |
| :--- | :--- |
| [`README.md`](./README.md) | Complete system overview, "Do X → See Y" verification steps, deployed Testnet contracts, 11-port honesty matrix, controls & CLI gates |
| [`HACKATHON.md`](./HACKATHON.md) | Official NEAR Hackathon rules, tracks, safety guardrails (never submit or sign Mainnet txs without explicit human confirmation) |
| [`frontend/whitepaper/whitepaper.md`](./frontend/whitepaper/whitepaper.md) | Outward-facing game, Guild AMM, 4-way settlement, Day-1 staking, Peace/War bond & protocol whitepaper (`node frontend/whitepaper/render.mjs` syncs `index.html`) |
| [`frontend/pitchdeck/index.html`](./frontend/pitchdeck/index.html) | 8-slide investor & judge deck covering gameplay, 4 income lanes, lossless staking, diplomacy escrows & `TerraAgent Protocol` |
| [`infra/.env.example`](./infra/.env.example) | Canonical environment variable template across `NEAR_MODE`, `AI_PROVIDER`, relayer caps, and `TerraAgent Protocol` fee/staking overrides |
| [`shared/sim/README.md`](./shared/sim/README.md) | Deterministic `@terra/sim` engine boundaries, ECS columns, movement (`SIM-M-01`), and placement invariants |

When moving or renaming any file or route, update every link to it (`git grep <name>`) so zero dead relative links remain.

---

## 6. Frontend & Repository Architecture (enforced)

```
frontend/
  index.html landing.html play.html trade.html me.html deed.html playground.html pitchdeck/ whitepaper/   thin page entries (Vite root = frontend/)
  public/assets/ SVG architecture schematics embedded by README.md and served statically
  design/       Faction Plate tokens + docs pages (shared layer: any app may import its CSS)
  landing/      app: main.ts (LandingPage orchestrator) + sections/ (economics, protocol, contractsBoard) + hero/ colony/ resources/
  game/         app: main.ts, app/ (Game, Gameplay, camera), ui/, features/, pages/, descent/ (DescentRunner + parts/ + fx/)
  trade/        24/7 CLOB orderbook, depth ladder, staker-aware OrderTicket, stall royalties & ta_bot_... API keys
  playground/   app: PlaygroundApp orchestrator + stage/ content/ camera/ panels/
  render/       3D render engine used by 2+ apps (`@terra/render/*`): core (viewport, StageHost), kitbash (+validate/),
                visuals, planets, orbit, descent (drop rig + handoff types), lighting, ui (CRT overlay)
shared/         code used by frontend AND backend: `contracts/`, `config/`, `db/`, `ledger/`, `sim/` (`@terra/*`, game rules, D-31)
backend/app/    the one NestJS app (D-24), including all 11 NEAR ports (`mock` / `testnet` / `mainnet`), `ai/`, `market/`, `game/`
backend/near-contracts/  6 Rust `near-sdk 5.7` smart contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`; 85 unit tests)
tests/          test suites: `tests/e2e/`, `tests/scenarios/`, `tests/vitest.config.ts`, `tests/vitest.integration.config.ts`, `tests/vitest.contract.config.ts`
infra/          deploy, docker, and environment configs (`infra/.env.example`, `infra/.env.worktree`, `docker/`, `hosts/`)
scripts/        developer, build, codegen, contract deploy, and structure check scripts (`dev/`, `ci/`, `gen/`, `wave/`)
```

`frontend/render/` draws things; `shared/sim/` decides things. A game rule never goes into `render/` or an app (D-31), and `render/` never imports `shared/sim` internals: apps pass sim views into it.

**Limits (checked by `npm run check:structure`, also part of `npm run build`):** no file over **500 lines**, no function (methods, closures, arrows included) over **100 lines**. Fix by extracting, not by compressing lines.

**Rules**
- **Layers point inward:** `render/` imports nothing from an app; an app imports `render/` (via `@terra/render/*`), the `shared/*` packages and itself, never another app. Code needed by two apps moves to `render/` (visual) or `shared/` (rules, contracts) first. `npm run check:structure` fails on a wrong-way import.
- **Orchestrators compose, parts do the work:** a big `createX()` closure becomes a thin orchestrator class (`DescentRunner`, `OrbitalStageImpl`, `PlaygroundApp`, `LandingPage`) that wires single-purpose parts, each in its own file under a subfolder (`parts/`, `stage/`, `panels/`, `sections/`). Keep the old factory name as the public entry when others import it.
- **One rule, one function (D-37):** a game rule the client previews and the server enforces (placement, validity, costs, bills) is a pure function in `shared/sim` over a read-only world (`evaluatePlacement` + `grid/geo.ts` for building placement); the `placeBuilding` handler (server and `?host=local`) and the client ghost both call it, the client never mutates world state and only sends commands, and a parity spec guards agreement. Never re-implement such a rule in `frontend/`.
- **Economy builds, queue and clock (D-42):** economy rows (extractors, generators, depots, …) are placed through `evaluatePlacement` (the row's placement rule, never a second check) and built on site by a worker through the W01 `build` command (job `job:<entityId>`, linked prep `job:<entityId>/prep`), not by a parallel progress system; which worker kind may build or prep is `dispatch/eligibility.ts`. Orders are paid progressively through the order queue (`systems/queue/`; waiting entries cost nothing, a cancel refunds through `refundCost`, which clamps at the storage cap); `enqueueTask` from a player source is capped at `player` precedence (`enqueueAuthority`). Day, night and daylight read the one planet solar clock (`systems/time`); never add a second clock or a client-side day counter. `npm run e2e -- --waves ..NN` boots the app with `TA_WAVES=..NN`, so every later wave's e2e must still pass with the waves above it off (`E2E_REUSE=1` and `--host local` keep the app's own setting).
- **Ground comes from the sim, not the renderer (D-38):** relief, classes, deposits and the hidden subsurface are generated by the world orchestrator in `shared/sim/src/gen/world/`; `frontend/render` only draws the sim's metre heights (plus cosmetic detail) and may import pure grid geometry (`@terra/sim/grid/hex`, `@terra/sim/grid/sectors`).
- **No copy/paste:** the second copy is the signal to extract a helper or base abstraction (`StageHost` is the shared rAF/visibility/resize host; `mulberry32` lives in `visuals/terrain/noise.ts`). Variation goes into registries/strategies (biomes, landforms, archetypes, validator stages), not `if` ladders.
- **GLSL** is split into named chunk constants composed by a builder, never one giant template string in a factory.
- **Build on the existing renderer:** `frontend/render` (viewport, kitbash, unified material, terrain/water, space, planets, orbit, descent rig, lighting) is the approved 3D look. New game features extend it or register into its registries (PRODUCT_WAVES §4 "One renderer" maps what to reuse for what); they never replace it or add a parallel renderer, and changing its look needs the owner's OK.
- **Pages stay thin:** HTML entries only load one `<script type="module">` (`main.ts`); logic lives in TypeScript, not inline or in plain `.js`.
- `.agents/skills/*/examples/` are reference copies for the skills, not app code; the app copies in `frontend/render/` are the source of truth.
- **Units move only by walking (SIM-M-01):** every bot input (player order, system work, death) is a unit command executed by the units runner; movement goes through the movement orchestrator and the pathfinding service, and only `shared/sim/src/units/movement/locomotion.ts` writes an entity's position (spawn: `placeSpawnedEntity`; admin `dev.*`: `adminRelocateEntity`). Never snap a unit to a target. The sim lint rejects position writes anywhere else. Details: `shared/sim/README.md` → Units.
- Pure refactors must keep behaviour identical: kitbash geometry unchanged (`npm run validate:models -- --all` same output), screenshots of `/play.html?planet=dune&seed=1&skip=1`, `/landing.html`, `/playground.html?inspect=<id>` unchanged.

---

## 7. NEAR, Smart Contracts & `TerraAgent Protocol` Constitution

- **11 Hexagonal NEAR Ports & 6 Rust WASM Contracts:** `backend/app/src/near/` binds all 11 ports (`ChainRead`, `Identity`, `Relayer`, `CargoToken`, `Intents`, `AgentWallet`, `DeedNft`, `BadgeNft`, `Escrow`, `Staking`, `TreasuryDao`) across `NEAR_MODE=mock|testnet|mainnet` (`mainnet` gated by `NEAR_ALLOW_MAINNET=1`) backed by 6 Rust `near-sdk 5.7` contracts (`backend/near-contracts/{res,deed,bounty,staking,dao,pilots}`) and 4 core accounts (`<root>`, `protocol.<root>`, `relayer.<root>`, `minter.<root>`).
- **WASM Build & Deploy Guardrail (`--cfg near`):** Always build contracts with `npm run near:build-contracts` (runs inside `backend/near-contracts` so `.cargo/config.toml` `--cfg near` emits `env::panic_str` errors instead of raw WASM `unreachable` traps), test with `npm run near:test-contracts` (`85/85` Rust unit tests), and deploy/verify via `npm run near:deploy-contracts -- --network testnet` (`--dry-run` for Mainnet unless the human explicitly confirms live Mainnet signing per [`HACKATHON.md`](./HACKATHON.md)).
- **`TerraAgent Protocol` (`protocol.<root>`, `GET /v1/near/protocol`, `/landing.html#protocol`):**
  - **3 Organic Inflows:** `80%` of platform trade fees (`0.80%` standard / `0.40%` staker; `20%` carves out to Planet Council DAO), `20%` of validator staking yield (`1.80%` APY; pilot keeps `100%` principal + `7.20%` net APY), and `10%` of slashed Peace/War escrow bonds (`90%` paid to betrayed treaty partner or war defender).
  - **2 Infrastructure Outflows:** Sponsors `NEP-366` gasless meta-transactions (`relayer.<root>`) and server-hosted Managed `NEAR.AI` Autopilot (`z-ai/glm-5.3-flash` TEE batching).
  - **Zero-P2W Day-1 Staking & AI Safety:** Claimed human accounts can stake from Day 1 (`>= 10 NEAR` unlocks Managed `NEAR.AI` Autopilot + `50%` platform trade fee cut `1.00% -> 0.50%`, while custom `/me.html` BYOK remains free; `@terra/sim` never reads staking state). AI callers receive `403 AI_STAKING_FORBIDDEN`, and `AW-13` blocks AI from canceling truces/wars or locking human `NEAR`.
  - **Tunable Protocol Env Vars ([`infra/.env.example`](./infra/.env.example)):** `NEAR_PROTOCOL_ACCOUNT`, `NEAR_PLATFORM_FEE_BP` (`100`), `NEAR_STAKER_PLATFORM_FEE_BP` (`50`), `NEAR_DAO_FEE_SHARE_BP` (`2000`), `NEAR_STAKER_MIN_NEAR` (`10`), `NEAR_PROTOCOL_STAKING_YIELD_BP` (`2000`), `NEAR_ESCROW_SLASH_PROTOCOL_BP` (`1000`).
