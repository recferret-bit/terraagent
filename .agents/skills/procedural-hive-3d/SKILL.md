---
name: procedural-hive-3d
description: Create TerraAgent species-specific insect hive models and passive hive-life playground scenes, using existing kitbash rendering and shared simulation fixtures. Use for ant mounds, armored beetle nests and acid-spitter hives; not for a resource economy or independent fauna AI.
---

For state-driven insect actions and hive-life combat, use [procedural-insect-animation](../procedural-insect-animation/SKILL.md) alongside this skill. It covers shared attack phases, species acting, animated release sockets, hit/death lifetimes and liquid contact effects.


# Hives that look inhabited

Read the [fauna contract](../../../docs/game/fauna-hives-spec.md), [organic policy](../procedural-kitbash-3d/references/organic-fauna.md), bug, shader, viewport and validator skills. Hives use organic rules even though gameplay treats them as buildings.

Build inhabited growth or excavated habitat: ant earth mounds with irregular burrow lips and sediment trails; beetle nests with layered molted shell vaults and a broad recessed entrance; spitter colonies with fleshy fluted chimneys, resin lobes and a recessed basin. Explore unequal spacing, slumped contours, branching growth, eroded ridges and asymmetric silhouettes. Avoid industrial plinths, collars, strut cages, rectangular doors and beacon towers unless the concept explicitly calls for machinery.

Use curved closed geometry and real entrance depth. Keep openings clear of the backing mound; a dark disk on a solid face is not a tunnel. Match opening size to the inhabitants. Foundations meet the terrain; a sunk plinth skirt is appropriate only when there is a real foundation skirt. Assign earth, dry shell, damp resin and membrane profiles independently of the inhabitant's palette. Procedural pores, strata, veins and roughness fields may supply surface detail; broad smooth shell areas are valid.

Reuse the merged catalog, unified material and species/planet registry. Production models remain <3.5k triangles. Optional resin motion uses bounded GPU deformation and matching validator/shadow poses. Cosmetic residents use existing instancing. Passive gestures and carried scraps are presentation, never hunger, inventories, production or extra AI.

Validate each hive and insect before the inhabited scene. Inspect all four views and three biomes, bug scale at entrances, ground contact, interior depth and emergence. Playground fixture execution stays in the app and uses shared sim commands; renderer accepts views. Keep gameplay RNG and population independent of rendering. Document only implemented controls and actual verification.
