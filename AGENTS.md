# TerraAgent — AI Agent Architecture & 3D Visuals Constitution

Welcome to **TerraAgent** (Autonomous Colony Builder on Web / Three.js / NEAR).

Whenever you are asked to create, modify, or debug **3D models, procedural geometry, `.glb` assets, textures, shaders, lighting, or Three.js scenes**, you MUST follow the **4 Visual Pillars** and activate the corresponding workspace skill in `.agents/skills/`.

---

## 1. Mandatory Skill Routing Table

Before writing any 3D, shader, or asset-pipeline code, read the `SKILL.md` for the relevant domain:

| Task / Domain | Activate Skill | Location |
| :--- | :--- | :--- |
| **Procedural 3D Models in Code** (Robots, Buildings, Turrets, Stations, Greebles, `InstancedMesh` merging) | `procedural-kitbash-3d` | [.agents/skills/procedural-kitbash-3d/SKILL.md](./.agents/skills/procedural-kitbash-3d/SKILL.md) |
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

All six skills are designed as open registries so you can extend the visual system without modifying core engine loops:
- **New Kitbash Greebles & Unit Archetypes:** Register via `KitbashRegistry.registerGreeble()` and `KitbashRegistry.registerArchetype()` in `procedural-kitbash-3d`.
- **New AI 3D Providers:** Implement `Ai3dProviderAdapter` and pipe into `sanitizeAiGlb()` in `ai-mesh-pipeline`.
- **New Procedural PBR Texture Patterns:** Register via `ProceduralTextureRegistry.register()` + `heightToNormalTexture()` in `procedural-texture-synthesis`.
- **New Planet Biomes & Shader Effects:** Register via `BiomeMaterialRegistry.registerBiome()` and `ShaderPluginRegistry.registerModifier()` in `shader-texture-tuning`.
- **New Weather States & Lightning/Plasma Arcs:** Register via `WeatherPresetRegistry.register()` and `LightningStrikeSystem` in `planetary-lighting-and-lightning`.

---

## 4. Pages, Dev Server & Visual QA

One Vite app, several HTML entries (`vite.config.ts` → `rollupOptions.input`). Run `npm run dev`; it serves http://127.0.0.1:5173/. Full parameter and control reference: [README.md](./README.md#pages).

| URL | Purpose | Edit here |
| :--- | :--- | :--- |
| `/` (`index.html`) | **Hub**: links to every page below. Static HTML + CSS. | `index.html` |
| `/landing.html` | **Landing** (terraagent.com). Planet cards deep-link to `/play.html?planet=<kind>`. | `landing.html`, `frontend/design/js/landing.js`, `frontend/design/css/landing.css` |
| `/play.html` | **Game**: orbit menu → descent → colony diorama. Params: `?planet=dune\|oceanForest\|forestRock&seed=<n>&skip=1\|deploy=1\|t=<s>`. | `src/game/`, `src/ui/` |
| `/playground.html` | **3D playground**, the model storybook: every `ArchetypeCatalog` entry with 4 diagnostic views, biome switch, tri budget and `minY` checks. Params: `?inspect=<id>&biome=<kind>&view=iso\|front\|side\|top&turntable=1&surface=1`. | `src/playground/` |
| `/frontend/design/` | **Faction Plate** design system docs (foundations, UI storybook, motion). `frontend/design/landing.html` is the mock-up; the live page is the root `landing.html`. | `frontend/design/` |

**Page and UI rules:**
- **All HTML/CSS chrome** (menus, HUDs, panels, buttons, overlays) MUST use the Faction Plate tokens from `frontend/design/css/tokens.css` + `base.css`. Use `--ta-*` variables, never raw hex. Corners are chamfered (`.plate*`, `.btn*`), never `border-radius` (planet thumbnails are the only round exception). Orange = action/selection (≈10 %), blue = systems/reference (≈5 %), void text on orange (never white).
- Pages that import `base.css` already get its `.btn`, `.card`, `.input`, `.label` classes. Don't reuse those names for page-specific components (the playground uses `.pg-btn`, the game menu uses `.world-card`).
- A new page MUST be added to `rollupOptions.input`, linked from the hub (`index.html`), and must use `<script type="module">` (classic scripts are not bundled).
- Debug handles: `window.__game` (game; `__game.debug`, `__game.setPaused(true)`) and `window.__pg` (playground; `__pg.select(id)`, `__pg.setView(v)`, `__pg.contactSheet()`).

**Visual QA for 3D work (Pillar 4):** the playground *is* the diagnostic turntable. After creating or changing an archetype or shader, open `/playground.html?inspect=<id>` and check `iso`, `front`, `side` and `top` (or press `4-VIEW SHEET`). The info panel must show `ground contact ✔ minY 0.000` and a triangle count under 3.5k. Check all three biomes for weathering. For game-flow changes, use `/play.html?planet=<kind>&skip=1` to land directly in gameplay.
