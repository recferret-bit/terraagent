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
  - `1`: Trunk / pelvis / tucked avian tarsi (6-DOF quadruped suspension: double-frequency trot heave with locomotion crouch, rocking-horse gallop pitch/surge, lateral hip sway, roll & yaw; avian lift-reaction heave & pitch)
  - `2`: Mammal neck / head / antlers / horns (grazing pitch, counter-bobbing walk/gallop stabilization, idle head-turn, safe sleep lower)
  - `3`: Mammal tail counterbalance (walk/gallop whip + elevated sleep curl above ground)
  - `4` / `5` / `6`: Quadruped upper limb / lower limb / ground-level paw or hoof solved analytically via closed-form 2-link planar IK (`hip -> elbow/stifle -> ankle`), blending diagonal trot (`LF + RH` vs `RF + LH`) into bound/gallop (`uVertRun`) and resting lateral splay (`uVertSleep`) with `det = 1`, `scale = 1` rigid matrices
  - `7` / `8`: Bird inner cambered wing (`shoulder`) + articulated outer hand & primary feathers (`wrist` one-way upstroke carpal fold + aerodynamic figure-8 supination/pronation twist)
  - `9` / `10`: Bird rectrix tail fan + stabilized neck/head
- **Quadruped 2-Link IK & Trunk Suspension Best Practices:**
  - **Locomotion crouch prevents straight-leg IK lockup:** at rest, `l1 + l2` is only slightly longer than `distance(hip0, toe0)`. Always apply a negative crouch bias in `heave` for both trot (`liftHeight * (-0.21 + 0.25 * cos(2 * g - 0.18)) * trotW`) and a bi-harmonic bound/gallop suspension wave (`liftHeight * (-0.04 + 0.26 * cos(2 * u - 0.85) - 0.22 * sin(u - 0.65)) * gallopW` where `u = g * 1.35`) so `hip.y` drops at maximum foot reach and stance compression, keeping `rawLen < l1 + l2` and preserving deep knee/elbow flexion (`perp > 0`).
  - **Bi-harmonic early-swing ankle tuck:** drive swing lift with `swing = max(0, cos(tau))`, `dy = pow(swing, 0.70) * lift`, and add an asymmetric backward tuck harmonic `toe.z += (sin(tau) - (0.22 * trotW + 0.06 * gallopW) * swing * swing) * amp` so the lower limb (`role 5`) folds sharply under the thigh/upper arm during early-to-mid swing before whipping forward to plant.
  - **Airborne pastern/wrist curl (`role 6`):** gate `swingTilt = (0.22 * swing - 0.16 * sin(tau)) * smoothstep(0.014, 0.050, dy)` (`0.272 rad` / `15.6°` peak flexion) by `dy` so paws and hooves flex expressively in mid-air while landing completely level (`dy = 0`) without triggering `ANIM_BELOW_GROUND`.
- **Avian Wingbeat Aerodynamics:**
  - **True radian angular frequencies (`gaitFreq` / `flapRate`):** scale wingbeat rates by wingspan/mass class from `8.2..11.2 rad/s` (`1.3..1.8 Hz` giant pelagic albatrosses/vultures) up to `38.0..42.0 rad/s` (`6.0..6.7 Hz` tiny passerines/kingfishers), modulated by `computeBirdFlapEnv` (`pose.ts` / `shader.ts`).
  - **Aerodynamic supination/pronation & one-way carpal fold:** pitch the leading edge (`+Z`) up on the upstroke and down on the downstroke via `-cos(g - 0.15)` (`role 7`) and `-cos(wristPhase)` (`role 8`), and fold the outer wrist downward/inward only during upstroke recovery (`upstrokeFold = pow(max(0, cos(g - 0.18)), 0.85)`).
- **CPU / GPU / Shadow / Instanced Parity:** `pose.ts` (`vertebratePartMatrix`), `shader.ts` (`VERTEBRATE_ANIMATION` injected into both visible & `customDepthMaterial`), and `instanceShader.ts` (`useVertebrateInstanceAttributes` reading `aBioState`) must share identical equations and phase timing.
- **Playground Verification Harness:** inspect every species across poses (`?inspect=fauna.<id>&pose=idle|walk|run|graze|sleep|glide|flap`) and live biome herds/flocks (`?wildlife=forestRock|oceanForest|dune&wildlifeHour=10`), and verify all 27 species with `vertebrates.spec.ts` + `vertebrateShader.spec.ts`.
