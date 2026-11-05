# Organic bugs and hives — 2026-11-05

The black ant, blue beetle, green spitter and their three species hives now use anatomical geometry and biological surface profiles. The owner requested freer organic skill rules and regeneration of all six models. Existing unrelated worktree changes were preserved.

## Changes

- Updated the bug and hive skills, and added an explicit organic exception to the kitbash, animation, texture, shader, validator and viewport skills and AGENTS.md. The [organic policy](../../.agents/skills/procedural-kitbash-3d/references/organic-fauna.md) records the implemented profile and channels.
- Replaced box bodies, rectangular trim, straight struts, foot pads, collars and mandatory lights with curved anatomical volumes, tapered appendages, hooked feet, shell seams, recessed burrows and fluted chimneys.
- Preserved smooth authored normals for organic parts while retaining existing mechanical normal generation. Anatomical UVs follow the body's longitudinal axis and unwrap seam triangles.
- Added nonmetallic chitin, membrane, secretory, earth and eye profiles. One shared, distance-filtered procedural field drives surface color, roughness and micro-normal variation; sacs include vein patterns and wet highlights. Eyes and habitats are nonemissive. Soil/shell/resin hive palettes are independent of bug palettes. Weathering favors low and downward-facing tissue.
- Added GPU jaw articulation (49), antenna probing (59), body-mounted sac pulse (69) and hive sac pulse (60). Soft strain is limited to secretory tissue at 1.8%, with CPU validator mirrors and the same deformation in shadow depth passes. Organic legs use explicit alternating tripods. Species clocks differ and initial placement supplies a stable cosmetic phase offset.
- Added an organic appearance profile and positive/negative fixtures; geometry connectivity, overlaps, motion clearance, grounding and triangle budgets still run. Mechanical models retain their original appearance checks.

## Review locally

The Vite playground was run on **http://127.0.0.1:4100**.

| Species | Creature | Hive |
|---|---|---|
| Ant | [Black ant](http://127.0.0.1:4100/playground.html?inspect=fauna.blackAnt&view=iso) | [Earthen mound](http://127.0.0.1:4100/playground.html?inspect=fauna.hive.blackAnt&view=iso) |
| Beetle | [Blue beetle](http://127.0.0.1:4100/playground.html?inspect=fauna.blueBeetle&view=iso) | [Molted shell nest](http://127.0.0.1:4100/playground.html?inspect=fauna.hive.blueBeetle&view=iso) |
| Spitter | [Green spitter](http://127.0.0.1:4100/playground.html?inspect=fauna.greenSpitter&view=iso) | [Resin chimney hive](http://127.0.0.1:4100/playground.html?inspect=fauna.hive.greenSpitter&view=iso) |

Use keys 1–4 for iso/front/side/top. Switch planets in World. The info panel reports grounded geometry and the triangle count. All six models contain no emissive tissue, so their normal captures also demonstrate the emission-off silhouette.

The [mixed fixture](http://127.0.0.1:4100/playground.html?faunaScene=mixed&faunaMode=passive&faunaSeed=7) was exercised in passive and aggressive modes. It shows all three species next to their hives, with antennae active during idle poses. It is a presentation smoke test, not an online replay or combat acceptance test. Neighbor overlap is recorded as RN-69.

## Evidence

Captured and inspected 72 diagnostic frames: six models × four views × three biomes. Review sheets:

- [Dune](./evidence/organic-fauna/sheet-dune.jpg)
- [Ocean forest](./evidence/organic-fauna/sheet-oceanForest.jpg)
- [Forest rock](./evidence/organic-fauna/sheet-forestRock.jpg)
- [Mixed passive scene](./evidence/organic-fauna/mixed-passive.png) and [aggressive scene](./evidence/organic-fauna/mixed-aggressive.png)

The visual pass caught outward-facing burrows and an overly divided beetle shell, both corrected before the final captures. Browser output had no JavaScript or shader compilation errors; the only console error was the existing missing `/favicon.ico` (recorded in `browser-errors.json`).

| Model | Triangles | Ground minY | Errors / warnings |
|---|---:|---:|---:|
| Black ant | 2,748 | 0.000 | 0 / 0 |
| Blue beetle | 2,652 | 0.000 | 0 / 0 |
| Green spitter | 2,980 | 0.000 | 0 / 0 |
| Ant hive | 2,304 | 0.000 | 0 / 0 |
| Beetle hive | 1,800 | 0.000 | 0 / 0 |
| Spitter hive | 2,496 | 0.000 | 0 / 0 |

Validation performed:

- `npm run validate:models -- --all --strict`: **46/46 models**, zero errors or warnings; [report](./evidence/organic-fauna/model-validation.txt).
- `npm run test:models`: **57/57 fixtures**, including nine organic fixtures.
- `npm test -- frontend/render frontend/playground/__tests__/w07-fauna-playground.spec.ts`: **194 tests, 32 files passed**.
- Production build, TypeScript and structure checks passed. Vite reported dependency annotation and bundle-size warnings.
- Focused ESLint and `git diff --check` passed.
- WebGL2 transform feedback compared the actual unified vertex shader against CPU validator poses: **594,420 vertices across 2,897 part poses**, maximum coordinate error **0.0000011921 m**. [Raw result](./evidence/organic-fauna/gpu-pose-parity.json). The visible and depth materials use the same vertex deformation builder.
- Skill YAML frontmatter parsed successfully using Ruby's YAML parser. The skill-creator Python validator could not run because this environment has no PyYAML; metadata and references were also reviewed directly.

Remaining optical, animation and performance limits: [RN-68](../questions-and-limitations/render.md#rn-68--organic-tissue-optics-and-animation-remain-inexpensive-approximations). Cosmetic crowd overlap: [RN-69](../questions-and-limitations/render.md#rn-69--mixed-hive-life-preview-can-overlap-neighboring-insects).
