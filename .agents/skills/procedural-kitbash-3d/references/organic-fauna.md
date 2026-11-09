# Organic fauna policy

Owner-approved 2026-11-05 for insect creatures and species hives. These exceptions override mechanical appearance prescriptions in kitbash, animation, texture, shader and validator skills only for fauna; robot/building rules otherwise remain unchanged.

- Forms may use custom smooth lofts, swept tapered appendages, sculpted shell patches, irregular mounds and hollow organic entrances. Broad curved surfaces need no mounted greebles. Geometry carries silhouette; procedural texture/shader fields carry fine pores, growth lines, veins and scars.
- Use anatomical surface profiles: nonmetallic chitin, flexible membrane, glossy eyes, secretory sacs, soil and dry shell. No mandatory 60/30/10 ratio, gunmetal joints, distinct color per limb group, accent stripe or glow. Maintain species and pose readability under actual lighting and biome weathering.
- Allow anatomy-aligned UVs and procedural color/roughness/normal fields on merged kitbash fauna. Patterns share a coherent source field. Filter fine frequencies at distance. Cache generated maps; never allocate textures per creature or per frame.
- Keep shell segments rigid. Explicit flexible channels may deform membranes/sacs within a documented strain envelope, while anchors stay attached. Mirror every GPU motion in validator poses and shadow passes. Do not disable collision, attachment, ground or triangle checks.
- Use a fauna appearance profile with positive anatomical/material checks instead of mechanical plate/color checks. Add known-good and known-bad fixtures for new checks. Smoothness and lack of glow are not defects; disconnection, invalid materials and robot-like morphology still require attention.
- Keep the existing catalog, unified material, deterministic cached generation, instancing compatibility and <3.5k production triangles. Any higher detail experiment requires a measured budget and production fallback, not an arbitrary global budget increase.
- Review all four views in three biomes, idle/walk/attack, emission-off and gameplay scale. Take artistic risks in shape and surface, then use visual comparison to select the result. Numeric validation does not judge anatomy or taste.

## Current implementation

- `frontend/render/kitbash/greebles/organic/shapes.ts`: `organ`, closed tapered `tendril`, recessed `burrow`; authored smooth normals and anatomy-aligned UVs survive merging. `aOrganic`: 0 mechanical/default, 1 chitin, 2 membrane, 3 secretory tissue, 4 soil, 5 eye.
- `organic/legs.ts`: reusable six-leg rig. Organic `6/16` uses explicit alternating tripods; mechanical spider phases are unchanged.
- `frontend/render/visuals/unified/organicSurface.ts`: shared filtered growth/vein/grain fields modulate pigmentation, roughness and micro-normal response. Derivatives execute outside tissue-dependent branches. Surface fields are evaluated in the shader, not downloaded maps or textures allocated per insect.
- Channels `49` (jaw hinge), `59` (antenna probing), `69` (1.8% gland strain riding body 9), `60` (1.8% static hive gland strain). Shells stay rigid. These run through the shared visible/depth shader and CPU validator poses. Species clock rates and stable initial-position phase offsets live in `tickArchetypeMesh`; socket consumers must use its effective material time.
- Organic appearance checks: `ORGANIC_TISSUE`, `ORGANIC_METAL`, `ORGANIC_ROUGHNESS`, `ORGANIC_FLEX`, `ORGANIC_TOO_DARK`, `ORGANIC_UNIFORM`. Mechanical appearance checks remain unchanged for models without tissue profiles. Good/bad fixtures in `validate/organicFixtures.ts` run in both Vitest and the skill's `self-test.mjs`.
- Current sacs are opaque PBR with thickness-inspired pigmentation, not physical transmission or subsurface scattering. See `docs/questions-and-limitations/render.md` RN-68 and `docs/visuals/organic-fauna-review.md` for evidence and remaining limits.
