# 2D-to-3D Concept Prompts, Blender MCP Recipes & Provider Extension Guide

---

## 1. Curated 2D Concept Prompt Templates (For Flux.1 / Midjourney Input to 3D AI)

Always generate a single isolated orthographic concept before invoking an Image-to-3D model.

### A. Autonomous Colony Building (Energy / Factory / Silo)
```text
Single isometric 3/4 view of a [COMPACT NUCLEAR FUSION STATION / HYDRO PUMPING FACILITY / AUTOMATED FACTORY], stylized hard-surface sci-fi strategy game building inspired by Factorio and Planetary Annihilation, mounted on a thick dark gunmetal octagonal base pad, matte ceramic-titanium hull (#D8DEE9) with industrial safety-amber accents (#E59838) and glowing cyan energy conduits (#00F0FF), chunky readable mechanical silhouette, thick pipes and vents, no thin wires, flat neutral studio lighting, zero cast shadows, isolated on a solid pure white background #FFFFFF, orthographic 3D game asset sheet.
```

### B. Autonomous Robot Unit (Miner / Builder / Combat / Founder)
```text
Single isometric 3/4 view of a [TRACKED MINING ROBOT WITH ARTICULATED LASER DRILL / SIX-WHEELED COMBAT TURRET BOT], compact utilitarian sci-fi robot, chunky beveled armor plates in matte off-white titanium (#D8DEE9) and safety amber (#E59838), dark gunmetal tracks and hydraulic joints (#242933), recessed glowing cyan sensor visor (#00F0FF), clear separation between parts, flat even studio lighting, no ground shadow, isolated on a pure white background #FFFFFF, orthographic game unit render.
```

### C. Alien Fauna & Nests
```text
Single isometric 3/4 view of a [CHITINOUS DESERT ARACHNID SWARMER / CRYSTALLINE ICE BEETLE], stylized sci-fi alien creature for a top-down strategy game, distinct segmented carapace with bioluminescent crimson-amber markings, sturdy thick legs in a neutral standing A-pose, flat diffuse lighting, no cast shadows, isolated on a solid pure white background #FFFFFF.
```

---

## 2. Blender MCP (`blender-mcp`) Modifier Stack Recipe

When an AI agent uses `blender-mcp` to generate hard-surface or organic `.glb` assets directly inside Blender, it must apply this modifier stack before exporting:

1. **Hard-Surface Buildings & Props:**
   - Base mesh constructed via clean extrusions/booleans.
   - Add **Bevel Modifier** (`width = 0.03m`, `segments = 2`, `limit_method = 'ANGLE'`, `angle_limit = 30°`).
   - Add **Weighted Normal Modifier** (`keep_sharp = True`) so flat faces never exhibit ugly shading gradients.
   - Snap cursor to world origin and align lowest vertex to `Z = 0.0` in Blender (exports as `Y = 0.0` in glTF).
2. **Organic Alien Fauna / Flora / Rock Arches:**
   - Construct a vertex-edge skeleton graph.
   - Add **Skin Modifier** + **Subdivision Surface** (`levels = 2`) + **Decimate Modifier** (`ratio = 0.25`, `COLLAPSE`).
   - Bake ambient occlusion or curvature into a Vertex Color attribute (`Col`) so Three.js shaders can read crevice darkening for free.

---

## 3. Pluggable 3D Provider Adapter Interface

To keep `ai-mesh-pipeline` open for new Image-to-3D backends (TRELLIS.2, Tripo, Rodin, Hunyuan3D, fal.ai, or Replicate), implement this adapter contract:

```typescript
// src/tools/providers/Ai3dProviderAdapter.ts
export interface Generate3dOptions {
  /** Path or URL to the isolated white-background 2D concept image */
  imageInput: string;
  /** Target polygon budget after sanitization */
  targetMaxTris?: number;
  /** Texture resolution (default: 512) */
  textureSize?: 256 | 512 | 1024;
  /** Whether to request quad topology from providers that support it (Tripo/Rodin) */
  preferQuadMesh?: boolean;
  /** Seed for deterministic generation */
  seed?: number;
}

export interface Ai3dProviderAdapter {
  readonly providerName: 'trellis-2' | 'tripo-v3' | 'rodin-gen2' | 'hunyuan3d' | string;
  generateGlbBuffer(options: Generate3dOptions): Promise<Buffer>;
}
```
