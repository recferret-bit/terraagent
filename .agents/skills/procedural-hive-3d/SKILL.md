---
name: procedural-hive-3d
description: Create TerraAgent species-specific insect hive models and passive hive-life playground scenes, using existing kitbash rendering and shared simulation fixtures. Use for ant mounds, armored beetle nests and acid-spitter hives; not for a resource economy or independent fauna AI.
---

# Hives that look inhabited

Read [the fauna contract](../../../docs/game/fauna-hives-spec.md), [kitbash](../procedural-kitbash-3d/SKILL.md), [viewport](../diorama-viewport-auditor/SKILL.md) and [geometry validation](../model-geometry-validator/SKILL.md). For inhabitants also use [procedural-bug-3d](../procedural-bug-3d/SKILL.md). Acid debris additionally requires both particle skills.

A hive serves one species. Match its openings to the bug's collision radius and silhouette: ants get a low multi-tunnel mound with trails; beetles get a wide buttressed shell bunker with molted plates; spitters get a ribbed chimney, resin sacs and a recessed acid basin. Break the skyline with rooted chimneys, overhangs or buttresses. Build real entrance lips and dark recessed cavities, not a black disk pasted onto a solid mound. Keep foundations grounded; use the existing plinth rule only if the model actually has a foundation skirt.

Use reusable closed, rounded kitbash subassemblies, a merged catalog mesh and the unified biome material. Detail with ribs, brood cells, seams, shell fragments and attached sacs; preserve shell/support/accent material separation and <3.5k triangles. Render separate cosmetic inhabitants through the existing instancing path. Keep `(planetType, species, role)` lookup separate from gameplay IDs: W07 resolves all planets to shared models, future planet models register overrides.

Passive life is visual: resting, feeding gestures, tending brood and carrying scraps. There is no hunger meter, nest inventory, simulated construction or free resource creation. Gameplay residents follow shared sim unit orders; attached scrap is a cosmetic part, not a second entity. Cosmetic props must not block paths or masquerade as live attackable bugs.

For the playground, put scene orchestration and shared sim fixture execution in `frontend/playground/`; renderer parts take read-only views. Provide per-species and mixed scenes, deterministic seed/reset, authoritative tick pause/step, passive/aggressive controls, attack targets and projectile previews. Do not write positions from preview UI. Culling and quality must never change gameplay RNG or population.

Validate each hive and bug independently before the populated scene. Inspect all four views and three biomes, entrance clearance and emergence without ground snapping. Test passive life, aggression, hive death and reset with the same seed. Keep all UI in Faction Plate tokens and document implemented controls in `docs/dev/DEV_TOOLS.md`. Never describe planned controls or unrun screenshots as verified.
