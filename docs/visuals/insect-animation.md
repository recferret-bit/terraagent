# Insect animation and hive combat review

Open [HIVE-LIFE on the worktree server](http://127.0.0.1:4102/playground.html?faunaScene=mixed&faunaMode=bugs&faunaSeed=7). In the Hive sidebar, choose ANT HIVE, BEETLE NEST, SPITTER HIVE or MIXED. **Bugs attack** is the default; **Robot attacks** exposes hit reactions and death. RESET restores the specimens. PAUSE freezes both simulation and visual time; +1 STEP advances both by one 200 ms simulation tick.

Ants approach, brace and close their mandibles with a forward lunge. Beetles approach and dip/shove with the horn. Spitters remain at ranged distance, charge the tail sacs and release a green bolus from the animated sac, followed by recovery. Acid leaves short fluid strands and splashes into rounded droplets and a collapsing liquid crown on the exterior contact plane. Melee does not render the legacy beam delivery effect.

The shared simulation owns target selection, approach, windup, release, recovery and damage. Its `insectActions` blob carries only active attack phases; idle/moving already come from entity state. The same simulation runs in the playground, local client and server. Generic unit work does not add a second insect damage path. Render controllers add idle motion, locomotion, hit response, dying and dead poses. Removed insect meshes survive for 2.4 seconds to complete the collapse.

`InsectPresentation` stamps release from authoritative shot events before sampling the muzzle, including the online event-before-snapshot order. Older action snapshots cannot rewind that release. GPU position/normal/depth deformation, CPU validation transforms and socket positions share the authored insect pose. This remains one merged mesh per insect, with no per-frame CPU skeletal or vertex solver.

The new [procedural-insect-animation skill](../../.agents/skills/procedural-insect-animation/SKILL.md) specializes the existing animation, bug, hive, shader and particle skills. It requires anatomical acting, explicit state timing, exact release sockets, paired melee review and combined-state validation.

Completed validation: 84 focused shared-sim, renderer, client-event and UI tests; additional sidebar/controls tests; strict 57-pose geometry sweeps across idle/gait/charge/strike/hurt/death combinations with zero errors or warnings; all 16 particle presets; production build, repository lint and generated-file checks. Existing liquid-effect browser evidence is under [evidence/insect-animation](./evidence/insect-animation/). Final browser review is complete: all eight scene/direction combinations passed pause, step, reset, release and death checks without console errors. A separate normal-speed MIXED run observed windup, attack and recovery for all three insects and live acid flight (`live-qa.json`). GPU transform feedback matched CPU positions/normals in 7,068 samples (maximum position error 0.00000128 m). All species were reviewed in four views and three biomes, for attack and dead poses. Close-up review found and fixed a beetle strike passing above the recon: the head now dips into contact, guarded by an authored-mesh distance regression test. The revised beetle passed strict geometry validation, GPU parity and a fresh production build; 15 focused animation/client/scene/contact tests also pass. The insect models remain below 3.5k triangles: ant 2,748, beetle 2,652, spitter 2,980.

Known approximations are recorded in [RN-72](../questions-and-limitations/render.md#rn-72--insect-feet-corpses-and-acid-remain-authored-visual-approximations): flat local-ground foot/corpse poses, cosmetic contact planes and liquid particles, finite live-health preview specimens, and manual reset. The server's scheduled 2D projectile collision rules are unchanged.


## Reproduce the visual review

[RN-73](../questions-and-limitations/render.md#rn-73--final-insect-animation-browser-review-awaits-chrome-access) is resolved by this review. Evidence includes `scenes-qa.json`, `gpu-parity.json`, per-species attack/dead sheets, individual diagnostic views, and contact close-ups. The right INFO panel still describes the previously selected standalone archetype during hive scenes; use the Hive pane for scene state and population.

1. Open each species scene and MIXED using the link above. Toggle both attack-direction radios; verify the selected scene persists and RESET returns to tick zero.
2. In Bugs attack, inspect ant mandible contact and beetle horn contact from the side at the attack state; confirm neither emits a beam. Inspect spitter charge, sac-to-bolus release, flight and exterior splash.
3. In Robot attacks, verify insects stay planted, react to hits, buckle/curl on death, remain briefly as grounded corpses and disappear. RESET should restore all specimens.
4. Pause each sequence, orbit the camera, and confirm poses/projectiles stay frozen. +1 STEP advances one 200 ms tick and resumes no continuous playback.
5. Inspect all three species in iso/front/side/top across dune, oceanForest and forestRock. Record attack/death connectivity, ground contact and shadow agreement. Execute GPU transform-feedback parity against the CPU pose and save the results when changing the animation again.


## Alternating sacs and inertial recovery

The spitter now releases from the top surface of the selected rear sac, alternating left/right on successive observed attack timestamps. A repeated event or matching snapshot cannot advance the side twice. The charging sac and emitted bolus share the same side selection and CPU/GPU pose. Active sac expansion is bounded at 20.5% (previously 13.5%); the other sac keeps a smaller breathing pulse. Contraction is bounded at 12.5%. These bounds apply only to spitter secretory tissue, not rigid shells or general model tolerances.

Charge and recovery use a critically damped response that retains velocity across action changes. The release still applies the contact pose at the authoritative tick; afterward the body eases home through recovery/idle rather than snapping to zero. Beetles settle slightly more slowly. Gait amplitude blends back as the attack settles, preserving front-leg clearance while movement resumes. No damage or attack-cadence rule changed. Regression tests cover alternating origins at an even firing cadence, duplicate delivery, boundary continuity, paused updates and frame-subdivision equivalence.

Validation for this refinement: 34 focused tests pass; all three models pass strict validation with no errors or warnings; 13,193 GPU/CPU position and normal samples agree. Four successive live gallery releases were left/right/left/right with zero socket-to-origin error (`sac-alternation-qa.json` and `sac-release-1..4.jpg`). Charge/release/settle captures cover all four views and all three biomes (`refinement-poses-qa.json` and the per-species sheets). Normal-speed MIXED playback, scoped lint and the production build also pass.

## Shared movement interpolation

Hive's combat and legacy cosmetic modes now use `frontend/render/motion/entityMotion.ts`, the same tick-keyed sampler as March and online/local gameplay. Position follows a straight interpolation between known simulation samples; only heading eases through turns. The game retains its network clock and correction handling. Preview pause freezes the sampled position and heading; manual steps display the latest pose and resume without rewinding.

Regression coverage includes all three species, bugs/passive/aggressive/robots modes, equal per-frame travel, delayed frames, pause/step/resume, March and local-versus-serialized-server gameplay. The focused run passed 41 tests. Browser frame traces and screenshots are under [evidence/shared-movement](evidence/shared-movement/): beetle combat/passive/aggressive playback maintained 90th/10th percentile speed ratios of 1.08–1.10 across roughly 110 frames per mode. March still moves all 30 units around the rock in together mode.

Check [Hive combat](http://127.0.0.1:4102/playground.html?faunaScene=blueBeetle&faunaMode=bugs), [passive](http://127.0.0.1:4102/playground.html?faunaScene=blueBeetle&faunaMode=passive), and [March](http://127.0.0.1:4102/playground.html?march=together&marchRock=1). Watch continuous travel between ticks, pause halfway through a stride, step once and resume. The intended buffering trade-off is recorded as RN-76 in [render limitations](../questions-and-limitations/render.md).
