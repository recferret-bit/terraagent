---
name: procedural-kitbash-3d
description: >-
  Generate, assemble, and extend procedural 3D hard-surface models (robots,
  buildings, energy stations, turrets, rockets, and resource nodes) in Three.js
  using the modular Kitbashing DSL, RoundedBoxGeometry, 60/30/10 material
  zones, and GPU vertex-color animation encoding. Use this skill whenever creating
  or modifying procedural 3D meshes in code.
---

# Procedural 3D Kitbashing Skill (`procedural-kitbash-3d`)

This skill enforces **Pillar 1 (Modular Hard-Surface Kitbashing)** so AI-generated Three.js models look like cohesive, high-detail sci-fi miniatures rather than primitive geometric snowmen.

---

## Core Architectural Rules

1. **Ban Sharp `THREE.BoxGeometry` on Structural Hulls:**
   - Always use `RoundedBoxGeometry` (`three/addons/geometries/RoundedBoxGeometry.js`), `LatheGeometry`, or beveled `ExtrudeGeometry`. Beveled edges catch specular highlights from the scene's IBL environment map.
2. **Enforce the 60 / 30 / 10 Material Zone Hierarchy:**
   - **60% Primary Hull (`zone: 'hullPrimary'`):** Satin ceramic/titanium armor plates (`roughness: 0.42`, `metalness: 0.15`).
   - **30% Mechanical Skeleton (`zone: 'frameGunmetal'`):** Dark gunmetal (`0x242933`, `roughness: 0.55`, `metalness: 0.80`) for joints, vents, undercarriages, treads, struts, and sagging cables.
   - **10% Accent & HDR Emissive (`zone: 'hullSecondary'` + `'energyCyan'` / `'warningAmber'`):** High-contrast faction trim and HDR glowing cores (`emissiveIntensity >= 3.0`) that trigger selective `UnrealBloomPass`.
3. **Minimum Complexity Floor:**
   - Every robot or building must combine **at least 7 kitbash sub-parts**, include **at least 1 silhouette breaker** (angled antenna, sagging power cable, radar dish, or external fluid tank), and sit on a **grounded base/plinth** (`minY = 0.0`, with foundations extending `-0.1m` below ground for sloped terrain).
4. **Single-Draw-Call Merging (`InstancedMesh` Ready):**
   - Stamp material zone IDs and GPU animation weights into **Vertex Attributes** (`color` and `aPartMeta`) and merge all sub-parts with `BufferGeometryUtils.mergeGeometries()` so 500+ units render in a single `THREE.InstancedMesh` draw call.

---

## Step-by-Step Workflow

### Step 1: Select or Extend Greebles
1. Review the available kitbash sub-assemblies in [greeble-catalog.md](./references/greeble-catalog.md).
2. If the asset requires a new reusable mechanical detail (e.g., a cryo-condenser coil, plasma drill head, or hydro turbine), register it as a reusable generator function in the Kitbash Registry following [KitbashRegistry.ts](./examples/KitbashRegistry.ts) before building the final unit.

### Step 2: Compose the Archetype Blueprint
Assemble the entity in four layers from bottom to top:
1. **Layer A — Ground Contact & Locomotion/Foundation (`Y: -0.1m → 0.35m`):**
   - For buildings: Octagonal or chamfered dark gunmetal foundation plinth (`minY = -0.1m` for slope tolerance, main pad at `Y = 0`).
   - For units: Tracked treads, multi-wheeled bogies, spider legs, or angled hover-thrusters.
2. **Layer B — Core Structural Chassis (`Y: 0.25m → 1.5m`):**
   - Primary `RoundedBoxGeometry` or compound cylinder/hex hull + recessed dark mechanical waist/spine.
3. **Layer C — Functional Payload & Greebles:**
   - Cooling vent arrays, solar wings, storage tanks, hydraulic pistons, and **sagging `CatmullRomCurve3` power cables** connecting the chassis to the payload.
4. **Layer D — Emissive Telemetry & Silhouette Breakers:**
   - Glowing sensor visors, status LED beacons, plasma coils, or rotating radar/wind vanes tagged with GPU animation channels.

### Step 3: Encode GPU Animation Channels (Zero CPU Overhead)
Instead of creating separate child `THREE.Mesh` hierarchies for `AnimationMixer`, tag vertices via `PartAnimationTag` in [KitbashRegistry.ts](./examples/KitbashRegistry.ts):
- `animType = 0`: Static chassis part.
- `animType = 1`: Continuous Y/Z-axis rotation around local part pivot (wind turbine blades, radar dishes, mining drills).
- `animType = 2`: Sinusoidal vertical hover/bobbing or hydraulic piston oscillation.
- `animType = 3`: Recoil / pulse scaling along part forward vector (turret barrels, thumper pistons).

### Step 4: Visual Diagnostic Verification
After generating a new procedural model:
1. Mount the geometry in the diagnostic turntable scene: any archetype registered in `ArchetypeCatalog` appears automatically in the 3D playground at `/playground.html?inspect=<id>` (see `diorama-viewport-auditor` skill). Its info panel must show `minY 0.000` and fewer than 3.5k triangles.
2. Verify that:
   - No sub-parts float disconnected in mid-air.
   - The bottom of the foundation/treads sits flush with the `Y = 0` ground plane.
   - Specular edge highlights and HDR emissive bloom accents are clearly readable from the `28°` telephoto RTS camera angle.

---

## Extending the Skill

To extend this skill with new procedural generators:
1. Add the new generator specification and parameter contract to [greeble-catalog.md](./references/greeble-catalog.md).
2. Implement the generator via `KitbashRegistry.registerGreeble(name, fn)` in [KitbashRegistry.ts](./examples/KitbashRegistry.ts).
3. Keep all generators pure and parameterized (width, height, depth, seed, bevelRadius) so both deterministic rules and LLM directors can instantiate variants.
