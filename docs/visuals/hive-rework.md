# Larger species hives and smaller ants

The black ant is uniformly 65% of its previous linear size. Catalog geometry, animation pivots, CPU pose matrices, GPU visible/shadow poses and the melee socket use the same scale. Beetle and spitter sizes are unchanged.

The three habitats now use a continuous closed shell around a real open entrance and recessed chamber. No backing sphere fills the doorway. The ant mound has sloping excavated earth, sediment fans and root seams; the beetle nest has a broad shell vault, molted side shells and roof ridges; the spitter hive has a taller ribbed resin chamber, rooted side folds, attached pulsing sacs and hollow chimneys.

| Habitat | Clear mouth width × height | Chamber depth | Triangles |
|---|---:|---:|---:|
| Ant mound | 1.40 × 1.05 m | 2.65 m | 1,824 |
| Beetle nest | 3.15 × 1.75 m | 3.15 m | 1,924 |
| Spitter hive | 2.05 × 1.95 m | 2.85 m | 1,944 |

The shell floors begin 3.5 cm above the model ground plane. Grounded outer walls prevent global bottom snapping from lifting the entrance. All four changed models have minY 0 and pass strict geometry validation with zero errors/warnings. Hive-only shadow receiver offsets suppress self-shadow acne on the concave shells; casting geometry and scene lighting remain unchanged.

`habitat.spec.ts` traces the actual walking silhouette through each full chamber, including surrounding attached parts. It samples twelve gait phases and retains upper/lateral silhouette extrema in 2 cm bands. The ant's finalized geometry and pivot scale also have a regression check. Browser transform-feedback parity covers 13,193 insect part/pose samples; maximum position error is below 0.000002 m.

Focused animation, presentation, geometry and entrance suites passed (34 tests), along with scoped ESLint, structure checks and the production build. Final Chrome review covered all four hive scenes, all three hive/specimen pairs in four views and three biomes, and the resized ant in four views and three biomes.

## Owner check

1. Open [Ant mound](http://127.0.0.1:4102/playground.html?inspect=fauna.hive.blackAnt), [Beetle nest](http://127.0.0.1:4102/playground.html?inspect=fauna.hive.blueBeetle), and [Spitter hive](http://127.0.0.1:4102/playground.html?inspect=fauna.hive.greenSpitter). Use views 1–4 and switch the world biome. Look for connected bases, recessed clear entrances, a broad beetle opening and high spitter clearance.
2. Open [Black ant](http://127.0.0.1:4102/playground.html?inspect=fauna.blackAnt). Its entire silhouette, stride and attack rig are smaller; parts retain their proportions.
3. Open [MIXED](http://127.0.0.1:4102/playground.html?faunaScene=mixed&faunaMode=bugs). Inspect the larger hives and the smaller ant beside the unchanged beetle and spitter. Pause/step/reset and both attack directions remain available.

Four-view, three-biome screenshots with a correctly sized specimen inside each entrance are in [evidence/hive-rework](evidence/hive-rework/). These specimen placements are a geometry QA arrangement, not an automatic emergence animation. Gameplay placement, pathfinding and attack ranges retain their existing grid rules; see RN-75 in [render limitations](../questions-and-limitations/render.md).
