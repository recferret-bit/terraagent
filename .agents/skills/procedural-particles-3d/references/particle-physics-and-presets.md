# 3D Particle Geometries, Presets & Physics Reference

## 1. Procedural 3D Chunk Geometries (`frontend/render/particles/geometries.ts`)

All particle geometries are low-poly, non-indexed `THREE.BufferGeometry` primitives with flat face normals (`computeVertexNormals()`), cached once per process.

| `ParticleGeometryKind` | Tris | Visual Shape | Primary Use Cases |
| :--- | :---: | :--- | :--- |
| `leafCluster` | 16 | Folded V-ridge botanical leaf blade with dihedral angle | `work.tree` primary canopy foliage |
| `pineNeedle` | 16 | Slender 4-sided tapered needle cluster | `work.tree` secondary needles |
| `barkSlab` | 20 | Curved rugged bark chip with beveled outer face | `work.tree` secondary trunk bark |
| `woodSplinter` | 8 | Asymmetric jagged timber shard (`stretchByVelocity`) | `work.tree` heartwood splinters |
| `rockShard` | 20 | Deterministic vertex-jittered faceted icosahedron | `work.rock`, `work.hole`, `work.flat` |
| `slateChunk` | 8 | Flat cleaved basalt slab | `work.rock`, `work.metals`, `work.repair` |
| `sandGrain` | 8 | Squat octahedral crystal grain | `work.dune` primary saltating sand |
| `dustCloud` | 36 | Low-poly lumpy dust puff | `work.dune`, `work.flat` fine plume |
| `soilClod` | 20 | Lumpy irregular dirt clod | `work.hole`, `work.flat` |
| `crystalShard` | 24 | Elongated hexagonal bipyramid prism | `work.minerals` primary quartz shard |
| `oreNugget` | 36 | Faceted metallic polyhedron | `work.metals` primary iron/titanium ore |
| `oilDroplet` | 8 | Teardrop-stretched hydrocarbon globule | `work.oil` primary/secondary crude |
| `weldSpark` | 8 | Elongated diamond needle (`stretchByVelocity`) | All presets (`role: 'accent'` HDR sparks) |
| `energyOrb` | 20 | Icosahedral plasma mote | `work.tree`, `work.dune`, `work.minerals`, `work.oil` |
| `shockRing` | 48 | Low-poly 3D torus shockwave ring | Ground impact pulses |

---

## 2. Built-in Object-of-Interaction Presets (`frontend/render/particles/presetsTerrain.ts` / `presetsGrading.ts` / `presetsResource.ts`, concatenated in `presets.ts`)

| Preset ID | `targetKind` | Trigger Condition | 60% Primary Layer | 30% Secondary Layer | 10% HDR Accent Layer |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `work.tree` | `tree` | `TERRAIN_CODES.forest` | Vibrant emerald `leafCluster` (`#38b84e`, flutter swirl + high drag) | Mahogany `barkSlab` (`#6e4423`) + ochre `woodSplinter` (`#c9934b`, bounce `0.38`) | Amber laser `weldSpark` + bio-sap `energyOrb` (`#a8ff60`, HDR `4.0`) |
| `work.rock` | `rock` | `TERRAIN_CODES.rock` | Light weathered granite `rockShard` (`#9aa4b2`, bounce `0.48`) | Dark basalt `slateChunk` (`#3b424d`, bounce `0.35`) | Cyan plasma `weldSpark` (`#66f7ff`, HDR `5.0`, stretch `2.8`) |
| `work.dune` | `dune` | `TERRAIN_CODES.slope` (or `dune` biome grading) | Sunlit golden `sandGrain` (`#f0be62`, saltation bounce `0.32` + swirl) | Reddish-brown iron-oxide `soilClod` + `dustCloud` (`#b86d2e`) | Acoustic solar `energyOrb` (`#ffe885`, HDR `3.8`) |
| `work.hole` | `hole` | `TERRAIN_CODES.hole` | Dark organic loam `soilClod` (`#5c4332`, bounce `0.25`) | Pale bedrock gravel `rockShard` (`#b8afa0`, bounce `0.42`) | Amber compaction `weldSpark` (`#ffae42`, HDR `4.2`) |
| `work.flat` | `flat` | Grading `flat` / `ridge` / `moat` on non-dune biomes | Warm regolith `soilClod` (`#9e8468`, bounce `0.28`) | Dark slate `rockShard` (`#454b54`, bounce `0.36`) | Cyan grading laser `weldSpark` (`#5ce6ff`, HDR `4.0`) |
| `work.metals` | `metals` | Harvesting `DEPOSIT_CODES.metals` | Specular steel `oreNugget` (`#adb8c9`, metalness `0.82`, bounce `0.45`) | Rust-red oxide `slateChunk` (`#6b3a2e`, bounce `0.32`) | White-hot `weldSpark` (`#ffcf70`, HDR `5.2`, stretch `3.0`) |
| `work.minerals` | `minerals` | Harvesting `DEPOSIT_CODES.minerals` | Cyan-teal `crystalShard` (`#4be3d6`, bounce `0.50`) | Deep indigo matrix `rockShard` (`#342c54`, bounce `0.36`) | Magenta-cyan piezo `energyOrb` (`#ff73fa`, HDR `4.8`) |
| `work.oil` | `oil` | Harvesting `DEPOSIT_CODES.oil` | Glossy obsidian crude `oilDroplet` (`#1d222b`, bounce `0.18`) | Ochre-amber bitumen `soilClod` (`#8f6834`, bounce `0.22`) | Amber flare `energyOrb` (`#ff8826`, HDR `4.5`) |
| `work.repair` | `repair` | Repairing damaged entity, constructing a building, or dismantling one (W02 `dismantle` op) | Ceramic-white hull `slateChunk` (`#d8dde6`, bounce `0.40`) | Gunmetal frame `rockShard` (`#333c4a`, bounce `0.34`) | Intense arc-weld `weldSpark` (`#70f5ff`, HDR `5.5`, stretch `3.2`) |

---

## 3. Physics & Kinematic Parameters (`ParticleLayerSpec`)

- **`gravity` ($m/s^2$):** Downward acceleration. Use `1.8–2.5` for fluttering leaves/dust, `6.5–8.5` for saltating sand and oil globules, and `10.5–14.5` for dense rock shards and metallic ore.
- **`drag` ($s^{-1}$):** Exponential air resistance (`exp(-drag * dt)`). High drag (`2.5–3.8`) makes foliage decelerate rapidly after ejection and drift down; low drag (`0.4–0.9`) lets dense rocks follow clean parabolic arcs.
- **`bounce` (`0..0.95`):** Coefficient of restitution on ground impact (falling below `site.groundY + 0.35 × chunk scale`; `groundY` is the terrain height at the target). Horizontal X/Z velocity is damped (× 0.72) on each bounce so chunks skitter to a halt.
- **`swirl` ($m/s$):** Tangential vortex acceleration around the work site's vertical axis. Essential for `work.tree` leaf flutter (`1.6`) and `work.dune` sand devil eddies (`1.8`).
- **Ejection direction (not a preset field):** every layer sprays a full 360° radial fountain with a fixed slight (`0.18`) horizontal bias toward the bot (`WorkParticleEmitter.spawnParticle`). Spawn positions are **outside** the target volume (a random 0.7–1.3 m offset from the target centre on X, Y and Z, plus a smaller jitter), never at the cut point inside the mesh.
- **`stretchByVelocity`:** When `> 1.05`, orients the particle's local `+Z` axis along its instantaneous 3D velocity vector and scales length proportionally to speed (`1 + min(speed * 0.35, stretchByVelocity - 1)`).

---

## 4. GPU-Synchronized Tool Muzzle Origins (`frontend/render/particles/toolOrigins.ts`)

Because unit limbs animate entirely on the GPU via `aPartAnim` in `shaderChunks.ts`, tool beams and muzzle flares must evaluate the exact CPU mirror (`evalArchetypeToolOrigins` / `computeMeshToolOrigins`) so beams stay 100% locked to moving hands, drills, and barrels:

| Archetype ID | Tool Origin Channels | Muzzle Behavior |
| :--- | :--- | :--- |
| `robot.hero` (HQ Drone) | Dual hands: `BipedArm (5)` around shoulder pivots `(±0.34, 1.08, 0.0)` + `bipedBodyTransform (8)` | Dual lasers originate strictly from the animated left and right hands (`(±0.34, 0.72, 0.24)` rest tips transformed by shoulder pitch, converging work yaw, and body heave/twist) with muzzle flare orbs at each palm. |
| `robot.miner` (Worker Drone T1) | Rotary drill (`SpinY 1`) + upper cutter lamp | Primary beam locks to the spinning auger tip; secondary beam locks to the upper auxiliary cutter. |
| `robot.builder` (Worker Drone T2 / T3) | Articulated torch (`RecoilPulse 3`) + top projector | Beams lock to the recoiling plasma torch nozzle and top nano-lathe projector. |
| `robot.combat` (Recon Spider) | Twin autocannon barrels (`animType 39`: `RecoilPulse 3` + `SpiderBody 9`) | Dual beams lock to the alternating-recoil left/right turret muzzles riding on the spider carapace suspension. |

---

## 5. Target-Object Resolution Across 1–2 Hexes (`workTargetResolver.ts`)

When a bot works a tile from 1–2 hexes away (`2m–4m` world distance):
1. `buildActiveWorkSites` queries `terrain.props.instancesForTile(tileIndex)` and selects the **nearest 3D prop instance** (pine/broadleaf tree, boulder, rock spire, or metal/mineral/oil deposit node) on that target tile, falling back to the tile center `tileXZ(q, r)` when the tile has no prop instances.
2. The bot rotates (`yaw = atan2(dx, dz)`) to face the resolved prop/tile target. Tool cutter beams end on the **outside** of the object (a shell point toward the bot, not inside `targetPos`). The 3D debris fountain spawns outside that volume — 0.7–1.3 m from the target centre on X, Y and Z — with a 360° radial splash around `targetPos`.
