# Render engine: questions and limitations

Scope: the 3D render engine in `frontend/render/**` (hex planet terrain, terrain shader and procedural textures,
kitbash archetypes and the model validator, unified material), the `.agents/skills/**` changes and the AGENTS.md visual
pillars. Entry format and rules: [README](./README.md). Found in the W01 branch review of 2026-11-01.

## Hex terrain (`frontend/render/planets/hex/`)

### RN-01 · Territory border ribbon is flat at the tile-centre height and floats or sinks on relief

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/territoryBorder.ts:200` (`y = effHeights[i] + BORDER_Y_OFFSET`), `:230` (`pushQuad` with one `y`); `heightSampler.ts` (surface interpolated between tile centres)
- **What happens:** the terrain mesh puts its vertices at tile centres, so at a shared hex edge the visible ground is
  roughly the mean of the two tiles' heights. The border quad on that edge is flat at the owning tile's own height
  + 3.5 cm. When the neighbour is more than about 7 cm higher, the outer edge of the ribbon goes under the ground and
  is depth-tested away (`depthWrite: false` does not turn depth testing off). When the neighbour is lower, the ribbon
  hangs in the air. D-38 relief is metres high, so territory edges that cross dunes, mesas or slopes break up.
  `territoryBorder.spec.ts` only uses flat height arrays.
- **Why it is like this:** the ribbon geometry is built per tile in the xz plane, with no height sampling.
- **Workaround / mitigation:** none. Prepared or flat starting areas look correct.
- **To resolve:** sample `heightAt` (the same sampler the chunks use) at each ribbon vertex and add the offset, or
  draw the border as a decal or shader term in the terrain material (as the hex edge lines are). Add a spec with a
  stepped height field.
- **Found:** 2026-11-01, render review

### RN-02 · Props on a tile all use the tile-centre height, although they sit up to ~0.7 m from the centre

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkPropScatter.ts:110` (`cy = heightAt(cx, cz)`), `:76-86` (`makeInstance` offsets x/z but keeps `y: cy`)
- **What happens:** trees, boulders, spires and deposit nodes are offset 0.2–0.7 m from the tile centre but keep
  the centre's height. On rock crags, slopes and hole rims (height steps of 0.3–1 m between neighbours) props float
  above, or sink into, the interpolated surface. `sink` in `INST_OPTS` only hides a few centimetres.
- **Why it is like this:** one `heightAt` call per tile, so the result depends only on the tile (deterministic,
  neighbour-independent scatter).
- **Workaround / mitigation:** hardly visible on flat ground.
- **To resolve:** call `heightAt(x, z)` per instance inside `makeInstance`. The result is still deterministic.
- **Found:** 2026-11-01, render review

### RN-03 · Every `updateTiles` rebuilds planet-wide props, water and borders, and each dirty chunk recomputes all heights

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/createHexTerrain.ts:273-283` (`updateTiles`), `:251-255` (`place`); `chunkMesh.ts:244` (`buildChunk` calls `computeEffectiveHeights` for the whole planet); `chunkPropScatter.ts:195,227-244` (`rebuildMeshes`); `hexWater.ts:158-168`; callers `frontend/game/app/online/OnlineSession.ts:427`, `frontend/game/features/territory-border/index.ts:82`
- **What happens:** a delta that changes one tile causes:
  - a whole-planet `computeEffectiveHeights` in `updateTiles`, then another one inside `buildChunk` for each dirty
    chunk (1–4 chunks, 9,577 tiles each time at radius 56);
  - all six prop `InstancedMesh`es disposed and rebuilt from every chunk's buckets (new GPU instance buffers);
  - the water bed texture (128² `tileAt` samples) and the water geometry rebuilt;
  - the whole border mesh rebuilt.

  `territory-border/index.ts:82` calls `updateTiles(hexTiles, [])` only to refresh borders, so it triggers everything
  except the chunk rebuild. The doc comment "rebuilding a chunk updates only that chunk's slice"
  (`chunkPropScatter.ts:195`) does not match the code. Nothing leaks: every old resource is disposed.
- **Why it is like this:** simplest correct rebuild for W01 sizes (radius 56).
- **Workaround / mitigation:** cheap enough at radius 56 for occasional deltas. Cost grows with planet size and
  delta rate.
- **To resolve:** pass the already computed `effHeights` into `buildChunk`. Rebuild only the prop slices of dirty
  chunks (one `InstancedMesh` per chunk, or a slice update). Rebuild water only when a water-relevant tile changed.
  Add a borders-only refresh (`refreshBorders()`) so callers do not need `updateTiles([])`.
- **Found:** 2026-11-01, render review

### RN-04 · Hex prop foliage never sways: its time uniform is never advanced

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkPropScatter.ts:199,216` (`timeU` → `createFoliageMaterial`); `createHexTerrain.ts:284-288` (`tick` updates only the terrain and water `uTime`)
- **What happens:** pines and broadleaf trees on the hex planet stand still, while the old noise-terrain trees sway
  (`planets/surface/index.ts:26` advances its `timeU`). Nothing outside the file writes `props.timeU`.
- **Why it is like this:** the uniform was exposed on `HexPropScatter` but never wired into `tick`.
- **Workaround / mitigation:** none.
- **To resolve:** in `tick`, add `props.timeU.value = elapsedTime`.
- **Found:** 2026-11-01, render review

### RN-05 · Three different "cleared ground" rules for height, water and props

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (divergence); PLAUSIBLE (that the sim produces the cases)
- **Area / code:** `frontend/render/planets/hex/chunkMesh.ts:166` (`baseTileHeight` levels prepared | irrigated | living), `:211` (slope easing exempts only `prepared`); `hexWater.ts:24` (no water for prepared | **flat** | living | irrigated); `chunkPropScatter.ts:111` (`cleared` = prepared | irrigated | living)
- **What happens:**
  - A Shallow or Deep tile with prep `flat` gets no water surface, but its height stays submerged (−0.2 to −0.6 m).
    The result is a dry pit.
  - An irrigated or living Slope tile is levelled in `baseTileHeight` and then eased towards its neighbours again,
    so it is not level. A prepared one stays level.
- **Why it is like this:** each feature added its own predicate.
- **Workaround / mitigation:** the sim may not produce these combinations yet.
- **To resolve:** add one `isClearedPrep(p)` helper (and, if needed, `isLevelledPrep`) in `chunkMesh.ts`, and use it
  in all three files. Ask the sim owner which prep values are allowed on water tiles.
- **Found:** 2026-11-01, render review

### RN-06 · Sim enum codes and colony colours are copied into render with no parity test

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkMesh.ts:5-30` (`HEX_TERRAIN`, `HEX_PREP`, `HEX_DEPOSIT`) vs `shared/sim/src/grid/layers.ts:40-110` (`TERRAIN`, `PREP`, `DEPOSIT`); `territoryBorder.ts:18-25` (`DEFAULT_COLONY_COLORS`) vs `shared/sim/src/kernel/colonies.ts:4`; `territoryBorder.ts:14-16,27-28` (`GLOBE_PLAYER_COLORS`)
- **What happens:** the values match today. If a sim table is renumbered or extended (`layers.ts` says later waves
  append values), the renderer silently draws the wrong class, prep or colony colour. No spec compares them.
  `GLOBE_PLAYER_COLORS` is re-exported but has no user, and its comment says the palette is "aligned with
  `PLAYER_COLORS`", although `PLAYER_COLORS` is orange, blue, yellow, magenta, cyan, unlike the
  orange/teal/red/amber/violet/blue border palette.
- **Why it is like this:** AGENTS §6 lets `render/` import only `@terra/sim/grid/hex` and `@terra/sim/grid/sectors`.
- **Workaround / mitigation:** none.
- **To resolve:** owner decision. Recommendation: allow the pure enum modules `@terra/sim/grid/layers` and the colony
  palette (or move them to `shared/contracts`) and delete the copies. Otherwise add a parity spec that imports both.
  Remove `GLOBE_PLAYER_COLORS` and fix the comment.
- **Found:** 2026-11-01, render review

### RN-07 · Dirty-chunk ring may miss normal changes on chunk seams

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `frontend/render/planets/hex/createHexTerrain.ts:138-152` (`collectDirtyChunks`, ±2 axial box); `chunkMesh.ts:211-224` (slope easing reads neighbours), `:277` (`fanNormal` reads neighbours), `:254-260` (a chunk holds border vertices of neighbour tiles)
- **What happens:** a changed tile X can change the effective height of its slope neighbours (1 ring). That changes
  the normals of tiles 2 rings away. Those tiles can be border vertices of a chunk whose own tiles are 3 rings from X.
  The ±2 axial box covers hex distance 2 fully but distance 3 only partly, so a chunk on a seam can keep a stale
  normal or height there. The visible effect is a lighting seam until the next full rebuild.
- **Why it is like this:** the ring was sized for height plus normals only.
- **Workaround / mitigation:** only Slope tiles on a chunk boundary are affected.
- **To resolve:** use hex distance 3 (or mark chunks whose vertex set includes any tile within distance 2 of a
  changed tile). Add a spec: incremental `updateTiles` must give the same buffers as a full rebuild.
- **Found:** 2026-11-01, render review

### RN-08 · `fanNormal` flip branch has a typo (`nz = -ny`)

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkMesh.ts:330`
- **What happens:** `if (ny < 0) { nx = -nx; ny = -ny; nz = -ny; }` sets `nz` from the already negated `ny`, not
  from `-nz`. Today the branch cannot run: `ny` depends only on the xz of the ring, and with `HEX_DIRS`'s fixed order
  it is always ≥ 0. Any change to the ring order or direction would produce wrong normals.
- **Why it is like this:** typo.
- **Workaround / mitigation:** currently unreachable.
- **To resolve:** change it to `nz = -nz`, or delete the branch.
- **Found:** 2026-11-01, render review

### RN-09 · A tile prepared during play looks different after a reload

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `frontend/render/planets/hex/chunkMesh.ts:280-285` (`stylePrep = isPrep && startT >= 0 ? HEX_PREP.flat : prepVal`)
- **What happens:** a tile prepared during the session has `startT >= 0`, so its vertex style uses the `flat` class
  (AO 1.0, rock 0) under the shader pad. A tile that was prepared when the terrain was built uses `PREP_PAD_STYLE`
  (AO 0.96, rock 0.25). The pad colour itself comes from the shader, but `aRock` and `aAO` still feed the terrain
  shading. The same pad can look slightly different before and after a reload. The rule also relies on the
  `INITIAL_PREP_START_TIME = -10` sentinel being negative.
- **Why it is like this:** the transition needs the old look under the 0.4 s wave.
- **Workaround / mitigation:** the shader pad covers most of the difference.
- **To resolve:** once the blend has finished, rebuild the tile with pad style, or blend `aAO` and `aRock` in the
  shader.
- **Found:** 2026-11-01, render review

### RN-10 · Shader constants copied from TypeScript (`0.4` s blend, `TILE_M = 2`)

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/hexEdges.ts:16` (`/ 0.4`) vs `chunkMesh.ts:32` (`PREP_BLEND_DURATION_S`); `hexEdges.ts:55` (`vLP.xz / 2.0`) vs `hexMath.ts:4` (`TILE_M`); `hexEdges.ts:74-79` (`String.replace` on `'vLP = position;'` and `'#include <alphatest_fragment>'`)
- **What happens:** if either TS constant changes, `getTilePrepBlend` or picking no longer agrees with what the
  shader draws. If the base terrain shader stops containing `vLP = position;`, the replace silently does nothing and
  the fragment shader fails to compile in the browser. The spec only checks that the strings are present, and no
  test compiles the GLSL.
- **Why it is like this:** literals are inlined into the GLSL chunks.
- **Workaround / mitigation:** none.
- **To resolve:** pass the values as uniforms or `#define`s built from the TS constants. Assert that each
  `replace` matched (throw on no-op).
- **Found:** 2026-11-01, render review

### RN-11 · The renderer overrides sim heights on several classes

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkMesh.ts:165-188` (`baseTileHeight`: rock `max(raw, 0.65) + crag`, hole `≤ -0.35`, deep `≤ -0.48`, shallow `-0.2` fallback, forest `0.12` fallback, slope `max(raw, 0.32)`), `:208-224` (slope easing)
- **What happens:** AGENTS §6 / D-38 say render draws the sim's metre heights "plus cosmetic detail". These rules
  clamp or replace the sim height. Picking, the camera and entity placement all use the rendered height, so the
  view is consistent with itself. Sim rules that read `height` (slope, line of sight, later combat) see different
  numbers from what the player sees, by up to about 0.9 m on low rock or hole tiles.
- **Why it is like this:** these are readability fallbacks from before the sim generated real relief.
- **Workaround / mitigation:** none.
- **To resolve:** owner decision. Recommendation: limit render to additive detail capped at about 0.2 m. Drop the
  `max` and `min` clamps now that `shared/sim/src/gen/world/` generates class-consistent heights.
- **Found:** 2026-11-01, render review

## Terrain material and procedural textures (`frontend/render/visuals/`)

### RN-12 · Foundation pad textures are generated at 512² instead of 128², and for every terrain

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/terrain/terrainMaterial.ts:12` (`ProceduralTextureRegistry.get('foundationHexPad')`); `ProceduralTextureRegistry.ts:88` (`get(name, size = 512)`), `:255` (generator default `size = 128`); `terrainShader.ts:18,162` (`FOUNDATION_PAD_GLSL` in the shared `FRAG_COMMON`)
- **What happens:** `get()` always passes its own default of 512, so the generator's 128 never applies. On first
  terrain creation the main thread runs a 262k-pixel JS loop plus a Sobel pass, and three 512² RGBA textures
  (~3 MB plus mips, anisotropy 4) are uploaded. `terrainUniforms` is shared with the non-hex `TerrainMesh`
  (`TerrainMesh.ts:24`), so every terrain pays for this, and every terrain shader compiles `evalFoundationPad` with
  three extra samplers, although only the hex edge chunk calls it. The exported `FOUNDATION_PAD_GLSL` has no
  importer outside its file.
- **Why it is like this:** the registry API has a global default size.
- **Workaround / mitigation:** the bundle is cached after the first call.
- **To resolve:** call `get('foundationHexPad', 128)` (or give the generator an explicit size). Add the pad uniforms
  and `FOUNDATION_PAD_GLSL` only in the hex material (`addHexEdges`). Un-export the chunk.
- **Found:** 2026-11-01, render review

### RN-13 · `ProceduralTextureRegistry.register` never invalidates the cache

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (older than this branch)
- **Area / code:** `frontend/render/visuals/ProceduralTextureRegistry.ts:83-86` (`cache.delete(name)`) vs `:88-89` (keys are `${name}_${size}`)
- **What happens:** re-registering a generator (the "open registry" extension path in AGENTS §3) keeps serving the
  old cached bundle, because the delete uses the bare name.
- **Why it is like this:** the key format changed and the delete was not updated.
- **Workaround / mitigation:** nothing re-registers at runtime today.
- **To resolve:** delete every key that starts with `${name}_`.
- **Found:** 2026-11-01, render review

## Unified material and kitbash runtime (`frontend/render/kitbash/catalog.ts`, `visuals/unified/`)

### RN-14 · Construction scaffold cut heights are tuned to the Command Hub only; `uBuildStage` is never read

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/unified/shaderChunks.ts:212-223` (`FRAG_BUILD_SCAFFOLD`), `:187-188`; `frontend/render/kitbash/catalog.ts:75-89` (`quantizeBuildStage`, `setArchetypeBuildProgress`); `UnifiedColonyMaterial.ts:23,47`; only caller `frontend/game/app/online/EntityMeshes.ts:289` (commandHub)
- **What happens:**
  - **Fixed cut heights.** The stage cut heights are fixed in model space: 0.25 m, 1.65 m and 3.85 m. Building
    heights in the catalog range from 2.52 m (turret) to 10.4 m (rocket). At "66 %" the turret, beacon, depot,
    capacitor and solar array show no scaffold at all (they are already complete). The rocket shows only its lower
    37 %. The hub (6.59 m) is the one model this suits, and today it is the only caller.
  - **Duplicate quantization.** The shader quantizes `uBuildProgress` again, duplicating `quantizeBuildStage`. Its
    `>= 0.999 ? 1.0` arm is dead inside `if (uBuildProgress < 0.999)`.
  - **Unused uniform.** `uBuildStage` is declared, set and asserted in `landfall.spec.ts`, but no GLSL reads it.
- **Why it is like this:** built for the W01 hub landing.
- **Workaround / mitigation:** only the hub uses it.
- **To resolve:** cut as a fraction of the model's height: pass `uBuildHeight` from the geometry bounding box (or
  normalise `vLocalPos.y`). Quantize only on the CPU and drop `uBuildStage` or the shader ladder. Add a
  playground toggle (RN-15).
- **Found:** 2026-11-01, render review

### RN-15 · New render features have no playground or docs surface

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/playground/` (no reference to `setArchetypeBuildProgress`, `uWorkWeight`, `createHexTerrain`, territory borders or `foundationHexPad`); `docs/visuals/*`, `.agents/skills/shader-texture-tuning`
- **What happens:**
  - **No playground view.** AGENTS §4 makes the playground the visual QA surface. The scaffold stages, the biped
    work pose (`uWorkWeight`), the hex terrain classes, the Prepared pad wave, the territory borders and the
    colour-blind hatch can only be seen in the online game flow.
  - **Hard-coded in core chunks.** The scaffold and work pose are written into the core fragment and vertex chunks.
    AGENTS §3 routes new shader effects through `ShaderPluginRegistry.registerModifier()`.
  - **No docs.** None of these features is described in `docs/visuals/`.
- **Why it is like this:** built directly against the game flow in W01.
- **Workaround / mitigation:** `/play.html?scenario=w00` shows them in context.
- **To resolve:** add a playground control for build stage and work weight, plus a hex terrain sample scene. Move
  the scaffold into a registered shader modifier. Add one paragraph to `docs/visuals/textures-shaders-lighting-spec.md`.
- **Found:** 2026-11-01, render review

## Kitbash archetypes (`frontend/render/kitbash/archetypes/`, `greebles/`)

### RN-16 · Command Hub copies the kit helpers it already imports

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/kitbash/archetypes/buildings/hub.ts:8-22` (`hubLamp`, `hubRing`, `hubCable`), `:100-115` (inline radar-dish lathe) vs `buildings/kit.ts:42-66` (`cable`, `lamp`, `ring`, `dish`, all imported on `hub.ts:4`); `hub.ts:76-82` (hand-built `TubeGeometry` cable)
- **What happens:** the hub defines local copies that differ only in segment counts or the curve shape (three control
  points instead of five). The radar dish is `kit.dish()`'s profile pasted with 10 instead of 12 lathe segments.
  Fixes to the kit helpers (names, segment budgets, validator naming) miss the hub. AGENTS §6 forbids copy/paste.
- **Why it is like this:** done to fit the 3.5k triangle budget and pass the validator quickly (`1865882`).
- **Workaround / mitigation:** none.
- **To resolve:** give `lamp`, `ring`, `cable` and `dish` optional segment and curve-point parameters in `kit.ts`, and
  delete the hub copies.
- **Found:** 2026-11-01, render review

### RN-17 · Global segment and bevel defaults were lowered: every model's look changed

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/kitbash/greebles/unitParts.ts:10-13` (`rbox` seg 2→1, `cyl` 12→10, `sph` 14×10→10×8), `:150` (`cable` 14×6→10×5), `:162` (`lathe` 20→14); `archetypes/buildings/kit.ts:13-30` (`box` seg 2→1, `cyl` 16→10, `ball` 14→10, `ring` 8×28→5×≤16), `:25` (`capsule` now emits a `CylinderGeometry`); commit `abe7ed1`
- **What happens:**
  - **Chamfers instead of rounded edges.** 37 `rbox` calls that relied on the default lost their 2-segment rounded
    bevels (now a single chamfer). Every building lost its explicit `seg: 2/3` hulls.
  - **No headroom left.** All 29 models now pass the 3.5k budget. Six of them sit within 1 % of the cap: combat
    3,492, pylon 3,480, rocket 3,476, carrier 3,472, droneArray 3,464, roboticsFactory 3,464.
  - **Stale doc comment.** The `rbox` comment still says "2 for hero hulls", which the default no longer gives.
  - **Misleading helper name.** `capsule()` no longer makes a capsule.
- **Why it is like this:** done to meet the triangle budget and the validator across all 29 models in one pass.
- **Workaround / mitigation:** validated at 0 errors and 0 warnings.
- **To resolve:** owner OK on the look (AGENTS §6: "changing its look needs the owner's OK"; Pillar 1 wants beveled
  hulls that catch highlights). Recommendation: keep the lower defaults, but give hero hulls an explicit `seg: 2`
  where the budget allows. Rename `capsule` to `roundedTank` (or restore a low-segment capsule). Fix the `rbox`
  comment.
- **Found:** 2026-11-01, render review

### RN-18 · Ground-contact rule disagrees between the docs, the playground and the validator

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/playground/panels/InfoPanel.ts:11` (`|minY| <= 0.02` else ✖); `frontend/playground/content/archetypeStats.ts:14` (raw bbox `minY`); `frontend/render/kitbash/archetypes/buildings/kit.ts:68-70` (plinth from −0.1); `.agents/skills/model-geometry-validator/scripts/self-test.mjs` ("foundation sunk 10 cm below ground is allowed"); `docs/visuals/agent-3d-coding-rules.md:15,23`; AGENTS §2 Pillar 4 and §4; CLAUDE.md "Require `minY 0.000`"; `buildings/hub.ts:26` (hub plinth at y = 0)
- **What happens:**
  - **Three sources disagree.** The validator passes every building with `minY -0.100`. The playground panel shows
    `✖ minY -0.100` for 13 of the 14 buildings. AGENTS and CLAUDE.md say the panel must show `0.000`. The 3D coding
    rules require a plinth sunk −0.1 m.
  - **The hub is the outlier.** The Command Hub, the one building the W01 game actually places, is the only
    building whose plinth starts at 0, so it is the only one that can show a gap on uneven ground.
- **Why it is like this:** the sunk-plinth convention predates the `minY 0.000` wording.
- **Workaround / mitigation:** buildings sit on levelled Prepared pads in W01.
- **To resolve:** owner decision. Recommendation: keep the −0.1 skirt. Make the playground compute contact above a
  named `foundation plinth` part (or accept `-0.1 ≤ minY ≤ 0`). Update AGENTS §2/§4 and CLAUDE.md to say "minY 0, or
  −0.1 for a building skirt". Sink the hub plinth like the others.
- **Found:** 2026-11-01, render review

### RN-19 · Leftover unused imports in rewritten archetypes; stale CLAUDE.md budget note

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/kitbash/archetypes/buildings/rocket.ts:4-5` (`RoundedBoxGeometry`, `box`, `ring`, all unused since this branch); `buildings/tech.ts:4` (`RoundedBoxGeometry`, unused since this branch); `buildings/industry.ts:4` (`V3`, older than this branch); CLAUDE.md "several existing archetypes currently exceed this"
- **What happens:** `tsc --noUnusedLocals` reports these. CLAUDE.md still says several archetypes exceed 3.5k
  triangles. After this branch none do (maximum 3,492).
- **Why it is like this:** imports were not cleaned up after the rewrites.
- **Workaround / mitigation:** none needed. This is dead code only.
- **To resolve:** remove the imports. Reword the CLAUDE.md note to "all archetypes are under 3.5k; several have
  < 1 % headroom".
- **Found:** 2026-11-01, render review

### RN-20 · `animType 3` is recoil, not a beacon pulse

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/unified/shaderChunks.ts:69-70` (type 3 = `transformed.z -=` recoil pulse on `g`); about 15 `animType: 3` beacons removed in `abe7ed1` (`ships.ts`, `nature.ts`, `satellites.ts`, `robots.ts`)
- **What happens:** earlier models used `animType: 3` on lights as a "pulsing beacon". In fact it slides the part
  6 cm along −z, so the validator reported moving lights. This branch removed those animations, so beacons are now
  static. There is no emissive-pulse channel.
- **Why it is like this:** the GPU animation set is rigid-body only.
- **Workaround / mitigation:** bloom still makes the beacons read as lights.
- **To resolve:** if pulsing lights are wanted, add an emissive-only anim channel (colour scale, no vertex motion) and
  teach the validator to skip it.
- **Found:** 2026-11-01, render review

## Model validator (`frontend/render/kitbash/validate/`)

### RN-21 · Validator verdicts depend on part names and part order

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/kitbash/validate/checks/overlaps.ts:40-43` (`isPlinthPart`: name `/plinth|foundation/` or part #0 below −2 cm), `:67` (skips `CABLE_FLOAT` for `/antenna|tendril|whip/`); `checks/animation.ts:39` (`/tendril/`); `appearance/colorChecks.ts:84-86`; `buildings/hub.ts:95-96` (`'antenna guy cable R'`, `'antenna guy cable L'`)
- **What happens:**
  - **Skipped anchor check.** The two Command Hub guy wires are named "antenna guy cable …", so they match
    `/antenna/` and never get the new `CABLE_FLOAT` anchor check. A floating guy-wire end would pass.
  - **Name controls the verdict.** Renaming a part (or a `kit.cable` default name, now "power cable") can flip
    an error to a pass.
  - **Part order controls plinth detection.** The plinth fallback treats part #0 as the plinth whenever it sits
    below −2 cm.
- **Why it is like this:** names are the only semantic signal the merged geometry carries.
- **Workaround / mitigation:** names are reviewed with the model.
- **To resolve:** add explicit part roles to `PartOptions` (`role: 'whip' | 'plinth' | …`) and use them in the
  checks instead of regexes. Until then, rename the hub's wires to "guy cable" so they get the anchor check.
- **Found:** 2026-11-01, render review

### RN-22 · All recoil parts are treated as one rig, although their phase depends on `pivot.x`

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/kitbash/validate/checks/animation.ts:15-19` (`sameRig`: `animType === 3` always true); `shaderChunks.ts:70` (`sin(g + pivot.x * 2.3)`)
- **What happens:** two type-3 parts with different `pivot.x` recoil at different times. This is fine for the twin
  autocannons. But a barrel and its muzzle given different pivots would pull apart while firing, and the validator
  no longer checks that pair for collision or detachment. Bob (type 2) correctly compares `pivot.x`; recoil should
  too.
- **Why it is like this:** relaxed to silence warnings on the turret.
- **Workaround / mitigation:** current models use a shared pivot per gun.
- **To resolve:** use the bob rule (`pivot.x` equal) for type 3, and add a self-test fixture.
- **Found:** 2026-11-01, render review

## Cross-area findings (added by the lead)

### RN-23 · Rotation block repeated in the unified shader chunks

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `frontend/render/visuals/unified/shaderChunks.ts:19-27` and `:40-48` (changed on this branch)
- **What happens:** the same rotation code appears twice in two chunk constants; a fix to one will miss the other.
- **To resolve:** extract one named chunk and compose it into both (AGENTS.md: GLSL is split into named chunks composed by a builder).
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
