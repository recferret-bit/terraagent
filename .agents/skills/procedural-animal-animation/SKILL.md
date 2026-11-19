---
name: procedural-animal-animation
description: >-
  Author, rig, and validate zero-CPU GPU/CPU parity locomotion and behavioral poses for TerraAgent
  vertebrates (quadruped trot/gallop with closed-form 2-link IK, avian flap/glide wingbeat, head graze/sleep,
  tail counterbalance, instanced biosphere attributes). Not for insects or mechanical robots.
---

# Procedural Vertebrate Animation (`procedural-animal-animation`)

Extend [procedural animation](./../procedural-animation-3d/SKILL.md) for all quadruped mammals and flying birds. Never animate warm-blooded wildlife with mechanical robot channels (`4`/`8`/`2`). Follow [state and performance](./references/state-and-performance.md).

## Architectural Contract

- **Semantic vertex rig (`aVertJoint`, `aVertTip`):** encode `vertRig = { role, joint, tip, meta }` on every part in `KitbashBuilder` alongside `animPivot` (`aPartAnim.yzw`), finalized after scale/ground-snap via `shiftVertebrateRigMetadata` + `stampVertebrateRig` (`frontend/render/animation/vertebrates/rig.ts`).
- **Role IDs (`aVertJoint.w`):**
  - `1`: Trunk / pelvis / tucked avian tarsi
  - `2`: Mammal neck / head / antlers / horns (grazing pitch, walk stabilization, idle head-turn, safe sleep lower)
  - `3`: Mammal tail counterbalance (walk/run wag + elevated sleep curl above ground)
  - `4` / `5` / `6`: Quadruped upper limb / lower limb / ground-level paw or hoof solved analytically via closed-form 2-link planar IK (`hip -> elbow/stifle -> ankle`), blending diagonal trot (`LF + RH` vs `RF + LH`) into bound/gallop (`uVertRun`) and resting lateral splay (`uVertSleep`) with `det = 1`, `scale = 1` rigid matrices
  - `7` / `8`: Bird inner cambered wing (`shoulder`) + articulated outer hand & primary feathers (`wrist` fold + aerodynamic figure-8 twist)
  - `9` / `10`: Bird rectrix tail fan + stabilized neck/head
- **CPU / GPU / Shadow / Instanced Parity:** `pose.ts` (`vertebratePartMatrix`), `shader.ts` (`VERTEBRATE_ANIMATION` injected into both visible & `customDepthMaterial`), and `instanceShader.ts` (`useVertebrateInstanceAttributes` reading `aBioState`) must share identical equations and phase timing.
- **Playground Verification Harness:** inspect every species across poses (`?inspect=fauna.<id>&pose=idle|walk|run|graze|sleep|glide|flap`) and live biome herds/flocks (`?wildlife=forestRock|oceanForest|dune&wildlifeHour=10`), and verify all 27 species with `vertebrates.spec.ts` + `vertebrateShader.spec.ts`.
