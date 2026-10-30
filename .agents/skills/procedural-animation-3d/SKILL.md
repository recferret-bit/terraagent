---
name: procedural-animation-3d
description: >-
  Author, rig, tune, and validate zero-CPU-overhead procedural 3D animations
  (bipedal walk cycles, counter-swinging arms, 4/6/8-legged spider & hexapod
  alternating gaits, rolling rover wheels, spinning radars/drills, hover bobbing,
  and turret recoil) in Three.js using GPU vertex-shader kinematics (`aPartAnim`),
  coupled multi-link pivot math, and `uWalkWeight` locomotion blending. Use this
  skill whenever animating robots, walkers, vehicles, buildings, or props.
---

# Procedural 3D Animation Skill (`procedural-animation-3d`)

This skill enforces **Zero-CPU Runtime Procedural Animation** across all `TerraAgent` 3D units and buildings. Instead of spawning expensive `THREE.SkinnedMesh` bone hierarchies, `THREE.AnimationMixer` instances, or per-frame CPU Inverse Kinematics solvers that break instancing, all mechanical rigging is stamped into vertex attributes (`aPartAnim`) at build time and evaluated in closed form inside the `UnifiedColonyMaterial` vertex shader.

---

## Core Architectural Rules (Performance & Quality)

1. **Zero CPU Calculations at Runtime:**
   - Never run per-frame bone matrix multiplications, scene-graph traversal, or iterative IK loops on the CPU during gameplay.
   - All sub-parts of an archetype merge into **one `THREE.BufferGeometry`** cached in `ArchetypeCatalog.getGeometry(id)`.
   - At runtime, advancing an animated unit costs **two float uniform assignments** (`uTime` and `uWalkWeight` via `tickArchetypeMesh(mesh, time, walkWeight)`), keeping 500+ units at 60 FPS.
2. **Coupled Multi-Link Limb Rigging (Single Root Pivot per Limb):**
   - A multi-part limb (e.g., `hip` + `thigh` + `knee` + `shin` + `ankle` + `foot`) is merged into a single vertex buffer. If different segments of the same leg used different `animPivot` coordinates without a bone hierarchy, their joints would tear apart during motion.
   - **Rule:** Every sub-part belonging to the same limb or wheel MUST share the **exact same `animType` and root `animPivot`** (the hip socket `[hipX, hipY, hipZ]`, shoulder socket `[shX, shY, shZ]`, or wheel axle `[wx, wy, wz]`).
   - The vertex shader evaluates a **continuous coupled kinematic field** from `(position - pivot)` (e.g., hip pitch + knee tuck + asymmetric foot-clearance lift), guaranteeing $C^1$ continuity across every joint so sub-parts never separate or shear.
3. **Ball-Joint Socket Mounting & ≥ 1 cm Swing Clearance:**
   - Place a spherical ball-joint (`sph`, centered at `animPivot`) at the root of every articulated limb (`leg hip`, `arm shoulder`), sunk into the static chassis/pelvis. Because a sphere rotating around its own center is invariant, it never detaches (`ANIM_DETACH`) and never deepens overlap (`ANIM_DEEPENS_OVERLAP`) into the static hull.
   - Keep moving struts (`leg thigh`, `leg femur`, `arm upper`) connected to the ball-joint but **$\ge 1.5\text{ cm}$ clear of static hull walls** so they do not trigger `ANIM_COLLISION` at maximum stride angle.
4. **Asymmetric Foot Clearance (`minY >= 0.000` Over Entire Stride):**
   - Walking gaits (`animType = 4` and `6`) combine forward/backward swing with an asymmetric vertical foot-lift curve (`abs(sin) + max(0, cos)`) weighted by distance from the hip socket.
   - During the ground stance phase ($\cos(\tau) \le 0$), the planted foot touches $y = 0.000$; during the forward recovery stroke ($\cos(\tau) > 0$), the knee and foot lift cleanly above ground, never dipping below $y = -0.02\text{ m}$ (`ANIM_BELOW_GROUND`).
5. **Frustum-Culling Bounding Sphere Expansion:**
   - Because vertices displace on the GPU, `common.ts` expands `geometry.boundingSphere.radius *= 1.15` after `computeBoundingSphere()` so legs at full stride never pop out of view near screen edges.

---

## The 8 GPU Animation Channels (`aPartAnim`)

Stamp each part in `KitbashBuilder.addPart(geo, zone, { name, position, animType, animPivot })`:

| `animType` | Channel Name | Typical Parts | Kinematic Formula in `shaderChunks.ts` & `poses.ts` |
| :---: | :--- | :--- | :--- |
| **`0`** | `Static` | Hulls, cabins, static struts | $\Delta\mathbf{p} = \mathbf{0}$ (rest pose). |
| **`1`** | `SpinY` | Radar dishes, turbines, auger drills | Continuous Y-axis spin around `pivot`: $\theta = 2.5 t$. |
| **`2`** | `HoverBob` | Thruster cores, hover pads, crystal nodes | Vertical oscillation: $\Delta y = \sin(4.0 t + 3.1 p_x) \cdot 0.05\text{ m}$. |
| **`3`** | `RecoilPulse` | Cannon barrels, thumpers, beacons, torches | Impulse recoil along $-Z$: $\Delta z = -\max(\sin(5.0 t + 2.3 p_x), 0)^6 \cdot 0.06\text{ m}$. |
| **`4`** | `BipedLeg` | Bipedal legs (`robot.hero` hip $\rightarrow$ foot) | Opposite left/right phase $\phi = (p_x \ge 0) ? 0 : \pi$, $\tau = 5.0 t + \phi$.<br>Hip pitch $\theta = 0.18 w_{\text{walk}} \sin\tau$ in $YZ$ around `pivot`, plus foot lift $\Delta y = w_{\text{walk}} \text{legT} (|\sin\tau| \cdot 0.038 + \max(0, \cos\tau) \cdot 0.045)$ and knee tuck $\Delta z = -w_{\text{walk}} \text{kneeT} \max(0, \cos\tau) \cdot 0.055$. |
| **`5`** | `BipedArm` | Bipedal arms (`robot.hero` shoulder $\rightarrow$ hand) | Counter-phase shoulder swing $\phi = (p_x \ge 0) ? \pi : 0$ (balances `BipedLeg`), $\tau = 5.0 t + \phi$.<br>Pitches $(y - p_y, z - p_z)$ around shoulder `pivot` by $\theta = 0.16 w_{\text{walk}} \sin\tau$. |
| **`6`** | `SpiderLeg` | 4/6/8-legged walkers (`robot.combat` spider legs) | Automatic diagonal/tripod/metachronal phase $\phi = ((p_x \ge 0) ? 0 : \pi) + 4.9 p_z$, $\tau = 5.0 t + \phi$.<br>Coxa yaw $\theta = 0.14 w_{\text{walk}} \text{sign}(p_x) \sin\tau$ in $XZ$ around hip `pivot`, plus radial stepping lift $\Delta y = 0.075 w_{\text{walk}} \text{radial} \max(0, \cos\tau)$. |
| **`7`** | `WheelSpin` | Rover wheels (`tyre`+`rim`+`hub`), track rollers | Continuous X-axis rolling around wheel axle `pivot`: $\theta = 4.0 t w_{\text{walk}}$. |

Full mathematical derivations and phase tables are in [references/gait-and-ik-math.md](./references/gait-and-ik-math.md).

---

## Step-by-Step Workflow

### Step 1: Rig the Archetype with Socket Pivots
1. Follow [examples/AnimatedRigExamples.ts](./examples/AnimatedRigExamples.ts).
2. Define one 3D joint coordinate per limb/wheel (`const hip: V3 = [0.39 * s, 0.76, z * 0.8]`) and pass `{ animType, animPivot: hip }` to **every sub-part** of that limb/wheel.
3. Ensure left and right limbs have opposite-signed `pivot.x` (`0.2 * s`) so `BipedLeg`, `BipedArm`, and `SpiderLeg` automatically compute opposite phase offsets.
4. For multi-legged walkers (4, 6, or 8 legs), space hip sockets along `Z` (`pivot.z`); the formula `((pivot.x >= 0) ? 0 : PI) + pivot.z * 4.9` automatically produces diagonal trotting for 4 legs, alternating tripod gait for 6 legs, and metachronal wave gait for 8 legs.

### Step 2: Validate Full Pose Sweeps (`model-geometry-validator`)
Every animated channel is mirrored in `frontend/render/kitbash/validate/poses.ts` and swept across its full $360^\circ$ cycle by `frontend/render/kitbash/validate/checks/animation.ts`:
```bash
npm run validate:models -- <archetype-id>
npm run test:models
```
Fix any reported issue before visual inspection:
- `ANIM_COLLISION`: A swinging leg, arm, or radar dish comes within `< 1 cm` of a static hull plate, cable, or neighboring limb. Fix by moving the limb's start strut $\ge 1.5\text{ cm}$ outside the static hull wall (while keeping it inside the socket sphere) or rerouting cables above shoulder/hip height.
- `ANIM_BELOW_GROUND`: A foot or bobbing part dips below `y = -0.02 m`. Fix by raising the rest foot to `y >= 0.0` or adjusting `animPivot.y`.
- `ANIM_DETACH`: The root of a limb lifts `> 3 cm` off its static mount. Fix by centering a ball-joint sphere (`sph`) right on `animPivot` and sinking it into the static chassis.

### Step 3: Drive Runtime Locomotion with Zero CPU Overhead
- **In `/playground.html` (Turntable QA):** `uWalkWeight` defaults to `1.0`, so `tickArchetypeMesh(mesh, time)` plays all locomotion and secondary channels continuously for visual verification across `iso`, `front`, `side`, and `top` views.
- **In `/play.html` (`Gameplay.ts`):** Smoothly damp a per-agent scalar `walk` toward `1.0` while moving and `0.0` while stopped (`agent.walk += ((moving ? 1 : 0) - agent.walk) * Math.min(1, dt * 10)`), then call:
  ```ts
  tickArchetypeMesh(agent.obj, this.time, agent.walk);
  ```
  When `walk` settles to `0`, legs and wheels plant smoothly at their rest stance (`minY = 0.000`) while secondary channels (`SpinY` radars, `HoverBob` thrusters, `RecoilPulse` beacons) continue running on `uTime`.

---

## Extending with New Procedural Gaits

To add a new procedural animation channel (`animType = 8`, e.g., insect wing flutter, crane boom articulation, or serpentine slither):
1. Add the GLSL branch to `vertBeginVertex` in `frontend/render/visuals/unified/shaderChunks.ts` (keep math branch-local, using `uTime`, `uWalkWeight`, and `pivot`).
2. Add the identical TypeScript pose generator to `frontend/render/kitbash/validate/poses.ts` and update `inSync` in `frontend/render/kitbash/validate/checks/animation.ts`.
3. Add a known-bad collision fixture and a known-good clearance fixture to `.agents/skills/model-geometry-validator/scripts/self-test.mjs` and verify `npm run test:models` passes.
