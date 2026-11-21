# Procedural PBR Texture Recipes & Channel Packing Guide

---

## 1. Standard Procedural PBR Texture Recipes

### A. `scifiHullPanels` (Hard-Surface Armor & Buildings)
- **Height Recipe (`512x512`):**
  - Base fill: `#B0B0B0` (`height = 0.69`).
  - Subdivide into an asymmetric modular grid of chamfered rectangles (`64px–256px` wide).
  - Stroke panel borders with a `3px` dark groove (`#202020`) and a `2px` inner highlight bevel (`#D8D8D8`).
  - Stamp `3px` circular rivet depressions (`#404040`) inset `8px` from panel corners.
  - Overlay sparse directional micro-scratches (`alpha = 0.08`).
- **Roughness Derivation:**
  - Recessed seams accumulate planet dust $\rightarrow$ `roughness = 0.88`.
  - Flat panel faces $\rightarrow$ `roughness = 0.42` with subtle per-tile variation (`±0.06`) so adjacent armor plates catch light slightly differently!

### B. `solarHexGrid` (Photovoltaic Wings & Arrays)
- **Albedo (`map`):**
  - Deep navy-indigo (`#102342`) inside hex cells; bright metallic silver (`#B8C4D4`) on the `2px` hex borders and primary vertical busbars.
- **Height $\rightarrow$ Normal (`normalMap`):**
  - Hex interiors slightly recessed (`#707070`), silver busbar frame raised (`#E0E0E0`) so sunlight glints across the solar grid as the camera orbits.
- **Roughness (`roughnessMap`):**
  - Glossy glass coating over cells (`roughness = 0.18`), satin frame (`roughness = 0.45`).

### C. `industrialHazardStripes` (Foundations, Bumpers & Silo Doors)
- **Albedo (`map`):**
  - 45° diagonal repeating bands (`width = 32px`) alternating between `COLONY_PALETTE.hullSecondary` (`#E59838`) and `COLONY_PALETTE.frameGunmetal` (`#242933`).
  - Apply procedural edge chipping along stripe boundaries so it looks weathered.

### D. `treeBarkFissures` (Botanical Tree Trunks & Stilt Roots)
- **Height & Albedo (`128x128` – `256x256`, `HeightBuffer` headless-safe):**
  - Domain-warped vertical sinusoidal bark ridges (`14` periods around circumference) + lenticel knots + moss pockets (`knot > 0.68`).
  - Bound at runtime in `createFoliageMaterial()` (`visuals/terrain/Scatter.ts`) via `uBarkMap` / `uBarkRoughMap` so woody trunks/branches get deep vertical fissure grain and high-roughness crevices while leafy crowns stay crisp.

### E. `meadowGrassClover` & `desertPebbleCrust` (Biome Terrain Micro-Detail)
- **`meadowGrassClover`:** Multi-scale botanical blade weave (`periods 28 & 64`) + wildflower clover clusters (`period 18`) + Sobel normal & satin-blade roughness maps. Bound to `uMeadowDetailMap` / `uMeadowRoughMap` in `terrainMaterial.ts` (`KIND_OCEAN_FOREST` & `KIND_FOREST_ROCK`).
- **`desertPebbleCrust`:** Wind-rippled arid sand (`period 10`), desert-varnish pebbles (`period 30`), and sun-baked alkali crack networks (`period 9`). Bound to `uDesertCrustMap` / `uDesertRoughMap` in `terrainMaterial.ts` (`KIND_DUNE`).

### F. `warmFurPelage` (Vertebrate Mammalian Coat)
- **Height, Albedo & Sheen Roughness:**
  - Anisotropic hair-strand value noise (`u * 3, period 42`) layered with fine guard-hair striations (`48` strands) and coat dappling (`period 6`).
  - Bound at runtime in `createUnifiedColonyMaterial()` (`uFurPelageMap` / `uFurRoughnessMap`) and sampled along anatomical UVs in `organicSurface.ts` whenever `aOrganic == 6` (`pelage`).

---

## 2. Wrapping Sobel Filter Math (Height $\rightarrow$ Tangent-Space Normal Map)

To ensure zero visible seams when tiling across terrain or triplanar projections, always wrap coordinates with `(x + size) % size`:

```typescript
// Wrapping 3x3 Sobel Gradient
const tl = getHeight(x - 1, y - 1);
const t  = getHeight(x,     y - 1);
const tr = getHeight(x + 1, y - 1);
const l  = getHeight(x - 1, y);
const r  = getHeight(x + 1, y);
const bl = getHeight(x - 1, y + 1);
const b  = getHeight(x,     y + 1);
const br = getHeight(x + 1, y + 1);

const dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
const dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
const dZ = 1.0 / normalStrength;

const len = Math.hypot(dX, dY, dZ);
const nx = ((-dX / len) * 0.5 + 0.5) * 255;
const ny = ((-dY / len) * 0.5 + 0.5) * 255;
const nz = (( dZ / len) * 0.5 + 0.5) * 255;
```
