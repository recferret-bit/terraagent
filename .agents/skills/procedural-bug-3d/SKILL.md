---
name: procedural-bug-3d
description: Create or modify TerraAgent insect fauna meshes with segmented bodies, chitin armor, mandibles, acid sacs and six-legged silhouettes. Use with the existing kitbash and model validator skills; not for mechanical robots or aquatic ambient fauna.
---

# Living insect models

Read [the fauna contract](../../../docs/game/fauna-hives-spec.md) and the existing [kitbash](../procedural-kitbash-3d/SKILL.md), [animation](../procedural-animation-3d/SKILL.md), [validator](../model-geometry-validator/SKILL.md) and [viewport](../diorama-viewport-auditor/SKILL.md) skills before geometry work.

Build bold, dangerous organisms: hooked appendages, asymmetric chitin damage, large cutting mouths, ribbed armored backs. Threat comes from silhouette and deliberate anatomy, not gratuitous spikes or particle clutter. At RTS distance identify the ant by its waist and mandibles, the beetle by width and layered shell, the spitter by elevated abdomen and visible acid nozzle. Use six legs, attached at thorax sockets. Head, thorax and abdomen overlap at narrow joints; do not make three intersecting spheres.

- Implement parameterized anatomy greebles in the existing KitbashRegistry; compose catalog archetypes under `frontend/render/kitbash/archetypes/`. Keep seeded static variations deterministic and cached. Never add a second render loop or a mesh per limb.
- Use curved/beveled closed geometry and geometry-mounted chitin ridges, seams, pores and plates. Primary shell ~60%, contrasting joints/underside ~30%, eyes/sacs/edge accents ~10%. Species-specific palette mappings must preserve material zone semantics and existing robot palettes. Black ants use charcoal shell with lighter highlights and distinct joint lightness; don't bypass dark-model/contrast checks.
- Exactly six grounded legs with mounted joints; total geometry under 3.5k triangles. Reuse shared multi-link spider kinematics (`6/16`, body `9`) and verify actual tripod phase for three leg pairs. All body attachments ride the body carrier. No CPU skeletal rigs, moving vertex distortions, or per-frame random poses.
- Ant mandibles, beetle horn and spitter nozzle are functional geometry. Acid leaves a named mouth socket; its authoritative attack event drives the cosmetic recoil. Use mounted compound channels where appropriate; new animation channels require shader and validator pose parity.
- Dynamic life/attack state belongs to the app/sim view. The model never chooses a target, spawns gameplay units, moves an entity or deals damage.

Run `npm run validate:models -- <id>` with zero errors and warnings. Inspect iso/front/side/top on all three biomes and the entire walk/attack sweep, with a hive nearby for scale. Reject disconnected antennae, intersecting legs, feet below ground, dark blobs and species distinguished only by hue. Fix geometry rather than weakening checks. Save review evidence under `docs/`; record remaining limitations.
