---
name: shader-texture-tuning
description: >-
  Create, tune, and extend Three.js shaders (TSL NodeMaterials and GLSL
  onBeforeCompile), procedural triplanar textures, planet biome weathering
  (desert dust, ice frost, temperate moss), GPU vertex animations, and VFX
  shaders. Use this skill whenever tuning material look, unifying AI-generated
  models, or writing terrain and visual effect shaders.
---

> **Fauna and organic hives:** apply the [organic fauna policy](../procedural-kitbash-3d/references/organic-fauna.md). It overrides mechanical-only material, detail and rigid-tissue requirements below; geometry safety, shader/pose parity and visual QA remain mandatory.

# Shader & Procedural Texture Tuning Skill (`shader-texture-tuning`)

This skill enforces **Pillar 3 (The Unifier Shader Architecture)** so procedural kitbashed models and external AI-generated `.glb` assets share an identical lighting response, surface grain, planet weathering gradient, and GPU animation pipeline.

---

## The 5 Rules of Material & Shader Tuning in `TerraAgent`

1. **Never Trust Raw AI UV Maps — Use Triplanar Detail Projection:**
   - External AI meshes have fragmented UV islands. Project micro-surface details (brushed metal, hex solar grids, rock strata) in **Object or World Space via Triplanar Mapping** (see [tsl-and-shader-recipes.md](./references/tsl-and-shader-recipes.md)).
2. **Anchor Every Object with Vertical Ground-Up Biome Weathering:**
   - Blend the active planet's `dustTint` (iron-oxide sand, glacial frost, or mossy loam) into the bottom `0.0m → 1.1m` of every building and robot (`smoothstep(0.0, uWeatheringHeight, vLocalPos.y)`) and increase `roughness` toward `0.9` near the ground.
3. **Decode GPU Vertex Animation Channels in the Vertex Shader (`procedural-animation-3d`):**
   - Read `aPartAnim` (`vec4: [animType, pivotX, pivotY, pivotZ]`) and `uWalkWeight` (`0..1`, default `1.0`) to drive all GPU channels: `1` (`SpinY` radars/turbines/drills), `2` (`HoverBob`), `3` (`RecoilPulse`), `4` (`BipedLeg` coupled stride), `5` (`BipedArm` counter-swing), `6` (`SpiderLeg` alternating arachnid gait), `7` (`WheelSpin` axle roll), `8` (`BipedBody` step-reaction suspension), `9` (`SpiderBody` heavy quadruped suspension), and compound codes `18, 19, 28, 29, 38, 39` (`SpinY`/`HoverBob`/`RecoilPulse` riding on `BipedBody`/`SpiderBody`) — never spawn CPU `AnimationMixer` instances for colony units.
4. **Drive Selective Bloom via HDR Emissive Thresholding (`> 1.1`):**
   - Keep standard sunlit albedo luminance `< 1.0`. Multiply emissive zones (`color.a > 0.5` or high-saturation energy masks) by `uEmissiveBoost` (`3.2 – 4.5`) so only power cores, status beacons, mining lasers, and terraforming waves trigger `UnrealBloomPass`.
5. **Maintain Zoom Readability with Top-Down Gradient & Fresnel Rim:**
   - Apply a subtle vertical hemisphere darkening (`0.75` at base to `1.10` at top) plus a view-dependent Fresnel rim highlight (`pow(1.0 - NdotV, 3.5)`) tinted by the planet's sky color so dark gunmetal robots pop against dark terrain when zoomed out.

6. **Colour Contrast Survives the Shader:**
   - The unifier shader only adds ±4 % grain, biome dust on the lowest `uWeatheringHeight` metres, a top-down gradient and a rim light; it does **not** add panel lines or cell grids. Distinctions between parts must therefore come from zone colours and geometry. When you change a zone colour or the weathering uniforms, re-run `npm run validate:models -- --category <cat>` (skill `model-geometry-validator`): `GROUP_SAME_COLOR`, `LOW_CONTRAST_INSET` and `MODEL_TOO_DARK` catch a palette that no longer separates parts. Near-black zones (`L* < 20`) merge into one silhouette under tone mapping: keep `solarCell` and other inset zones clearly lighter than the frame they sit on.

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
When tuning the terraforming terrain splatmap, use `createTerraformingTerrainMaterial()` from [TerrainAndWaterShaders.ts](./examples/TerrainAndWaterShaders.ts) (in-repo copy: `frontend/render/visuals/TerrainAndWaterShaders.ts`). The example's `createHydroWaterMaterial()` is not the game's water: every water surface uses `createWaterMaterial()` in `frontend/render/visuals/water/WaterMaterial.ts` (GLSL chunks in `frontend/render/visuals/water/glsl/`: `waves`, `surface`, `foam`, `reflections`, `mirror`, `bed`, `stages`; the planar mirror image comes from `visuals/water/reflection/`, see below), tuned through `waterConfig.ts` (F8 Visual Shader Lab → `WATER` tab, `?water=1|0`), with the shared wave maths (wavelengths, slopes, peak height that fauna and the CPU read too) in `waveModel.ts`. For the splatmap:
1. Sample the dynamic `uTerraformMap` (`DataTexture` updated by terraforming stations).
2. Compute a glowing frontier ring along the transition boundary (`smoothstep(0.42, 0.5, mask) * (1.0 - smoothstep(0.5, 0.58, mask))`) boosted by `3.8x` for selective bloom.
3. Blend barren biome rock/sand/ice into lush terraformed grass/soil inside the mask.

### Step 4: Planar Water Reflections
The water mirrors the scene through one planar pass (`frontend/render/visuals/water/reflection/`): `createColonyViewport().render()` calls `WaterReflectionPass.render()` right before `composer.render()`; it reflects the render camera about the water plane (`mirrorCamera.ts`, Reflector-style oblique near-plane clip), renders into a HalfFloat target sized `REFLECT_RES_SCALES[reflectRes]` × the canvas, scissored to the screen rect of the visible water, and writes the shared uniforms in `reflectionUniforms.ts` (`uReflTex`, `uReflMatrix`, `uReflRect`, `uReflOn`). The water shader (`glsl/mirror.ts`, MED 1 tap, HIGH 3 taps, LOW none) projects the undisplaced surface point through `uReflMatrix`, offsets it along the wave normal (`uReflDistort`, wind-scaled) and lays the mirror over the water with cover `max(Fresnel, 0.75) × strength` (alpha follows the cover, not the brightness, so dark trees read); texels that match the sky (dome gradient or background, `water/mirrorSky.ts`) get no cover, so open water keeps its look. Transparent no-depth-write materials are left out of the mirror (`reflectionOverlays.ts`). Debug: F8 → WATER → REFLECTION DEBUG / `?reflectDebug=1` (mirror only); e2e `tests/e2e/probes/water-reflections.spec.ts`. A new water surface calls `registerReflectiveWater({ object, planeY?, parts? })`; anything that must not appear in the mirror calls `excludeFromReflection(obj)`.

---

## Extending the Shader System

The shader architecture is open for extension via two registries in [UnifiedColonyMaterial.ts](./examples/UnifiedColonyMaterial.ts):
1. **`ShaderPluginRegistry.registerModifier(plugin)`** (`frontend/render/visuals/unified/registries.ts`): inject custom vertex displacements or fragment overlays (e.g., `shieldHexPulse`, `radiationGlitch`, `damageScorchMarks`) without forked materials. A plugin has `name`, `vertexTransformChunk` / `fragmentColorChunk` (appended inside `main()`), `fragmentDeclarations` (uniforms and helpers for the fragment common block), shared `uniforms`, and `createUniforms()` for per-material state. A material opts in with `createUnifiedColonyMaterial({ plugins: [name] })`. Shipped example: the construction scaffold `buildScaffold` (`visuals/unified/buildScaffold.ts`, per-mesh `uBuildStage` / `uBuildHeight`, on for every `createArchetypeMesh`).
2. **`BiomeMaterialRegistry.registerBiome(name, config)`:** Add new planet types (e.g., `volcanic`, `toxicSwamp`, `crystalline`) with custom dust colors, roughness shifts, and rim tints.
