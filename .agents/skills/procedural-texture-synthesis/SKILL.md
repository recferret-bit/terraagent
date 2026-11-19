---
name: procedural-texture-synthesis
description: >-
  Synthesize tileable PBR textures (Normal maps via Sobel height conversion,
  Roughness maps, Metallic masks, Emissive maps, Sci-Fi hull panels, Solar hex
  grids, Hazard stripes, and Terrain noise DataTextures) in pure TypeScript at
  startup with zero external image downloads. Use this skill whenever creating
  or tuning surface textures for 3D models or terrain.
---

> **Fauna and organic hives:** apply the [organic fauna policy](../procedural-kitbash-3d/references/organic-fauna.md). It overrides mechanical-only material, detail and rigid-tissue requirements below; geometry safety, shader/pose parity and visual QA remain mandatory.

# Procedural PBR Texture Synthesis Skill (`procedural-texture-synthesis`)

This skill enables AI coding agents to generate crisp, tileable PBR texture sets (`map`, `normalMap`, `roughnessMap`, `emissiveMap`) in pure code at startup (`< 25ms`) without relying on external `.png` assets.

> **Note for kitbashed models vs organic/botanical surfaces.** Mechanical kitbash robots and buildings carry zone colours, roughness and metalness as vertex attributes, so mechanical surface detail (solar cells, rims, vents, panel lines) must be real geometry (`npm run validate:models -- <id>`). By contrast, organic pelage (`warmFurPelage` on `aOrganic == 6` in `UnifiedColonyMaterial`), woody trunks (`treeBarkFissures` on `aBark == 1` in `createFoliageMaterial`), and planet ground ecotypes (`meadowGrassClover` & `desertPebbleCrust` in `terrainMaterial.ts`) DO bind cached `ProceduralTextureRegistry` PBR bundles alongside loaded `.glb` props and UI.

---

## Core Principles

1. **Draw Height First, Derive Normals Automatically:**
   - Never attempt to hand-code RGB tangent-space normal values pixel-by-pixel.
   - Draw a grayscale heightfield (`0 = deep seam/groove`, `128 = flat plate`, `255 = raised rivet/ridge`) onto an offscreen canvas or `Uint8Array` buffer, then pass it through `heightToNormalTexture()` in [ProceduralTextureRegistry.ts](./examples/ProceduralTextureRegistry.ts) (which runs a wrapping $3 \times 3$ Sobel filter to produce a seamless `THREE.CanvasTexture` / `DataTexture` normal map).
2. **Enforce Seamless Wrap, Linear Mipmaps & Anisotropy:**
   - All synthesized textures must wrap cleanly across borders (`wrapS = wrapT = THREE.RepeatWrapping`). When building a `THREE.DataTexture`, explicitly set `magFilter = THREE.LinearFilter`, `minFilter = THREE.LinearMipmapLinearFilter`, `generateMipmaps = true`, and `anisotropy = 4` (`DataTexture` otherwise defaults to `NearestFilter` without mipmaps, leaving `anisotropy` inert).
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
- `treeBarkFissures`: Anisotropic vertical bark ridges, lenticel knots, Sobel `normalMap` & crevice `roughnessMap` (`frontend/render/visuals/ProceduralTextureRegistry.ts`, headless-safe `HeightBuffer` fallback).
- `meadowGrassClover`: Botanical meadow blade weave + wildflower clover clusters + Sobel normal/roughness maps.
- `desertPebbleCrust`: Wind-rippled arid sand, desert varnish pebbles & sun-baked alkali crack network.
- `warmFurPelage`: Directional mammalian hair-strand pelage & guard-hair sheen roughness map.

### Step 2: Register or Tune a Custom PBR Pattern
To add a new procedural texture (e.g., `nuclearCoolingTiles`, `alienChitinCarapace`, `iceGlacierCracks`):
1. Register a generator via `ProceduralTextureRegistry.register(name, fn)`.
2. Paint the height canvas, derive `normalMap` via `heightToNormalTexture(heightCanvas, strength)`, and derive `roughnessMap` by inverting groove brightness (grooves are rough/dusty `0.85`, raised plates are satin `0.40`).

### Step 3: Bind to `UnifiedColonyMaterial` or Archetype Meshes
Attach the synthesized PBR bundle (`{ map, normalMap, roughnessMap, emissiveMap }`) to your material and tune `normalScale` (`new THREE.Vector2(0.6, 0.6)` recommended so surface seams enhance rather than overpower the 3D geometry silhouette).
