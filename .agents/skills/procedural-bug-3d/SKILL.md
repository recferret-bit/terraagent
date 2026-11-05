---
name: procedural-bug-3d
description: Create or modify TerraAgent insect fauna meshes with segmented bodies, chitin armor, mandibles, acid sacs and six-legged silhouettes. Use with the existing kitbash and model validator skills; not for mechanical robots or aquatic ambient fauna.
---

# Living insect models

Read the [fauna contract](../../../docs/game/fauna-hives-spec.md), [organic policy](../procedural-kitbash-3d/references/organic-fauna.md), animation, shader and validator skills. The organic policy takes precedence over mechanical kitbash appearance rules for fauna.

Build forms that appear grown. Major shapes express anatomy, growth, articulation or tissue tension. Explore bold proportions, curved cross-sections, tapered limbs, overlapping shell lips, uneven growth and restrained asymmetry. Avoid box thoraxes, foot pads with rims, exposed ball bearings, gun barrels and decorative status lights. Keep six legs attached to the thorax and a recognizable species silhouette: ant waist and cutting jaws; beetle domed elytra and horn; spitter elevated gland-bearing abdomen and fleshy mouth.

Use parameterized organic generators in the existing KitbashRegistry. Curved shells may be visually continuous and do not require mounted panels. Keep shell segments rigid; allow bounded deformation on declared membranes/sacs and independent antenna/jaw motion. Every new motion needs a CPU validator mirror and matching shadow deformation. Animation never changes gameplay or chooses targets.

Surface detail may use procedural color, roughness and normal fields. Align growth bands with anatomical coordinates; use nondirectional noise only for grain. Separate chitin, membrane, eyes and secretory tissue through material response, not mandatory bright stripes. Nonmetallic chitin and nonemissive eyes are the default. Bioluminescence is optional and species-motivated. Dirt favors feet, underside and sheltered folds.

Keep geometry cached, deterministic and merged, with <3.5k triangles per production model. Validate connectivity, full gait/attack sweeps and material profile. Inspect iso/front/side/top in all three biomes plus gameplay zoom and emission-off silhouette. Compare species and inspect an idle group for synchronized motion. A numeric pass cannot establish that the animal looks alive. Record actual evidence and remaining trade-offs.
