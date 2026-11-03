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

- **Status:** Resolved (review-fix round 2026-11-01); superseded 2026-11-02: the Prepared pad, its blend and textures were removed (RN-29)
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

- **Status:** Resolved (review-fix round 2026-11-01); superseded 2026-11-02: the Prepared pad, its blend and textures were removed (RN-29)
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

- **Status:** Resolved (review-fix round 2026-11-01); superseded 2026-11-02: the Prepared pad, its blend and textures were removed (RN-29)
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

## W02 First Light review fixes (`lighting`, `planets/hex`, `visuals/terrain`, `playground`)

### RN-26 · Daytime shutoff, cone/ground projector sync, 4-sided building illumination, and Playground Lights Editor

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/lighting/archetypeLights.ts`, `frontend/render/lighting/EntityProjectorRig.ts`, `frontend/render/lighting/ColonyVisionAndLights.ts`, `frontend/game/app/online/entityVisionSync.ts`, `frontend/playground/panels/LightsPanel.ts`
- **What happens:** unit and building volumetric cones and projectors remained on during daytime (`rigIntensity` floor `0.22`), volumetric cone cylinders pointed 180° away from their ground illumination pools, the Metals Extractor (archetype `building.mine`) and Solar Array (`building.solar`) fell through to the 1-lamp robot projector branch instead of lighting all 4 building sides, and light sources could not be tuned in `/playground.html`.
- **Fix:** created `archetypeLights.ts` as the single code-configurable registry of `ArchetypeLightSource`s (`pos`, `target`, `color`, `intensity`, `range`, `coneTopRadius`, `coneBottomRadius`, `poolRadius`) shared by `EntityProjectorRig` (orienting cones via `quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir)`) and `entityVisionSync` (projecting all 4 corner lights on `building.commandHub`, `building.mine`, `building.solar` and `ship.dropPod`, with `MAX_COLONY_PROJECTORS = 32`; registry keys: there is no `metalsExtractor` key, `entityVisionSync.lightArchetypeForKind` maps that entity kind to `building.mine`; the pod's lights were later removed, RN-44); gated all unit/building lights off during daytime (`daylight >= 0.65`) and disabled Solar lights/animation at night; added the interactive `LightsPanel` (`?lights=1` / `[L]`) in `/playground.html` with live add/remove/move/aim/tune controls and TypeScript code export.
- **Found:** 2026-11-02, owner review (W02)

### RN-27 · Missing hex grid lines and partial foundation plates under HQ / placed buildings

- **Status:** Resolved (W02 review-fix 2026-11-02); the metallic foundation plate part is superseded the same day: Prepared ground is drawn as plain flat ground (RN-29)
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkMesh.ts`, `frontend/render/planets/hex/hexEdges.ts`, `frontend/game/app/online/EntityMeshes.ts`, `shared/sim/src/systems/economy/construction.ts`
- **What happens:** `isFlatBuildable` excluded `isClearedPrep` tiles bordering uneven ground and `hexEdges.ts` attenuated hex grid lines on prepared pads; barycentric `smoothstep(0.36, 0.54, vPrepTarget)` clipped off the outer half and 6 corners of every prepared hex; `3×3` Command Hub prepared `[0..2]` while its mesh sat at `(0, 0)`, and `2×2` buildings sat at `(q, r)` instead of `(q + 0.5, r + 0.5)`.
- **Fix:** included `isClearedPrep(prepVal)` in `isFlatBuildable`, computed exact Voronoi hex membership (`vPrepPos`) in `hexEdges.ts` so 100% of every prepared hexagon renders as a metallic foundation plate with crisp dark metallic hex borders, centered `3×3` footprints at `[q-1..q+1, r-1..r+1]`, and centered `2×2` building meshes at `(x + 0.5, y + 0.5)` over their 4 footprint hexes.
- **Found:** 2026-11-02, owner review (W02)

### RN-28 · Prop/deposit overlap, animated water spilling past hex borders, and sandy beach shoreline transition

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkPropScatter.ts`, `frontend/render/planets/hex/hexWater.ts`, `frontend/render/visuals/terrain/Liquids.ts`, `frontend/render/planets/hex/chunkMesh.ts`, `frontend/render/planets/hex/hexEdges.ts`, `shared/sim/src/gen/temperate.ts`
- **What happens:** `assignTemperateDeposits` and `scatterTileProps` placed rocks/trees and resource deposits on the same tile, multi-instance props could overlap randomly, and `Liquids.ts` displaced dry bank vertices upward so animated water spilled over adjacent land tiles.
- **Fix:** restricted deposit candidates in `assignTemperateDeposits` to `TERRAIN.flat`/`TERRAIN.slope`, skipped wild rock/forest props on deposit tiles in `chunkPropScatter.ts` with even angular sector spacing (`minR >= 0.34m`), pinned dry shoreline water vertices (`WATER_SHORE_PIN_Y = -0.16`, `waterVert = 0`) with exact Voronoi water-hex clipping (`inWaterHex`) in `Liquids.ts`, and added procedural wet/dry sandy beach transitions (`vHexShore`, `HEX_SHORE_BEACH_GLSL`) along water borders and hex corners.
- **Found:** 2026-11-02, owner review (W02)

### RN-29 · Prepared ground is drawn as plain flat ground (metal pad removed)

- **Status:** Accepted (owner request 2026-11-02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/{chunkMesh,createHexTerrain,hexEdges,chunkSet}.ts`, `frontend/render/visuals/ProceduralTextureRegistry.ts`
- **What happens:** `tileStyle` gives Prepared the flat style (same tint, AO 1.0, levelled height, hex lines); the engineered hex-plate pad (`evalFoundationPad`, `frontierGlow`, `uPad*`, `foundationHexPad`), the 0.4 s Wild → Prepared blend (`prepTransitions.ts`, `PREP_BLEND_DURATION_S`, `getTilePrepBlend`, `aPrepTarget` / `aPrepStartTime`) are gone; the shore factor lives in its own attribute `aHexShore`. A Prepared tile next to water gets the beach band like a flat tile. Deposit tiles are levelled at `levelledFlatHeight(raw)` instead of 0 m (no more pits on raised ground).
- **Why it is like this:** the owner wants terraform to just flatten the ground; buildable ground is no longer visible on its own (the build ghost shows it).
- **To resolve:** if buildable ground should be readable again, add a subtle overlay in the build ghost, not a ground material.
- **Found:** 2026-11-02, terraform rework

### RN-30 · Hex terrain colour on uneven ground: water bands gated to water tiles, class tint per hex cell

- **Status:** Resolved (terraform rework 2026-11-02)
- **Severity:** medium
- **Confidence:** CONFIRMED (bisected: stayed with `?shadow=0`, `?daynight=0`, projectors / FoV off; gone with a plain material)
- **Area / code:** `frontend/render/visuals/terrain/terrainShader.ts` (`TA_WATER_GATE`), `frontend/render/planets/hex/{tileTint,hexEdges,chunkMesh}.ts`
- **What happened:** around the rock ridge north of the HQ a dark parallelogram, pale diagonal stripes and a brown smear showed. (a/b) The forestRock / oceanForest shader adds shore-sand / wet / lake-bed bands measured from the water level, and levelled hex land sits exactly at `HEX_WATER_LEVEL` (0 m): level tiles got ~0.9 sand, tiles raised ≥ 10 cm none, cut along mesh triangles; dry basins below 0 m showed lake-bed sand. (c) The class tint (slope brown, rock grey) was a per-vertex colour at tile centres, smeared a full tile across 2 m triangles.
- **Fix:** every water-level band is multiplied by `TA_WATER_GATE` (1.0 for the continuous terrain; `smoothstep(0.96, 1.0, vHexShore)` on the hex terrain, so only real water tiles get them). The class tint is a per-cell `(2R+1)²` DataTexture (`tileTint.ts`, updated in `updateTiles`) sampled for the fragment's own hex and the neighbour across the nearest edge, 0.45 m seam; the vertex `color` attribute is gone.
- **Left as is:** slope tiles stay brown inside their own hex (design; knobs `CLASS_STYLES` in `chunkMesh.ts`, `tileMix` 0.72, the 0.45 m seam in `HEX_TINT_GLSL`). The tint is now crisp per hex instead of the soft vertex blend.
- **Found:** 2026-11-02, owner screenshot (terraform rework)

### RN-31 · Deposit tier look is a default

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkPropScatter.ts` (`depositVisualTier`), `frontend/render/visuals/terrain/Scatter.ts` (`Place.tintMul`), `frontend/game/store/replica/viewCodec.ts` (`depositTier`), `frontend/game/features/landfall/HqPanel.ts`
- **What happens:** tier from the sim's `depositTier` layer (missing / 0 = t1): t1 3 nodes; t2 4 nodes, 1.12× size, colour ×1.1; t3 5 nodes, 1.24× size, colour ×1.2. Same models, so the family stays readable; the selection bar now names the tier and resource (`IRON DEPOSIT · T1`, `LIGHT ALLOYS DEPOSIT · T2`, etc.).
- **To resolve:** owner tunes the 3D node counts/scales/tints if desired.
- **Found:** 2026-11-02, terraform rework

### RN-32 (RND-04) · Work particle bounce uses a scalar groundY plane per work site, and tool muzzle origins use a CPU-side GPU-pose mirror (`toolOrigins.ts`)

- **Status:** Deliberate trade-off / Resolved (`toolOrigins.ts`)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/particles/WorkParticleEmitter.ts` (`stepLayer`), `frontend/render/particles/toolOrigins.ts` (`evalArchetypeToolOrigins`, `computeMeshToolOrigins`), `frontend/game/app/online/workTargetResolver.ts` (`buildActiveWorkSites`)
- **What happens:**
  1. **Scalar ground bounce plane:** each active work emitter samples `terrain.heightAt(tx, tz)` once per frame at the target cut point (`site.groundY`) and bounces all 100 instanced 3D debris chunks against that horizontal plane (`groundY + baseScale * 0.35`) rather than querying `terrain.heightAt(px, pz)` per particle per frame. On steeply sloped hex edges a chunk that skitters > 1 m upslope can clip slightly into the slope, or hover a few centimetres downslope before fading out.
  2. **CPU mirror of GPU vertex animation for hand-locked tool beams (`RND-04`):** because robot limb kinematics (`BipedArm 5` + `BipedBody 8`, `SpinY 1`, `HoverBob 2`, `RecoilPulse 3`) are evaluated on the GPU in `UnifierShader.ts`, `frontend/render/particles/toolOrigins.ts` mirrors the exact shader math on the CPU (`evalArchetypeToolOrigins` / `computeMeshToolOrigins`) so dual cutter lasers on `robot.hero` (HQ bot) originate strictly from the animated left and right hands (with glowing palm muzzle orbs) and drills/torches/barrels on `robot.miner`, `robot.builder`, and `robot.combat` stay locked to their animated tips.
  3. **Prop-instance target resolution across 1–2 hexes (`2m–4m`):** when a worker operates from 1–2 hexes away, `workTargetResolver.ts` queries `terrain.props.instancesForTile(targetTileIndex)` and snaps the laser cut point and 3D particle fountain to the nearest actual tree/rock/deposit prop instance (or tile center) with a 360° radial debris splash around the object rather than spraying backward into the bot.
- **Why:** keeps per-emitter CPU stepping at ~100 simple arithmetic ops per frame + 1 lightweight analytical pose evaluation per active worker instead of GPU readbacks or 100 hex-height lookups per worker per frame.
- **To resolve:** if upslope clipping is noticeable on steep ridges, sample `terrain.heightAt(px, pz)` only on frames where `py < groundY + 0.4`; if a new `aPartAnim` channel is added to `UnifierShader.ts` for a tool-bearing limb, mirror its formula in `toolOrigins.ts`.
- **Found:** 2026-11-02, object-driven 3D work particles & hand-locked HQ lasers

### RN-33 · Hex grid lines are the only "prepared" cue, and they also show on uneven Prepared tiles and deposits

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/chunkMesh.ts` (`isFlatBuildable`: `isClearedPrep ||`, `hasDeposit ||`), `shared/sim/src/systems/terraform-basic/workTile.ts` (uneven Prepared is re-workable)
- **What happens:** with the pad gone (RN-29) the grid lines are the only hint that a hex is buildable. A Prepared tile that is uneven still gets the grid although the sim treats it as re-workable, and deposits get the grid although only deposit buildings may stand there.
- **Why it is like this:** kept on purpose during the terraform rework review; changing it hides the grid on tiles players already see it on.
- **To resolve:** decide whether the grid should mean "buildable now"; if so drop both shortcuts and let the build ghost carry the deposit rule.
- **Found:** 2026-11-02, terraform rework review

### RN-34 · A reseed to another planet type at the same radius keeps the old terrain look

- **Status:** Resolved (W02 audit 2026-11-02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts` (`onTiles`), `frontend/render/planets/hex/createHexTerrain.ts` (`look.kind`, `uKind`)
- **What happens:** the hex terrain was only recreated when the radius changed; a dev `seed` to another planet type with the same radius kept the previous `look.kind` for the tint table and `uKind`.
- **Fix:** `OnlineSession.onTiles` resolves `look = resolveOnlinePlanetLook(v.planet.type, this.planetKind)` up front and recreates the `HexTerrain` (and applies the new sky look) whenever `this.biomeKey !== look.biomeKey`.
- **Found:** 2026-11-02, terraform rework review

### RN-35 · Viewport tile updates: one rebuild per snapshot, richness only by visual stage

- **Status:** Resolved (terraform rework review 2026-11-02)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/viewportHelper.ts` (`applyTerrainTileChanges`, `changedTiles`), `frontend/render/planets/hex/hexEdges.ts` (shore beach)
- **What happened:** with ≤ 16 changed tiles each tile went through `setTileState` (a full planet rebuild each, writing into the previous snapshot's layers) before the final `updateTiles`: up to 17 rebuilds per snapshot. `changedTiles` compared raw `richness`, which a working harvester drains every tick, so every snapshot rebuilt chunks, props and borders near it. Shore cells showed a sand ring with a green hexagon inside.
- **Fix:** a single `updateTiles(nextTiles, changed)`; richness compared by `getDepositVisualStage`; a `depositTier`-only change still triggers; the beach is one continuous noise-edged strip. Tests in `viewportHelper.spec.ts`, `hexUpdates.spec.ts`.
- **Found:** 2026-11-02, terraform rework review


## Water, wind and F8 WIND / WATER tabs (2026-11-02)

### RN-36 · Waves are per-pixel below ~8 m; the water mesh only carries the long swell

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/water/glsl/waves.ts` (`waterSwellHeight`, `waterWaves`), `frontend/render/planets/hex/hexWater.ts` (one vertex per tile centre, 2 m apart)
- **What happens:** the Gerstner sum has four wind-driven components (9, 5.2, 3.1, 1.8 m × `waveScale`). Only components ≥ ~8 m move vertices (soft-clamped to ±0.12 m, shores pinned); the shorter ones and the ripples exist only in the normals, so silhouettes at the shore never show small waves.
- **Why it is like this:** the hex water mesh is rebuilt on terraform and has a 2 m lattice; subdividing it costs geometry for a barely visible gain at the diorama distance.
- **To resolve:** a finer, camera-local water grid (or tessellated shore strips) if close-up shots need geometric chop.
- **Found:** 2026-11-02, water rework (lead)

### RN-37 · Stylised choices in the water lighting

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/water/glsl/reflections.ts`, `glsl/stages.ts` (`FRAG_EMISSIVE`, `FRAG_OUTPUT`), `glsl/bed.ts`, `frontend/render/visuals/terrain/terrainShader.ts` (bed tint before `roughnessmap_fragment`)
- **What happens:** (1) Projector (bot lamp) reflections use a widened lobe and a Fresnel floor of 0.4, so lamps read as glitter on the water even though physically almost nothing would reflect at the diorama angle; a lamp that faces away from the camera still reflects nothing. (2) The extra sun glint is emissive, so it is not darkened by cast shadows. (3) The ground under the water is tinted per channel by the terrain shader (Beer-Lambert on its real depth), because the alpha-blended surface can only fade it with one scalar; bed tint and surface use the same extinction and `uAbsorption`, but the surface's depth comes from the baked bed field (R channel), the tint from the terrain's own height, so they can differ by a few cm. (4) Absorption, foam and caustic strengths are single values tuned on oceanForest.
- **Why it is like this:** one pass, no reflection/refraction render targets (GPU budget); readability over physics for the lamps.
- **Workaround / mitigation:** every strength is an F8 → WATER slider (`projectorReflect`, `sunGlint`, `absorption`, …).
- **To resolve:** per-biome water presets if forestRock lakes need a different look.
- **Found:** 2026-11-02, water rework (lead, browser check)

### RN-38 · Water fauna: re-placed on every water rebuild, sparse in small lakes

- **Status:** Open (wave-depth, jellyfish and "drawn above the water" parts resolved 2026-11-02, follow-ups)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/water/fauna/` (`faunaPlacement.ts`, `jellyPlacement.ts`, `faunaSink.ts`, `faunaWater.ts`, `fishMaterial.ts`, `jellyMaterial.ts`), `frontend/render/visuals/water/glsl/surface.ts` (alpha cap), `frontend/render/planets/hex/hexWater.ts`
- **What happens:** (1) fish and jelly loops are placed from the seed and the shore field, so every terraform that changes water tiles re-places all of them (they jump). (2) The whole wave sink (`FAUNA_SINK_MAX` = 0.15 m) is budgeted against the bed, so shallow-only lakes (bed −0.55 m) get no fish and jellies need ≥ 1.1 m of water; the w02 scenario lake has 8 fish. (3) To keep fauna visible under the surface, the water's alpha is capped at 0.8 (was 0.95), so 20 % of the (terrain-tinted, dark) bed shows through even the deepest water.
- **Fixed in the follow-ups:** fauna depth follows the waves (an eased `uFaunaSink` = deepest swell trough for the gusty wind × `waveHeight`, `waveScale`, from the shared `waveModel.ts`); bioluminescent jellyfish (≤ 24, deep water, one draw call). The fauna first read as drawn on top of the water (it was drawn after the surface): it is now drawn before the surface again, so the surface's alpha, foam, glints and caustic lines lie over it, and its image wobbles with the waves above (refraction shift against the Gerstner slope, `faunaWater.ts`).
- **To resolve:** keep placements whose loops are still valid across rebuilds.
- **Found:** 2026-11-02, water rework (fauna agent; follow-ups by the lead)

### RN-39 · Wind is global and partly static

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/core/windConfig.ts`, `frontend/render/planets/hex/hexAmbient.ts`, `frontend/render/planets/surface/biomes/dune.ts`, `frontend/render/visuals/terrain/heightfields.ts`
- **What happens:** (1) On the prototype surfaces (`?planet=…` heightfield) the dune ripple geometry and shading keep the seeded `field.wind`; only dust, trees and waves follow F8 wind there (on the hex planet the ripples follow it too). (2) Hex ambient particles fly at 0..12–16 m absolute height and pass through higher mesas. (3) `uWindPhase` / `uWindDrift` grow without bound; float precision drifts after many hours of play. (4) ~~Sway frequency follows the global strength~~ superseded 2026-11-03: each tree has its own frequency (size + hash) and reacts to the local gust with a lag (RN-45). (5) The landing page's planet cards use their own renderer, so the wind clock does not tick there. (6) The F8 compass is in world terms (right = +X, down = +Z), it does not turn with the camera. (7) Two more real-time clocks grow without bound: `uWindTime` (`windConfig.ts` `tickWindClock`, `+= dt`) and `uWaterTime` (`visuals/water/waterConfig.ts` `tickWaterClock`, `+= dt × waveSpeed`), read by the Gerstner phase (`waterWaves`), foam and ripples; the same float-precision drift applies after many hours (added 2026-11-03, W02 review round 1, render agent).
- **To resolve:** wrap phase/drift (and `uWindTime` / `uWaterTime`, modulo a period that is a whole number of every wave / foam period, or by re-basing all phases together) in `tickWindClock` / `tickWaterClock`; height-follow the ambient layer (sample `heightAt` in a small texture) if mesas look wrong.
- **Found:** 2026-11-02, water rework (wind agent)

### RN-40 · Night lighting: two dim night keys, fixed moon direction

- **Status:** Question for the owner (night "second sun" bug resolved in the same change, d6d63a7)
- **Severity:** low
- **Confidence:** CONFIRMED (browser check, oceanForest `?host=local`, 00:10 / 18:30 / 12:00)
- **Area / code:** `frontend/render/core/shadowConfig.ts` (`applyShadowSourceMode`, mode 0), `frontend/render/core/dayNightConfig.ts` (`computeSolarState`, `computeMoonMults`)
- **What happened:** in shadow source mode 0 the secondary "moon" directional jumped at the horizon to the full `secondaryIntensity` (1.35, 60 % of the noon sun) with `nightShadowIntensity` (0.72) shadows, from a fixed −55° / 38° direction, and `NIGHT MOONLIGHT` never reached it, so night looked like a blue day with crisp shadows. It now blends continuously (by `1 − daylight`) from the unchanged day fill (18 % light, 15 % shadow) to a dim moon driven by `nightBrightness` (≈0.13 light, ≈0.09 shadow at 12 %).
- **Still open:** (1) the sun light keeps its own dim night key (`nightKey`, ≈0.06, shadow ≈0.06, shallow 14–32° "moonlight" angle), so two faint night sources with different directions remain; both are near-invisible at the default. (2) The moon has a fixed azimuth/elevation (lab sliders), no arc over the night. (3) Modes 1 and 2 still use the full `secondaryIntensity` at night (explicit lab choices). (4) The night is now very dark outside projector cones; in the check only the commander drone's headlight lit the ground; the landed pod showed no visible light pool (before and after this change, so not caused by it; projector rigs: `EntityProjectorRig.ts`, `archetypeLights.ts`).
- **To resolve:** decide whether the sun should drop to 0 below the horizon in mode 0 (the moon is then the only night key), and whether the moon should arc with the clock.
- **Found:** 2026-11-03, night lighting fix (render agent)

## Orbital deploy: space hardware vs colony lighting (2026-11-03)

### RN-41 · Colony FoV shroud / night factor / projectors are global and reach space hardware

- **Status:** Resolved (d6d63a7, 2026-11-03: space-phase / descent gate + eased hand-over; see **Fix** below)
- **Severity:** high (before the mitigation: carrier and pod rendered as near-black silhouettes at "Bay open — pod clamps releasing")
- **Confidence:** CONFIRMED (browser: stage carrier/pod program uniforms; zeroing the vision map with `uFovEnabled = 1` reproduces the user screenshot, `setSpaceLit(false)` brings it back)
- **Area / code:** `frontend/render/lighting/ColonyVisionAndLights.ts` (`sharedUniforms`, `applyColonyFovShroud`), `frontend/render/visuals/UnifiedColonyMaterial.ts` (`onBeforeCompile` assigns the shared uniforms to every Unified material), `frontend/game/app/online/EntityMeshes.ts` (`syncVisionAndForeignVisibility`), `frontend/game/app/online/entityVisionSync.ts` (`fovEnabled: Boolean(terrain)`); mitigation in `frontend/render/visuals/space/spaceLighting.ts` + `placeholders.ts` (`acquireModel(..., { spaceLit })`, `FittedModel.setSpaceLit`)
- **What happens:** the online session is created at DEPLOY and syncs colony vision as soon as it has terrain, with no gate on the space phase. The shroud keys on world xz of whatever scene renders a Unified material, so the orbital stage's carrier/pod (stage coordinates) and the descent pod (≈90 m off the colony in xz, 580 m up) fall "outside vision" and are dimmed to ≈ 5 % + desaturated; `uNightFactor` also kills their rim light. Whether it shows depends on how fast the session gets its first view (not reproduced on every run).
- **Mitigation:** stage carrier, satellites and the drop-rig pod are acquired with `spaceLit: true`: their materials read 0 for `uFovEnabled`, `uNightFactor`, `uProjectorCount`, `uVisionSourceCount` (same GLSL, one extra cached program). The descent pod keeps that through touchdown.
- **Fix:** `EntityMeshes.syncVisionAndForeignVisibility` passes `colonyActive: !podTouchdown.isSpacePhaseActive() && !isSceneInDescent(scene)` (`dayNightConfig.ts`, direct-child check of `descent:root`); while it is false `syncColonyVisionAndProjectors` (`entityVisionSync.ts`) holds the shroud, night factor, vision sources and projectors at 0, then eases them in over `COLONY_FADE_IN_S` = 0.8 s (`setColonyLightingBlend` in `ColonyVisionAndLights.ts`; `uFovEnabled` is now a 0..1 shroud strength and `applyDayNightAtmosphere` scales its `uNightFactor` write by the same blend, so the two writers no longer fight). Browser: at "CHUTE JETTISONED — TERMINAL APPROACH VECTOR" (`?planet=oceanForest&deploy=1`, online and `?host=local`) every ground material reads `uFovEnabled` 0 / `uNightFactor` 0 and props are lit; after the hand-over both rise monotonically 0.3 → 1 (day and 00:10 night landings). The pod-`setSpaceLit(false)` item is moot: the descent pod is removed with `descent:root` at hand-over and the colony pod entity is a normal (not space-lit) mesh.
- **Before the fix, to resolve:** (1) gate the vision sync on the space phase (hold `fovEnabled`/`nightFactor` at 0 or call `resetColonyVisionAndLights()` until touchdown) in `EntityMeshes`/`entityVisionSync`; (2) `DescentRunner` now passes `{ spaceLit: true }` for its carrier (done 2026-11-03); still open: call `rig.pod.setSpaceLit(false)` when the pod stands in the colony (touchdown) so the landed pod follows night/FoV again.
- **Found:** 2026-11-03, orbital deploy visual bugs (render agent)

### RN-42 · Descent key light ignores the descent sun direction

- **Status:** Resolved (d6d63a7, 2026-11-03): `setDescentSunDirection(vp, ctx.sunDir)` (`shadowConfig.ts`) is set by `DescentRunner` and cleared in `restoreAndCleanup`; while the descent renders `followShadowTarget` places the key light along it (browser at tn 30.6: `vp.sun` direction (0.50, 0.79, 0.36) = `ctx.sunDir`). Still open: the descent ignores the planet clock, so a night landing cuts from a sunlit descent to the night colony at hand-over.
- **Severity:** medium
- **Confidence:** CONFIRMED (browser, `?planet=oceanForest&deploy=1`, tn ≈ 9–10: `vp.sun` direction (−0.44, 0.53, −0.73) vs `ctx.sunDir` (0.50, 0.79, 0.36))
- **Area / code:** `frontend/render/core/shadowConfig.ts` (`followShadowTarget` → `computeSunOffset(undefined)` uses the day/night solar clock; `fitShadowToView` re-places the sun every rendered frame), `frontend/game/descent/parts/SkyRig.ts` (`viewport.followShadow(podCenter)`), `frontend/game/descent/DescentRunner.ts` (`sunDir = (35, 55, 25)`)
- **What happens:** during the descent the globe, backdrop, cloud deck and canopy are lit from `ctx.sunDir`, but the directional key light is placed from the planet's time of day, so the pod can be back-lit (dark side towards the camera) while the planet under it is in full sun.
- **To resolve:** in `followShadowTarget`, when `isViewportInDescent(vp)`, place the sun along the descent's sun direction (e.g. a `setDescentSunDir(vp, dir)` the `SkyRig` calls once, or `computeSunOffset(out, params)` with the planet-look default angles) instead of the solar-clock angles.
- **Found:** 2026-11-03, orbital deploy visual bugs (render agent)

### RN-43 · Drop pod carries two heat shields

- **Status:** Resolved (d6d63a7, 2026-11-03 pod-base fit change); one open question below
- **Severity:** low
- **Area / code:** `frontend/render/descent/dropRig.ts` (`SHIELD_PROFILE`, `HULL_R`, `setShieldAttached`, `setLegDeploy`), `frontend/render/descent/podGear.ts`, `frontend/game/descent/parts/HeatShield.ts`, `frontend/render/kitbash/archetypes/units/ships.ts` (`podShell` shield + rim band, landing legs; unchanged)
- **What happened:** the rig's shield (first a 3.6 m black half-sphere sized from the leg bbox, then a r 1.37 skin) sat over the archetype's own shield (r 1.32) and orange rim band (r 1.34), all wider than the petal cone (r 1.25), so the base read as a separate plate glued under the pod, with the splayed legs and foot pads poking out. The fitted root was also centred on the leg-skewed bbox, 0.25 m off the hull axis, so shield, bay ring and clamp arms were off-centre; the jettisoned copy spawned 1.9 m below the pod (`podBase − podH/2`).
- **Now:** while attached, `podGear` skips the archetype's shield + rim band with a draw range and the rig shield hugs the cone (r 1.26, ≈ 1 cm seam, top tucked inside the petals); the pod axis sits on the rig origin; the legs are retracted into their hull hinges. At tn 23 the free copy separates from exactly where it sat (pod pose at 23 s), the built-in base comes back (matching the landed colony pod) and the legs extend over tn 24.5–27.5. Checked in the browser: freefall close-ups, reentry glow (tn 21), separation (tn 23.0 / 24.0), legs out under the chute (tn 28.5), stage hold.
- **Still open:** after the jettison the built-in base (r 1.32 shield + r 1.34 band) is ~8 cm wider than the jettisoned cover, the reverse of a real capsule. Decide whether the archetype's base should be slimmed to the cone (a kitbash change in `ships.ts` that also changes the landed pod; needs `validate:models -- ship.dropPod`) or kept as is.
- **Found:** 2026-11-03, orbital deploy visual bugs (render agent)

### RN-44 · Drop pod has no projector lights

- **Status:** Accepted (owner decision, 2026-11-03)
- **Severity:** low
- **Confidence:** CONFIRMED (browser: orbit bay, freefall, `/playground.html?inspect=ship.dropPod&lights=1` shows 0 sources; night `?host=local&scenario=w02` / `?scenario=w02`: 4 Command Hub ground pools, `uProjectorCount = 5`)
- **Area / code:** `frontend/render/lighting/archetypeLights.ts` (`'ship.dropPod': []`), `frontend/game/app/online/entityVisionSync.ts`
- **What happens:** the pod lost its 4 warm corner projectors everywhere (orbit bay, descent, landed pod; mesh rig and GPU colony projectors read the same list). A night landing (e.g. `?host=local&scenario=w01` at 00:10) therefore has `uProjectorCount = 0` until the HQ leaves the pod; the site is lit only by the HQ headlight and, later, building floodlights. Supersedes the `dropPod` mention in RN-26.
- **To resolve:** if a dark night landing site reads badly, give the landed pod one dim light (authored live in the playground LIGHTS editor) without bringing back the descent cones.
- **Found:** 2026-11-03, descent visual bugs (lighting agent)

## Rendering optimisation and per-tree wind (2026-11-03)

### RN-45 · Per-tree wind sway is an imitation of inertia, not a simulation

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/visuals/terrain/Scatter.ts` (`FOLIAGE_SWAY_BEGIN`, `FOLIAGE_TREE`, `foliageTreeTraits`)
- **What happens:** each tree's frequency (≈ 1/√height ± 20 %), mass, phase, lean tilt and orbit come from a hash of its position and its instance height; inertia is two gust samples downwind of the tree (the gust that already passed), their mean drives the lean and their difference the overshoot. There is no per-tree state, so it is not a real spring–damper. The lag is in metres (gust-front travel), so its time lag shrinks as the wind strengthens. Trait sizes assume the ~5 m tree geometry (crown mask 1.2–4.5 m in model units). Tree bounds are padded by `PROP_BOUNDS_PAD` = 2 m for the sway (`planets/hex/propBuckets.ts`; was 0.75 m until 2f1f2c1: a ~5.9 m pine moves ~0.6 m at the default wind but ~1.9 m at the slider maxima, strength 2 / gust 1, so crowns of corner trees popped at the screen edge; calculated, not measured against a gale).
- **To resolve:** a per-instance spring state in a small texture updated on the GPU, if the owner wants true settling.
- **Found:** 2026-11-03, tree wind rework

### RN-46 · View focus: effects restricted to the visible ground (padded footprint quad since RN-52), global state, flat-ground assumption

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/core/viewFocus.ts`, `core/shadowFit.ts`, `planets/hex/propBuckets.ts`, `lighting/ColonyVisionAndLights.ts` (`selectFocusedProjectors`), `game/app/online/entityVisionSync.ts`, `visuals/water/fauna/faunaBounds.ts`, `planets/hex/hexAmbient.ts`
- **What happens:** per frame the camera's ground footprint (plane at min(0, target y)) is the "view focus": since RN-52 the footprint quad × margin (default 1.0) + 4 m inside a bounding circle (≤ 220 m); before, the circle around it × 1.5. Props are split into 32 m (trees) / 64 m (rocks, deposits) instanced buckets that three frustum-culls and that are hidden outside the focus; the sun / night shadow boxes fit the visible radius × 1.25 (stepped, clamped to [max(12 m, `frustumSize`/2.5), `frustumSize`], blur scaled so softness stays the same); only projectors touching the focus are uploaded (nearest 32 of up to 256); trees outside it stop swaying; fauna and the ambient layer are bounded / follow it. Trade-offs: (1) draw calls ≈ 2.7× (≈ 310 on the radius-56 planet) for ≈ 32 % fewer triangles; (2) ~~a tree just outside the focus casts no shadow, so a very long low-sun shadow from beyond ~0.5× the visible radius can be missing~~ props off the focus whose shadow reaches it are drawn in the shadow passes since RN-51 (units / buildings still rely on the fitted shadow camera only); (3) the focus is one global (pages with several viewports share the last rendered camera's), prop / fauna culling and the projector list use the previous frame's focus (covered by the margin); (4) the F8 `frustumSize` slider is now the maximum shadow box; (5) basins far below 0 m could make the focus slightly small; (6) ~~fauna has one box for all lakes~~ fauna and the water surface are bucketed per 64 m / 32 m cell since RN-49. `?focus=0` turns it all off for comparison.
- **Measured:** real Chrome on the owner's machine, w02 scenario, 2992×1702: 32–35 FPS with the focus on vs 26 with it off. Headless A/B on the radius-56 planet: frame time −20 % (upper bound). At the default camera on the small w02 map everything is on screen, so most of the gain is on bigger maps and zoomed-in views.
- **To resolve:** per-viewport focus if a page ever renders two colony views. (Per-cell fauna bounds: done, RN-49.)
- **Found:** 2026-11-03, rendering optimisation

### RN-47 · Frame time is dominated by fill rate (DPR 2), not by off-screen work

- **Status:** Resolved (F8 → PERF, 2026-11-03; see RN-50)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/core/createColonyViewport.ts` (`maxDpr = min(devicePixelRatio, 2)`), `core/perfConfig.ts`, `core/shadowConfig.ts` (secondary shadow)
- **What happens:** at 1920×1080 CSS on a DPR-2 display the canvas is 8.3 M pixels, each running the terrain / unified shader and two soft-shadow lookups (~41 texture fetches). Measured (headless ANGLE Metal, A/B in one page): ~80 % of the frame scales with resolution; DPR 1.5 saves ~32 % (day 5 ms, night 7.7 ms per frame), DPR 1 ~58 %; shadows cost 25–30 % (of which the daytime secondary "moon" shadow, at 0.108 intensity, 1.4–2.1 ms); bloom, water, props, particles, FoV shroud ≈ noise at the default camera.
- **Why it is like this:** the look was tuned at native DPR; lowering resolution or dropping the faint daytime secondary shadow changes the look, so it was not done without the owner.
- **To resolve (recommendation):** cap the default DPR at 1.5 (or an F8 / settings render-scale, or adaptive resolution that drops to 1.5 when frame time > 20 ms); skip the secondary shadow map by day (fade its intensity, keep `castShadow` on to avoid a ~30-program recompile at dusk, and skip its map render instead).
- **Found:** 2026-11-03, rendering optimisation (perf agent)
- **Fix:** both recommendations are in F8 → `PERF` (2026-11-03, d6d63a7): render scale AUTO (dynamic resolution, default) or fixed 1 / 1.25 / 1.5 / 2, and the daytime secondary shadow faded out by day with its map frozen and its taps skipped. Remaining trade-offs: RN-50.

### RN-50 · F8 → PERF: dynamic resolution, daytime secondary shadow skip, focus margin / ring (trade-offs)

- **Status:** Open (defaults picked by the perf agent; owner to confirm)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/core/perfConfig.ts` (PERF store), `core/adaptiveScale.ts`, `core/renderScale.ts`, `core/createColonyViewport.ts` (`resize()`), `core/shadowConfig.ts` + `core/shadowFit.ts` (`daySecondaryShadowFade`), `core/shadowShaderPatch.ts` (tap skip), `core/viewFocus.ts` (margin, freeze), `core/viewFocusRing.ts`
- **What happens / trade-offs:**
  1. **AUTO is the default**, so a slow machine now renders below native DPR (softer image) without being asked. It steps 2 → 1.75 → 1.5 → 1.25 → 1 on 1 s of slow frames and back on 3 s of fast ones (since RN-52 relative to the display refresh: > 1.12 × / < 1.04 × the refresh interval; before, > 18 ms / < 12 ms, i.e. a 60 FPS budget). It measures rAF intervals, so it cannot tell a GPU-bound frame from a CPU-bound one (sim, path-finding, GC): a CPU-bound stretch also lowers the resolution, which does not help (it recovers once frames are fast again). The scene build / shader compiles after load and the descent → colony hand-off are slow stretches too (100–250 ms frames count as 100 ms), so AUTO may start a level or two down and climb back at 3 s per level.
  2. On a vsync-locked 60 Hz display a frame is never < 12 ms, so "fast" there means within 4 % of the refresh interval; a step up is then a probe that costs ~1 s of slow frames if the level is too heavy, retried after 3 → 6 → … ≤ 60 s. Displays slower than ~59 Hz are not recognised (their frames count as slow).
  3. **Daytime secondary shadow OFF by default** changes the look by day: the faint (0.108) secondary "moon" shadow is gone while `1 − daylight` < 0.02 and fades back in up to 0.5. With day/night off (playground, `?daynight=0`) it counts as day, so the playground loses it too. Only shadow source mode 0 is affected (modes 1–3 are explicit choices). The shader patch now skips the taps of every directional light whose shadow intensity is 0 (identical output, a uniform branch).
  4. The focus ring is the computed circle on the flat focus plane (min(0, target y)), drawn on top of everything, not draped on relief. It encloses the screen by construction, so `focusRing=2` (freeze) is the way to see it; while frozen, everything focus-limited (incl. the shadow box) stays at the frozen place.
  5. `perfTelemetry` and the focus are global (last rendered viewport wins), like RN-46.
  6. Focus margin on the small w02 map changes nothing (everything is on screen); on w01 the 1.0 / 1.5 / 2.5 A/B was within the ±2 ms run-to-run noise of headless timing. ~~so the default stays 1.5~~ Default 1.0 (on the footprint quad) since RN-52.
- **Measured (headless Chromium ANGLE Metal, 1920×1080 CSS at DPR 2 = 3840×2160 canvas, vsync off, paired A/B medians):** PERF ON (AUTO) vs OFF −4.1 to −5.7 ms per frame (−23 to −27 %; AUTO settled at ×1.5–1.75) on w02 / w01, day and night; daytime secondary shadow skip −1.1 to −3.4 ms by day, 0 ± 1.5 ms (noise) at night as intended; focus margin 1.0 vs 1.5 vs 2.5 within noise. Headless timing on a GPU shared with other agents' benches is ±2 ms; no shader recompiles across a full day cycle (32 programs before / after).
- **To resolve:** owner decides the defaults (AUTO vs fixed 1.5; daytime secondary shadow off vs on). A GPU timer query (`EXT_disjoint_timer_query_webgl2`, where available) would let AUTO react to GPU time only.
- **Found:** 2026-11-03, PERF tab (perf agent 2)

### RN-52 · Shadow filter early-out, one shadow light at night, AUTO aims at the display rate, footprint-quad focus

- **Status:** Open (defaults picked 2026-11-03 on the owner's "do it"; owner to confirm in play)
- **Severity:** low
- **Confidence:** CONFIRMED (headless measurements); the owner's in-browser FPS is not reproduced (see 5)
- **Area / code:** `frontend/render/core/shadowShaderPatch.ts` (`taSampleShadowSoft` early-out), `core/shadowConfig.ts` + `core/shadowFit.ts` (`nightSunShadowFade`), `core/perfConfig.ts` (`targetFps`, `nightSunShadow`, store v2), `core/displayRefresh.ts`, `core/adaptiveScale.ts`, `core/renderScale.ts`, `core/viewFocus.ts` (quad, `uViewFocusEdges`), `core/viewFocusRing.ts`
- **Why:** the owner could not hold 120 FPS and saw trees / water animating past the screen. Measured first (headless Chromium ANGLE Metal, 3840×2160 canvas, vsync off, one page, each toggle 3× interleaved, GPU-synced `readPixels` around `composer.render`): day 7.9 ms, night 9.2 ms; shadows off −0.8 / −1.8 ms, a 1-read hard shadow −0.7 / −1.6 ms (so ~90 % of the shadow cost was the 41-read soft filter per pixel per light, not the shadow-map render); bloom −0.4 / −0.5 ms; hiding all props, all water or all entities: 0 ± 0.2 ms (off-screen work costs nothing measurable; it was already culled). Two lights cast shadows at night (the sun's residual ~0.06 shadow + the moon's ~0.085). CPU per frame ≈ 1.8 ms (canvas shrunk to 320×180): the frame is fill-bound.
- **What changed:**
  1. **Soft shadow early-out:** when all 5 blocker probes agree (lit / deep shadow) the filter returns 1 / 0 without its 36 reads; only penumbrae filter. The final `smoothstep(0.08, 0.92, s)` already mapped those pixels to 1 / 0; a sub-texel acne gap (< 4e-5 depth) at the centre probe no longer darkens lit pixels.
  2. **Night sun shadow off (F8 → PERF → NIGHT SUN SHADOW, default OFF):** in shadow mode 0 the sun shadow intensity × (1 − smoothstep(0.6, 0.95, 1 − daylight)) (~18:00 → ~19:00), and its map stops re-rendering at 0 (`castShadow` untouched, no recompile). At night only the moon casts.
  3. **AUTO aims at the display:** thresholds are 1.12 × / 1.04 × the refresh interval from a page-lifetime rAF probe (clamped to [8.33 ms = 120 FPS, 17 ms]); F8 → PERF → AUTO TARGET FPS / `?fps=` forces 60 or 120.
  4. **Focus = footprint quad:** the four screen-corner ground hits, scaled about their centre by the margin (default now 1.0) and padded 4 m; the shaders (`viewFocusWeight`) and `inViewFocus` (lights, entities, work particles, prop / water / fauna buckets) test circle ∩ quad. The prop per-instance compaction (RN-51) and the shadow box fit still use the bounding circle.
- **Measured after (same harness, same page):** day 7.9 → 7.4 ms, night 9.2 → 7.7 ms (−16 %); shadow cost day 0.8 → 0.2 ms, night 1.8 → 0.4 ms. Frame pacing with AUTO (rAF, vsync off): night median 8.1 → 6.1 ms, frames over 8.33 ms 34 % → 9 %; day 8 % (unchanged). Screens: shadows / focus quad / night checked by eye, no shader errors.
- **Trade-offs / open:**
  1. Margin 1.0 + 4 m: things just past the screen edge are still (sway / waves fade in over the shader fade, 16 m trees / 12 m water, so a fast pan can show a tree "waking up" at the edge); a tree taller than ~4 m whose base is below the bottom edge sways with reduced amplitude. Raise FOCUS MARGIN if it shows.
  2. The tree shadow-map program ignores the focus (`TA_FOCUS_SHADOW_PASS`: weight 1), so an off-screen tree whose shadow falls on screen keeps swaying in its shadow; which casters enter the shadow pass is still the CPU's choice (RN-51).
  3. The refresh probe needs ≥ 2 refresh-length frames in some block of 8; a 120 Hz screen that is GPU-bound from the first frame (never presents at 8.3 ms) reads as slower, so AUTO aims too low; then set AUTO TARGET FPS = 120. 144 / 240 Hz screens are held at 120.
  4. Night look: the faint sun shadow is gone at night (moon shadow kept); dusk / dawn unchanged.
  5. ~8 % of frames still take ~2× the median in headless (bimodal 6 / 12–13 ms, at every resolution above tiny, none at 320×180, no long tasks): GPU back-pressure of the uncapped headless pipeline is the likely cause; not verified on a vsync-locked screen. The owner's earlier 32–35 FPS (2992×1702, live planet) is far below the headless numbers on the same machine (~140 FPS): the difference (live planet size, online session, other tabs) is not reproduced; a PERF readout from the owner's session is needed.
  6. Bloom at half resolution (−0.2…0.3 ms expected) was not done (not asked for).
- **Found:** 2026-11-03, 120 FPS pass

## Off-screen work audit (2026-11-03)

### RN-51 · Per-instance prop culling to the view focus; entity / work-particle off-focus skip

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED (headless audit + frozen-frame pixel diffs)
- **Area / code:** `frontend/render/planets/hex/propFocusCompaction.ts` (+ `propBuckets.ts` `cullToFocus` / `pick`), `render/particles/WorkParticleSystem.ts`, `game/app/online/entityFocus.ts` (used by `EntityMeshes.update`, `entityVisionSync.ts`, `unitHealthBars.ts`)
- **Audit (headless Chromium ANGLE Metal, 3840×2160, one frame, every draw recorded per pass with its world bounds):** mesh-level culling was already clean (0 off-frustum draws in the colour pass; terrain chunks, entities, pod rig, hp bars, sky, water all frustum-culled; shadow passes cull against the view-fitted box). The waste was **inside** the prop buckets: a 32 m pine cell touching the focus drew all its trees. w01 zoomed in (focus r 22 m): 2211 of 3092 colour-pass tree instances (200k of 296k triangles) and 3045 of 3926 shadow-pass instances (278k of 381k) lay outside the focus. CPU per frame was negligible: `EntityMeshes.update` ≈ 0.08 ms, `terrain.tick` ≈ 0.04 ms (1–3 entities in w01/w02).
- **What changed:** a straddling bucket reorders its instance buffers into [in focus | shadow-only | culled]: the colour pass draws `count = nMain`, `onBeforeShadow` raises it to `nShadow` (off-focus trees whose shadow segment, height × cot(sun elevation) along each directional shadow light seen, clamped 60 m, reaches the focus) and `onAfterShadow` lowers it again. The bucket-level test is padded by the bucket's shadow reach, so buckets just off the focus can cast into it. Bounds stay the full set's; re-classified only when the focus leaves the classified circle (+ max(2 m, 8 % of the radius)) or a light turns > 1.5°; only the live prefix is uploaded. Picking maps instance ids through `placedIndex`. Work-particle emitters off the focus (+ 6 m) are hidden and not stepped (fading ones are dropped). Entities off the focus (+ 8 m) keep their pose / walk / work weights every frame but skip the shader clock + projector-rig power upload and the hp-bar layout; `mesh.visible` is untouched (vision sources and selection read it), so draw culling of entities stays three's frustum test.
- **Measured (same page, interleaved):** w01 zoomed in: triangles 677k → 252k per frame (colour 296k → 116k, shadow 381k → 136k), draws 126 → 112; w01 zoomed in, panned into forest: 375k → 218k; w01 default zoom: 1.17M → 1.10M; w02 zoomed in: 75k → 51k; w02 default zoom: unchanged (everything on screen). Frame time: no measurable change (vsync off, w01 zoomed in, static and panning: median 14.1 vs 13.9 ms / 12.9 vs 12.3 ms, within noise), because the frame is fill-bound (RN-47: DPR 2 → 1 on the same page 19.4 → 8.2 ms median; shadows on/off 12.2 → 11.2 ms). Frozen-time frames with the culling vs with every prop drawn are pixel-identical (zoomed in and default, low sun 6.5 h / 17.7 h, 6–10 pan steps with the real, stale classification, also after the full orbit → descent → colony flow).
- **Trade-offs:** (1) the colour pass culls to the focus circle, not the frustum: zoomed in ~75–90 % of the drawn tree instances are still off-frustum (inside the 1.5× circle; per-instance frustum culling would re-sort on every camera turn); (2) the classification slack keeps ~10–20 % of drawn instances just outside the focus; (3) spot/point shadow cameras get only the directional shadow-only set; (4) a bucket kept only for its shadow issues a 0-instance colour-pass draw; (5) the shadow reach uses the previous frame's light directions (first frame after load: every caster kept); (6) territory borders (1 mesh, ~500 triangles) and the sky dome were left as is (not measurable); (7) ~~`propBuckets.ts` still does not use `core/focusCull.ts`~~ resolved 2026-11-03 (it uses `worldCellKey`, `viewFocusBounded`, `sphereInViewFocus` with a shadow pad); (8) the instance world positions are cached per bucket and re-measured when the bucket's world translation changes (the space view offsets the terrain group, `syncSpaceTerrainOffset`; checked on the real `?planet=forestRock&deploy=1` flow); (9) dev only: a hot reload of `propFocusCompaction.ts` leaves an open tab with already compacted buckets it can no longer restore (some trees missing until a reload).
- **Found:** 2026-11-03, off-screen work audit (offscreen agent)

## HDR NaN → bloom black square (2026-11-03)

### RN-48 · One NaN pixel anywhere in the HDR pass becomes a ~1000 px black square

- **Status:** Open (the drop-pod case is fixed; the pipeline has no NaN guard)
- **Area / code:** `frontend/render/core/createColonyViewport.ts` (`UnrealBloomPass` → `OutputPass`), every HDR shader; fixed: `frontend/render/visuals/unified/shaderChunks.ts` (`FRAG_RIM` fresnel), `frontend/game/descent/fx/{Plasma,Flames,Streaks}.ts`
- **What happens:** the composer renders into a HalfFloat target. If a single fragment writes NaN (e.g. `pow(x, y)` with `x` a hair below 0), the bloom bright-pass passes it on, each of the 5 separable mip blurs spreads it over its kernel, the composite sums all levels and `OutputPass` shows NaN as black: an axis-aligned black square ~1100 px wide (2992 px canvas) for every frame the NaN pixel exists. In the descent the Unified material's fresnel `pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.2)` hit NaN on the drop pod's view-facing face (|dot| rounds to 1.0000001) around authored t ≈ 12.05 s, one or two frames, so the user saw "sometimes a black square behind the pod". Bloom off: the same frame shows one dark pixel only.
- **Why it is like this:** three's `UnrealBloomPass` has no NaN/Inf filter; any shader math that can go out of domain is a latent full-square flash.
- **Workaround / mitigation:** the known sites now clamp the `pow` base with `max(…, 0.0)`. The same unclamped pattern in `frontend/render/orbit/Moons.ts`, `frontend/render/planets/globe/surfaceFrag.ts` and `frontend/render/visuals/water/fauna/jellyMaterial.ts` was clamped too (2026-11-03, lead).
- **To resolve:** a NaN guard in the bloom bright-pass (replace non-finite texels with 0 before the blur, one `isnan`/`isinf` check per texel) so a future shader bug costs one pixel, not a square. (The three files above are already clamped; checked 2026-11-03, W02 review round 1. Another latent NaN source: RN-56.) Probe used: render the scene into a clone of `composer.renderTarget1`, `readRenderTargetPixels` as `Uint16Array`, count halves with exponent `0x7C00`, bisect visible meshes.
- **Found:** 2026-11-03, descent black-square bug (descent fx agent)

## Water culling (2026-11-03)

### RN-49 · Hex water: 32 m surface buckets, 64 m fauna cells, shader still-water fade off the view focus

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/waterBuckets.ts`, `planets/hex/hexWater.ts` (`HexWater.group` / `buckets` / `material` / `cullToFocus`, replacing `mesh`), `visuals/water/fauna/faunaBuckets.ts` (`WaterFauna.fish` / `jellies` are now arrays), `visuals/water/glsl/stages.ts` (`WATER_FOCUS_FADE`), `core/focusCull.ts`
- **What happens:** the hex water surface is one Mesh per 32 m cell with water (all on one material, so F8 / clocks stay shared); three frustum-culls them and `cullToFocus` hides cells off the view focus (unless the focus is clamped at 220 m). A water-tile change rebuilds only the cells around the changed tiles, but the shore field (512² bake) and the fauna placement are still rebuilt whole, as before. Fish and jellies are one InstancedMesh per 64 m cell. In the shader the swell, waves, ripples, caustics, crest foam, foam motion and glint sparkle are scaled by `viewFocusWeight(p, 12 m)` and skipped where it is 0 (amplitudes fade, clocks never do, so the edge does not pop or smear).
- **Trade-offs:** (1) more meshes: up to ≈ 48 surface buckets on a radius-56 planet instead of 1, but only the ones in view draw (headless w01: 3–7 draws / 307–795 of 2310 triangles instead of 1 draw / 2310; radius-56 ocean probe: 12.6 % / 31 % / 67 % of the water triangles at camera distance 20 / 50 / 95 m); (2) fauna: up to one draw per 64 m cell per kind instead of 2 in total; (3) vertices on cell borders are duplicated (seamless; everything is world-derived); (4) the shader fade only shows when the focus is capped (zoomed far out); the RTS camera's max zoom (95 m) keeps the whole planet in the focus on today's maps, so it is mostly a guard for bigger planets; (5) ~~`propBuckets.ts` still has its own copy of the cell key and the clamped-focus rule~~ resolved 2026-11-03, see RN-51 (7). (6) a water-tile change now disposes and recreates the fauna cell meshes (cloned ~40-triangle geometries + sliced instance buffers) instead of rewriting one set of buffers in place: a little GC churn when terraforming near water.
- **Measured:** frame time is not a meaningful number here (RN-47: fill-rate bound); the gain is submitted water triangles / vertex-shader work and per-lake fauna draws.
- **Found:** 2026-11-03, water culling (water agent)

## W02 review rounds 1–2 (2026-11-03)

### RN-53 · Spinners and recoil jump phase when the work weight changes

- **Status:** Open (latent)
- **Severity:** low
- **Confidence:** CONFIRMED (code); not visible yet
- **Area / code:** `frontend/render/visuals/unified/shaderChunks.ts:58` (`VERT_SUB_ANIM` type 1: `angle = hasBodyCarrier ? g * (1.0 + uWorkWeight) : uTime * (2.5 + 10.0 * uWorkWeight)`), `:69` (type 3: `recoilWave = sin(g * (1.0 + uWorkWeight) + pivot.x * 2.3)`)
- **What happens:** the work weight multiplies the clock instead of the speed. When `uWorkWeight` eases from 0 to 1 the phase is `t × (2.5 + 10 w)`, so after a few minutes of play (`uTime` in the hundreds of seconds) a 0.1 change of `w` jumps the drill / spinner angle by hundreds of radians within one ease, and recoil pulses fire in a burst. Today the weight eases at `dt × 10` (`EntityMeshes.update`), so the jump happens in a few frames and reads as a flicker of the spinning part; idle → work transitions are rare in W02.
- **Why it is like this:** the GPU animation is closed-form in time; there is no per-mesh integrated phase.
- **Workaround / mitigation:** none needed while gameplay changes the work weight rarely.
- **To resolve:** integrate a per-mesh `uWorkPhase` on the CPU (`phase += dt × (1 + w)` in `tickArchetypeMesh`) and use it in both branches, once gameplay drives the work weight often.
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-54 · Animation clocks disagree under dev warp: trees, fauna and units follow warp, waves, foam and wind do not

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/OnlineSession.ts:436-446` (`animDt = min(rawDt, 0.4) × max(1, warp)` → `entities.update(animDt, …)` and `terrain.tick(animDt)`), `frontend/render/planets/hex/createHexTerrain.ts` (`tick`: terrain / water `uTime`, `props.timeU`, `ambient.setTime`), `frontend/render/core/createColonyViewport.ts:207-208` (`tickWindClock()`, `tickWaterClock()` from `performance.now()`), `frontend/render/visuals/water/fauna/WaterFauna.ts` (fish / jellies read the water `uTime`)
- **What happens:** at `warp 10` tree sway (`props.timeU`), fish and jellyfish, the ambient dust layer and the units' shader animation (`EntityMeshes.time`) run 10× faster, while the waves, foam, ripples (`uWaterTime`) and the wind gusts / dune drift (`uWindPhase`, `uWindDrift`, `uWindTime`) keep real time. Trees therefore whip back and forth under a calm wind, and fish dart through slow waves.
- **Why it is like this:** the terrain clock was made to pause with the game (fauna "pause with the game") and follow warp; the wind and water clocks were added later as global real-time clocks ticked by the viewport so every 3D page animates.
- **Workaround / mitigation:** only with dev warp (`warp`, F8); at warp 1 all clocks agree.
- **To resolve:** pick one rule (recommendation: cosmetic loops in real time, sim-driven motion in game time) and feed `terrain.tick` the real `dt`, or scale `tickWindClock` / `tickWaterClock` by warp too.
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-55 · Hex ambient follow mode fixed at creation; a dune planet allocates water it never shows; fauna ignores WATER_QUALITY

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/planets/hex/hexAmbient.ts` (`createHexAmbient`: `follow = isViewFocusEnabled() && planetBox > AMBIENT_FOLLOW_BOX`), `frontend/render/planets/hex/hexWater.ts` (`createHexWater`: `createShoreField`, `createShoreFieldTexture`, `createWaterMaterial`, `createWaterFauna` before `hasWater = look.kind !== 'dune'`), `frontend/render/visuals/water/shoreField.ts` (`SHORE_FIELD_RES = 512`), `frontend/render/visuals/water/fauna/{fishMaterial,jellyMaterial,faunaWater}.ts`, `frontend/render/visuals/water/glsl/waves.ts` (`WATER_TIER_GLSL`)
- **What happens:**
  1. The ambient layer decides once, when the terrain is built, whether its wrap box follows the view focus (180 m box) or covers the planet. Toggling the focus later (`setViewFocusEnabled`, F8) does not switch it: with the focus turned on later the layer keeps the planet-sized box and its point count; turned off later, the 180 m box stays parked at the last focus.
  2. A dune planet has no water, but `createHexWater` still bakes the shore field object (512² × (bed f32 + distance f32 + mask u8) ≈ 2.4 MB) and its 512² RGBA half-float texture (≈ 2 MB), compiles the water material and creates the fish / jelly materials; only `rebuildAll` is skipped.
  3. The fish and jelly vertex shaders include `WATER_STAGE_COMMON_GLSL` for the refraction wobble (`faunaRefractShift` → `waterWaves`) but their materials never set the `WATER_QUALITY` define, so they always sum 4 waves (the HIGH default), also when the water surface runs LOW (2 waves): extra vertex ALU, and the wobble does not match the surface at lower tiers.
- **Why it is like this:** each part was written for the default case (focus on, water planets, HIGH quality).
- **Workaround / mitigation:** small costs: one ambient layer, ~4 MB on dune, a handful of fauna vertices.
- **To resolve:** (1) re-create (or re-size) the ambient layer when the focus is toggled; (2) return a no-op `HexWater` for dune (or create the field / fauna lazily on the first water tile); (3) pass the water material's `WATER_QUALITY` define to the fauna materials.
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-56 · Water fragment shader discards before it takes derivatives

- **Status:** Open (theoretical; needs a visual check after the fix)
- **Severity:** low
- **Confidence:** PLAUSIBLE (GLSL rule; no NaN observed)
- **Area / code:** `frontend/render/visuals/water/glsl/stages.ts:65` (`FRAG_FIELD`: `float waBank = waterHexClip(waP);`), `:69` (`FRAG_WAVES`: `waFootprint = length(fwidth(waP))`), `glsl/surface.ts` (`waterHexClip`: `if (inWaterHex < 0.5) discard;`), `glsl/foam.ts:13-14` (`dFdx` / `dFdy`), `glsl/reflections.ts:10` (`fwidth(Nw)`)
- **What happens:** `waterHexClip` discards fragments outside a water hex before `fwidth` / `dFdx` run. After a `discard` the derivatives of the helper lanes in the same 2×2 quad are undefined on some GPUs, so a pixel on a water edge can get a garbage or NaN footprint / normal derivative. The comment "derivatives stay in uniform control flow" is true for the `if (waFocus > 0.0)` block, but not with respect to the earlier discard. A NaN there would become the bloom black square of RN-48.
- **Why it is like this:** the hex clip was put first so off-hex fragments skip the wave math.
- **Workaround / mitigation:** none observed; most drivers keep helper lanes running after a discard.
- **To resolve:** make `waterHexClip` return a keep flag, take all derivatives first, and `discard` in `FRAG_OUTPUT` (or at least after the last derivative); then check the shore edges in the browser (`?host=local&scenario=w02`, oceanForest) with bloom on.
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-57 · Playground projectors: 32-light cap applied before the focus cull; rigs built twice per spawn

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/playground/content/SpawnSet.ts` (`syncProjectors`, `refreshLights`, `rebuild`), `frontend/render/lighting/ColonyVisionAndLights.ts` (`selectFocusedProjectors`, `MAX_COLONY_PROJECTORS = 32`), `frontend/render/kitbash/catalog.ts:168` (`createArchetypeMesh` → `attachEntityProjectorRig`), `frontend/render/lighting/EntityProjectorRig.ts` (constructor calls `rebuild()`; `updateEntityProjectorRig` version check)
- **What happens:**
  1. `syncProjectors` orders the spawns selected-first and stops at 32 lights before it calls `updateColonyProjectorsAndVision`, whose `selectFocusedProjectors` then culls to the view focus. In a full row (e.g. every building, 4 corner lights each) lights of on-screen models past the first 32 are dropped although off-screen ones were kept.
  2. Spawning builds every rig twice: `createArchetypeMesh` attaches a rig whose constructor runs `rebuild()`, then `SpawnSet.rebuild` → `refreshLights()` finds it and calls `rebuild()` again. On a LIGHTS edit the change listener rebuilds the rigs of that archetype; the per-frame version check in `updateEntityProjectorRig` would also do it, so one of the two mechanisms is redundant (no double rebuild per edit: the listener's `rebuild()` stores the new version first).
- **Why it is like this:** the playground cap predates the focus selection (RN-46 / RN-52); the listener predates the version check.
- **Workaround / mitigation:** playground only; inspecting a single model (`?inspect=<id>`) stays far below 32 lights.
- **To resolve:** pass every light (up to `MAX_PROJECTOR_CANDIDATES`) and let `selectFocusedProjectors` choose, keeping the selected model first on ties; skip `rebuild()` in `refreshLights` when the rig's `lightsVersion` is current (or drop the listener and rely on the version check).
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-58 · Particle validator checks less than the emitter draws

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/particles/validate/ParticleValidator.ts:86,110-111` (`spreadCone` range check), `:239-281` (`totalTriangles` budget), `frontend/render/particles/WorkParticleEmitter.ts:75-81` (`createLayer` age stagger), `:150-180` (beams, muzzle flares, impact flare, shock ring), `:225-275` (`spawnParticle`, `seedAllParticles`), `frontend/render/particles/types.ts:57`
- **What happens:**
  1. **`spreadCone` is validated but unused:** every preset sets it and the validator rejects values outside (0, π], but `spawnParticle` always throws a full 360° radial fountain with a 0.18 bias toward the bot; no code reads `spreadCone`.
  2. **Triangle budget excludes the fixed meshes:** the 3,500-triangle check sums only the instanced layers. Each emitter also draws 4 beam cylinders (2 × core + sheath, 24 tris each), 2 muzzle orbs and 1 impact flare (`energyOrb`, 20 tris each) and the shock ring (torus 3 × 8, 48 tris): ≈ 204 triangles per active emitter that no check sees.
  3. **The age stagger is lost on the first cycle:** `createLayer` staggers `age` by a golden-ratio fraction of each particle's lifetime so a stream looks continuous from frame 1, but the constructor then calls `seedAllParticles(1.0)`, which re-spawns every particle at the cut point in the same frame and re-rolls its `lifetime` (`age` is kept, so some particles now have `age ≥ lifetime` and respawn at once). The first second is a synchronous fountain, not a stream. A burst (`triggerBurst`, speed boost 1.55) also resets every `age` to 0..0.12 s (intended there).
- **Why it is like this:** the validator was written against the preset spec, not the emitter; the cone parameter predates the radial-splash rework (RN-32).
- **Workaround / mitigation:** visual QA in `/playground.html?inspect=<id>&work=1&workTarget=<kind>`.
- **To resolve:** use `spreadCone` in `spawnParticle` (or remove it from the spec and the validator); add the fixed-mesh triangles (beams, orbs, ring) to `totalTriangles`; keep the constructor's ages (seed positions along each particle's own age, or do not reseed in the constructor).
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-59 · A night descent may keep the PERF night-skipped sun shadow

- **Status:** Open (suspicion; visual check needed)
- **Severity:** low
- **Confidence:** PLAUSIBLE (code path; not seen in a browser)
- **Area / code:** `frontend/render/core/shadowConfig.ts` (`syncViewportShadow`: `if (isViewportInDescent(vp)) return;` before the mode-0 block that sets `sun.shadow.intensity = … × nightSunShadowFade(t, skipNightSunShadow())` and `sun.shadow.autoUpdate`), `core/shadowFit.ts` (`nightSunShadowFade`), `core/perfConfig.ts` (`nightSunShadow` default 0); RN-42, RN-52 (2)
- **What happens:** while the descent renders, `syncViewportShadow` returns early, so the sun keeps whatever shadow intensity / `autoUpdate` the colony sync last set. If the colony clock was at night with F8 → PERF → NIGHT SUN SHADOW off (the default), that is intensity 0 and a frozen map, so the sunlit descent (which lights the pod from `ctx.sunDir`, RN-42) would cast no sun shadow.
- **Why it is like this:** the early return keeps the descent's own lighting from being overwritten by the colony's night settings.
- **Workaround / mitigation:** none known; may not show if the descent starts from a viewport that never ran a night colony sync.
- **To resolve:** check `?planet=oceanForest&deploy=1` with the planet clock at night (and `?host=local&scenario=w01` at 00:10); if the pod casts no shadow, set the sun shadow to the day value (intensity, `autoUpdate = true`) when the descent starts and restore it in `restoreAndCleanup`.
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-60 · Lighting leftovers: secondary shadow light built in two places, light keys without a model, per-frame name lookups

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/core/createColonyViewport.ts:47-79` (`createSunAndHemi` builds `secondaryShadowLight`), `frontend/render/core/shadowConfig.ts:138-158` (`ensureSecondaryShadowLight` builds the same light), `:224-248` (`followShadowTarget`: `vp.scene.getObjectByName('planetSkyDome')`), `frontend/render/lighting/archetypeLights.ts:84-90,150-160` (`robot.*` keys, `resolveDefaultLights`), `frontend/render/kitbash/archetypes/units/robots.ts` (registered: `robot.hero`, `robot.miner`, `robot.builder`, `robot.combat`), `frontend/game/app/online/entityVisionSync.ts:25-36` (`lightArchetypeForKind`), `frontend/game/app/online/EntityMeshes.ts:49-57` (`archetypeForKind`)
- **What happens:**
  1. **Copy/paste:** the viewport creates the secondary "moon" light (colour, 1024² map, near 8 / far 138, frustum) and `ensureSecondaryShadowLight` repeats the same construction as a fallback (found by name, else built). The copies have already drifted: only the viewport's sets `bias`, `normalBias`, `radius` and `intensity`. A change to one (map size, frustum) misses the other.
  2. **Keys without a model:** `robot.hauler`, `robot.tleilaxu` and `robot.raid` have light entries but no registered archetype. `robot.scout` has none either, yet `lightArchetypeForKind` maps `devProbe` to `'robot.scout'` while `archetypeForKind` draws it as `robot.builder`: its projectors and its mesh come from different archetypes. Every explicit `robot.*` entry is `makeStandardRobotHeadlamp()`, which `resolveDefaultLights` already returns for any `robot.*` id.
  3. **Per frame:** `followShadowTarget` runs every rendered frame (`fitShadowToView`) and walks the scene graph with `getObjectByName('planetSkyDome')` to update the dome's sun uniform.
- **Why it is like this:** the light was first part of the viewport and later made lazy for viewports built elsewhere; the robot keys were written for the full robot list of the design.
- **Workaround / mitigation:** none needed for correctness; the lookup is a few dozen nodes on today's scenes.
- **To resolve:** one factory for the secondary light used by both; delete the three dead keys (and `robot.scout`, mapping `devProbe` to `robot.builder` lights like its mesh); cache the dome reference on the viewport record.
- **Found:** 2026-11-03, W02 review round 1 (render agent)

### RN-61 · Some focus-culling callers ignore `viewFocusBounded()`

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (code); effect not checked in a browser
- **Area / code:** `frontend/render/core/focusCull.ts` (`viewFocusBounded`: false while the focus is clamped to `VIEW_FOCUS_MAX_RADIUS` = 220 m), `frontend/render/particles/WorkParticleSystem.ts` (`showIfInFocus`), `frontend/render/lighting/ColonyVisionAndLights.ts` (`selectFocusedProjectors`), `frontend/game/app/online/entityFocus.ts` (`isEntityInViewFocus`); RN-46, RN-51
- **What happens:** when the camera looks toward the horizon the focus is clamped and may not cover the screen; `cullToViewFocus` and the prop buckets then stop hiding anything. These three callers test `inViewFocus` directly, so work particles in a far corner are hidden and not stepped, projectors there are not uploaded (dark pools), and entities there skip their shader clock and rig power (frozen animation) while visible.
- **Why it is like this:** the bounded check was added for the prop / water buckets; these callers were written against `inViewFocus` before it.
- **Workaround / mitigation:** only while the focus is clamped (a footprint wider than 220 m: grazing camera angles, e.g. the 2f1f2c1 grazing-camera view focus work); at the default RTS pitch the focus is bounded.
- **To resolve:** in each caller, treat everything as in focus while `!viewFocusBounded()` (one helper in `focusCull.ts`, e.g. `pointInViewFocus(x, z, pad)`).
- **Found:** 2026-11-03, W02 review round 2 (render agent)

### RN-62 · Half / depleted deposit models got extra detail to pass the validator

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/kitbash/archetypes/units/nature.ts:148-152` (`buildMetalDeposit`: `if (stage !== 'full')` adds three `mined ore chip` rocks), `:212-216` (`buildCrystalDeposit`: `if (stage !== 'full')` adds four `frameGunmetal` crystal stumps on the side rocks); commit 2f1f2c1
- **What happens:** the `@half` / `@depleted` deposit stages (fewer nuggets / spires) failed the model validator's surface-detail checks, so round 1 added dull ore chips where nuggets were and dark broken crystal bases. `npm run validate:models -- --all` now passes 35/35 models with 0 errors and 0 warnings, but the depleted deposits look busier than a plain mined-out rock.
- **Why it is like this:** CLAUDE.md requires 0 errors / 0 warnings for every kitbash model; adding detail was the smallest change that passes.
- **Workaround / mitigation:** none needed.
- **To resolve:** owner decides the look. To revert, delete the two `if (stage !== 'full') { … }` blocks in `nature.ts` (then the half / depleted stages report validator warnings again: either accept them for these stages or relax the check per stage). Check in `/playground.html?inspect=resource.metalDeposit&depositStage=half|depleted` (and `resource.crystalDeposit`).
- **Found:** 2026-11-03, W02 review round 1 (render agent)


## W06 Invisible Chain

This entry was RN-26 on `wave/w06-invisible-chain`. W02 landed RN-26..RN-62 on `main` first, so the shadow-depth fix continues at RN-63.

### RN-63 · Shadow depth pass failed to compile (`objectNormal` undeclared)

- **Status:** Resolved (W06, 2026-11-02)
- **Area / code:** `frontend/render/visuals/unified/shaderChunks.ts` (`vertBeginVertex`)
- **What happens:** the unified vertex chunk wrote `vTaWorldNormal` from Three's `objectNormal`. `MeshDepthMaterial` (the shadow pass) does not declare that name, so Chrome logged `THREE.WebGLProgram: Shader Error` and `tests/e2e/w01.spec.ts` step 1 failed on `expectNoPageErrors`. The colour pass still drew.
- **Why it is like this:** `objectNormal` comes from `<beginnormal_vertex>`, which the depth material does not include before this chunk.
- **Workaround / mitigation:** none; the depth shader did not compile.
- **To resolve:** build the same vector `beginnormal_vertex` would (`normal`, times `instanceMatrix` when instancing) inside the chunk.
- **Found:** 2026-11-02, W06 e2e (`npm run e2e -- --waves 01 --hack`)
- **Fix:** `vertBeginVertex` no longer reads `objectNormal`.

### RN-64 · Grid cables are a visual tree, not the sim's adjacency

- **Status:** Accepted (by design, 4b45c18)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/app/online/powerCableSpans.ts`, `frontend/render/lighting/gridCables/`
- **What happens:** Cables are a minimum spanning tree per synced grid component (Hub + pylons, 2 conductors per span) plus one thin cable from each attached building to its nearest relay. A pylon may reach more relays in the sim than it is wired to on screen; cables can clip through a building between two nodes; only the own colony's cables are drawn, with no shroud tint and no quality / `?perf` switch.
- **Why it is like this:** Two draw calls, geometry rebuilt only on shape change, zero per-frame allocation.
- **Workaround / mitigation:** —
- **To resolve:** Route cables around footprints; add a quality switch if perf needs it.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### RN-65 · Buildings without their own light entry inherit the 4-corner mine rig

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/render/lighting/archetypeLights.ts` (`DEFAULT_ARCHETYPE_LIGHTS`, `resolveDefaultLights`)
- **What happens:** Owner feedback #5 found that the pylon had 4 light sources because `building.pylon` had no entry and fell back to `building.mine`'s 4-corner rig; fixed for the pylon (single grid-core light). Capacitor, wind, coalGen, supplyDepot, waterPump and the quarry / well mapped to mine still inherit the 4-corner rig. Pylons and other unlisted buildings also go through the unit branch of `collectOwnedEntityVisionAndProjectors` and add forward vision sources at +2.8 m / +7.5 m like robots. The pylon's insulator caps are now `hullSecondary`, which reads tan / orange on dune.
- **Why it is like this:** Out of the owner's item scope (pylon only).
- **Workaround / mitigation:** —
- **To resolve:** Give each building archetype an explicit light entry; route buildings through a building vision branch.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)
