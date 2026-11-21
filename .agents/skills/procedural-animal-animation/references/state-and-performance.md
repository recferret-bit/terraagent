# Vertebrate Animation States, Instancing & Performance

## 1. Per-Instance Biosphere Packing (`aBioState`)

`InstancedMesh` slots in `PlanetBiosphere.ts` stream one `vec4` per animal (`DynamicDrawUsage`) — total mesh vertex attributes remain `<= 14` (`<= 16` WebGL2 cap):

| Component | Land Mammal (`isBird = 0`) | Flying Bird (`isBird = 1`) |
| :--- | :--- | :--- |
| `aBioState.x` | Deterministic phase offset (s) | Deterministic wingbeat phase offset (s) |
| `aBioState.y` | `0..1` trot weight; `> 1..2` canter/bound/gallop (`uVertRun = clamp(y - 1, 0, 1)`, triggered when `spdRatio > 1.05` on open-ground legs or fleeing/hunting sprints) | `0.16..1.0` glide-to-flap weight |
| `aBioState.z` | `0..1` feeding/grazing/drinking head pitch (`uWorkWeight`) | Reserved (`0`) |
| `aBioState.w` | `0..1` circadian sleep crouch (`uVertSleep`, keeps folded elbows/tails clear of `Y=0` and flanks) | `0` |

## 2. Single-Mesh Uniforms (`createArchetypeMesh`)

- `uVertParams`: `vec4(comY, sleepDrop, strideLen, liftHeight)`
- `uVertMeta`: `vec4(gaitFreq, isBird, headSleepPitch, birdSize)`
- `uWalkWeight`, `uWorkWeight`, `uVertRun`, `uVertSleep`

## 3. Biomechanical Kinematics & Waypoint Steering

- **Continuous Waypoint Steering & Predator Peel-Off (`LandAnimalSim.ts`):** refresh roaming/prowl goals immediately when `distGoal < 1.8 m`, blend `yaw` smoothly via shortest-angle delta (`dt * 10.0`), and peel hunting predators off to a fresh prowl waypoint when closing within `2.6 m` of prey so mammals never stall mid-field, overshoot waypoints, or oscillate yaw 180°.
- **Open-Ground Canter & Bound (`LandAnimalSim.ts` & `AnimalsOrchestrator.ts`):** lagomorphs/prosimians (`meadowHare`, `islandLemur`) hop/bound at `1.55x walkSpeed` when `distGoal > 3.5 m` (sustaining down to `2.0 m`), and cursorial ungulates/carnivores (`crownStag`, `saberOryx`, `timberWolf`, `duneJackal`, `canopyPanther`, `mesaCaracal`) canter at `1.48x walkSpeed` when `distGoal > 6.0 m` (sustaining down to `2.8 m`), streaming `aBioState.y = min(2.0, spdRatio)` so herds showcase both diagonal trot and bounding/cantering gaits.

## 4. Validation & Parity Tests

- `frontend/render/kitbash/validate/checks/animation.ts`: invokes `vertebratePartPoses` from `frontend/render/animation/vertebrates/validationPoses.ts` across all behavioral states (`idle`, `walk`, `run`, `graze`, `sleep`, `glide`, `flap`), enforcing `ANIM_DISTORTION` (`det=1`, `<= 0.5mm` drift), `ANIM_COLLISION` (`>= 1cm` clearance), and `ANIM_BELOW_GROUND`.
- `frontend/render/animation/vertebrates/vertebrates.spec.ts`: exercises every one of the 27 biosphere species across all behavioral poses.
- `frontend/render/animation/vertebrates/vertebrateShader.spec.ts`: verifies visible/depth GLSL injection, normal transforms, uniform updates, and `useVertebrateInstanceAttributes` shader patching.
- `frontend/render/biosphere/biosphere.spec.ts` & `biosphereModels.spec.ts`: verify live circadian ecosystem stepping and zero errors/warnings on all 27 species.
