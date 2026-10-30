# TerraAgent — AI Agent Architecture & 3D Visuals Constitution

Welcome to **TerraAgent** (Autonomous Colony Builder on Web / Three.js / NEAR).

Whenever you are asked to create, modify, or debug **3D models, procedural geometry, `.glb` assets, textures, shaders, lighting, or Three.js scenes**, you MUST follow the **4 Visual Pillars** and activate the corresponding workspace skill in `.agents/skills/`.

---

## 1. Mandatory Skill Routing Table

Before writing any 3D, shader, or asset-pipeline code, read the `SKILL.md` for the relevant domain:

| Task / Domain | Activate Skill | Location |
| :--- | :--- | :--- |
| **Procedural 3D Models in Code** (Robots, Buildings, Turrets, Stations, Greebles, `InstancedMesh` merging) | `procedural-kitbash-3d` | [.agents/skills/procedural-kitbash-3d/SKILL.md](./.agents/skills/procedural-kitbash-3d/SKILL.md) |
| **Model Validation: geometry, colours, detail** (floating or disconnected parts, hairline gaps, parts cutting through each other, z-fighting, cables clipping, animated parts hitting something; wheels/chassis/arm in one colour, a solar panel that is a flat slab, blank faces, flat palette; run after ANY kitbash change) | `model-geometry-validator` | [.agents/skills/model-geometry-validator/SKILL.md](./.agents/skills/model-geometry-validator/SKILL.md) |
| **External AI 3D Models & Blender MCP** (2D-to-3D via TRELLIS.2 / Rodin / Tripo, `.glb` optimization, pivot & scale normalization) | `ai-mesh-pipeline` | [.agents/skills/ai-mesh-pipeline/SKILL.md](./.agents/skills/ai-mesh-pipeline/SKILL.md) |
| **Procedural PBR Textures** (Canvas2D / `DataTexture` Normal maps via Sobel filter, Hull panels, Solar hex grids, Hazard stripes) | `procedural-texture-synthesis` | [.agents/skills/procedural-texture-synthesis/SKILL.md](./.agents/skills/procedural-texture-synthesis/SKILL.md) |
| **Shaders, Materials & Terrain/Water** (Unifier Shader, Triplanar grain, Planet dust/frost weathering, Terraforming wave, Hydro water) | `shader-texture-tuning` | [.agents/skills/shader-texture-tuning/SKILL.md](./.agents/skills/shader-texture-tuning/SKILL.md) |
| **Dynamic Lighting & 3D Lightning Hazards** (Orbital day/night solar cycle, Pooled PointLights, 3D jagged lightning bolts, Grid overload arcs) | `planetary-lighting-and-lightning` | [.agents/skills/planetary-lighting-and-lightning/SKILL.md](./.agents/skills/planetary-lighting-and-lightning/SKILL.md) |
| **Scene Viewport, Post-Processing & Visual QA** (28° Telephoto Isometric Diorama, PMREM IBL, Selective Bloom, 4-View Screenshot Audit) | `diorama-viewport-auditor` | [.agents/skills/diorama-viewport-auditor/SKILL.md](./.agents/skills/diorama-viewport-auditor/SKILL.md) |

---

## 2. Non-Negotiable Visual Quality Guardrails (The 4 Pillars)

1. **Pillar 1 — Modular Kitbashing Over Raw Primitives (`procedural-kitbash-3d`):**
   - **Never** use raw sharp `THREE.BoxGeometry` for hulls or chassis; always use `RoundedBoxGeometry` or beveled profiles so edges catch specular highlights.
   - Enforce the **60 / 30 / 10 Material Hierarchy**: 60% Primary Hull (`hullPrimary`), 30% Dark Gunmetal Skeleton (`frameGunmetal`), 10% Faction Accent & HDR Emissive (`hullSecondary` + `energyCyan` / `warningAmber` with `emissiveIntensity >= 3.0`).
   - **Every new or edited kitbash model MUST pass `npm run validate:models -- <archetype id>` (skill `model-geometry-validator`) with 0 errors and 0 warnings before the visual check:** every part overlaps its support by ≥ 1 cm, insets stand proud of their frames, cables end on anchors, and animated parts keep ≥ 1 cm clearance over their whole motion. The same run checks appearance: functional groups (wheels, platform, manipulator) have different colours, a thin inset never shares its base's colour, functional parts show their function in geometry (a solar panel is a cell grid with bus bars, a wheel has a rim and hub) and every large face carries mounted detail. There are no image textures on kitbash models, so colour and detail come from zones and geometry.
   - Every robot or building must combine **$\ge 7$ sub-parts**, include a **silhouette breaker** (sagging `CatmullRomCurve3` cable, angled antenna, radar dish, or solar wing), and merge into a single `BufferGeometry` with GPU animation vertex attributes (`aPartAnim`).
2. **Pillar 2 — Sanitized 2D-to-3D Asset Pipeline (`ai-mesh-pipeline`):**
   - Never use direct Text-to-3D or load raw `.glb` exports directly.
   - Always generate an isolated white-background orthographic 2D concept (zero cast shadows) $\rightarrow$ reconstruct 3D $\rightarrow$ run `node .agents/skills/ai-mesh-pipeline/scripts/sanitize-glb.mjs` to weld, decimate (`<3.5k` tris), snap pivot to bottom-center (`Y = 0`), compress textures to `512px` WebP, and clamp roughness (`>= 0.45`).
3. **Pillar 3 — The Unifier Shader Architecture (`shader-texture-tuning`):**
   - Apply `createUnifiedColonyMaterial()` so both procedural meshes and imported `.glb` models share **Triplanar surface grain** (bypassing bad AI UVs), **Vertical Ground-Up Biome Weathering** (blending desert dust, ice frost, or temperate moss onto the bottom `0m–1.1m`), and **Fresnel silhouette rim lighting**.
4. **Pillar 4 — Tabletop Diorama Viewport & Visual QA (`diorama-viewport-auditor`):**
   - Render with a `28°` FOV telephoto isometric camera, `ACESFilmicToneMapping`, `RoomEnvironment` PMREM IBL, and selective `UnrealBloomPass` (`threshold: 1.1`).
   - Always visually inspect newly created 3D models or shaders across the 4 diagnostic views (`iso`, `front`, `side`, `top`) to verify ground contact (`minY == 0`) and part connectivity.

---

## 3. Extension Architecture

All seven skills are designed as open registries so you can extend the visual system without modifying core engine loops:
- **New Kitbash Greebles & Unit Archetypes:** Register via `KitbashRegistry.registerGreeble()` and `KitbashRegistry.registerArchetype()` in `procedural-kitbash-3d`.
- **New AI 3D Providers:** Implement `Ai3dProviderAdapter` and pipe into `sanitizeAiGlb()` in `ai-mesh-pipeline`.
- **New Geometry Checks:** Add to `frontend/shared/engine/kitbash/validate/checks/` (one stage per file, wired in `ModelValidator.ts`) plus a known-bad and a known-good fixture in `model-geometry-validator/scripts/self-test.mjs` (`npm run test:models`).
- **New Procedural PBR Texture Patterns:** Register via `ProceduralTextureRegistry.register()` + `heightToNormalTexture()` in `procedural-texture-synthesis`.
- **New Planet Biomes & Shader Effects:** Register via `BiomeMaterialRegistry.registerBiome()` and `ShaderPluginRegistry.registerModifier()` in `shader-texture-tuning`.
- **New Weather States & Lightning/Plasma Arcs:** Register via `WeatherPresetRegistry.register()` and `LightningStrikeSystem` in `planetary-lighting-and-lightning`.

---

## 4. Pages, Dev Server & Visual QA

One Vite app, several HTML entries (`vite.config.ts` → `rollupOptions.input`, Vite root `frontend/`). Run `npm run dev`; it serves http://127.0.0.1:5173/. Full parameter and control reference: [README.md](./README.md#pages).

| URL | Purpose | Edit here |
| :--- | :--- | :--- |
| `/` (`frontend/index.html`) | **Hub**: links to every page below. Static HTML + CSS. | `frontend/index.html` |
| `/landing.html` | **Landing** (terraagent.com). Planet cards deep-link to `/play.html?planet=<kind>`. | `frontend/landing.html`, `frontend/landing/` (`main.ts`, `sections/`, `landing.css`) |
| `/play.html` | **Game**: orbit menu → descent → colony diorama. Params: `?planet=dune\|oceanForest\|forestRock&seed=<n>&skip=1\|deploy=1\|t=<s>`. | `frontend/game/app/`, `frontend/game/ui/`, `frontend/game/descent/` |
| `/playground.html` | **3D playground**, the model storybook: every `ArchetypeCatalog` entry with 4 diagnostic views, biome switch, tri budget and `minY` checks. Params: `?inspect=<id>&biome=<kind>&view=iso\|front\|side\|top&turntable=1&surface=1`. | `frontend/playground/` |
| `/design/` | **Faction Plate** design system docs (foundations, UI storybook, motion). |  `frontend/design/` |

**Page and UI rules:**
- **All HTML/CSS chrome** (menus, HUDs, panels, buttons, overlays) MUST use the Faction Plate tokens from `frontend/design/css/tokens.css` + `base.css`. Use `--ta-*` variables, never raw hex. Corners are chamfered (`.plate*`, `.btn*`), never `border-radius` (planet thumbnails are the only round exception). Orange = action/selection (≈10 %), blue = systems/reference (≈5 %), void text on orange (never white).
- Pages that import `base.css` already get its `.btn`, `.card`, `.input`, `.label` classes. Don't reuse those names for page-specific components (the playground uses `.pg-btn`, the game menu uses `.world-card`).
- A new page MUST be added to `rollupOptions.input`, linked from the hub (`frontend/index.html`), and must use `<script type="module">` (classic scripts are not bundled).
- Debug handles: `window.__game` (game; `__game.debug`, `__game.setPaused(true)`) and `window.__pg` (playground; `__pg.select(id)`, `__pg.setView(v)`, `__pg.contactSheet()`).

**Visual QA for 3D work (Pillar 4):** first run `npm run validate:models -- <id>` (numeric geometry check), then open the playground with `&validate=1` (or press `V`) to see offending parts outlined and numbered. The playground *is* the diagnostic turntable. After creating or changing an archetype or shader, open `/playground.html?inspect=<id>` and check `iso`, `front`, `side` and `top` (or press `4-VIEW SHEET`). The info panel must show `ground contact ✔ minY 0.000` and a triangle count under 3.5k. Check all three biomes for weathering. For game-flow changes, use `/play.html?planet=<kind>&skip=1` to land directly in gameplay.

---

## 5. Where documents live

Everything that is not code goes in `docs/` (index: [docs/README.md](./docs/README.md)). Do not add loose `.md` files to the repo root: only `README.md`, `AGENTS.md` and `CLAUDE.md` belong there.

| Folder | Put here |
| :--- | :--- |
| `docs/game/` | Game design: economy, units, NEAR features |
| `docs/spec/` | Online architecture and decisions (`DECISIONS.md` is the source of truth) |
| `docs/plan/` | Build plans, status boards, owner tasks |
| `docs/visuals/` | 3D coding rules, AI-mesh pipeline, procedural textures, shaders, lighting |

When you move or rename a document, update every link to it (`grep -r <name> --include='*.md'`), and keep relative links working.

---

## 6. Frontend Architecture (enforced)

```
frontend/
  index.html landing.html play.html playground.html   thin page entries (Vite root = frontend/)
  design/       Faction Plate tokens + docs pages
  landing/      app: main.ts (LandingPage orchestrator) + sections/ hero/ colony/ resources/
  game/         app: main.ts, app/ (Game, Gameplay, camera), ui/, descent/ (DescentRunner + parts/ + fx/)
  playground/   app: PlaygroundApp orchestrator + stage/ content/ camera/ panels/
  shared/       only code used by 2+ apps (import via `@shared/*`)
    engine/     core (viewport, StageHost), kitbash (+validate/), visuals, planets, orbit, lighting
    ui/         CRT overlay
```

**Limits (checked by `npm run check:structure`, also part of `npm run build`):** no file over **500 lines**, no function (methods, closures, arrows included) over **100 lines**. Fix by extracting, not by compressing lines.

**Rules**
- **Layers point inward:** `shared/` imports nothing from an app; an app imports `shared/` (via `@shared/*`) and itself, never another app. Code needed by two apps moves to `shared/` first.
- **Orchestrators compose, parts do the work:** a big `createX()` closure becomes a thin orchestrator class (`DescentRunner`, `OrbitalStageImpl`, `PlaygroundApp`, `LandingPage`) that wires single-purpose parts, each in its own file under a subfolder (`parts/`, `stage/`, `panels/`, `sections/`). Keep the old factory name as the public entry when others import it.
- **No copy/paste:** the second copy is the signal to extract a helper or base abstraction (`StageHost` is the shared rAF/visibility/resize host; `mulberry32` lives in `visuals/terrain/noise.ts`). Variation goes into registries/strategies (biomes, landforms, archetypes, validator stages), not `if` ladders.
- **GLSL** is split into named chunk constants composed by a builder, never one giant template string in a factory.
- **Pages stay thin:** HTML entries only load one `<script type="module">` (`main.ts`); logic lives in TypeScript, not inline or in plain `.js`.
- `.agents/skills/*/examples/` are reference copies for the skills, not app code; the app copies in `frontend/shared/engine/` are the source of truth.
- Pure refactors must keep behaviour identical: kitbash geometry unchanged (`npm run validate:models -- --all` same output), screenshots of `/play.html?planet=dune&seed=1&skip=1`, `/landing.html`, `/playground.html?inspect=<id>` unchanged.
