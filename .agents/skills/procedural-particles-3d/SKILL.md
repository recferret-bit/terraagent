---
name: procedural-particles-3d
description: >-
  Author, tune, and extend object-driven 3D procedural particle effects and
  articulated tool-cutter beams in Three.js for terraforming, harvesting,
  construction, and combat interactions. Enforces low-poly 3D chunk geometry
  (never 2D sprite templates), the 60/30/10 material-and-color hierarchy with
  CIE Lab contrast, ballistic ground-bounce physics, and HDR bloom accents.
  Use this skill whenever creating or modifying particle emitters, work effects,
  or interaction debris.
---

# Object-Driven 3D Procedural Particles (`procedural-particles-3d`)

This skill enforces the **Object-Driven 3D Miniature Debris Architecture** so every bot interaction (felling trees, fracturing basalt rocks, grading sand dunes, filling craters, mining ore/crystals/oil, or welding hulls) ejects physically grounded, multi-layered 3D chunks derived directly from the **object of interaction** rather than generic 2D billboard smoke templates.

---

## Core Architectural Rules (The 4 Particle Pillars)

1. **Pillar 1 — Compositional 3D Chunk Geometry Over Flat Billboards:**
   - **Never** use 2D `THREE.Sprite` or camera-facing quad textures for debris. Every particle layer renders an instanced low-poly 3D mesh (`ParticleGeometryKind`: faceted rock shards, cleaved slate slabs, folded botanical leaves, curved bark slabs, wood splinters, saltating sand tetrahedra, crystalline prisms, metallic ore nuggets, oil droplets, or elongated velocity-stretched sparks).
   - Every preset (`ParticlePresetSpec`) must combine **at least 3 layers** across **at least 2 distinct 3D geometry primitives** so the silhouette reads as heterogeneous physical matter at the `28°` telephoto isometric angle.

2. **Pillar 2 — Strict 60 / 30 / 10 Debris Hierarchy & CIE $L^*a^*b^*$ Separation:**
   - Mirroring `procedural-kitbash-3d`, every particle preset divides its instance budget into three explicit `role` tiers:
     - **50–65% Primary Matter (`role: 'primary'`):** The signature visual mass of the target object (e.g., vibrant emerald canopy foliage `#38b84e` on `tree`, light weathered granite `#9aa4b2` on `rock`, sunlit golden quartz `#f0be62` on `dune`). Must remain non-emissive (`emissiveIntensity < 1.0`) so directional sun shadows and faceted normals stay crisp.
     - **22–38% Secondary Sub-Structure (`role: 'secondary'`):** The darker structural substrate (e.g., mahogany bark slabs `#6e4423` + heartwood splinters on `tree`, dark basalt slate `#3b424d` on `rock`, deep ochre clods `#b86d2e` on `dune`).
     - **6–20% HDR Energy / Specular Accent (`role: 'accent'`):** High-velocity cutting sparks, bio-luminescent sap motes, piezoelectric quartz flashes, or shockwave rings with `emissiveIntensity >= 3.0` (`additive: true`) to trigger selective `UnrealBloomPass` (`threshold: 1.1`).
   - **Mandatory Colour Contrast:** The dominant `primary` and `secondary` layers must have a perceptual CIE $L^*a^*b^*$ distance of **$\Delta E_{76} \ge 15$** so green foliage + brown bark or light granite + dark basalt never muddy into a single monochrome cloud.

3. **Pillar 3 — Ballistic Kinematics, Ground Restitution Bounce & Tool Cutter Beams:**
   - Particles do not fade out while falling through the floor. At least one heavy solid layer (`primary` or `secondary`) in every preset must set `bounce >= 0.15` so ejected chunks collide with the local terrain plane (`groundY`), bounce with restitution, damp horizontal velocity via surface friction, and skitter to rest before shrinking out.
   - Elongated sparks and splinters use `stretchByVelocity > 1.05` so fast-moving ejecta align their local `+Z` axis along their instantaneous 3D velocity vector and stretch proportionally to speed like real motion-blurred fragments.
   - Every active work site pairs its debris emitter with an **Articulated 3D Tool Cutter Beam** (`ToolBeamSpec`) connecting the bot's GPU-synchronized animated tool muzzle/hands (`evalArchetypeToolOrigins` / `computeMeshToolOrigins` in `frontend/render/particles/toolOrigins.ts`, driven by `uTime`, `uWalkWeight`, and `uWorkWeight = 1`) directly to the target object on the tile, complete with muzzle flare orbs at each hand/tool tip, a high-HDR inner core, pulsing outer plasma sheath, impact flare, and expanding ground shockwave ring.
   - **Target-Object Resolution (`1–2` Hexes / `2m–4m` Range):** When a bot works an obstacle or deposit from 1–2 hexes away (`2m–4m`), laser beams and 3D particle fountains target **directly on the object** (`terrain.props.instancesForTile` nearest prop instance on that tile, or the tile center when no prop instance exists), with a **360° radial debris splash** around the object rather than clamping the cut point close to the bot or spraying debris back into the bot.

4. **Pillar 4 — Open Registry & Automated Validation (`particle-effect-validator`):**
   - Register all presets in `ParticlePresetRegistry` (`frontend/render/particles/ParticlePresetRegistry.ts`).
   - **Every new or edited preset MUST pass `npm run validate:particles -- --all` (skill `particle-effect-validator`) with 0 errors and 0 warnings**, then be visually inspected in `/playground.html?inspect=robot.miner&work=1&workTarget=<kind>`.

---

## Step-by-Step Workflow

### Step 1: Identify the Object of Interaction
Check [particle-physics-and-presets.md](./references/particle-physics-and-presets.md) and [preset-catalog.md](./references/preset-catalog.md) for the 9 built-in `InteractionTargetKind` presets (`tree`, `rock`, `dune`, `hole`, `flat`, `metals`, `minerals`, `oil`, `repair`) and 15 procedural 3D chunk geometries.
- `ParticlePresetRegistry.resolveTargetKind({ mode, terrainKey, depositKind, biomeKey })` maps authoritative tile codes (`TERRAIN_CODES.forest`, `TERRAIN_CODES.rock`, `TERRAIN_CODES.slope`, `TERRAIN_CODES.hole`, `DEPOSIT_CODES.*`), the work mode, and planet biome (`dune`, `oceanForest`, `forestRock`) to the right preset automatically. The sim's terraform ops are `grade`, `clear`, `break`, `dismantle`, `work` (`W02_TERRAFORM_OPS`); `workTargetResolver.ts` passes the op as `mode` except `work` (and `prepare`), which resolve from the tile itself. `clear` → `tree` (`rock` on a dune biome), `break` → `rock`, `dismantle` (like `repair` / `build` / `construct`) → `repair`; `grade` has no mode branch and resolves from the terrain key alone (e.g. `slope` → `dune`, `hole` → `hole`, flat ground → `flat`, or `dune` on a dune biome). `flatten` / `fill` are still accepted mode strings but no sim op sends them.

### Step 2: Compose the 3-Tier Preset Blueprint
When authoring or tuning a `ParticlePresetSpec` in `frontend/render/particles/presetsTerrain.ts` (tree, rock, dune), `presetsGrading.ts` (hole, flat, repair) or `presetsResource.ts` (metals, minerals, oil) (`presets.ts` only concatenates them; or registering a custom preset via `ParticlePresetRegistry.register()`):
1. **Primary Layer (`role: 'primary'`, ~55% of instances):**
   - Pick the signature 3D geometry (`leafCluster`, `rockShard`, `sandGrain`, `soilClod`, `oreNugget`, `crystalShard`, `oilDroplet`).
   - Tune `speedRange`, `upwardBias`, `gravity`, and `bounce`. The ejection direction is not a preset knob: every layer sprays a full 360° radial fountain around the cut point with a fixed slight (0.18) bias toward the bot (`WorkParticleEmitter.spawnParticle`).
2. **Secondary Layer (`role: 'secondary'`, ~32% of instances):**
   - Pick a contrasting structural geometry (`barkSlab` / `woodSplinter`, `slateChunk`, `dustCloud`) with $\Delta E_{76} \ge 15$ against the primary layer.
3. **Accent Layer (`role: 'accent'`, ~13% of instances):**
   - Add `weldSpark`, `energyOrb`, or `pineNeedle` with `emissiveIntensity >= 3.5` and `stretchByVelocity` (`> 1.05` aligns with velocity and stretches).
4. **Tool Cutter Beam (`toolBeam: ToolBeamSpec`):**
   - Set `coreColor`, `glowColor`, `emissiveIntensity` ($\ge 4.0$), `beamRadius`, `pulseFreq`, `sweepFreq`, and `sweepRadius` to match the physical cutting physics (amber laser on wood, cyan plasma arc on rock, acoustic golden wave on sand dunes).

### Step 3: Couple with GPU Work Animation (`uWorkWeight`) & Hand/Tool Muzzle Origins (`toolOrigins.ts`)
When a unit is actively working:
- `EntityMeshes.ts` (and `SpawnSet.ts` in the playground) sets `uWorkWeight = 1.0` on the unit's `UnifiedColonyMaterial`.
- In `shaderChunks.ts`, `uWorkWeight` drives:
  - `BipedBody (8)` & `SpiderBody (9)`: Forward-leaning bracing stance, rhythmic effort heave, and torso/carapace counter-twist.
  - `BipedArm (5)`: Dual-axis cutting/channeling sweep (forward pitch + converging inward yaw) riding on `BipedBody (8)` so tool hands actively work the target.
  - `SpinY (1)`: `3.5x` high-RPM drill/auger spin (`robot.miner`).
  - `RecoilPulse (3)`: Rapid pneumatic impactor/torch pulsing (`robot.builder`, `robot.combat`).
  - `WheelSpin (7)`: Subtle forward/back bracing torque rock.
- **Exact GPU-Synchronized Muzzle Origins (`frontend/render/particles/toolOrigins.ts`):**
  - Never use static world offsets for tool beams, or the lasers will detach from moving arms and drills!
  - `evalArchetypeToolOrigins({ archetypeId, position, yaw?, time?, walkWeight?, workWeight? })` (one params object; `workWeight` defaults to 1) and `computeMeshToolOrigins(mesh, fallbackArchetypeId?, fallbackWalkWeight = 0, fallbackWorkWeight = 1)` (reads the archetype id from `mesh.userData` and `uTime` / `uWalkWeight` / `uWorkWeight` from its material uniforms, the fallbacks only where those are missing) evaluate the exact CPU mirror of the vertex shader's rigid-body transforms (`bipedBodyTransform`, `spiderBodyTransform`, `BipedArm 5`, `SpinY 1`, `RecoilPulse 3`):
    - **`robot.hero` (HQ Drone):** Dual lasers originate strictly from the animated left and right hands (`animType 5` shoulder pitch + converging work yaw + `bipedBodyTransform`), with glowing muzzle flare orbs locked to both palms.
    - **`robot.miner` (Harvester):** Dual/single beams lock to the animated front rotary auger drill (`SpinY 1`) and upper Auxiliary cutter lamp.
    - **`robot.builder` (Builder Bot):** Beams lock to the articulated welding torch arm and top projector emitter (`RecoilPulse 3`).
    - **`robot.combat` / spiders (`SpiderBody 9`):** Dual beams lock to the recoiling twin turret barrels (`animType 39` = `RecoilPulse 3` riding on `SpiderBody 9`).
- **Target-Object Resolution (`workTargetResolver.ts`):**
  - When a unit works a tile from 1–2 hexes away (`2m–4m`), `buildActiveWorkSites` queries `terrain.props.instancesForTile(tileIndex)` and picks the nearest 3D prop instance (tree, boulder, spire, or deposit node) on that target tile (falling back to the tile center `tileXZ(q, r)` when the tile has no prop instances).
  - The tool beam reaches all the way to the target object (`targetPos`), and the 3D particle emitter spawns chunks right at the sweeping cut point on the object with a 360° radial splash around the object rather than spraying back into the bot.

### Step 4: Validate Numerically, Then Inspect in the Playground
1. Run the automated particle validator and self-test:
   ```bash
   npm run validate:particles -- --all
   npm run test:particles
   npm run validate:models -- --all
   ```
2. Open `/playground.html?inspect=robot.miner&work=1&workTarget=tree` and cycle through targets (`tree`, `rock`, `dune`, `hole`, `flat`, `metals`, `minerals`, `oil`, `repair`) using the **`target: <kind>`** toolbar button (or `window.__pg.setWorkTarget('rock')`).
3. Verify across `iso`, `front`, `side`, and `top` views that:
   - The tool beam originates cleanly at the bot's tool muzzle/hands and sweeps the ground target.
   - Both primary and secondary chunk colours are immediately distinguishable (e.g. green canopy leaves fluttering down while brown bark slabs bounce off the ground).
   - When `work` is toggled off, airborne particles continue falling and bouncing to rest rather than vanishing abruptly.
