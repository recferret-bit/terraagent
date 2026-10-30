---
name: procedural-texture-synthesis
description: >-
  Synthesize tileable PBR textures (Normal maps via Sobel height conversion,
  Roughness maps, Metallic masks, Emissive maps, Sci-Fi hull panels, Solar hex
  grids, Hazard stripes, and Terrain noise DataTextures) in pure TypeScript at
  startup with zero external image downloads. Use this skill whenever creating
  or tuning surface textures for 3D models or terrain.
---

# Procedural PBR Texture Synthesis Skill (`procedural-texture-synthesis`)

This skill enables AI coding agents to generate crisp, tileable PBR texture sets (`map`, `normalMap`, `roughnessMap`, `emissiveMap`) in pure code at startup (`< 25ms`) without relying on external `.png` assets.

> **Note for kitbashed models.** The procedural kitbash pipeline does not bind these textures: kitbash parts carry zone colours, roughness and metalness as vertex attributes, so surface detail (solar cells, rims, vents, panel lines) must be real geometry. Before adding a texture to cover for a plain part, run `npm run validate:models -- <id>` (skill `model-geometry-validator`): `ROLE_DETAIL`, `FLAT_SURFACE` and `LOW_CONTRAST_INSET` say which parts are too plain or too close in colour to their support. Textures from this skill are for terrain, loaded `.glb` props and UI, and must still respect the same colour-separation rules (neighbouring functional parts differ in lightness by a clear margin).

---

## Core Principles

1. **Draw Height First, Derive Normals Automatically:**
   - Never attempt to hand-code RGB tangent-space normal values pixel-by-pixel.
   - Draw a grayscale heightfield (`0 = deep seam/groove`, `128 = flat plate`, `255 = raised rivet/ridge`) onto an offscreen canvas or `Uint8Array` buffer, then pass it through `heightToNormalTexture()` in [ProceduralTextureRegistry.ts](./examples/ProceduralTextureRegistry.ts) (which runs a wrapping $3 \times 3$ Sobel filter to produce a seamless `THREE.CanvasTexture` / `DataTexture` normal map).
2. **Enforce Seamless Wrap (`RepeatWrapping` + Anisotropy):**
   - All synthesized textures must wrap cleanly across borders (`wrapS = wrapT = THREE.RepeatWrapping`) and set `anisotropy = 4` so oblique RTS camera angles remain razor-sharp.
3. **Color Space Correctness:**
   - Set `texture.colorSpace = THREE.SRGBColorSpace` **only** for Albedo (`map`) and Emissive (`emissiveMap`) textures.
   - Keep `normalMap`, `roughnessMap`, `metalnessMap`, and `DataTexture` splatmaps in `THREE.NoColorSpace` (linear) so PBR lighting math is never gamma-corrupted.
4. **Cache & Share via `ProceduralTextureRegistry`:**
   - Synthesize each texture preset once at startup and share the cached `THREE.Texture` instances across all materials and `InstancedMesh` groups.

---

## Step-by-Step Workflow

### Step 1: Check Existing Texture Presets
Review the built-in procedural generators in [procedural-pbr-patterns.md](./references/procedural-pbr-patterns.md) and [ProceduralTextureRegistry.ts](./examples/ProceduralTextureRegistry.ts):
- `scifiHullPanels`: Interlocking chamfered armor plates, recessed seams, corner bolts.
- `solarHexGrid`: Photovoltaic blue hex cells, metallic silver busbar grid, subtle cyan charge glow.
- `industrialHazardStripes`: Diagonal 45° safety-amber and gunmetal stripes with edge scuffs.
- `biomeTerrainNoise`: 4-channel `RGBA` `DataTexture` (FBM elevation, Voronoi cracks, moisture, micro-grain).

### Step 2: Register or Tune a Custom PBR Pattern
To add a new procedural texture (e.g., `nuclearCoolingTiles`, `alienChitinCarapace`, `iceGlacierCracks`):
1. Register a generator via `ProceduralTextureRegistry.register(name, fn)`.
2. Paint the height canvas, derive `normalMap` via `heightToNormalTexture(heightCanvas, strength)`, and derive `roughnessMap` by inverting groove brightness (grooves are rough/dusty `0.85`, raised plates are satin `0.40`).

### Step 3: Bind to `UnifiedColonyMaterial` or Archetype Meshes
Attach the synthesized PBR bundle (`{ map, normalMap, roughnessMap, emissiveMap }`) to your material and tune `normalScale` (`new THREE.Vector2(0.6, 0.6)` recommended so surface seams enhance rather than overpower the 3D geometry silhouette).
