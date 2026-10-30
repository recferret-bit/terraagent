---
name: ai-mesh-pipeline
description: >-
  Generate, optimize, sanitize, and integrate external 3D `.glb` assets from
  Image-to-3D AI providers (Microsoft TRELLIS.2, Deemos Rodin, Tripo, Hunyuan3D)
  or Blender MCP into Three.js. Use this skill whenever creating hero buildings,
  alien fauna, terrain props, or running the automated `.glb` mesh/texture
  optimization pipeline.
---

# AI 3D Mesh Generation & Sanitization Pipeline (`ai-mesh-pipeline`)

This skill implements **Pillar 2 (2D Concept Lock $\rightarrow$ 3D Reconstruction $\rightarrow$ Automated GLB Sanitization)** so external AI-generated meshes match the polygon budget, pivot alignment, grid scale, and PBR roughness standards of **TerraAgent**.

---

## Mandatory Pipeline Stages

Never load raw AI-generated `.glb` files directly into Three.js. Every asset must pass through all four stages:

```text
[Stage 1: 2D Ortho Concept] ──► [Stage 2: 3D Reconstruction] ──► [Stage 3: CLI Sanitizer] ──► [Stage 4: Unified Loader]
```

### Stage 1: 2D Orthographic Concept Lock (Zero Cast Shadows)
Never use direct Text-to-3D prompts for production assets. Generate or supply an isolated 2D reference image first using the curated prompt structures in [prompt-templates-and-providers.md](./references/prompt-templates-and-providers.md):
- **Camera:** Isometric front-3/4 view, orthographic projection.
- **Lighting:** Flat, neutral studio illumination with **zero cast ground shadows** and **zero strong directional specular highlights** (prevents the 3D AI from baking dark shadow blotches into albedo textures).
- **Background:** Pure solid white (`#FFFFFF`) or transparent PNG alpha.
- **Silhouette:** Chunky, thick mechanical forms; avoid hair-thin wires that fragment during voxel/mesh reconstruction.
- **Colour roles and detail:** Specify a different colour for each functional group (wheels / chassis / arm / body), real surface detail on every function (a solar panel with visible cells and bus bars, wheels with rims, vents with louvres) and trim plus one emissive light. A reference that is one colour with blank panels reconstructs as a blank mesh. Reject a concept image that fails this before spending a 3D generation.

### Stage 2: 3D Reconstruction (Provider Selection or Blender MCP)
Choose the generator plugin/provider based on the asset archetype:
- **Open-Source / Batch Props & Buildings:** **Microsoft TRELLIS.2** (structured latent PBR output).
- **Hero Hard-Surface Structures (Rocket, Command Core, Factories):** **Deemos Rodin Gen-2.5** (sharp creases, clean sub-parts).
- **Rigged Alien Fauna & Organic Creatures:** **Tripo v3.1** (quad remeshing + auto-rigging).
- **Local Algorithmic / Modifier Modeling:** **Blender MCP (`blender-mcp`)** using Bevel + Weighted Normals + Boolean/Skin modifiers (see [prompt-templates-and-providers.md](./references/prompt-templates-and-providers.md)).

### Stage 3: Automated CLI Sanitization
Run the executable sanitizer script [sanitize-glb.mjs](./scripts/sanitize-glb.mjs) on every exported `.glb`:

```bash
node .agents/skills/ai-mesh-pipeline/scripts/sanitize-glb.mjs \
  --input ./raw-assets/nuclear-station-raw.glb \
  --output ./public/assets/models/nuclear-station.glb \
  --max-tris 4000 \
  --tex-size 512 \
  --min-roughness 0.45
```

What this script enforces automatically:
1. **Deduplication & Vertex Welding:** Merges split seams (`tolerance: 0.0005`).
2. **Meshopt Simplification:** Decimates bloated `100k+` AI meshes down to your exact target triangle budget (`1,500` tris for units/fauna, `4,000` tris for buildings, `8,000` tris for the Rocket).
3. **Bottom-Center Pivot Normalization (`pivot: 'below'`):** Centers `X` and `Z` at `0` and snaps the lowest vertex to `Y = 0.0` so assets never float or sink into terrain tiles.
4. **Texture Downscaling & WebP Compression:** Resizes `2048x2048` AI textures to crisp `512x512` WebP images.
5. **PBR Roughness/Metalness Clamping:** Prevents the "wet plastic" AI artifact by clamping `roughness >= 0.45` and `metalness <= 0.75`.

### Stage 4: Validation & Registration
1. Verify that the output `.glb` file size is `< 1.5 MB` and triangle count meets the archetype budget printed by `sanitize-glb.mjs`.
2. Judge the result like a kitbash model: no parts floating off the body, no overlapping or z-fighting shells, animated parts clear of their neighbours, each functional group a distinct colour, no large blank faces (the rules of the `model-geometry-validator` skill; its CLI only reads archetypes registered through `KitbashBuilder`, so for a `.glb` apply them in the playground with `?inspect=` plus the 4-view sheet).
3. Load the sanitized asset through the runtime `loadUnifiedModel()` helper and apply the Unifier Shader (see `shader-texture-tuning` skill).

---

## Extending the Pipeline with New 3D Providers

To add a new Image-to-3D API provider (e.g., a custom ComfyUI Hunyuan3D endpoint, fal.ai, or Replicate webhook):
1. Implement the `Ai3dProviderAdapter` interface documented in [prompt-templates-and-providers.md](./references/prompt-templates-and-providers.md).
2. Pipe the downloaded binary `.glb` buffer directly into `sanitizeAiGlb()` from [sanitize-glb.mjs](./scripts/sanitize-glb.mjs) before saving to `public/assets/models/`.
