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
        W["WaterMaterial\n(Gerstner + Volume + Foam)"]
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

### 3.2 Water surface, wind and fauna (`frontend/render/visuals/water/`)
- **One material for every water** (`WaterMaterial.ts`, GLSL chunks in `glsl/`; `createWater` in `visuals/terrain/Liquids.ts` is the thin entry): `MeshStandardMaterial` + `onBeforeCompile`, one pass, no reflection/refraction render targets. Quality tiers by the `WATER_QUALITY` define (F8 → WATER): LOW 2 waves; MED 3 waves + 1 ripple octave + caustics; HIGH 4 waves + 2 ripple octaves + caustics + refracted-bed parallax (2 field fetches).
  1. **Waves:** wind-driven Gerstner sum (directions = wind ± spread, deep-water dispersion ω = √(g·k), amplitude from the local gusty `windStrengthAt`), long components in the vertex shader (the hex water lattice is 2 m), the rest as analytic per-pixel normals; clock `uWaterTime` integrated on the CPU.
  2. **Volume:** per-channel Beer–Lambert along the refracted path sets colour and alpha; the terrain shader tints the ground under water with the same extinction (`glsl/bed.ts`), since the blended surface cannot tint it per channel.
  3. **Foam:** shore band + wave-front lines from the baked shore-distance field (`shoreField.ts`: 512² RGBA, R bed height, G distance to dry ground, B mask; exact EDT, rebuilt only when water tiles change), stronger on shores the wind blows onto; whitecaps from the Gerstner Jacobian.
  4. **Reflections:** PBR sun specular + IBL with wind roughness and specular AA, an extra sun glint, and bot / building projector reflections from the shared projector loop (`colonyProjectorLighting`, diffuse + specular in one loop).
- **Wind** (`core/windConfig.ts`, F8 → WIND): one shared, visual-only state (direction, strength, gust fronts, turbulence) for tree sway (colour and shadow programs; per-tree frequency, mass, phase and orbit from a position hash + size, inertia from gust samples downwind, trunk sway + crown shiver + flutter, off outside the view focus), ambient dust/pollen drift (`Particles.ts`, `planets/hex/hexAmbient.ts`), hex dune ripple orientation and wave direction. Phase and drift are integrated on the CPU so slider moves never jump.
- **View focus** (`core/viewFocus.ts`, `?focus=0` to compare): the camera's ground footprint quad (screen corners on the ground) × F8 PERF margin (default 1.0) + 4 m, bounded by a circle; shadow boxes fit it (`core/shadowFit.ts`), props are 32/64 m instanced buckets culled to the frustum and the focus (`planets/hex/propBuckets.ts`), only projectors touching it are uploaded, trees and water outside it stop moving. Soft shadows (`core/shadowShaderPatch.ts`) run their 36-read filter only in penumbrae (the 5-read blocker search exits when all probes agree). Limits RN-46, RN-47, RN-52.
- **Fauna** (`water/fauna/`): fish (≤ 128 × 42 tris) and bioluminescent jellyfish (≤ 24 × 104 tris, deep water only), each kind one `InstancedMesh` per 64 m world cell (`faunaBuckets.ts`, frustum-culled and hidden off the view focus, RN-49), no shadows, GPU-only swim / drift loops, tail wiggle and bell pulse, placed from the shore field so loops never cross the shore. Both swim deeper as the waves grow (`faunaSink.ts`, from the shared `waveModel.ts`), are drawn before the water surface (which caps its alpha at 0.8 so they show through), tint themselves by depth, and their image wobbles with the waves above (refraction shift, `faunaWater.ts`). Limits: RN-36…RN-39 in `docs/questions-and-limitations/render.md`.

### 3.3 Game-flow terrain, water borders, 3-stage deposits, construction & 3D work particles (W01–W02)
- **Hex terrain & shoreline transitions** (`frontend/render/planets/hex/`): the sim's tile classes tint the shared terrain shader per hex cell (`uTileTint`, a per-cell DataTexture from `tileTint.ts`, 0.45 m seam to the neighbour); hex edge lines are a shader term (`hexEdges.ts`, no line geometry). Water-level bands (shore sand, wet ground, lake bed) apply only on water tiles (`TA_WATER_GATE`). Animated hex water (`hexWater.ts`: one mesh per 32 m cell, `waterBuckets.ts`, all on one `WaterMaterial.ts`; cells off the view focus are hidden, and waves, foam motion and caustics fade to still water off it, which only shows while the focus is capped at 220 m by a grazing camera, when no cell is hidden, RN-49) pins dry shoreline vertices (`WATER_SHORE_PIN_Y = -0.16`, `waterVert = 0`) and clips wave displacement to exact Voronoi water hexes (`inWaterHex`) so water never spills over adjacent dry land tiles. The dry/wet sandy beach next to water is one continuous strip along the shore with a noise-broken inland edge (`aHexShore` / `vHexShore`, `HEX_SHORE_BEACH_GLSL` in `hexEdges.ts`). The hex material has its own program cache key (`taHexTerrain`) so it never shares a program with the continuous terrain material. **Prepared** ground looks like plain flat ground (no pad, RN-29).
- **Building hex foundation leveling & `stripBuildingPlinth`**: `3×3` Command Hub footprints center on `[q-1..q+1, r-1..r+1]` and `2×2` buildings (the Extractor, entity kind `metalsExtractor` drawn as `building.mine`, and `building.solar`) center at `(q + 0.5, r + 0.5)` over their 4 footprint hexes. In online gameplay, `stripBuildingPlinth(mesh)` (`frontend/render/kitbash/catalog.ts`) removes the `role: 'plinth' | 'plinthDetail'` skirt and shifts the building flush to the levelled hex ground.
- **3-stage finite deposits (`full`, `half`, `depleted`) & deposit tiers**: surface deposits (`resource.metalDeposit`, `resource.crystalDeposit`, `resource.oilDeposit`) transition across 3 visual stages (`getDepositVisualStage(richnessBp)`: `full` $> 50\%$, `half` $1\text{–}50\%$, `depleted` $0\%$) both in `ArchetypeCatalog` (`setDepositPreviewStage` / `?depositStage=full|half|depleted` in the playground) and in `chunkPropScatter.ts` (`applyDepositStage`), plus tier 1/2/3 node count and scale (`DEPOSIT_TIER_LOOK`: T1 = 3 nodes, T2 = 4 nodes $\times 1.12$, T3 = 5 nodes $\times 1.24$).
- **Territory borders**: ribbons whose every vertex sits 3.5 cm above the interpolated terrain surface (normal 8 cm, frozen 18 cm wide), with per-colony angled hatch ribs in colour-blind mode.
- **Construction scaffold**: the `buildScaffold` shader modifier (`ShaderPluginRegistry`, `visuals/unified/buildScaffold.ts`, on for every `createArchetypeMesh`) quantizes progress to 0 / 33 / 66 / 100 % (`uBuildStage`), and the amber/cyan holo-lattice starts above a laser cut at 3.8 % / 25 % / 58 % of the model's own height (`uBuildHeight`; on the Command Hub 0.25 / 1.65 / 3.85 m).
- **Full-channel GPU work pose (`uWorkWeight`) & Object-Driven 3D Particle System (`@terra/render/particles`)**:
  - `uWorkWeight` (`0..1`) drives active work motion across all GPU animation channels in `shaderChunks.ts`: `SpinY (1)` high-RPM drill spin, `RecoilPulse (3)` rapid tool impact pulsing, `BipedArm (5)` dual-axis forward pitch + converging inward yaw, `WheelSpin (7)` bracing torque rock, and `BipedBody (8)` / `SpiderBody (9)` forward-leaning effort heave.
  - `WorkParticleSystem` and `WorkParticleEmitter` spawn multi-layer instanced 3D debris chunks (`leafCluster`, `barkSlab`, `woodSplinter`, `rockShard`, `slateChunk`, `sandGrain`, `soilClod`, `oreNugget`, `crystalShard`, `oilDroplet`, `weldSpark`, `energyOrb`, `shockRing`) governed by 9 object-of-interaction presets (`tree`, `rock`, `dune`, `hole`, `flat`, `metals`, `minerals`, `oil`, `repair`), validated via `npm run validate:particles -- --all`.
  - Tool cutter beams lock to GPU-animated hands and tool muzzles via the closed-form CPU mirror `evalArchetypeToolOrigins` / `computeMeshToolOrigins` (`frontend/render/particles/toolOrigins.ts`, with palm muzzle flare orbs on `robot.hero`), and `buildActiveWorkSites` (`workTargetResolver.ts`) targets the nearest 3D prop instance on the worked tile (`terrain.props.instancesForTile`) across 1–2 hexes (`2m–4m`) with a 360° radial splash around the target object.
  - All of these can be inspected in `/playground.html?hexterrain=1&hatch=1&build=33&work=1&workTarget=tree&depositStage=full&lights=1`.

---

## 4. Dynamic Planetary Lighting System (`planetary-lighting-and-lightning`)

In `docs/game/autonomous-colony-spec.md`, **Solar Energy depends on time of day and weather**, and **Night / Storms** create tactical vulnerability. The lighting system links simulation state directly to Three.js rendering:

### 4.1 Orbital Solar Cycle, Sun Color, Multi-Light Moon Shadows & Entity Light Shutoff (`dayNightConfig.ts` + `@terra/sim`)
- Controlled by 24-hour planetary solar time `timeOfDay` (`0..24h`, orbital phase $\text{phase} = ((\text{hour} - 6) / 24) \bmod 1$, `solarElevation = sin(phase * 2π)` in `frontend/render/core/dayNightConfig.ts`):
  - **Midday (`10:00 – 14:00`, `elevation > 0.35`):** Crisp high-angle shadows (`shadowIntensityMult: 1.0`, `shadowSoftnessMult: 0.95`), Planckian blackbody noon sun color (`noonTempK`: `3500K–8500K`, default `5800K` $\approx$ `0xfff5e4`, `sunIntensityMult: 1.05`), 100% Solar Station output. All unit and building floodlights/cones shut off completely during bright daytime (`daylight >= 0.65`).
  - **Dawn / Dusk Golden Hour (`05:30 – 08:00`, `16:00 – 18:30`, `elevation` `0.0` to `0.55`):** Sun angle drops toward `9°–25°`, `sun.color` shifts to warm golden-amber at dawn (`0xff8a3d`) and deep crimson-coral at dusk (`0xff5e2b`, scaled by `sunWarmth`), casting long, softer penumbra shadows (`shadowIntensityMult: 0.75`, `shadowSoftnessMult: 1.35`), 35%–80% Solar output.
  - **Night (`19:00 – 05:00`, `elevation < 0.0`):** Key light transitions to cool orbital moonlight (`0x6498e8`, scaled by `nightBrightness`), secondary moon directional shadow caster (`shadowConfig.ts`, configurable via `shadowSourceMode` `0..3` and `nightShadowStrength` in the `F8` `SHADOW` tab) casts soft nocturnal shadows, sky dome and exponential fog shift to deep nocturnal indigo, `UnrealBloomPass` strength boosts (`+0.12`), 4-sided building floodlights (`building.commandHub`, `building.mine` (the Extractor), `building.solar` in `archetypeLights.ts`; the drop pod has none) and unit headlights illuminate the colony, and Solar Collectors turn off their lights and tracking animations (`offline: night`).
- **Interactive Tuning (`F8` Visual Shader Lab & Playground `?lights=1`):**
  - Alongside `CRT`, `PIXEL`, and `SHADOW` (which includes `shadowSourceMode`, `nightShadowStrength`, and secondary light azimuth/elevation/intensity), the `DAY/NIGHT` tab (`frontend/render/ui/pixelDialog.ts`, `visualLabSpecs.ts`) exposes live sliders for `timeOfDay` (`0..24h` + `DAWN`/`DAY`/`DUSK`/`NIGHT` readout), `dayLengthHours` (`0.02..24h`), `timeScale` (`0..20×` in UI, up to `1000×` via console), `noonTempK` (`3500..8500K`), `sunWarmth` (`0..2`), and `nightBrightness` (`0.05..1`).
  - In `/playground.html?lights=1` (or `[L]`), `LightsPanel` provides interactive editing and TypeScript code export (`window.__pg.exportLightsCode()`) for every archetype's `ArchetypeLightSource`s.
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
