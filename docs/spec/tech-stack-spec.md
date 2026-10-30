# TerraAgent — Browser 3D Tech Stack & Architecture Specification

**Target Project:** Autonomous Colony Builder (NEAR Hackathon 2026)  
**Target Platform:** Modern Web Browser (60 FPS Desktop & Laptop, Zero Install)  
**Core Engine:** Three.js (`r170+` WebGPU / WebGL2 Hybrid)

> **Status (2026-10-30): early design note; the built renderer wins.** The 3D look is implemented and approved in `frontend/render` on **WebGL2** (`WebGLRenderer` + `EffectComposer`, D-22) with **GLSL** shader chunks (`onBeforeCompile`, unified material, terrain/water shaders), not `WebGPURenderer` + TSL, and the HUD is vanilla DOM (D-36). Don't port the renderer to WebGPU/TSL or restructure it to the tree below; extend `frontend/render` as PRODUCT_WAVES §4 "One renderer" maps it. The sections below stay as background on instancing, GPU animation and LOD.

---

## 1. Executive Summary & Architectural Philosophy

An autonomous colony builder ("Factorio-lite" + RTS + multi-planet simulation) has very different technical constraints from a typical 3D website:
1. **High Entity Count:** Hundreds of autonomous robots, resource nodes, buildings, projectiles, and terrain tiles active simultaneously.
2. **Continuous Simulation + Heavy UI:** Complex economy telemetry, task queues, AI orchestrator logs, and NEAR blockchain intents must never stutter the 60 FPS 3D viewport.
3. **Rapid Hackathon Iteration:** The stack must be 100% TypeScript, hot-reload instantaneously, and be maximally ergonomic for **AI coding agents** to read, write, and extend without hallucinating legacy APIs.

### Recommended Core Stack at a Glance

| Layer | Technology Choice | Why This Wins for TerraAgent |
| :--- | :--- | :--- |
| **Build & Bundler** | **Vite 6 + TypeScript** | Instant HMR, native Web Worker bundling, clean asset pipeline. |
| **3D Engine** | **Vanilla Three.js (`r170+`)** (`WebGPURenderer` + TSL) | Direct control over `InstancedMesh`, `BatchedMesh`, and GPU buffers without React reconciliation overhead on 1,000+ moving units. |
| **Shader System** | **TSL (Three.js Shading Language)** | Write shaders in TypeScript (NodeMaterials) instead of fragile GLSL strings; compiles to both WebGPU (WGSL) and WebGL2 (GLSL). |
| **ECS / Simulation** | **bitECS** (or **Miniplex**) in a Fixed Timestep | Structure-of-Arrays (SoA) typed arrays map directly to Three.js `InstancedBufferAttribute` matrices for zero-GC-pause updates. |
| **Pathfinding & Sim** | **Web Worker** (`RedBlobGames` Hex Flow Fields / A*) | Keeps pathfinding, rule-engine scoring, and terrain cellular automata off the main UI/render thread. |
| **2D UI / HUD Overlay** | **Vanilla DOM + Faction Plate CSS** (`frontend/design/css/tokens.css` + `base.css`; D-36) | HTML/CSS is vastly superior to 3D canvas UI for complex RTS dashboards, priority queues, trade tables, and NEAR wallet modals. Small TypeScript panel view classes fed by the sim `view()` keep one UI idiom and a small bundle. |
| **Audio / Juice** | **Howler.js** + **Motion (Framer)** | Spatial SFX for mining/lasers/weather + crisp HUD micro-animations. |
| **3D Asset Pipeline** | **@gltf-transform/cli** + **Meshopt** + **KTX2** | Compresses AI-generated `.glb` models by 80–90% and normalizes pivots, polycounts, and materials automatically. |
| **Web3 & AI Layer** | **NEAR JS SDK (`@near-js/*`)** + **NEAR Intents** + **JSON Schema LLM** | Non-blocking async intents; 95% local deterministic Rule Engine + 5% event-driven LLM Director calls. |

---

## 2. Why Vanilla Three.js Core + Vanilla-DOM HUD (Instead of React Three Fiber or a React HUD)

> **D-36 (2026-10-30):** the HUD is vanilla DOM on the design system. React and Zustand are not used anywhere in the game client.

While **React Three Fiber (R3F)** is great for product configurators, in a simulation/RTS game where AI coding agents write procedural generators, custom instanced buffers, and tick-by-tick simulation loops:
- **Vanilla Three.js for the Canvas** avoids component lifecycle clashes with imperative `InstancedMesh` matrix updates, `BufferGeometryUtils` kitbashing, and TSL node graphs.
- **Vanilla DOM for the 2D HUD Overlay** sits as a transparent `pointer-events: none` root over the `<canvas>`, with interactive islands. Each panel (resource bar, task queue, priorities, trade, minimap) is a small TypeScript **view class**, registered by its feature and rendering into the Faction Plate classes (`--ta-*` tokens, `.plate`, `.btn`). Panels are fed by the sim worker's `view()` projection, throttled to ≤ 10 Hz, so the DOM never updates at 60 Hz. State flows one way (sim view → panel); panels send commands through the command bus. The `AGENTS.md` §6 limits apply (orchestrator + parts, files ≤ 500 lines, functions ≤ 100 lines).

```mermaid
flowchart TD
    subgraph MainThread["Main Thread (60 FPS Render & Input)"]
        UI["Vanilla-DOM HUD panels (Faction Plate CSS)\n(Task Queue, Priorities, Trade UI)"]
        Store["HUD projection + command bus\n(Throttled sim view() + Commands)"]
        Renderer["Three.js WebGPURenderer\n(InstancedMesh, TSL Shaders, PostProcessing)"]
    end

    subgraph SimWorker["Simulation Web Worker (20 TPS Deterministic Tick)"]
        ECS["bitECS World\n(Robots, Buildings, Deposits, Fauna)"]
        Rules["Rule Engine (95% Decisions)\nUtility AI + Flow-Field Pathfinding"]
    end

    subgraph External["Async External Services"]
        LLM["LLM Orchestrator (5% Decisions)\nEvent-Driven Strategic JSON"]
        NEAR["NEAR Protocol & Intents\nColony State, Resource Trades, Chain Signatures"]
    end

    UI -->|Player Priorities & Queue| Store
    Store -->|Command Buffer| Rules
    ECS -->|SharedArrayBuffer / Float32Array Matrices| Renderer
    ECS -->|10Hz Telemetry Snapshot| Store
    Rules -->|Critical Event Trigger| LLM
    LLM -->|Strategic Directive| Rules
    Rules -->|Trade / Task Intent| NEAR
```

---

## 3. High-Performance Rendering Architecture for Colony Scale

To render an entire planet sector with hundreds of active robots, factories, turrets, trees, rocks, and weather effects at a locked 60 FPS in a browser:

### 3.1 Zero-Draw-Call Explosion via `InstancedMesh` & `BatchedMesh`
Never call `scene.add(new THREE.Mesh())` for individual units, resources, or projectiles.
1. **Homogeneous Entities (`THREE.InstancedMesh`):**
   - One `InstancedMesh` per unit archetype (e.g., `MinerBot`, `CombatBot`, `CrystalDeposit`, `AlienSwarmer`, `LaserBolt`).
   - Attach custom `InstancedBufferAttribute` buffers for:
     - `instanceColor` / `aStateColor`: Health status, faction tint, or energy charge level.
     - `aAnimData` (`vec4`): `[animPhase, speed, taskState, hitFlash]` — used by the vertex shader to animate hover-bobbing, wheel rotation, mining lasers, or damage flashes **entirely on the GPU** without CPU `AnimationMixer` overhead.
2. **Heterogeneous Buildings (`THREE.BatchedMesh` or Merged Archetypes):**
   - Buildings (Solar Panels, Wind Turbines, Hydro Dams, Factories, Rocket Silos) share a **single unified Triplanar/Palette NodeMaterial** so the entire colony base renders in **< 10 draw calls**.

### 3.2 GPU-Driven Animation (Vertex Shaders via TSL)
Instead of rigging and skinning 500 robots on the CPU:
- Encode part IDs into **Vertex Colors** (`R` = chassis, `G` = rotating turret/rotor/dish, `B` = hovering thruster/wheel, `A` = emissive mask).
- In Three.js **TSL (Three Shading Language)**, rotate vertices where `vertexColor.g > 0.5` around their local pivot using `time * instanceSpeed`, and bob vertices where `vertexColor.b > 0.5` using `sin(time * 4.0 + instanceId)`.
- Result: Thousands of animated wind turbines, radar dishes, and mining bots at **zero CPU cost**.

### 3.3 Planetary Terrain & Terraforming Grid
- **Hexagonal or Dual-Grid Chunk System:**
  - Logical simulation runs on a **2D Hex Grid** (axial coordinates `q, r`) or **Square Dual-Grid** (where visual tiles sit offset by `0.5` from logical vertices, automatically producing smooth organic coastlines and biome transitions with only 16 tile permutations).
- **GPU Terraforming Splatmap:**
  - Store planet terraforming progress, moisture, and pollution in a dynamic `THREE.DataTexture` (`RGBA`, e.g., `256x256` covering the map).
  - As terraforming machines run, update pixels in the `DataTexture` and set `texture.needsUpdate = true`.
  - The terrain TSL shader blends smoothly between **Barren/Arid/Ice rock** and **Lush Terraformed grass/water** with a glowing terraforming frontier ring—no mesh rebuilding required!

---

## 4. Recommended Project Directory Structure

```text
TerraAgent/
├── public/
│   ├── assets/
│   │   ├── models/          # Optimized, Meshopt-compressed .glb files
│   │   ├── matcaps/         # Curated 512x512 matcap & LUT textures
│   │   └── hdri/            # Compressed .hdr / .ktx2 environment maps
├── scripts/
│   └── optimize-assets.mjs  # Automated gltf-transform pipeline for AI 3D models
├── src/
│   ├── core/
│   │   ├── Engine.ts        # WebGPURenderer, Camera, PostProcessing pipeline
│   │   ├── AssetManager.ts  # GLTF + KTX2 loader + Material Unifier override
│   │   └── InputManager.ts  # Raycasting against mathematical ground plane / hex grid
│   ├── visuals/
│   │   ├── Palette.ts       # Strict physically-based color & emissive constants
│   │   ├── materials/       # Unified TSL NodeMaterials (Triplanar, Toon-PBR, Hologram)
│   │   ├── kitbash/         # Procedural hard-surface generator & greeble library
│   │   ├── TerrainMesh.ts   # Hex/Dual-grid terrain + GPU terraforming splatmap
│   │   └── VFXManager.ts    # Instanced particles (sandstorms, meteors, lasers, smoke)
│   ├── simulation/
│   │   ├── worker.ts        # Fixed-timestep simulation loop
│   │   ├── ecs/             # bitECS components & systems
│   │   ├── RuleEngine.ts    # 95% autonomous colony utility AI
│   │   └──LLMDirector.ts    # 5% event-driven strategic LLM orchestrator
│   ├── near/
│   │   └── NearIntents.ts   # Invisible chain signatures & inter-colony trade intents
│   └── ui/
│       ├── HudRoot.ts       # Tactical orbital overlay root; registers panel view classes
│       └── projection.ts    # Throttled sim view() projection + command bus for the panels
```

---

## 5. Core NPM Dependencies Blueprint

```json
{
  "dependencies": {
    "three": "^0.174.0",
    "bitecs": "^0.4.0",
    "howler": "^2.2.4",
    "@near-js/accounts": "^1.2.0",
    "@near-js/transactions": "^1.2.0"
  },
  "devDependencies": {
    "@gltf-transform/cli": "^4.1.0",
    "@gltf-transform/core": "^4.1.0",
    "@gltf-transform/extensions": "^4.1.0",
    "@gltf-transform/functions": "^4.1.0",
    "meshoptimizer": "^0.22.0",
    "typescript": "^5.7.0",
    "vite": "^6.1.0"
  }
}
```
