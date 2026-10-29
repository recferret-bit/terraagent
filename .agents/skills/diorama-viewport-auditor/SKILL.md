---
name: diorama-viewport-auditor
description: >-
  Configure, audit, and tune the Three.js "Tabletop Diorama" lighting, 28-degree
  telephoto isometric camera, PMREM environment reflections, selective HDR
  bloom, and run the 4-view orthographic visual QA inspection loop. Use this
  skill whenever setting up scenes, tuning post-processing, or visually
  verifying generated 3D models and shaders.
---

# Tabletop Diorama Viewport & Visual QA Auditor (`diorama-viewport-auditor`)

This skill enforces **Pillar 4 (The Tabletop Diorama Viewport & Visual Self-Correction Loop)** so every 3D asset and shader in **TerraAgent** is rendered under studio-grade lighting and visually verified by the agent.

---

## The 7-Point Diorama Viewport Standard

Whenever creating or auditing a Three.js scene, verify all 7 requirements:

1. **Telephoto Isometric Camera (`FOV = 28°`):**
   - Never use a wide `60°–75°` FOV for an RTS/colony game. Use `PerspectiveCamera(28, aspect, 1, 400)` at a `40°–45°` elevation angle to create a tactile miniature diorama look.
2. **Filmic Tone Mapping & Color Space:**
   - `renderer.outputColorSpace = THREE.SRGBColorSpace;`
   - `renderer.toneMapping = THREE.ACESFilmicToneMapping;`
   - `renderer.toneMappingExposure = 1.05 – 1.15;`
3. **Mandatory PMREM Environment Map (`scene.environment`):**
   - Metallic surfaces (`frameGunmetal`, `solarCell`, `glassVisor`) render pitch black without IBL. Always assign `pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture`.
4. **Warm Key Sun + Cool Sky Hemisphere Fill:**
   - Pair a warm `DirectionalLight` (`intensity: 2.8 – 3.4`) with a cool/ground-bounced `HemisphereLight` (`intensity: 0.75 – 0.95`) from [lighting-and-postprocessing-presets.md](./references/lighting-and-postprocessing-presets.md).
5. **Target-Following Shadow Frustum:**
   - Keep `sunLight.shadow.camera` tightly bounded (`±35m`) and recenter it on the camera's ground look-at target every frame so shadow texels (`2048x2048` `PCFSoftShadowMap`) never look blocky.
6. **Selective HDR Bloom (`threshold: 1.1`):**
   - Configure `UnrealBloomPass` with `threshold: 1.1`, `strength: 0.40 – 0.50`, `radius: 0.35`. Because `threshold > 1.0`, sunlit white hulls never smear, while HDR emissive cores (`intensity >= 3.0`) glow cleanly.
7. **Atmospheric Height / Distance Fog:**
   - Match `scene.fog = new THREE.FogExp2(biome.fogColor, 0.007)` to `scene.background` for seamless horizon blending.

---

## Mandatory Visual Self-Correction Loop (4-View Diagnostic Inspection)

AI coding agents cannot judge 3D coordinates, part intersections, or shader roughness from code alone. Whenever you generate or modify a 3D model or shader:

### Step 1: Mount the Asset in `DiagnosticTurntable`
In this repo the turntable is the **3D playground** page: run `npm run dev` and open `http://127.0.0.1:5173/playground.html?inspect=<archetype id>&biome=dune|oceanForest|forestRock&view=iso|front|side|top` (implementation: `src/playground/main.ts`; reference example: [DiagnosticTurntable.ts](./examples/DiagnosticTurntable.ts)). It renders the asset on a calibrated `1m` grid/hex pedestal (toggles for ruler, 1.8m human, wireframe, bloom, real planet surface) with an info panel (tris vs 3.5k budget, bbox, `minY` ground contact) and 4 camera presets. `4-VIEW SHEET` (or `window.__pg.contactSheet()`) exports all four at once:
- `iso` (Default 3/4 RTS camera)
- `front` (Checks vertical alignment and ground contact `minY == 0`)
- `side` (Checks front/back weight balance, cable sag, and turret clearance)
- `top` (Checks RTS top-down silhouette readability and 60/30/10 color balance)

### Step 2: Capture & Inspect via Browser / DevTools
1. Open the running dev server in Chrome DevTools MCP (or headless screenshot tool).
2. Inspect the rendered frame against this QA checklist:
   - [ ] **Ground Contact:** Does the foundation/tread sit flush on `Y = 0` without floating or clipping?
   - [ ] **No Disconnected Floating Parts:** Are all antennas, arms, solar panels, and vents physically connected to the main hull via struts, joints, or cables?
   - [ ] **Edge Readability:** Are beveled edges catching bright specular highlights from the IBL environment?
   - [ ] **Bloom Selectivity:** Are only the intended emissive cores/vison strips glowing, while primary armor remains crisp and matte?
3. If any check fails, adjust the part coordinates or shader uniforms and re-verify before completing the task.
