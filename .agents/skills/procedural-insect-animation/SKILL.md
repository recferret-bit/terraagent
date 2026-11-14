---
name: procedural-insect-animation
description: >-
  Author and validate state-driven animation for TerraAgent ants, beetles and acid spitters: insect locomotion, melee contact, sac charging and release, hit reactions and death. Extends the shared procedural animation, bug, shader and particle skills for merged GPU-animated fauna and hive-life combat scenes.
---

# Insects that behave like living animals

Use this specialization with [procedural-animation-3d](../procedural-animation-3d/SKILL.md), [procedural-bug-3d](../procedural-bug-3d/SKILL.md) and the [organic policy](../procedural-kitbash-3d/references/organic-fauna.md). For liquid emission, add [procedural-particles-3d](../procedural-particles-3d/SKILL.md) and its validator. For shader changes, follow [shader-texture-tuning](../shader-texture-tuning/SKILL.md). Hive fixtures also use [procedural-hive-3d](../procedural-hive-3d/SKILL.md).

Aim for a readable animal with weight, intent and recovery. Explore expressive anticipation and asymmetry; keep contact and timing honest. Anatomy is a starting point, not a requirement to copy a real species. Preserve the species silhouette and the owner's art direction.

## State and timing contract

Read [references/state-and-performance.md](references/state-and-performance.md) when wiring actions, sockets, replication or lifetimes. The authoritative sim owns targets, approach, attack eligibility, release ticks, damage and death. Render controllers consume those facts and interpolate poses. Idle, moving, windup, attack, recovery, hurt, dying and dead each need a visible pose or motion. Do not map every activity to an undifferentiated work-weight sine wave.

An attack must show preparation before release. At the authoritative release, the ant's jaws close, the beetle's horn reaches its shove, or the spitter's charged sac discharges. Recovery follows and must not trigger another hit. Duplicate snapshots/events must not restart windup, emit twice or resurrect a dying insect. Hits interrupt or overlay only as the state controller allows; death wins over locomotion, attack and hit reactions.

Reuse the existing merged geometry, unified material and GPU animation architecture. Use fixed-size per-instance state/phase uniforms and pure closed-form pose functions. No CPU skeleton, vertex loop or IK solver in the frame loop. GPU visible vertices, normals and shadows, CPU validator poses and animated emission sockets must describe the same anatomy.

## Species acting

- **Ant:** probing, unsynchronized antennae at rest; light alternating-tripod gait; forelegs brace before a short forward head/body lunge; hinged mandibles open during windup and clamp at contact. Keep the petiole flexible-looking while shell segments stay rigid. Avoid boxing-arm gestures or a gun recoil substituted for a bite.
- **Beetle:** heavier stance and slower recovery; weight shifts into planted legs as the head dips; horn scoops/shoves at the release moment. Keep the domed elytra coherent, and preserve head/pronotum attachment through the motion. A horn swing without target contact is not a finished melee animation.
- **Spitter:** the rear gland-bearing abdomen raises/loads; green sacs visibly swell and pulse, then contract as a rounded green liquid bolus leaves an animated sac socket. Keep residual fluid trails short, viscous and gravity-aware. Distinguish refill/recovery from another charge. Do not launch the visible bolus from the belly center or an unrelated mouth offset.
- **Hit/death:** a localized recoil or stagger should settle without sliding the sim root. Death can buckle legs, curl tarsi, lower the thorax and relax antennae. Ground the final silhouette and stop living loops; a whole-model shrink is not a death animation. Keep removed entities' presentation meshes long enough to finish the motion, then dispose them once.

Give individuals stable phase seeds. Asymmetry should remain deterministic and bounded. Let hard chitin, joints, membranes and liquid have different motion: shells rotate/translate rigidly; only declared tissue may swell within an authored bound. Record which surfaces deform and their attachment constraints.

## Contact and effects

Approach through sim movement commands and the movement orchestrator. Never translate a unit root in the renderer to make a bite appear in range. Tune the shared contact distance and the authored forward reach together. Review the opponent and attack as a pair: foot stance, jaws/horn, target surface, release frame and recoil.

Melee is contact combat. Suppress the legacy laser-shaped delivery visualization for bite/horn weapon identifiers; render a compact surface response without a beam. Spit follows the shared projectile event, using the sac socket after the release pose is applied. The impact splash belongs outside the struck surface, oriented by its normal. Use rounded 3D droplets, thin 3D fluid ligaments and collapsing surface sheets/crowns, with a bounded wet residue; avoid metallic sparks, a generic explosion or a solitary expanding ring.

Do not silently replace gameplay collision with render raycasts. State exactly when a surface/contact approximation is cosmetic, particularly on moving or GPU-deformed targets.

## Review the whole sequence

1. Verify idle → movement → windup → release → recovery, interruption by hit, and dying → dead. Exercise pause, step, reset, target loss, duplicate events and late snapshots.
2. Validate geometry and the actual state-specific motion envelopes. The ordinary walk-cycle validator alone cannot prove an attack/death pose safe. Sample anticipation, contact, maximum tissue swell, leg curl and corpse pose; keep CPU/GPU pose parity coverage.
3. Run model and particle validators for touched models/presets. Do not loosen global tolerances to hide a failed attack pose.
4. Review each species in iso/front/side/top and all three biomes. Watch sequences at normal speed and freeze key frames. Check melee reach at gameplay zoom and side view, sac-to-bolus continuity, exterior splash, feet and corpse contact, and independent individuals in MIXED.
5. Exercise ANT HIVE, BEETLE NEST, SPITTER HIVE and MIXED in both attack directions. Controls use actual radio semantics and keep the selected species/scene. Robots attack must expose insect hit/death; bugs attack must expose real melee or ranged release. Preserve explicit legacy gallery access and deterministic reset.

Save actual visual evidence and focused state/replication tests. Explicitly report any remaining optical, collision or terrain-contact approximations; a validator pass does not substitute for watching the creature act.
