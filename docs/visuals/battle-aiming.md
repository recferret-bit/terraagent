# Shooting gallery and shared battle aiming

Open [the gallery](http://127.0.0.1:4100/playground.html?faunaScene=mixed&faunaMode=gallery&faunaSeed=7) on this worktree's running Vite server. Select **HIVE-LIFE → MIXED → SHOOTING GALLERY**. Autocannon, laser tower, recon, tank and artillery stand in one line, each opposite one stationary bug. Hives remain visible behind the targets. The scene uses the real shared simulation with dry fire; `PAUSE`, `STEP` and `RESET` remain available. Old `turrets` and `units` URL modes open this combined gallery.

## Architecture

- `shared/sim/src/systems/combat/BattleOrchestrator.ts` is the single registered combat tick: vision/rally setup, unit stances, defenses/HQ, one projectile-impact pass, then fauna attacks (preserving arrival-before-fauna timing). Server, local host, client simulation and gallery use this pipeline.
- `Combatant` is the common per-entity target abstraction. Its serializable `battle.byEntityId[id].targetId` record is only stamped when selection changes. Existing stance policies and cooldown rules remain shared. No cosmetic angle stream is sent across the network.
- `populateShootingGallery` owns the fixture in shared sim. Each shooter has an explicit target id; losing that target cannot redirect fire into another lane. Bugs face the shooters. Positions are established with the normal spawn API, and the range issues no walking/evasive orders.
- `frontend/render/combat/BattlePresentation.ts` is used by both `CombatSyncController` in the game and the playground. It consumes target records and firing events, then resolves an authored weapon rig or fauna mouth socket.
- `WeaponRigRegistry` defines the mount, named head/barrel parts and muzzle sockets. Those parts receive `aWeaponPart` in the merged geometry. Turret heads yaw independently of the chassis; barrels converge and elevate independently. Recon aims its fixed-gun chassis. HQ has a small independent helmet weapon so it can defend while moving or working.
- `weaponShader.ts` computes rigid aim transforms on the GPU, including the moving body mount and shot-driven recoil. The same transform is applied to visible vertices, normals and shadows. `WeaponRig.matrices` is its CPU mirror for emission sockets and diagnostics, rather than a CPU bone-animation loop.
- Shots originate at the live muzzle after aiming. Twin barrels alternate. Laser sources remain attached during recoil/movement. Artillery pitch follows the launch tangent of the rendered parabola. Early online events briefly wait for a missing shooter mesh instead of spawning at its center.
- Shader program cache keys include the plugin set. This is required when a weapon-bearing model and an organic/plain model share the scene; otherwise Three.js can reuse a shader without weapon steering.

## Adding a weapon

Register its rig in `WeaponRigRegistry`, using the exact authored part names, mount/socket coordinates, and optional body carrier. Add an alignment test, validate the model, and inspect the four diagnostic views. Gameplay weapon rows and target policies belong in shared sim; never add a separate attack/cooldown loop to an app or renderer.

## Review evidence

- [Gallery, isometric](evidence/shooting-gallery/gallery-iso.png), [top](evidence/shooting-gallery/gallery-top.png), [front](evidence/shooting-gallery/gallery-front.png), [side](evidence/shooting-gallery/gallery-side.png).
- [Browser state and GPU parity](evidence/shooting-gallery/qa.json): five distinct pairs, five stationary bugs and three hives. 312 GPU pose samples differ from the CPU mirror by at most `0.000000598 m`.
- [Dune model sheet](evidence/shooting-gallery/models-dune.jpg), [oceanForest sheet](evidence/shooting-gallery/models-oceanForest.jpg), [forestRock sheet](evidence/shooting-gallery/models-forestRock.jpg).
- Five weapon-bearing archetypes pass strict geometry validation with zero errors and warnings; all stay below 3,500 triangles. Four views were captured in dune, oceanForest and forestRock.
- Regression coverage includes stationary paired fire, lost targets, deterministic host/client stepping, replicated snapshots, early events, rear targets, recoil, terrain offsets, attached beams and artillery tangents. The existing 200-unit tick and 50-unit wire-bandwidth benchmarks pass.

The browser reported no shader/runtime errors; its only failed request was the existing missing `/favicon.ico`. RN-70 records the retained instant steering, shared tank/artillery chassis and 2D simulation model.

## Recoil and combat effects

Gun recoil is a 25 ms compression followed by a 190 ms smooth return over 4 cm, strictly along the barrel axis. Firing elevation persists through the cooldown, including artillery's ballistic lift. Lasers have no mechanical kick. Pausing the gallery holds recoil as well as particles; muzzle effects update after the weapon pose.

The game and gallery pass target IDs and impact ticks into `BattlePresentation`. It adds seeded centimeter-scale scatter, projects onto the target's exterior and remembers that contact for the matching impact event. The muzzle, shot path and impact remain connected. RN-71 records the base-mesh and launch-time approximation; this does not add physical projectile collisions or change damage accuracy.

`ParticlePresetRegistry` now supports finite combat bursts alongside work-site presets. Six combat presets share the existing 3D chunk geometry and validation rules. `CombatBurstSystem` pools each layer, ejects particles outward, bounces heavy fragments on the supplied terrain plane and fades smoke by instance. There are no expanding AoE circles in combat impacts. Rockets use warm fire lobes and rising charcoal smoke; artillery uses a short white flash, a taller grit/shrapnel fountain and a fading 3D tracer along its arc.

To review, open the gallery linked above and watch the five lanes. The fourth lane fires rockets and the fifth artillery. Look for a brief flash attached to the active barrel, straight recoil, a stable elevated artillery barrel between shots, small variations at the target surface and different explosion silhouettes. Pause to inspect a burst, then reset for another volley.

- [Muzzle flash](evidence/combat-effects/muzzle.jpg), [artillery trail](evidence/combat-effects/artillery-trace.jpg).
- [Rocket fire](evidence/combat-effects/rocket-0.18.jpg), [rocket smoke](evidence/combat-effects/rocket-0.45.jpg), [artillery ejecta](evidence/combat-effects/shell-0.18.jpg).
- [Four-view and three-biome audit data](evidence/combat-effects/qa.json): no shader/runtime errors; 312 GPU/CPU pose samples, maximum discrepancy below one micrometer.
- 49 focused tests cover rig stability, bounded recoil, laser exclusion, deterministic scatter, surface placement, serialized server events, effect lifetimes/pool limits and the shared gallery. All 15 particle presets validate with zero errors/warnings; all 28 particle-validator self-tests pass. The production build passed before concurrent group-march edits introduced unrelated whole-repo lint/typecheck failures; XC-40 records the exact blockers. Existing Zod annotation and bundle-size warnings remain.
