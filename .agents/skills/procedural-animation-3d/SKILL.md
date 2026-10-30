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
2. **100% Rigid-Body Multi-Link Kinematics (Zero Part Distortion — `ANIM_DISTORTION`):**
   - **Never scale, stretch, shear, bend, or blend per-vertex coordinates inside a mechanical part!** Every sub-part of a robot or building is a rigid solid (`RoundedBox`, `Cylinder`, `Sphere`, `Lathe`) and may ONLY undergo **pure 3D Euclidean rigid-body transformations** ($\mathbf{p}' = \mathbf{R}_{\text{part}}\,\mathbf{p} + \mathbf{T}_{\text{part}}$ where $\mathbf{R}_{\text{part}} \in SO(3)$ and $\mathbf{T}_{\text{part}} \in \mathbb{R}^3$ depend **only** on `uTime`, `uWalkWeight`, `animType`, and the part's constant `pivot`, NEVER on the vertex coordinate `position`).
   - The validator's `animationStage` enforces `ANIM_DISTORTION`: if any triangle edge in any animated part changes length by $> 0.5\text{ mm}$ during its motion sweep, validation fails with an error.
   - **Multi-Link Articulated Limbs via Shared Root `animPivot`:**
     - Every sub-part of a multi-link limb passes the **same root hip socket `animPivot`** (`[hipX, hipY, hipZ]`), while its `subAnim = floor(rawAnim / 10)` selects which rigid link of the kinematic chain it belongs to:
       - **Spider 2-Link Leg (`base = 6`):** Upper link `animType = 6` (`leg hip` + `leg femur`) rotates rigidly in 3D around `hip`; lower link `animType = 16` (`leg knee` + `leg tibia` + `leg foot`) attaches at the moving knee center $\mathbf{p}'_{\text{knee}} = \mathbf{p}_{\text{hip}} + \Delta\mathbf{h} + \mathbf{R}_{\text{femur}}(\mathbf{k}_0)$ and yaws rigidly with the coxa while staying upright.
       - **Biped 3-Link Leg (`base = 4`):** Upper link `animType = 4` (`leg hip` + `leg thigh` + `leg hydraulic`) pitches rigidly around `hip`; middle link `animType = 14` (`leg knee` + `leg shin` + `leg ankle`) attaches at the moving knee center $\mathbf{p}'_{\text{knee}}$ and flexes backward during swing; lower link `animType = 24` (`leg foot` + `leg toe cap`) attaches at the moving ankle center $\mathbf{p}'_{\text{ankle}}$ and stays dorsiflexed level with the ground.
     - Because each link's joint center ($\mathbf{p}_{\text{hip}}$, $\mathbf{p}'_{\text{knee}}$, $\mathbf{p}'_{\text{ankle}}$) is computed from the exact rigid rotation of the parent link, ball-joint spheres centered at those joints remain **100% locked together with zero gap and zero distortion**.
3. **Ball-Joint Socket Mounting & ≥ 1 cm Swing Clearance:**
   - Place a spherical ball-joint (`sph`, centered at `animPivot`) at the root of every articulated limb (`leg hip`, `arm shoulder`), sunk into the static chassis/pelvis. Because a sphere rotating around its own center is invariant, it never detaches (`ANIM_DETACH`) and never deepens overlap (`ANIM_DEEPENS_OVERLAP`) into the static hull.
   - Keep moving struts (`leg thigh`, `leg femur`, `arm upper`) connected to the ball-joint but **$\ge 1.5\text{ cm}$ clear of static hull walls** so they do not trigger `ANIM_COLLISION` at maximum stride angle.
4. **Asymmetric Foot Clearance (`minY >= 0.000` Over Entire Stride):**
   - Walking gaits (`animType = 4` and `6`) combine forward/backward swing with an asymmetric vertical foot-lift curve (`abs(sin) + max(0, cos)`) weighted by distance from the hip socket.
   - During the ground stance phase ($\cos(\tau) \le 0$), the planted foot touches $y = 0.000$; during the forward recovery stroke ($\cos(\tau) > 0$), the knee and foot lift cleanly above ground, never dipping below $y = -0.02\text{ m}$ (`ANIM_BELOW_GROUND`).
5. **Frustum-Culling Bounding Sphere Expansion:**
   - Because vertices displace on the GPU, `common.ts` expands `geometry.boundingSphere.radius *= 1.15` after `computeBoundingSphere()` so legs at full stride never pop out of view near screen edges.
6. **Full-Body Step Reaction, Mass, Suspension & Phase-Lagged Inertia (`BipedBody 8` & `SpiderBody 9`):**
   - **Never leave a legged walker's chassis static (`animType = 0`)!** A static hull while legs swing makes a heavy mech or battle spider look weightless and robotic in the bad sense (zero ground reaction force, zero suspension compression, zero momentum).
   - Tag all body, carapace, pelvis, torso, head, turret, and cable sub-parts of a biped with **`animType = 8` (`BipedBody`)** and of a multi-legged walker with **`animType = 9` (`SpiderBody`)**.
   - Both body carriers evaluate **spring-damped $2\omega$ step-impact heave** (`-cos(2g) - 0.6 sin(2g)`, dropping sharply right after each foot/diagonal pair strikes the ground and rebounding as the stance legs push off), **phase-lagged roll, pitch, and yaw** around the center of mass, **lateral weight shift** onto the planted side, and **forward surge impulse**.
   - **Hip-Socket Lock & Rigid Multi-Link Suspension:** In the vertex shader (`shaderChunks.ts`) and validator (`poses.ts`), the hip socket of `BipedLeg (4)` and `SpiderLeg (6)` translates by $\Delta\mathbf{h} = \mathcal{B}(\mathbf{p}_{\text{hip}}) - \mathbf{p}_{\text{hip}}$, locking the hip 100% into the heaving chassis. On `SpiderLeg (6)`, the rigid femur elevation angle $\theta_{\text{femur}} = (\text{stepLift} - \Delta h_y + 0.004 w) / |p_x|$ automatically pitches the femur upward whenever the carapace drops down ($\Delta h_y < 0$), keeping the rigid `SpiderTibia (16)` foot planted flat on the ground ($y = 0.000$) while the carapace visibly sinks between the knees.
   - **Compound Mounted Channels (`18, 19, 28, 29, 38, 39`):** Parts mounted on a moving body that also have their own local motion (e.g., spinning radar dish, bobbing thruster core, recoiling cannon barrel) use compound code `subAnim * 10 + bodyCarrier` (`18, 28, 38` on `BipedBody 8`; `19, 29, 39` on `SpiderBody 9`). The shader applies the local spin/bob/recoil around `pivot` first, then transforms the result by the moving body carrier so mounted parts never detach from their hull mounts.

---

## The GPU Animation Channels (`aPartAnim`)

Stamp each part in `KitbashBuilder.addPart(geo, zone, { name, position, animType, animPivot })`:

| `animType` | Channel Name | Typical Parts | Rigid Kinematic Formula in `shaderChunks.ts` & `poses.ts` |
| :---: | :--- | :--- | :--- |
| **`0`** | `Static` | Building foundations, rover/miner hulls | $\Delta\mathbf{p} = \mathbf{0}$ (rest pose). |
| **`1`** | `SpinY` | Radar dishes, turbines, auger drills | Rigid Y-axis spin around `pivot`: $\theta = 2.5 t$. |
| **`2`** | `HoverBob` | Thruster cores, hover pads, crystal nodes | Rigid vertical oscillation: $\Delta y = \sin(4.0 t + 3.1 p_x) \cdot 0.05\text{ m}$. |
| **`3`** | `RecoilPulse` | Cannon barrels, thumpers, beacons, torches | Rigid impulse recoil along $-Z$: $\Delta z = -\max(\sin(5.0 t + 2.3 p_x), 0)^6 \cdot 0.06\text{ m}$. |
| **`4, 14, 24`** | `BipedLeg / Shin / Foot` | 3-link rigid biped leg (`4` thigh, `14` shin+ankle, `24` foot) | Coupled to `BipedBody (8)` at hip `pivot`. Link `4` pitches rigidly by $\theta_{\text{hip}} = 0.22 w \sin\tau$; Link `14` pivots rigidly around the moving knee by $\theta_{\text{shin}} = \theta_{\text{hip}} + 0.52 w \max(0, \cos\tau)$; Link `24` translates rigidly with the moving ankle, staying level with the ground. |
| **`5`** | `BipedArm` | Bipedal arms (`robot.hero` shoulder $\rightarrow$ hand) | Rigid counter-phase shoulder swing $\phi = (p_x \ge 0) ? \pi : 0$ around `pivot`, then transformed by `BipedBody (8)`. |
| **`6, 16`** | `SpiderLeg / Tibia` | 2-link rigid spider leg (`6` hip+femur, `16` knee+tibia+foot) | Coupled to `SpiderBody (9)` at hip `pivot`. Link `6` rotates rigidly by femur elevation $\theta_{\text{femur}} = (\text{stepLift} - \Delta h_y) / |p_x|$ and coxa yaw $\theta_{\text{yaw}} = 0.18 w \text{sign}(p_x)\sin\tau$; Link `16` attaches at the moving knee $\mathbf{p}'_{\text{knee}}$ and yaws rigidly by $\theta_{\text{yaw}}$ while keeping the tibia and foot upright. |
| **`7`** | `WheelSpin` | Rover wheels (`tyre`+`rim`+`hub`), track rollers | Rigid X-axis rolling around wheel axle `pivot`: $\theta = 4.0 t w_{\text{walk}}$. |
| **`8`** | `BipedBody` | Bipedal pelvis, torso, head, backpack, cables | Rigid full-body step reaction around COM `(0, 0.92, 0)`: $2\omega$ impact heave, lateral weight sway, forward surge, hip roll, pitch, and counter-yaw. |
| **`9`** | `SpiderBody` | Spider carapace, underbelly, turret, cables | Rigid quadruped/arachnid chassis suspension around COM `(0, 0.76, 0)`: spring-damped $2\omega$ step-impact heave, phase-lagged roll, pitch, yaw, sway, and surge. |
| **`18, 28, 38`** | `Sub + BipedBody` | Radar (`18`), thruster (`28`), beacon (`38`) on biped | Evaluates rigid `SpinY (1)` / `HoverBob (2)` / `RecoilPulse (3)` around `pivot`, then rides on `BipedBody (8)`. |
| **`19, 29, 39`** | `Sub + SpiderBody` | Radar (`19`), core (`29`), cannons (`39`) on spider | Evaluates rigid `SpinY (1)` / `HoverBob (2)` / `RecoilPulse (3)` around `pivot`, then rides on `SpiderBody (9)`. |

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
