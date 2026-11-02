# TerraAgent — Procedural Texturing, Shaders, Lighting & Lightning VFX Specification

**Target Project:** Autonomous Colony Builder (NEAR Hackathon 2026)  
**Scope:** Zero-External-Asset Procedural PBR Texturing, Terrain/Water/VFX Shaders, Dynamic Planetary Lighting, and Procedural 3D Lightning Hazard System

---

## 1. Why Procedural Texturing + Unified Shaders Beat Static Texture Files

When AI coding agents build 3D games, static `.png`/`.jpg` texture files are a major bottleneck:
- Coding agents cannot directly "paint" binary PNG files in code, so they fall back to untextured solid colors.
- External textures from different sources have mismatched texel densities, seams, and megabytes of download overhead.

### The Solution: Startup Canvas2D / `DataTexture` PBR Synthesis (`< 25ms`)
By synthesizing tileable `512x512` Height, Normal (via Sobel filter), Roughness, and Emissive maps on an offscreen `<canvas>` or `Uint8Array` `DataTexture` at startup:
1. **Coding agents have 100% programmatic control** over panel seams, rivets, hexagonal solar cells, hazard stripes, and rock/sand/ice strata.
2. **Automatic Normal Maps:** Agents only draw a grayscale height pattern (`0.0 = groove`, `1.0 = raised plate`); the `heightToNormalMap()` utility automatically computes tangent-space `RGB` normal maps so every panel line catches directional sunlight!
3. **Combined with Triplanar Mapping:** Even meshes with zero or broken UV coordinates receive crisp, distortion-free panel lines and surface grain.

```mermaid
flowchart LR
    subgraph TexGen["1. Procedural PBR Synthesizer (Startup <25ms)"]
        H["Grayscale Height Canvas\n(Sci-Fi Panels, Hex Grid,\nHazard Stripes, Rock Noise)"]
        S["Sobel Filter Converter\n(heightToNormalMap)"]
        R["Roughness & Metalness\nChannel Packer"]
        H --> S
        H --> R
    end

    subgraph Shaders["2. Shader Pipeline (TSL / GLSL)"]
        U["UnifiedColonyMaterial\n(Triplanar + Biome Dust + Rim)"]
        T["TerrainTerraformShader\n(Biome Splat + Emerald Wave)"]
        W["HydroWaterShader\n(Dual-Normal Ripple + Foam)"]
    end

    subgraph LightVFX["3. Lighting & Hazard VFX"]
        L1["PlanetaryLightingSystem\n(Solar Orbit, Shadow Tracker,\nPooled PointLights)"]
        L2["LightningStrikeSystem\n(Midpoint Displacement Bolts,\nSky Flash, Grid Overload Arcs)"]
    end

    TexGen --> Shaders
    L1 --> Shaders
    L2 --> L1
```

---

## 2. Procedural Texture Catalog (`procedural-texture-synthesis`)

Every colony structure, robot, and terrain tile draws from 5 core procedural PBR texture generators:

| Generator ID | Generated Maps | Visual Pattern | Used On |
| :--- | :--- | :--- | :--- |
| `scifiHullPanels` | `normalMap`, `roughnessMap`, `aoMap` | Interlocking chamfered rectangular plates, recessed seam grooves, corner bolt indentations, and micro-scratches. | Robot hulls, Factories, Rocket Silo, Command Hub |
| `solarHexGrid` | `map`, `normalMap`, `roughnessMap`, `emissiveMap` | Deep photovoltaic blue hexagonal cells framed by raised silver busbars and subtle cyan charge glow. | Solar Stations, Satellite Wings |
| `industrialHazardStripes` | `map`, `roughnessMap` | 45-degree alternating safety-amber (`#E59838`) and dark gunmetal (`#242933`) caution stripes with edge wear. | Foundation plinths, Miner bumpers, Landing pads |
| `CoolingLouverVents` | `normalMap`, `aoMap`, `emissiveMap` | Parallel Recessed dark slats with optional internal thermal orange/cyan heat glow. | Nuclear Reactors, Generators, Robot exhausts |
| `biomeTerrainNoise` | `DataTexture (RGBA)` | `R`: Multi-octave FBM height, `G`: Voronoi rock cracks, `B`: Moisture/ripple mask, `A`: Detail grain. | Temperate, Arid Desert, and Ice terrain + Ground-Up Weathering |

---

## 3. Core Game Shader Systems (`shader-texture-tuning`)

### 3.1 Multi-Biome Terrain & Dynamic Terraforming Frontier Shader
- **Inputs:**
  - `uTerraformMap` (`256x256` dynamic `DataTexture` updated whenever terraforming machines operate).
  - Biome preset colors (`barrenLow`, `barrenHigh`, `slopeRock`, `terraformedLush`).
- **Shader Logic:**
  1. **Slope & Elevation Splatting:** Steep slopes (`normal.y < 0.75`) automatically expose striated cliff rock via triplanar projection; flat basins accumulate sand/snow/soil.
  2. **Terraforming Wave Transition:** Where `uTerraformMap.r` crosses `0.5`, the shader renders a **glowing HDR emerald plasma ring** (`COLONY_PALETTE.terraformEmerald`, `intensity: 3.5`) with animated hex scanlines, smoothly morphing barren dust into lush terraformed ground inside the radius.

### 3.2 Hydro / Coolant / Ice-Thaw Water Shader
- Used for **Temperate rivers**, **Hydro Energy Stations**, and **Terraforming Thaws**:
  1. **Dual-Scrolling Procedural Normals:** Two octaves of procedural wave normals scrolling at opposing angles (`vec2(1.0, 0.4)` and `vec2(-0.6, 0.8)`) create shimmering specular sun reflections.
  2. **Depth & Shoreline Foam:** Compares fragment height against terrain height (`waterY - terrainY`); shallow edges (`< 0.18m`) render crisp animated white shoreline foam and higher transparency.

### 3.3 Game-flow terrain and construction terms (W01)
- **Hex terrain** (`frontend/render/planets/hex/`): the sim's tile classes tint the shared terrain shader per tile (`vTileColor`); hex edge lines are a shader term (`hexEdges.ts`, no line geometry). A tile that becomes **Prepared** plays a 0.4 s pad wave (`PREP_BLEND_DURATION_S`, built into the GLSL from the TS constant) that blends in the engineered hex-plate pad (`foundationHexPad` bundle, 128², bound only on the hex material). **Territory borders** are ribbons whose every vertex sits 3.5 cm above the interpolated terrain surface (normal 8 cm, frozen 18 cm wide), with per-colony angled hatch ribs in colour-blind mode. **Construction scaffold** is the `buildScaffold` shader modifier (`ShaderPluginRegistry`, `visuals/unified/buildScaffold.ts`, on for every `createArchetypeMesh`): the CPU quantizes progress to 0 / 33 / 66 / 100 % (`uBuildStage`), and the amber/cyan holo-lattice starts above a laser cut at 3.8 % / 25 % / 58 % of the model's own height (`uBuildHeight`; on the Command Hub 0.25 / 1.65 / 3.85 m). The biped **work pose** (`uWorkWeight` 0..1) tilts the arms forward on top of the gait. All of these can be checked in `/playground.html?hexterrain=1&hatch=1&build=33&work=1` (toolbar: `hex terrain`, `border hatch`, `work pose`, `build`).

---

## 4. Dynamic Planetary Lighting System (`planetary-lighting-and-lightning`)

In `docs/game/autonomous-colony-spec.md`, **Solar Energy depends on time of day and weather**, and **Night / Storms** create tactical vulnerability. The lighting system links simulation state directly to Three.js rendering:

### 4.1 Orbital Solar Cycle, Sun Color & Shadow Modulation (`dayNightConfig.ts` + `@terra/sim`)
- Controlled by 24-hour planetary solar time `timeOfDay` (`0..24h`, orbital phase $\text{phase} = ((\text{hour} - 6) / 24) \bmod 1$, `solarElevation = sin(phase * 2π)` in `frontend/render/core/dayNightConfig.ts`):
  - **Midday (`10:00 – 14:00`, `elevation > 0.35`):** Crisp high-angle shadows (`shadowIntensityMult: 1.0`, `shadowSoftnessMult: 0.95`), Planckian blackbody noon sun color (`noonTempK`: `3500K–8500K`, default `5800K` $\approx$ `0xfff5e4`, `sunIntensityMult: 1.05`), 100% Solar Station output.
  - **Dawn / Dusk Golden Hour (`05:30 – 08:00`, `16:00 – 18:30`, `elevation` `0.0` to `0.55`):** Sun angle drops toward `9°–25°`, `sun.color` shifts to warm golden-amber at dawn (`0xff8a3d`) and deep crimson-coral at dusk (`0xff5e2b`, scaled by `sunWarmth`), casting long, softer penumbra shadows (`shadowIntensityMult: 0.75`, `shadowSoftnessMult: 1.35`), 35%–80% Solar output.
  - **Night (`19:00 – 05:00`, `elevation < 0.0`):** Key light transitions to cool orbital moonlight (`0x6498e8`, scaled by `nightBrightness`), shadow contrast softens into diffused night penumbras (`shadowIntensityMult: 0.22–0.38`, `shadowSoftnessMult: 1.75`), sky dome and exponential fog shift to deep nocturnal indigo, and `UnrealBloomPass` strength boosts (`+0.12`) so colony emissives and headlights pop.
- **Interactive Tuning (`F8` Visual Shader Lab — 4th `DAY/NIGHT` Tab):**
  - Alongside `CRT`, `PIXEL`, and `SHADOW`, the `DAY/NIGHT` tab (`frontend/render/ui/pixelDialog.ts`, `visualLabSpecs.ts`) exposes live sliders for `timeOfDay` (`0..24h` + `DAWN`/`DAY`/`DUSK`/`NIGHT` readout), `dayLengthHours` (`0.02..24h`), `timeScale` (`0..20×` in UI, up to `1000×` via console), `noonTempK` (`3500..8500K`), `sunWarmth` (`0..2`), and `nightBrightness` (`0.05..1`).
- **Authoritative Server + Client Time Sync (`@terra/sim` + `dayNightSync.ts`):**
  - Each planet maintains an authoritative solar clock in `blobs.planetTime` (`shared/sim/src/systems/time/index.ts`, `shared/sim/src/data/time.ts`, default `realHoursPerDay = 0.25`, `timeScale = 1`, `initialTimeOfDay = 9.0`, overridable on server boot via `PLANET_DAY_HOURS` / `PLANET_TIME_SCALE`).
  - `bindOnlineDayNightSync` (`frontend/game/app/online/dayNightSync.ts`) interpolates `computePlanetTimeAtTick` against `store.serverTickF()` every frame across both singleplayer (`?host=local`) and multiplayer (`PlanetHost`), and dispatches throttled (`<= 8 Hz`) `setPlanetTime` / `dev.time` commands when the player scrubs time sliders in `F8` or runs `time` in the `` ` `` dev console.

### 4.2 Zero-Stutter Pooled Dynamic Point Lights (`LightPool`)
- **Problem:** Adding or removing `THREE.PointLight` objects at runtime forces Three.js to recompile every PBR shader in the scene, causing a `100ms–400ms` frame freeze!
- **Best Practice Solution:** Pre-allocate a fixed pool of **8 `THREE.PointLight` instances** at scene init with `intensity = 0` and `distance = 12`.
- Whenever a mining laser fires, a lightning bolt strikes, a turret shoots, or a rocket ignites, lease a light from `LightPool`, tween its intensity/position, and return it to `intensity = 0` when finished—**zero shader recompilations ever**.

### 4.3 Target-Following Shadow Frustum & Contact-Hardening Soft Shadows
- Every frame, `followShadowTarget` (`frontend/render/core/shadowConfig.ts`) snaps `sun.target.position` and `sun.position` in light-space texel increments (`2 × texelWorld`) so panning the RTS camera never causes shadow-edge swimming.
- `installShadowShaderPatch` replaces Three.js's harsh hardware step shadow lookup with a smooth 9-tap cubic-bilinear contact-hardening filter (`taSampleShadowSoft`) and attenuates indirect hemisphere/IBL irradiance (`taAmbOcc`) inside shadowed regions.

---

## 5. Procedural 3D Lightning & Weather Hazard System

Section 6 of `docs/game/autonomous-colony-spec.md` specifies **Lightning (damages power grid)**, **Sandstorms**, **Blizzards**, and **Radiation Anomalies**.

### 5.1 Midpoint-Displacement 3D Lightning Bolts
Instead of flat 2D sprites, lightning strikes are generated procedurally in 3D:
1. **Main Trunk:** Subdivide the segment from sky `(targetX + jitter, 45, targetZ + jitter)` to the target building `(targetX, buildingTopY, targetZ)` across 6 recursive midpoint-displacement passes (`offset *= 0.5` per pass).
2. **Branching Forks:** At 30% of interior nodes, spawn secondary child branches angled outward at `25°–40°` that taper to zero radius.
3. **HDR Plasma Material:** Render using an additive/unlit `MeshBasicMaterial` with HDR color `[0.4 * 6.0, 0.85 * 6.0, 1.0 * 6.0]` so `UnrealBloomPass` surrounds the jagged core with an intense electric corona.
4. **Synchronized Multi-Sensory Impact:**
   - **Sky Exposure Flash:** Spikes `hemiLight.intensity` by `+4.0` with a double-flicker decay curve (`t = 0ms`, `t = 70ms`).
   - **Pooled PointLight Flash:** Leases a `LightPool` node at the impact point (`intensity: 15.0`, `distance: 25m`) casting real local illumination on nearby robots and buildings.
   - **Power-Grid Overload Arcs:** When a power station is damaged by lightning, smaller procedural electric arcs jump across its hull every `0.4s` until repaired by a robot!
