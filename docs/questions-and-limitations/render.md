# Render engine: questions and limitations

Scope: the 3D render engine in `frontend/render/**` (hex planet terrain, terrain shader and procedural textures,
kitbash archetypes and the model validator, unified material), the `.agents/skills/**` changes and the AGENTS.md visual
pillars. Entry format and rules: [README](./README.md). Found in the W01 branch review of 2026-11-01.

## Hex terrain (`frontend/render/planets/hex/`)

### RN-01 · Territory border ribbon is flat at the tile-centre height and floats or sinks on relief

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** Every ribbon and hatch vertex now sits `BORDER_Y_OFFSET` above `heightAt(x, z)` (the same lattice sampler the chunks and picking use), and each boundary edge is two quads that meet at the edge midpoint, where the terrain kinks (`BORDER_VERTS_PER_EDGE = 8`). `frontend/render/planets/hex/territoryBorder.ts`; test `hexUpdates.spec.ts` › "every ribbon and hatch vertex sits a fixed lift above the surface under it" (1.2 m step and 0.4 m drop); `territoryBorder.spec.ts` vertex counts updated to 8 per edge.

### RN-02 · Props on a tile all use the tile-centre height, although they sit up to ~0.7 m from the centre

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `makeInstance` sets `y = heightAt(x, z)` at the prop's own spot (still deterministic). `chunkPropScatter.ts`; test `hexUpdates.spec.ts` › "every instance takes the height at its own (x, z)"; `hexTerrain.spec.ts` neighbour check now asserts unchanged placement and `y = heightAt(x, z)` (the neighbour's props follow the re-levelled ground).

### RN-03 · Every `updateTiles` rebuilds planet-wide props, water and borders, and each dirty chunk recomputes all heights

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** One `computeEffectiveHeights` per update, passed to `buildChunk` (new optional `effHeights` argument). Chunk handling moved to `chunkSet.ts`; `setChunk` diffs each kind's instances and `rebuildMeshes` rebuilds only the kinds that changed (still one `InstancedMesh` per kind, so the draw-call count is unchanged; per-chunk instancing was not done because it multiplies draw calls). `water.update(tiles, changed)` rebuilds only when a changed tile gains, loses or changes its water (dry/shallow/deep). `updateTiles(tiles, [])` now rebuilds only the borders, and `HexTerrain.refreshBorders(tiles?)` was added (`territory-border/index.ts:82` can switch to it: FRONTEND-FEATURES). The `chunkPropScatter.ts` doc comment was corrected. Files `createHexTerrain.ts`, `chunkSet.ts`, `borderController.ts` (extracted), `chunkMesh.ts`, `chunkPropScatter.ts`, `hexWater.ts`; tests `hexUpdates.spec.ts` › "a borders-only update rebuilds neither chunks, props nor water", "a delta on dry ground keeps the water and the untouched prop kinds", "buildChunk with the precomputed planet heights equals …".

### RN-04 · Hex prop foliage never sways: its time uniform is never advanced

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkPropScatter.ts:199,216` (`timeU` → `createFoliageMaterial`); `createHexTerrain.ts:284-288` (`tick` updates only the terrain and water `uTime`)
- **What happens:** pines and broadleaf trees on the hex planet stand still, while the old noise-terrain trees sway
  (`planets/surface/index.ts:26` advances its `timeU`). Nothing outside the file writes `props.timeU`.
- **Why it is like this:** the uniform was exposed on `HexPropScatter` but never wired into `tick`.
- **Workaround / mitigation:** none.
- **To resolve:** in `tick`, add `props.timeU.value = elapsedTime`.
- **Found:** 2026-11-01, render review
- **Fix:** `tick` sets `props.timeU.value = elapsedTime`. `createHexTerrain.ts`; test `hexUpdates.spec.ts` › "tick advances the prop foliage time uniform".

### RN-05 · Three different "cleared ground" rules for height, water and props

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** One `isClearedPrep(p)` (prepared | irrigated | living) in `chunkMesh.ts`, used by `baseTileHeight`, the slope-easing exemption, `hexWater.isWaterTile` (which no longer treats `flat` as cleared: a Shallow/Deep tile with prep `flat` keeps its water over its submerged bed) and the prop scatter. Tests `hexUpdates.spec.ts` › "a Shallow tile with prep `flat` keeps its water", "an irrigated or living Slope tile stays level". Today the sim sets prep `flat` only together with terrain `flat` (clear/break, landing zone, spawn slots, starter hub site), and 15 generated worlds (3 planet types × 5 seeds, radius 56) have 0 water tiles with a prep other than `wild`, so no current world looks different; which prep values a water tile may carry is still a question for SIM-GAMEPLAY.

### RN-06 · Sim enum codes and colony colours are copied into render with no parity test

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** The tables moved to `shared/contracts/src/tiles/codes.ts` (`TERRAIN_CODES`, `PREP_CODES`, `DEPOSIT_CODES`, `DEFAULT_COLONY_COLORS`); render's `HEX_TERRAIN` / `HEX_PREP` / `HEX_DEPOSIT` and `DEFAULT_COLONY_COLORS` are now those objects (`@terra/contracts/tiles/codes`; `@terra/contracts` added to `frontend/render/package.json` and its lock entry). Parity test `shared/contracts/test/tile-codes.spec.ts` compares them with the sim's `TERRAIN` / `PREP` / `DEPOSIT` and `kernel/colonies.ts` `DEFAULT_COLONY_COLORS`. `GLOBE_PLAYER_COLORS` and its misleading comment were removed. Follow-up for SIM-ENGINE: make `grid/layers.ts` `*_BASE` and `kernel/colonies.ts` import the contracts tables so only one copy remains (the parity test guards until then).
- **Follow-up done (final pass 2026-11-01):** `shared/sim/src/grid/layers.ts` builds `TERRAIN` / `PREP` / `DEPOSIT` from `TERRAIN_CODES` / `PREP_CODES` / `DEPOSIT_CODES` (`withPascalAliases` adds the non-enumerable `Flat` / `Wild` / … aliases), and `kernel/colonies.ts` re-exports the contracts palette: no second copy. The parity spec moved out of contracts (it imported `@terra/sim`, a wrong-way dependency) to `shared/sim/test/grid/tile-codes.spec.ts`, which asserts the sim tables are the contracts tables.

### RN-07 · Dirty-chunk ring may miss normal changes on chunk seams

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** The dirty box is now hex distance 3 (`DIRTY_REACH` in `chunkSet.ts`, an axial box that covers every tile within 3 steps). Test `hexUpdates.spec.ts` › "an incremental update gives the same chunk buffers as a full rebuild, also across a chunk seam" (fails with the old ±2 box).

### RN-08 · `fanNormal` flip branch has a typo (`nz = -ny`)

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `nz = -nz` in `fanNormal` (`chunkMesh.ts`). The branch is still unreachable with `HEX_DIRS`' order, so no test can exercise it; all chunk buffers are unchanged.

### RN-09 · A tile prepared during play looks different after a reload

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `PrepTransitions` (`prepTransitions.ts`) keeps the tiles still blending; once a tile's 0.4 s blend is over, `tick` resets its start time to the sentinel and rebuilds its chunks, so it gets the same pad style (`aAO` 0.96, `aRock` 0.25) a reload gives. Test `hexUpdates.spec.ts` › "rebuilds the tile with the pad style after the 0.4 s blend" (buffers equal a terrain built with the tile already Prepared).

### RN-10 · Shader constants copied from TypeScript (`0.4` s blend, `TILE_M = 2`)

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** The hex GLSL takes `PREP_BLEND_DURATION_S` and `TILE_M` as literals built from the TS constants (`glslFloat`), and every `onBeforeCompile` patch of the terrain, hex and unified colony materials goes through `injectAll` / `replaceOrThrow` (`frontend/render/visuals/shaderInject.ts`), which throws when a marker is missing. Tests `visuals/shaderInject.spec.ts`; `hexUpdates.spec.ts` › "patches three's real standard shader with literals built from the TS constants", "throws instead of compiling a half-patched shader" (both run on `THREE.ShaderLib.standard`, the real sources).

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
- **Note:** Not changed (review-fix round 2026-11-01): measured on `createPlanet` worlds (radius 56, seeds world-1 / golden-1 / x-7), the clamps still fire a lot, so dropping them would visibly move the ground: temperate/ocean holes are all clamped (sim height up to +0.09 m, moved down by up to 0.44 m), 20–27 % of rock tiles (up to 0.54 m), about 60 % of deep tiles (up to 0.18 m) and 7–14 % of slopes (up to 0.21 m); desert slopes 3–18 %. The class-consistent heights the recommendation assumes are not generated yet. Needs the owner (and SIM-ENGINE for the generator) to decide which side moves.

## Terrain material and procedural textures (`frontend/render/visuals/`)

### RN-12 · Foundation pad textures are generated at 512² instead of 128², and for every terrain

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** The pad bundle is requested at 128² (`FOUNDATION_PAD_TEX_SIZE`), and the pad uniforms, sampler declarations and `evalFoundationPad` GLSL moved from the shared terrain shader into the hex material only (`hexEdges.ts` `foundationPadUniforms()`, merged in `createHexTerrain`); `FOUNDATION_PAD_GLSL` is no longer exported. Tests `hexTerrain.spec.ts` (bundle width 128), `hexUpdates.spec.ts` › "only the hex material carries the pad textures and GLSL". Visible effect: the pad's texture detail is 128² per 2 m tile instead of 512².

### RN-13 · `ProceduralTextureRegistry.register` never invalidates the cache

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (older than this branch)
- **Area / code:** `frontend/render/visuals/ProceduralTextureRegistry.ts:83-86` (`cache.delete(name)`) vs `:88-89` (keys are `${name}_${size}`)
- **What happens:** re-registering a generator (the "open registry" extension path in AGENTS §3) keeps serving the
  old cached bundle, because the delete uses the bare name.
- **Why it is like this:** the key format changed and the delete was not updated.
- **Workaround / mitigation:** nothing re-registers at runtime today.
- **To resolve:** delete every key that starts with `${name}_`.
- **Found:** 2026-11-01, render review
- **Fix:** `register` deletes every cached `${name}_<size>` key (not other presets that share a prefix). `ProceduralTextureRegistry.ts`; test `visuals/ProceduralTextureRegistry.spec.ts`.

## Unified material and kitbash runtime (`frontend/render/kitbash/catalog.ts`, `visuals/unified/`)

### RN-14 · Construction scaffold cut heights are tuned to the Command Hub only; `uBuildStage` is never read

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** The scaffold cuts at fixed fractions of the model's own height (`SCAFFOLD_CUT_FRACTIONS` = 0.25 / 1.65 / 3.85 m over the hub's 6.59 m, so the hub looks as before; `uBuildHeight` is set from the geometry bounding box in `createArchetypeMesh`). Progress is quantized only on the CPU; the shader reads `uBuildStage` and its duplicate ladder (with the dead arm) is gone. `uBuildProgress` still mirrors the stage because `frontend/game/features/landfall/landfall.spec.ts` asserts it (see RN-24). Files `visuals/unified/buildScaffold.ts`, `UnifiedColonyMaterial.ts`, `shaderChunks.ts`, `kitbash/catalog.ts`; test `kitbash/buildScaffold.spec.ts`.

### RN-15 · New render features have no playground or docs surface

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** Playground: `hex terrain` toggle / `&hexterrain=1` (sample scene with every class, deposits, a Prepared pad whose wave replays every 3 s, normal and frozen borders; `content/HexSampleHost.ts`), `border hatch` / `&hatch=1`, `work pose` / `&work=1` (`uWorkWeight` 1) and a `build` button / `&build=0|33|66` / `__pg.setBuild()`. The scaffold is now the registered `buildScaffold` shader modifier (`ShaderPluginRegistry`, which gained per-material `createUniforms` and `fragmentDeclarations`). Docs: `docs/visuals/textures-shaders-lighting-spec.md` §3.3, README URL parameters, `docs/dev/DEV_TOOLS.md` (`__pg`). The work pose stays in the core biped arm chunk (it is part of that gait). Checked in headless Chrome: `/playground.html?inspect=building.turret&hexterrain=1&hatch=1&build=66&biome=forestRock` and `?inspect=building.commandHub&hexterrain=1&build=33`, no console errors.

## Kitbash archetypes (`frontend/render/kitbash/archetypes/`, `greebles/`)

### RN-16 · Command Hub copies the kit helpers it already imports

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `kit.ts` helpers take the budgets the hub needed (`lamp` `hSeg`, `ring` `tubeSeg`, `cable` `points: 3` and `seg`, `dish` `seg`) plus a new `tube()` (curve through given points, which `cable` now uses); the hub's `hubLamp` / `hubRing` / `hubCable` copies and the pasted dish lathe are gone, and its pad power cable uses `tube()`. Pure refactor: the geometry of all 29 archetypes is byte-identical (attribute hash before/after) and `validate:models -- --all` reports the same issues.

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
- **Note:** Partly applied (review-fix round 2026-11-01): `capsule` was renamed `roundedTank` with a doc comment saying it is a straight cylinder, and the `rbox` comment now says the default 1 is a single chamfer and `seg = 2` must be passed for a hero hull. No hull got `seg: 2`: it changes the look and six models have < 1 % triangle headroom, so which hulls are "hero" hulls is left to the owner. Geometry of all 29 models unchanged.

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
- **Note:** Partly applied (review-fix round 2026-11-01): the −0.1 m skirt is kept. One rule in `frontend/render/kitbash/validate/groundContact.ts` (flush within 2 cm, or a skirt: only `role: 'plinth'` parts below −2 cm, at most 10.5 cm deep); the playground panel uses it and shows `✔ minY -0.100 (−0.1 m plinth skirt)` for the 13 kit buildings, and "orbital, no ground rule" for ships and props. AGENTS §2/§4, CLAUDE.md and `docs/visuals/agent-3d-coding-rules.md` now say "minY 0, or −0.1 for a building's plinth skirt". Test `kitbash/validate/groundContact.spec.ts`. Not done: sinking the Command Hub plinth, because `frontend/game/features/landfall/landfall.spec.ts` (FRONTEND-FEATURES) pins the hub's `|minY| < 0.001`; the owner decides, then that spec changes with the model.

### RN-19 · Leftover unused imports in rewritten archetypes; stale CLAUDE.md budget note

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** Removed the unused imports in `rocket.ts`, `tech.ts`, `industry.ts` (plus the unused `jitter` in `planets/surface/index.ts` and the unread `viewport` field in `orbit/OrbitalStage.ts`); `tsc --noUnusedLocals` reports nothing in `frontend/render`, `frontend/playground`, `frontend/design`. CLAUDE.md now says all archetypes are under 3.5k with several under 1 % headroom.

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

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `PartOptions.role` / `PartMeta.role` (`'plinth' | 'plinthDetail' | 'whip'`, carried by `extract.ts`) replace the name regexes and the part-#0 rule in the geometry checks: plinth parts are not cable anchors and cables must clear the `plinth` slab's top; only `whip` tubes skip `CABLE_FLOAT` and may ride another animation (`animation.ts`). Roles set in `kit.plinth()`, the hub plinth, the skitter's whip antennas and the drifter's tendrils. The hub's guy wires were renamed "guy cable R/L" and now pass the anchor check. All 29 models report the same issues as before. Appearance checks (colour groups, `ROLE_ZONE`, `ROLE_DETAIL`) still read names, as documented in the skill. Self-test fixtures added: a tube named "antenna lead" with a free end → `CABLE_FLOAT`; a `whip` → clean; a sunk part #0 without the role is an ordinary anchor (`npm run test:models` 48/48).

### RN-22 · All recoil parts are treated as one rig, although their phase depends on `pivot.x`

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `sameRig` applies the bob rule (equal `pivot.x`) to recoil too (`validate/checks/animation.ts`). No model changes verdict. Self-test fixtures: barrel and muzzle brake on different `pivot.x` → `ANIM_COLLISION`; on the same `pivot.x` → clean.

## Cross-area findings (added by the lead)

### RN-23 · Rotation block repeated in the unified shader chunks

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `frontend/render/visuals/unified/shaderChunks.ts:19-27` and `:40-48` (changed on this branch)
- **What happens:** the same rotation code appears twice in two chunk constants; a fix to one will miss the other.
- **To resolve:** extract one named chunk and compose it into both (AGENTS.md: GLSL is split into named chunks composed by a builder).
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** One `rotateRollPitchYaw` GLSL function in `VERT_COMMON`, used by `bipedBodyTransform` and `spiderBodyTransform` (`visuals/unified/shaderChunks.ts`); same math and evaluation order.

### RN-24 · `uBuildProgress` only mirrors `uBuildStage`

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/unified/buildScaffold.ts` (`createUniforms`), `frontend/render/kitbash/catalog.ts` (`setArchetypeBuildProgress`); asserted in `frontend/game/features/landfall/landfall.spec.ts`
- **What happens:** after RN-14 the scaffold shader reads only `uBuildStage`. `uBuildProgress` is still created and set to the same quantized stage, but no GLSL reads it.
- **Why it is like this:** `landfall.spec.ts` (FRONTEND-FEATURES) asserts `uniforms.uBuildProgress.value`; removing the uniform would break that spec.
- **Workaround / mitigation:** documented on `ArchetypeUniforms` ("mirrors `uBuildStage`; not read by the shader").
- **To resolve:** switch the spec's assertions to `uBuildStage`, then drop `uBuildProgress` from the plugin and `setArchetypeBuildProgress`.
- **Found:** 2026-11-01, render review-fix round
- **Fix:** the `uBuildProgress` mirror uniform is removed (`buildScaffold.ts`, `catalog.ts` type and setter, `UnifiedColonyMaterial.ts` doc); the shader and callers use `uBuildStage` only; `buildScaffold.spec.ts` asserts the mirror is gone.


### RN-25 · Two "tube through points" helpers: `kit.tube` and `unitParts.cable`

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (older than the review-fix round)
- **Area / code:** `frontend/render/kitbash/archetypes/buildings/kit.ts` (`tube`, `cable`), `frontend/render/kitbash/greebles/unitParts.ts` (`cable`, `sag`)
- **What happens:** the building kit and the unit kit each build a `TubeGeometry` along a CatmullRom curve through given points, with different defaults (4 vs 5 radial segments, 10 tubular). A fix to one (naming, budgets, roles) misses the other.
- **Why it is like this:** the two kits grew separately; merging them changes the unit models' tube segment count, so it is not a pure refactor.
- **Workaround / mitigation:** none needed for correctness.
- **To resolve:** give one shared helper a radial-segment option and have both kits call it with their current defaults (geometry must stay byte-identical; check with an attribute hash of all archetypes).
- **Found:** 2026-11-01, render review-fix round
- **Fix:** one helper `tubeThrough(b, pts, r, zone, { along, radial }, opts)` in `frontend/render/kitbash/greebles/tube.ts` (CatmullRom `TubeGeometry`, named `power cable` unless `opts.name` says otherwise); `kit.tube` (and so `kit.cable`) calls it with `{ along: o.seg ?? 10, radial: 4 }` and the same option bag, `unitParts.cable` (and `sag`) with `{ along: 10, radial: 5 }`, and the third copy found on the way, the `saggingCable` greeble in `KitbashRegistry.ts` (used by no archetype), with `{ along: 12, radial: 6 }` (its part is now named `power cable`). Geometry byte-identical: a scratch SHA-256 over every archetype's merged attributes + index and its extracted part list (name, zone, kind, role, anim, pivot, emissive) is unchanged for all 29 archetypes; `npm run validate:models -- --all` 29 pass, 0 errors, 0 warnings before and after; `npm run test:models` 48/48.

### RN-26 · Shadow depth pass failed to compile (`objectNormal` undeclared)

- **Status:** Resolved (W06, 2026-11-02)
- **Area / code:** `frontend/render/visuals/unified/shaderChunks.ts` (`vertBeginVertex`)
- **What happens:** the unified vertex chunk wrote `vTaWorldNormal` from Three's `objectNormal`. `MeshDepthMaterial` (the shadow pass) does not declare that name, so Chrome logged `THREE.WebGLProgram: Shader Error` and `tests/e2e/w01.spec.ts` step 1 failed on `expectNoPageErrors`. The colour pass still drew.
- **Why it is like this:** `objectNormal` comes from `<beginnormal_vertex>`, which the depth material does not include before this chunk.
- **Workaround / mitigation:** none; the depth shader did not compile.
- **To resolve:** build the same vector `beginnormal_vertex` would (`normal`, times `instanceMatrix` when instancing) inside the chunk.
- **Found:** 2026-11-02, W06 e2e (`npm run e2e -- --waves 01 --hack`)
- **Fix:** `vertBeginVertex` no longer reads `objectNormal`.
