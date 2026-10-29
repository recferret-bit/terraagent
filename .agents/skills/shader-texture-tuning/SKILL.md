---
name: shader-texture-tuning
description: >-
  Create, tune, and extend Three.js shaders (TSL NodeMaterials and GLSL
  onBeforeCompile), procedural triplanar textures, planet biome weathering
  (desert dust, ice frost, temperate moss), GPU vertex animations, and VFX
  shaders. Use this skill whenever tuning material look, unifying AI-generated
  models, or writing terrain and visual effect shaders.
---

# Shader & Procedural Texture Tuning Skill (`shader-texture-tuning`)

This skill enforces **Pillar 3 (The Unifier Shader Architecture)** so procedural kitbashed models and external AI-generated `.glb` assets share an identical lighting response, surface grain, planet weathering gradient, and GPU animation pipeline.

---

## The 5 Rules of Material & Shader Tuning in `TerraAgent`

1. **Never Trust Raw AI UV Maps — Use Triplanar Detail Projection:**
   - External AI meshes have fragmented UV islands. Project micro-surface details (brushed metal, hex solar grids, rock strata) in **Object or World Space via Triplanar Mapping** (see [tsl-and-shader-recipes.md](./references/tsl-and-shader-recipes.md)).
2. **Anchor Every Object with Vertical Ground-Up Biome Weathering:**
   - Blend the active planet's `dustTint` (iron-oxide sand, glacial frost, or mossy loam) into the bottom `0.0m → 1.1m` of every building and robot (`smoothstep(0.0, uWeatheringHeight, vLocalPos.y)`) and increase `roughness` toward `0.9` near the ground.
3. **Decode GPU Vertex Animation Channels in the Vertex Shader:**
   - Read `aPartAnim` (`vec4: [animType, pivotX, pivotY, pivotZ]`) to rotate wind turbines/radar dishes (`animType == 1`), bob hover units (`animType == 2`), or recoil turret barrels (`animType == 3`) on the GPU—never spawn CPU `AnimationMixer` instances for hundreds of units.
4. **Drive Selective Bloom via HDR Emissive Thresholding (`> 1.1`):**
   - Keep standard sunlit albedo luminance `< 1.0`. Multiply emissive zones (`color.a > 0.5` or high-saturation energy masks) by `uEmissiveBoost` (`3.2 – 4.5`) so only power cores, status beacons, mining lasers, and terraforming waves trigger `UnrealBloomPass`.
5. **Maintain Zoom Readability with Top-Down Gradient & Fresnel Rim:**
   - Apply a subtle vertical hemisphere darkening (`0.75` at base to `1.10` at top) plus a view-dependent Fresnel rim highlight (`pow(1.0 - NdotV, 3.5)`) tinted by the planet's sky color so dark gunmetal robots pop against dark terrain when zoomed out.

---

## Step-by-Step Tuning Workflow

### Step 1: Instantiate or Extend `UnifiedColonyMaterial`
1. Use `createUnifiedColonyMaterial()` from [UnifiedColonyMaterial.ts](./examples/UnifiedColonyMaterial.ts) as the single material backbone for all colony units, buildings, and sanitized `.glb` props.
2. Pass the active planet biome preset (`'temperate' | 'desert' | 'ice'` or a custom registered biome).

### Step 2: Tune Surface & Weathering Uniforms
Adjust the exposed uniforms live (or via a diagnostic GUI / URL params) to balance visual clarity:
- `uWeatheringHeight` (`0.4` for small robots, `1.2` for tall buildings): Controls how high planet dust/frost climbs up the hull.
- `uWeatheringIntensity` (`0.0 – 1.0`): Controls opacity of the biome dust layer (`0.65` recommended for Arid Desert, `0.50` for Ice, `0.35` for Temperate).
- `uRimStrength` (`0.15 – 0.45`): Controls silhouette edge separation at RTS zoom distances.
- `uTriplanarScale` (`1.5 – 4.0`): Controls frequency of procedural micro-normal/roughness variation.

### Step 3: Terrain, Water & Terraforming Splatmap Tuning
When tuning planet terrain or hydro water shaders, use `createTerraformingTerrainMaterial()` and `createHydroWaterMaterial()` from [TerrainAndWaterShaders.ts](./examples/TerrainAndWaterShaders.ts):
1. Sample the dynamic `uTerraformMap` (`DataTexture` updated by terraforming stations).
2. Compute a glowing frontier ring along the transition boundary (`smoothstep(0.42, 0.5, mask) * (1.0 - smoothstep(0.5, 0.58, mask))`) boosted by `3.8x` for selective bloom.
3. Blend barren biome rock/sand/ice into lush terraformed grass/soil inside the mask.

---

## Extending the Shader System

The shader architecture is open for extension via two registries in [UnifiedColonyMaterial.ts](./examples/UnifiedColonyMaterial.ts):
1. **`ShaderPluginRegistry.registerModifier(name, plugin)`:** Inject custom vertex displacements or fragment overlays (e.g., `shieldHexPulse`, `radiationGlitch`, `buildHologramWireframe`, `damageScorchMarks`) without forked materials.
2. **`BiomeMaterialRegistry.registerBiome(name, config)`:** Add new planet types (e.g., `volcanic`, `toxicSwamp`, `crystalline`) with custom dust colors, roughness shifts, and rim tints.
