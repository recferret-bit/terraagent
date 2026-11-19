# Vertebrate Animation States, Instancing & Performance

## 1. Per-Instance Biosphere Packing (`aBioState`)

`InstancedMesh` slots in `PlanetBiosphere.ts` stream one `vec4` per animal (`DynamicDrawUsage`) — total mesh vertex attributes remain `<= 14` (`<= 16` WebGL2 cap):

| Component | Land Mammal (`isBird = 0`) | Flying Bird (`isBird = 1`) |
| :--- | :--- | :--- |
| `aBioState.x` | Deterministic phase offset (s) | Deterministic wingbeat phase offset (s) |
| `aBioState.y` | `0..1` trot weight; `> 1..2` sprint gallop (`uVertRun = clamp(y - 1, 0, 1)`) | `0.16..1.0` glide-to-flap weight |
| `aBioState.z` | `0..1` feeding/grazing/drinking head pitch (`uWorkWeight`) | Reserved (`0`) |
| `aBioState.w` | `0..1` circadian sleep crouch (`uVertSleep`, keeps folded elbows/tails clear of `Y=0` and flanks) | `0` |

## 2. Single-Mesh Uniforms (`createArchetypeMesh`)

- `uVertParams`: `vec4(comY, sleepDrop, strideLen, liftHeight)`
- `uVertMeta`: `vec4(gaitFreq, isBird, headSleepPitch, 0)`
- `uWalkWeight`, `uWorkWeight`, `uVertRun`, `uVertSleep`

## 3. Validation & Parity Tests

- `frontend/render/kitbash/validate/checks/animation.ts`: invokes `vertebratePartPoses` from `frontend/render/animation/vertebrates/validationPoses.ts` across all behavioral states (`idle`, `walk`, `run`, `graze`, `sleep`, `glide`, `flap`), enforcing `ANIM_DISTORTION` (`det=1`, `<= 0.5mm` drift), `ANIM_COLLISION` (`>= 1cm` clearance), and `ANIM_BELOW_GROUND`.
- `frontend/render/animation/vertebrates/vertebrates.spec.ts`: exercises every one of the 27 biosphere species across all behavioral poses.
- `frontend/render/animation/vertebrates/vertebrateShader.spec.ts`: verifies visible/depth GLSL injection, normal transforms, uniform updates, and `useVertebrateInstanceAttributes` shader patching.
- `frontend/render/biosphere/biosphere.spec.ts` & `biosphereModels.spec.ts`: verify live circadian ecosystem stepping and zero errors/warnings on all 27 species.
