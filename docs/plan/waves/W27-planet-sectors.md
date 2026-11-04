# W27 — Planet Atlas, Continents & Sector Streaming

> **Status:** Planned (2026-11-03); documentation only, no implementation claimed.
> **Track:** Sim / Meta / Client · **Flag:** `W27` · **Tag:** `wave-27`
> **Scenario:** `tests/scenarios/w27-planet-sectors.ts` · **E2E:** `tests/e2e/w27.spec.ts`
> **Depends on:** W04 (maps and camera), W05 (territory and terrain operations), W11 (lobby, reservations and home).
> **Optional:** W09 (offline), W14 (walls), W18 (combat), W21 (transfer), W24 (mobile/landing), W25 (load harness).
> **Owned paths:** new atlas/topology modules under `shared/sim/src/{gen,grid,world}/`, sector contracts under `shared/contracts/src/`, sector persistence under `shared/db/prisma/`, existing `backend/app/src/{game,lobby,core/home}/`, `frontend/game/{app,features,maps,camera,core,net,store,ui}/`, `frontend/landing/`, existing `frontend/render/{core,planets,orbit,visuals}/`. Resolve actual paths against landed code before splitting issues; shared kernel/codec/schema/app composition changes belong to the wave lead.
> **Specs:** D-12, D-24, D-31, D-37–D-39, D-42; [CLIENT](../../spec/CLIENT.md), [PROTOCOL](../../spec/PROTOCOL.md), [MATCHMAKING](../../spec/MATCHMAKING.md), [SIMULATION](../../spec/SIMULATION.md). W27-02 records the scoped amendments before implementation.

## Goal

Each of the three existing landing worlds becomes one persistent, coherent planet: continents made of large hexagonal gameplay sectors, configurable founding capacity per sector, and nearby terrain loaded as the camera or units approach it. The globe, selection screen, landing summary, W04 global map and playable ground all describe the same generated geography. A colony may occupy multiple sectors without a transfer, artificial border or duplicate base. Wheel/trackpad/pinch zoom continuously from the playable ground through sector and continent scale to the shader-rendered planet seen on the landing page, then back to the same location. Camera location, home and selection remain identifiable throughout.

Exactly **one canonical planet per type**, at most one active for each: Kharon Dunes (`desert` / `dune`), Thalassa Verde (`ocean` / `oceanForest`), Granite Hollow (`temperate` / `forestRock`). Production instance scaling is a later owner-led task. W27 is the next unused wave ID, not a requirement to finish W06–W26 first; its hard dependency graph controls scheduling. No new hackathon commitment: all issue tags are blank.

**Readiness beyond a wave tag:** W04 map registry/camera rows W04-03/-15/-20/-26, W05 territory rows W05-12/-13, and W11 reservation/saga/party rows W11-11/-13/-18/-19 must actually be landed. An H-only tag is insufficient. Reopen those owning waves for missing rows before W27 implementation; do not silently replace their systems inside W27.

## Review findings and changes to existing waves

| Finding | Evidence | W27 treatment |
|---|---|---|
| W04 is a good map/input foundation, but assumes the entire small world is resident | W04-03 one planet canvas; -08/-18 full state; -07 1,500 dots; -14/-27 bounds; -20 immediate fly | Preserve layer registry and controls; introduce atlas summaries, bounded sector caches, load-aware fly-to and unloaded/unknown states. Global map never requests all detailed tiles |
| Existing sectors are storage blocks, not multiplayer regions | D-38; `shared/sim/src/grid/sectors.ts`: 8×8 axial buckets, 32×32 render chunks | Introduce distinct `GameplaySectorId`; retain internal chunk indexes and dirty-stamp pruning. Never enlarge `SECTOR_TILES` to implement this feature |
| Full-state sync and whole-world prediction defeat sector streaming | D-24; `frontend/game/store/replica/ReplicaCore.ts`, `frontend/game/store/prediction/Predictor.ts` | Versioned interest subscriptions and partial replicas; prediction only on complete dependencies, server always authoritative |
| Colony identifiers/fog and path allocation cannot support the requested scale | [WE-06](../../questions-and-limitations/sim-world-engine.md#we-06--fog-of-war-is-not-a-security-boundary-explored-covers-only-colonies-07-owner-only-up-to-127), [WE-29](../../questions-and-limitations/sim-world-engine.md#we-29--every-path-search-still-allocates-planet-sized-arrays) | Widen owner identity across codec/entity/grid/contracts; sparse per-colony exploration; bounded path scratch and hierarchical routing |
| W11 assumes planet capacity five, automatic extra planets and a warm pool | W11-07/-08/-12/-15/-22/-31; D-12 | W27 mode reserves sector seats on three canonical planets; no overflow planet creation; aggregate planet capacity is derived, not five |
| W05/W11 still describe desert/ocean generators as future work | D-38 already brought all three profiles forward | Reuse those profiles; W05 retains its biome/terraform work; W27 adds geography, not duplicate generators |
| Territory is not a sector allocation | W05 beacons/territory, D-37 placement; W14 walls | Sector membership is spatial indexing/admission, never a new ownership or placement boundary |

These are a review of the wave plan and current architectural constraints, not a claim that unimplemented W04/W11 features have been tested.

## Product and topology contract

**Configuration defaults proposed for implementation (tunable before planet creation):**

| Setting | Initial value / rule |
|---|---|
| `sectorPlayerCapacity` (X) | 4; validate positive bounded integers; acceptance presets exercise 3, 4 and 5 |
| `sectorRadiusTiles` (R) | 24; complete hex-ring footprint gives Y = `1 + 3R(R + 1)` = 1,801 tiles |
| `tilesPerSector` (Y) | Derived and displayed; accept Y input only if it maps to a supported integer R, otherwise explain validation failure |
| `continentCount` | Kharon 1 supercontinent; Thalassa 3; Granite 3; all profiles support 1 and 3 |
| `sectorsPerContinent` | 150, configurable; means 150 connected land-bearing gameplay sectors per continent, including coastal sectors |
| Ocean sectors | Separately counted, zero founding seats; total planet sectors = land-bearing + ocean sectors |
| Nearby interest | Camera frustum plus one sector halo; prefetch within 8 tiles of an edge; retain hysteresis 2 s; all configurable and validated against R |
| Cache budgets | Initial target 19 detailed sectors, 256 MiB client terrain/cache CPU bytes and 128 MiB tracked GPU assets; hard limits, instrumentation and tuning in W27-35 |

At X=4, a 150-sector supercontinent has 600 founding seats; a 3×150 planet has 1,800. At X=5 the latter has 2,250. These are topology capacity figures, **not proven concurrency claims**; load gates below determine whether this configuration may be enabled. Nominal capacity must never exceed the spawn sites validated by generation.

**Canonical atlas.** Keep the existing axial tile simulation. Use a finite atlas of macro hexagons with globally stable tile coordinates, exact unique tile-to-sector ownership, symmetric neighbour links and a single `planetId → continentId → sectorId → tile` lookup. Use a proven integer macro-hex partition, not overlapping radius discs placed by eye. Sector silhouettes follow whole tile edges (stepped hex outlines); do not claim exact straight hex boundaries at both resolutions. Property-test no gaps/duplicates, corners, negative coordinates and all six shared edges. Water tiles belong to sectors too; water inside a coastal sector is not spawnable.

**Globe relationship and boundary default.** The atlas is authoritative geography projected onto the existing globe; all continents fit inside an ocean margin, with an explicit projection seam through ocean. Coastlines, sector polygons and selected landing locations come from that manifest. Ground traversal is finite and continuous within the atlas; loading nearby sectors feels continuous, but does not generate an infinite planet. No polar traversal or spherical path metric is promised in this wave. This is a proposed default recorded as WE-32, not a claim that a sphere can be tiled with regular hexagons. A true spherical gameplay grid would require a different topology with exceptional cells. Globe picking and atlas picking must round-trip to the same canonical sector/tile.

**Versioned configuration.** Persist `planetId`, public seed, generator/topology/config versions, config hash and immutable manifest together. Derive IDs from coordinates and versioned identity, not creation order. Never reinterpret existing worlds when an environment default changes. New configs require a new dev scenario or an explicit future migration. Preserve hidden subsurface salts and layers on the server.

## Deterministic planet generator

1. Validate config and estimate tile/seat/memory budgets before allocating. Reject impossible sector counts, undersized spawn space and unsupported budgets with structured errors.
2. Generate a compact macro-sector graph first. Place separated continent seeds, then deterministic constrained region growth to exactly 150 sectors per component (or configured value). Stable tie breaks and bounded retries; a failed seed fails visibly, never silently reduces counts.
3. Enforce component connectivity, ocean separation, minimum navigable corridors and plausible coast shape. Use low-frequency noise/distance fields to bias growth and fine coastlines, not a raw threshold that cannot guarantee component counts. Validate the traversable land connection graph as well as macro adjacency.
4. Generate fine terrain from canonical global coordinates and named, versioned per-stage seeds. Sample neighbour halos for coast, slopes, water and normals; never reseed noise at sector edges. Extend the existing profile orchestrator with macro masks while preserving each world's palette, terrain character and resource families. Continental sea and inland water shares are reported separately from legacy small-map biome percentages.
5. Validate X safe, separated landings with starter resources and preparation space in every land-bearing sector, including spacing across sector borders. Deterministically repair within budget or reject the seed. Water-only sectors have zero capacity. Larger parties may reserve neighbouring sectors atomically; no silent split across planets.
6. Persist the manifest and generated-baseline version; materialize fine sectors on demand, persist mutations and checkpoints, regenerate pristine cells only from the pinned version. Loading order and worker scheduling must not change output. Test hashes across server, browser local host, shuffled loads and restarts.

Use existing deterministic noise/RNG and sim purity rules. No new renderer-based terrain truth or unconstrained browser math in the sim. The generator is an extensible registry of profiles/stages; no three copied implementations.

## Server, client and persistence

- **One authority per planet.** A sector is an interest/storage unit, not a separate sim world or worker. Cross-sector pathing, power, range, collisions, work, territory and clocks retain global semantics. An offscreen colony keeps running; unloading visuals never pauses production or deletes entities. W09's offline policy applies planet-wide when enabled.
- **Resident data.** Keep the small manifest and aggregate counters resident. Activate authoritative fine terrain for colonies, work, routes, combat and their dependency halos; retain dirty data until durable. Sparse storage/query adapters replace planet-sized grid allocation where necessary. Dormant pristine sectors need no per-tick scan. Active gameplay is never throttled just because no camera watches it.
- **Identity and fog.** Upgrade i8 owners and the eight-colony explored mask with versioned migrations; use stable colony IDs and a sufficiently wide internal index with explicit sentinels. Per-colony explored chunks are sparse. Admission, presence and occupancy use distinct counts: founded/reserved seats, colonies physically present, online players. Moving a unit or expanding a base never consumes a second founding seat. Reconnect does not double count; historical owners cannot alias reused seats.
- **Admission.** Reserve sector seats plus valid landing slots atomically with idempotent expiry/release and the existing spawn saga. Validate capacity again at authority; handle simultaneous joins, party rollback, reconnect and stale UI counts. If full, queue on the same type; never manufacture another instance. Keep all three planets visible with full/sealed/ended status. With W21 enabled and no eligible destination, keep transfer tickets/carry pending; do not respawn on the source planet, repeat settlement or consume carry. Offer a different type only with explicit player selection. No silent change to admission/lifetime rules: retained W11 rules can leave a type unavailable; no automatic replacement until production instance policy is supplied. Restart preserves sealed/ended states and never creates a replacement just to restore three active worlds.
- **Protocol.** Negotiate an atlas capability/version. Welcome contains manifest metadata, own colony/HUD summary and initial interest, not every tile. Define sector subscribe/unsubscribe, snapshot, delta, entity transfer/tombstone and summary messages; each carries planet/version/sector/revision plus subscription epoch. Install a snapshot and replay newer deltas atomically. Gaps resnapshot only affected sectors; late epochs are discarded. Bound subscriptions, inflight bytes, queues, retries and cache usage; apply backpressure.
- **Replica and prediction.** Missing is unknown/loading, never empty/passable/unclaimed. Predict only when the full rule dependency set is resident, otherwise send intent for server validation and show pending status. Use the existing shared rule functions; no approximate client copy of placement/path rules. Remote own units have lightweight summaries; detailed interest follows selected/controlled units with quotas and server fallback. Huge empires use summaries rather than pinning every base sector in client memory.
- **Cross-border integrity.** Same entity ID crosses once; no despawn/spawn duplication. Footprints, beacons, territory outlines, fog, electricity and connected walls query neighbouring sectors. Outlines omit internal sector edges. Borders may span any number of sectors allowed by ordinary game rules. Map clicks do not teleport units; only locomotion writes gameplay positions.
- **Recovery.** Sector checkpoints plus planet-global metadata must share a consistent tick/journal boundary. Crash/reconnect during a boundary crossing yields neither lost nor duplicated work/ownership. Never evict unsaved dirty sectors. Migrate old saves or preserve them in explicit legacy mode; never silently regenerate occupied worlds. W27-off old scenarios retain their previous behavior; W27 worlds refuse incompatible clients/flags rather than loading corrupt partial state.

## Streaming and W04 global map

Compute interest from camera footprint and selected-unit needs, with direction-aware prefetch before the border. Deduplicate jobs, cancel stale work, load at most a bounded number concurrently and incrementally upload meshes within a per-frame budget. Retain an LRU cache with hysteresis; evict listeners, geometries, textures and spatial caches together. Renderer uses existing terrain/chunks, diorama camera, materials and lighting.

W04 minimap shows nearby detail within a planet/continent context. Global map drills **planet → continent → sector → tile** using manifest summaries at low zoom and detailed caches only where requested. Keep Territory/Terrain/Resources/Units/Threats/Market/Walls registry behavior and producer flags. Unloaded detail is a hatch/loading state, not black fog; fog remains sim-authored. Aggregate counts never expose buried resources or unexplored enemy locations. Public geography/occupancy and private tactical intelligence have separate fields.

Far fly-to is a cancellable request: display coarse target immediately, load its detail, then settle the camera; keep old terrain until the destination is ready. Loading time is separate from W04's 0.6 s movement animation. Rapid clicks cannot install stale sectors. Do not stretch W04's planet-sized canvas: tile/cache summaries with bounded resolution and cluster dots. Preserve W04 repaint budgets (minimap ≤1 ms p95; global ≤8 ms p95 at ≤2 Hz) and baseline ≤60 draw calls on the reference scene.

## Continuous ground-to-globe game map

**Player contract.** Scrolling outward over the game viewport travels through **ground → sector → continent → planet** in one reversible navigation flow. These are detail bands on one zoom axis, not separate pages or a second lobby. Scrolling inward returns to the geographic anchor under the pointer (viewport centre for keyboard/buttons). Ground keeps the approved 28° diorama view and closest supported gameplay distance; “ground” does not introduce first-person controls. At planet scale the full shaded globe, atmosphere and clouds match the landing's visual language, with the current world's actual continents and sectors. The game session and simulation continue throughout.

| Band | Rendered content | Location and interaction |
|---|---|---|
| Ground | Existing hex terrain, units, buildings and tactical layers | Tile/sector breadcrumb, camera footprint, selected entity; ordinary commands on loaded valid ground |
| Sector | Simplified terrain and sector outlines; clustered units/colonies | Camera focus and home remain separate; borders and availability use authoritative summaries |
| Continent | Manifest-derived coast/relief overview and sector summaries | Continent/sector breadcrumb, projected last ground footprint, selected sector and home marker |
| Planet | Existing shader globe with atlas-backed surface and map overlays | Camera anchor pin plus last ground footprint, home and selected-unit pins; pick a location to zoom toward it |

**One navigation state.** Introduce a game-owned controller with canonical `planetId`, atlas focus, last valid ground pose/footprint, heading, continuous logarithmic zoom, selected entity/sector and an optional pending destination. Renderer adapters consume immutable views of this state; minimap, `M`, wheel, pinch, zoom buttons and load-aware fly-to all dispatch navigation intents to it. `M` opens the planet band and remembers the prior pose; `M`/Escape returns to that pose through the same load-aware path. Escape first cancels an outstanding destination. Preserve layer toggles and selection across every band. Home/F retain W04's established home/follow semantics and use this controller rather than competing camera writers.

**Input and transitions.** Normalize wheel delta modes and trackpad deltas; clamp extreme bursts and zoom endpoints. Only the active viewport controller consumes input; console, text fields, modal UI and scrollable panels retain their own events. Pinch and labelled +/- controls offer the same navigation without depending on W24. Pan is atlas-relative near ground and globe rotation at planet scale; neither moves units. Preserve the picked geographic anchor and heading while changing scale; a pointer over sky uses the last valid anchor. Define configurable band thresholds with hysteresis, test both directions and rapid reversal, and avoid resetting momentum or pose at a boundary. Reduced motion uses immediate or short opacity handoffs with the same anchors and controls.

**Flat ground to curved globe.** The finite planar atlas remains the simulation topology. Share a versioned forward/inverse atlas-to-sphere projection, local tangent frame and transform conventions between globe picking, terrain overview, markers and camera transitions. Use an aligned overview patch and bounded overlap/compositing interval to bridge the planar ground into the curved globe; do not scale the entire detailed world into a sphere or promise spherical locomotion. Freeze autonomous surface spin in the gameplay map; cloud drift may continue. Project markers through the actual globe transform. Hide back-facing pins behind the globe and offer a labelled far-side indicator/recentre action; never draw them as if visible through the planet. Ocean outside the finite atlas and the projection seam have explicit non-playable states, with no wrap or accidental tile pick.

**Position indications.** Always show a DOM breadcrumb `planet / continent / sector / tile (q,r)` at the finest known precision, a zoom-band label and a north/heading cue. Label the camera marker “Viewing here”; home marks the colony HQ, while a selected moving unit has its own marker. Draw the last ground camera footprint on continent/planet views and the current footprint on the minimap; update them through the same projection. Offer “Return to ground view”, “Home” and “Follow selection” actions. If home or selection is offscreen, show an edge/far-side cue; if its summary is stale, lost or unavailable, label that state instead of inventing a position. Breadcrumbs must not claim tile precision for unloaded/coarse picks. Use shapes and text as well as colour, readable sizes, Faction Plate tokens and keyboard focus. Private markers obey fog/visibility at every zoom.

**Load-aware zoom.** At continent/planet scale, interest follows bounded summaries, not the expanding camera frustum across every sector. Only a chosen ground destination and required tactical dependencies request fine data. While descending into uncached ground, hold the aligned coarse surface with a loading/error indicator until the destination baseline and meshes are ready; keep the prior usable ground view available. Cancel or reverse without stale mesh/camera installation. A timeout offers retry/return and leaves the session usable. Picking ocean or unknown detail never issues a build/move command. Zoom consumes no founding seat and never changes planet identity.

### Reuse and implementation boundaries

Current source anchors (reviewed 2026-11-03):

| Existing code | W27 extension / reuse |
|---|---|
| `frontend/landing/hero/HeroStage.ts` → `createOrbitalStage()` | Landing already shares the renderer. Keep its promotional morph timeline in the landing app; game map supplies live state and no automatic planet switching |
| `frontend/render/planets/PlanetGlobe.ts`, `globe/materials.ts`, `surfaceFrag.ts`, `cloudFrag.ts`, `atmFrag.ts` | Reuse globe construction and shader chunks. Add atlas surface/summary inputs; preserve biome material appearance. Seeded decorative coastlines cannot override the manifest |
| `frontend/render/planets/globe/{terraform,ColonyStructures,ColonyBeams}.ts` | Existing fixed demo colonies/terraform stages are promotional. Add an explicit presentation/live-data mode boundary; game overlays use authorized real colony/terraform summaries, never the demo's five colonies |
| `frontend/render/core/{createColonyViewport,StageHost}.ts`, `frontend/render/orbit/OrbitalStage.ts` | Reuse the viewport, render lifecycle and reusable globe/backdrop composition. Extract any reusable orbit parts needed by both apps into `render/`; one active game input owner and render loop |
| `frontend/game/app/RTSCamera.ts`, landed W04 camera/maps features | Replace the game's ground-only zoom ceiling with an adapter into the common navigation state. Preserve ground pose, follow, picking and W04 layers; do not run both wheel listeners |
| `frontend/render/planets/hex/`, `frontend/game/store/`, W27 interest scheduler | Keep detailed terrain and replicas; add bounded atlas overview LOD and readiness signals, with explicit ownership/disposal of transition resources |

Projection topology and canonical IDs belong to pure shared modules; visual transforms, globe/overview drawing and overlay projection belong to `frontend/render/`; navigation intent, input routing, selection and network readiness belong to the game app. No imports between landing and game, copied shader strings, second map-specific globe implementation, or renderer imports of sim internals. Add typed view contracts and small single-purpose parts, keeping the 500-line file / 100-line function limits. Shared renderer inputs must support both public landing summaries and authorized game summaries without exposing private data to the landing.

Use one game viewport/WebGL context. A transition may render bounded ground/overview/globe passes through that viewport; account for their combined CPU/GPU resources and fill cost. Warm shaders before their first visible use, release obsolete transition targets, and disable inactive scene work. Scope any shared view-focus/shadow state per rendered pass so the globe cannot overwrite the ground's culling footprint during overlap. Day/night comes from the authoritative solar clock passed by the app; reuse the existing lighting adapters and read `planetary-lighting-and-lightning` before changing them. Landing's demo clock stays presentation-only.

## Planet selection and landing page

Extend the current orbital menu and globe; no separate picker or parallel rendering stack. On hover, keyboard focus or tap, show a hologram-style callout anchored near the selected globe: connector lines, continent outlines, sector grid at closer zoom, and a restrained scan/reveal animation. Keep Faction Plate tokens/chamfers, orange selection and blue system annotations; reduced-motion mode is static and text remains accessible in DOM.

Callout fields: world name/type, continent count, land/ocean/total sector counts, configured sectors per continent, tiles and founding seats per sector, online players, founded/reserved/free seats, selected continent/sector availability and data timestamp. Player counts come from server summaries, never cosmetic estimates. Stale/error/offline states remain readable; no false zero. Join reserves the chosen eligible sector or explicitly offers another on that same planet.

Save this short copy for W27-32 to apply to the existing landing cards:

> **One planet. Connected continents. Room to build together.** Explore vast hex sectors, found a colony alongside other pioneers, and expand across borders as nearby terrain streams into view.

Per-card compact facts: **“{continents} continents · {landSectors} land sectors · {onlinePlayers} online”**, with “1 supercontinent” singular form, plus **“Up to {X} starting colonies per sector”**. Load metadata through a shared public contract, not an import from the game app. Offline landing uses versioned static geography and “Live population unavailable.” Landing and picker must not fetch gameplay snapshots.

## Development controls (planned, not available yet)

Open the existing in-game console with backtick (`); support its shifted `~` key without firing while typing in a field. Add these to `docs/dev/DEV_TOOLS.md` in the implementation commit. Mutations use existing dev-only server authorization and shared sim commands; production excludes them.

| Command | Purpose / expected output |
|---|---|
| `planet.info` | Manifest/version/hash, counts, admission state and cache budget |
| `planet.verify` | Exact component/sector counts, unique tile coverage, shared edges, spawn guarantees and identity limits |
| `planet.preview desert --continents 1 --sectors 150 --players 4 --radius 24 --seed 27` | Generate an isolated dev preview, never reset the current planet; variants accept ocean/temperate and 3/5 players |
| `sector.goto <id>` | Camera fly/load to sector; never move a unit |
| `sector.inspect <id>` | Continent, neighbours, founding/reserved/present/online counts and revisions |
| `sector.overlay on` | Toggle sector outlines and loaded/prefetch/eviction states |
| `stream.stats` | Resident/inflight sectors, bytes, uploads, cache hits, p95 loads and dropped stale epochs |
| `stream.simulate --latency 500 --drop-every 5` | Dev transport fault injection; `stream.simulate off` restores transport |
| `sector.populate <id> --players 5` | Dev guests through real admission/spawn; reject overflow; no direct seat edits |
| `map.zoom <band>` | Move the camera through the same navigation controller; print anchor and readiness; bands: ground, sector, continent, planet |
| `map.position` | Canonical focus, saved ground pose, band/blend, home/selection positions and pending destination |
| `map.layer sectors on` | Toggle W04 sector boundaries and occupancy summaries |

Fixtures include adjacent-sector colonies, a three-sector base, an edge-crossing route and a remote destination. Existing `teleport` remains admin-only and is not used to prove walking/streaming correctness.

## Demo story

1. Open `/play.html?scenario=w27` on the running online stack: exactly three planets, one per existing type; hover/focus each and compare its live facts to the landing card.
2. Inspect Kharon's 1×150 and Thalassa/Granite's 3×150 atlas; highlight a continent/sector on the globe and find that same coastline/sector on `M`.
3. Join a sector at capacity four using five concurrent guests: four valid reservations/foundings, one queued or explicitly offered another eligible sector; planet count stays three. Repeat X=3 and X=5 fixtures.
4. Walk a unit toward an edge while following it; see neighbour prefetch before crossing, continuous terrain, stable entity ID and no position snap. Pan in another direction and repeat with latency injection.
5. Build/extend the prepared three-sector base fixture; see one continuous territory outline and correct placement, power and pathing across boundaries. No extra founding seats consumed.
6. From a selected tile, scroll out through sector/continent to the shaded globe and back: retain its canonical anchor, heading, home marker, selected unit and layer toggles. Compare the globe appearance with `/landing.html`; coastlines must match the atlas. Repeat with trackpad, pinch, keyboard and reduced motion.
7. Open `M`, choose a distant continent, toggle layers and descend to a sector with 500 ms latency: see the coarse surface and loading state, then correct ground. Reverse zoom, cancel and pick a second destination; no stale jump. Rotate home onto the far side and verify its cue; return home, follow a crossing unit and inspect breadcrumb/footprint updates.
8. Leave a producing colony offscreen, evict its render cache, return and reconnect/restart: authoritative production, terrain edits and ownership persist.
9. Inspect `stream.stats` after 100 crossings and remote jumps; memory plateaus at configured budgets. Compare resident/delta work with 150 and 450 sectors at equal active population.
10. Repeat deterministic fixtures with `?host=local&scenario=w27`; geography, rules and boundary moves agree, server-only matchmaking shows unavailable locally.
11. Run old W04/W05/W11 scenarios with W27 off: existing map, territory and legacy lobby behavior still pass. Try an incompatible client on a W27 save: clear version error, no reset.

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W27-01 | Register flag, config and manifest/sector/summary/interest contract schemas | contract | M |  | W04-01, W05-01, W11-01 | Validate malformed IDs and unsupported config → structured errors | Product contract | — |
| W27-02 | Record scoped D-12/D-24/D-38 amendments and legacy/save compatibility matrix | docs | S |  | W27-01 | Review affected specs → one explicit W27-on/off policy per conflict | Review findings | — |
| W27-03 | Implement integer macro-hex coordinates, IDs and exact tile partition | sim | M |  | W27-01 | Enumerate adjacent sectors and corners → each tile has exactly one owner | Topology | — |
| W27-04 | Generate connected macro continents with exact sector quotas | sim | M |  | W27-03 | Generate 1/3 continent fixtures → exactly 150 connected sectors each | Generator 1–3 | — |
| W27-05 | Integrate profile masks, global noise and neighbour halos | sim | M |  | W27-04 | Load sectors in shuffled order → matching edge terrain/height hashes | Generator 4 | — |
| W27-06 | Validate and repair per-sector safe spawn sites and starter resources | sim | M |  | W27-05 | Validate X=3/4/5 including coastal sectors → X valid separated sites each | Generator 5 | — |
| W27-07 | Publish pinned manifest, config hash and atlas/globe projection contract | sim | M |  | W27-06 | Project/unproject sampled sector points → stable canonical IDs | Topology | — |
| W27-08 | Widen tile/entity owner indices and migrate codecs/snapshots | sim | M |  | W27-02 | Restore a colony index above 2,250 → ownership preserved without wrap | WE-06 | — |
| W27-09 | Replace shared eight-bit fog with sparse per-colony exploration | sim | M |  | W27-08 | Explore as colony 2,250 → correct mask with no other-colony leakage | WE-06 | — |
| W27-10 | Introduce sparse sector terrain storage and shared read adapters | sim | M |  | W27-07, W27-08 | Materialize one sector → allocation follows resident tiles, not atlas area | Residency | — |
| W27-11 | Bound path scratch and add sector route corridor refinement | sim | M |  | W27-10 | Route across three sectors → walking path with bounded scratch allocation | WE-29, SIM-M-01 | — |
| W27-12 | Adapt placement, territory and power queries across sector edges | sim | M |  | W27-10, W27-11, W05-12, W05-13 | Execute three-sector base fixture → same shared validity and connected power | D-37, D-42 | — |
| W27-13 | Add authoritative activation dependencies and bounded sector eviction | sim | M |  | W27-12 | Evict client interest from producing base → sim production continues | Residency | — |
| W27-14 | Persist sector edits with consistent planet checkpoint boundaries | server | M |  | W27-10, W27-13 | Restart mid-crossing → no lost edits or duplicate entities | Recovery | — |
| W27-15 | Migrate legacy saves or preserve explicit legacy mode | server | M |  | W27-14, W27-09 | Load an old occupied save → preserved colony and explicit mode/version | Recovery | — |
| W27-16 | Provision three canonical planet identities and disable overflow creation | server | M |  | W27-07, W27-15 | Restart twice → at most one active per type, stable IDs and preserved terminal states | Admission | — |
| W27-17 | Reserve sector seats/slots transactionally through existing spawn saga | server | M |  | W27-16, W11-11, W11-13 | Race five joins into four seats → four reservations, no overbooking | Admission | — |
| W27-18 | Extend party reservation, rollback, queue and capacity accounting | server | M |  | W27-17, W11-18, W11-19 | Expire a partial party spawn → exact released seats with no orphan | Admission | — |
| W27-19 | Serve public atlas/occupancy summaries with timestamps and bounded refresh | server | M |  | W27-18 | Query landing metadata → counts agree with authoritative seats/presence | Public summaries | — |
| W27-20 | Implement bounded interest subscriptions and versioned sector baselines | server | M |  | W27-14, W27-01 | Subscribe near one edge → local sectors only, hidden fields absent | Protocol | — |
| W27-21 | Implement ordered deltas, transfer/tombstones and reconnect resync | server | M |  | W27-20 | Drop/reorder boundary messages → affected sectors converge exactly | Protocol | — |
| W27-22 | Add partial replica loading states and safe prediction fallback | client | M |  | W27-21, W27-09 | Preview placement over missing dependency → pending then server verdict | D-31, D-37 | — |
| W27-23 | Add frustum/selected-unit interest, prefetch and hysteresis scheduler | client | M |  | W27-22 | Follow across edge → neighbour requested before crossing | Streaming | — |
| W27-24 | Integrate bounded terrain mesh uploads, LRU disposal and cache counters | visual | M |  | W27-23 | Traverse 100 borders → bounded live resources and no missing edge mesh | Streaming | — |
| W27-25 | Render continuous multi-sector territory and preserve entity selection | visual | M |  | W27-24, W27-12 | Select crossing unit/base → stable selection and no internal border | Cross-border integrity | — |
| W27-26 | Extend W04 map registry with hierarchical atlas summaries and detail caches | client | M |  | W27-19, W27-22, W04-03, W04-15 | Open planet view → all continents without fetching all detailed tiles | W04 integration | — |
| W27-27 | Add map drill-down, sector occupancy and clustered layer markers | client | M |  | W27-26 | Toggle producer flags/layers → correct summaries and unknown-state hatching | W04 integration | — |
| W27-28 | Make map fly-to cancellable and sector-load aware | client | M |  | W27-23, W27-27, W04-20, W04-26 | Click two remote targets rapidly → only latest destination settles | W04 integration | — |
| W27-29 | Project canonical coastlines, sectors and selections onto existing globes | visual | M |  | W27-07, W27-19 | Compare globe and map selection → same continent/sector and coastline | Globe relationship | — |
| W27-30 | Add accessible hologram hover/focus/tap panels with live counts | client | M |  | W27-29 | Focus each globe with reduced motion → readable accurate static callout | Picker | — |
| W27-31 | Wire sector selection to admission and handle stale/full/offline states | client | M |  | W27-30, W27-18 | Join stale full sector → explicit queue/alternative on same planet | Admission | — |
| W27-32 | Add compact geography/population facts and saved copy to landing cards | client | S |  | W27-19 | Disable summary endpoint → geography remains and population reads unavailable | Landing | — |
| W27-33 | Implement dev commands, fault controls and DEV_TOOLS reference | client | M |  | W27-28, W27-31, W27-44 | Run documented command sequence → inspectable reproducible edge fixture | Dev controls | — |
| W27-34 | Test generator properties, host parity and migration/recovery faults | test | M |  | W27-15, W27-21, W27-22 | Run fixed seed/config corpus in both hosts → matching hashes/invariants | Validation | — |
| W27-35 | Add streaming performance probe and bounded-work scale comparison | test | M |  | W27-24, W27-28 | Run 150/450-sector traverse → budgets pass with no linear idle-world cost | Performance gates | — |
| W27-36 | Load-test capacity, parties, lifecycle and active planet simulation | test | M |  | W27-18, W27-35 | Fill configured seats under movement/work → tick and admission gates pass | Performance gates | — |
| W27-37 | Audit globe/map/terrain visuals and accessible responsive callouts | test | M |  | W27-25, W27-30, W27-32 | Inspect all three profiles/views and keyboard/touch → coherent maps and readable UI | AGENTS pillars | — |
| W27-38 | Verify optional-wave border systems and document production deferrals | test | M |  | W27-33, W27-36 | Run optional flag matrix → no border regression or extra planet creation | Compatibility | — |
| W27-40 | Define navigation state, projection/tangent frames and renderer view contracts | contract | M |  | W27-07, W27-26 | Round-trip seam/edge fixtures and serialize camera state → stable sector/tile IDs | Continuous map | — |
| W27-41 | Add live atlas/colony inputs to shared globe and overview LOD | visual | M |  | W27-29, W27-40 | Render same manifest in landing/picker/game → matching coasts; game has no demo colonies | Reuse boundaries | — |
| W27-42 | Implement reversible ground/overview/globe camera and render handoff | visual | M |  | W27-24, W27-41 | Zoom out/in and reverse at each boundary → aligned anchor, no blank frame or extra context | Continuous map | — |
| W27-43 | Unify wheel, pinch, keyboard, M and fly-to with load readiness | client | M |  | W27-28, W27-42 | Descend under latency then cancel → latest intent wins; UI scrolling unaffected | Input and loading | — |
| W27-44 | Add location breadcrumbs, footprint, home/selection and far-side cues | client | M |  | W27-25, W27-43 | Follow crossing unit then orbit away → distinct accurate camera/home/unit indicators | Position indications | — |
| W27-45 | Test projection, navigation reversal, input ownership and stale loads | test | M |  | W27-43, W27-44 | Online/local anchor round trips, ocean/seam picks, disconnect and retry → stable safe state | Continuous-map tests | — |
| W27-46 | Audit all zoom bands, shared landing appearance and transition budgets | test | M |  | W27-35, W27-37, W27-45 | Repeat 100 zoom cycles across three profiles → readable markers, bounded resources and frame gates | Continuous-map QA | — |
| W27-39 | Wave e2e, scenarios, owner check guide and landing tag | test | M |  | all above | Run online/local demos and prior suites → green with reproducible owner guide | PRODUCT_WAVES §3, §7 | — |

## Execution and acceptance gates

Lead first: contracts, decision amendments and shared-file changes (W27-01/-02/-08). Then independent issue worktrees: generation/storage, backend admission/protocol, client streaming/maps, picker/landing. Freeze schemas and coordinate shared files before these lanes run concurrently; integration issues wait for their declared deps. Split a row further during implementation if it exceeds one agent-day; no hidden L-sized changes.

- **Generation:** fixed corpus of at least 100 seeds per profile across 1/3 continents and X=3/4/5, with exhaustive seam/coverage checks on small maps and sampled full-size checks; exact counts, connected land, valid spawns and deterministic hashes. Invalid configs fail before large allocations.
- **Runtime:** pin browser/hardware/build and workload in the perf report. Reference desktop target frame p95 ≤16.7 ms; terrain upload work ≤4 ms/frame; server tick p95 ≤50 ms, p99 <100 ms at 10 TPS. Cached border crossing has no blank frame; at injected 500 ms latency, loading fallback stays usable and converges without wrong terrain. Publish measured sector bytes, reconnect bytes and wire throughput.
- **Scaling:** compare 150 vs 450 sectors with identical active work; resident fine-terrain bytes and steady-state delta traffic grow ≤10%, excluding the small manifest/summary growth. Soak 100 crossings/remote jumps: client caches remain within configured caps with no monotonic leak. Test fully occupied 450×5 capacity, with at least one moving/working unit per colony and declared building workload; add 200 concurrent viewport subscribers and reconnect bursts. A failed gate blocks shipping advertised capacity; document measured limits, do not quietly lower the user's configured X/counts or claim rendering streaming fixes server load.
- **Correctness:** concurrent admission and party failure; ID above 2,250; multi-sector base/footprint/path/power; stale/duplicate/out-of-order packets; failed persistence; reconnect during movement; W09 distinguishes the last camera unsubscribe from the last connected player leaving, and fast-runs across sector checkpoints with exactly-once notices; W14 wall isolation checks cover routes above 2,000 tiles and unloaded neighbours, with route invalidation after gate/breach; W18 combat/visibility; W21 same-type transfer when no other instance exists. Optional-wave tests run only when implementations are available, with shared contract fixtures otherwise.
- **Visuals:** implementers read the relevant workspace skills before 3D changes: shader-texture-tuning and diorama-viewport-auditor; texture/geometry skills and validators if touched. Preserve approved materials/camera/lighting. Check iso/front/side/top and all three biome profiles, plus globe/map coastline correspondence. No new model is required for the hologram UI.
- **Continuous-map acceptance:** test all three profiles at ground/sector/continent/planet and both transition overlaps; record video plus iso/front/side/top diagnostics for changed shaders. Ground → planet → ground with no pan returns to the same tile and heading; projected anchor drift at a handoff is ≤2 CSS pixels on the pinned desktop/mobile viewports. Cover seam, poles/non-playable ocean, far-side pins, rapid wheel/pinch reversal, UI focus, lost selection and reduced motion. Over 100 full zoom cycles, combined caches stay within W27 budgets with no monotonic growth; overview never subscribes to all detailed sectors. Measure warmed frame p95 ≤16.7 ms including overlap passes on the reference desktop, and record first-use shader/mesh preparation stalls separately. Shared landing visual regression must preserve its approved shader appearance and promotional behavior.
- **Completion:** `npm run check:structure`, relevant sim/contract/integration/parity suites, W27 online/local e2e and prior-wave regressions pass; document actual commands/results. Write `docs/plan/checks/w27-check.md` only after playing the running demo, with exact worktree URLs. Owner lands with `npm run wave -- land 27`.

## Scope limits and references

Continuous navigation is planned here, not implemented by this documentation; WE-32 also records the planar-to-globe presentation boundary. Planning defaults (R=24, X=4, continent assignments, finite atlas projection) are recorded in [WE-32](../../questions-and-limitations/sim-world-engine.md). Production instance provisioning, cross-instance migration/sharding and geodesic/polar gameplay are deferred; this wave includes measured single-authority capacity validation and rejects unsupported configurations. Existing small-world issues WE-06 and WE-29 remain open/accepted until implementation proves their fixes.

Algorithm references, consulted 2026-11-03: [Red Blob Games: axial hex geometry and coordinate conversions](https://www.redblobgames.com/grids/hexagons/) supports the coordinate foundation; [terrain from noise](https://www.redblobgames.com/maps/terrain-from-noise/) describes frequency/mask techniques, extended here with explicit continent quota/connectivity constraints. [H3 overview](https://h3geo.org/docs/core-library/overview/) documents spherical exceptional cells; [H3 indexing](https://h3geo.org/docs/highlights/indexing/) distinguishes logical from geometric containment. These inform topology constraints; H3 is not a required dependency or a substitute for the existing sim grid.

## W12 progression integration gate (revised)

Follow [Progression persistence and delivery](../../spec/PROGRESSION_ENGINE.md). Identify any new statistics producers and reuse the W12 catalogue, transaction and effect queue; do not introduce parallel counters or reward callbacks.

Acceptance: producer-to-profile persistence, replay/restart, concurrent inputs, threshold boundaries, independent queue retries and disabled-wave behavior are covered by unit and PostgreSQL integration tests. New achievement conditions use catalogue configuration; new event semantics use registered producers. Keep earned achievements and lifetime statistics across colony transitions. ME opens in a new tab from authenticated landing/selection only; the hub's W12 mock is explicit.

## W16 director integration gate

When W16 is enabled, serve its [bounded world-context contract](../../spec/AI_ORCHESTRATOR.md#5-context-w11-and-w27) from the real summary/read services. Run the director's 150/450-sector load and knowledge-scope fixtures on actual streaming: camera-independent owned-sector relevance, timestamped unknown/unloaded summaries, protected player goals and no forced whole-atlas residency. Preserve W11 IDs and epoch/revision invalidation. W16 is optional; W27 works with no worker. Synthetic W16 tests do not satisfy this real-stack scale gate.
