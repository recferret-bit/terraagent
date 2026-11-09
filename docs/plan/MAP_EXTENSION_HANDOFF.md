# Map implementation handoff — W11 and W27

Code review baseline: 2026-11-04. Required reading before W11-37/-39/-42/-43 and W27-22/-26–28/-40–44. This describes current code and required extensions, not completed atlas or streaming work. Recheck these anchors on the implementation branch; historical W04 issue descriptions and FF-64 are not a completion ledger.

## Existing implementation to extend

Paths below are relative to the repository root.

| Source | Current behavior / reuse boundary |
|---|---|
| `frontend/game/features/maps/index.ts` | W04 feature mounts `MapsController`, publishes `ctx.services.maps`, and updates it from HUD/render hooks. Extend this feature/service; do not mount a parallel map or camera listener for each wave. |
| `frontend/game/maps/MapsController.ts` | Composes raster, minimap, overlay, layer chips, viewport and scheduler. `updateFromView` consumes full `ClientTiles`/`ClientView`; `panToTile` calls `focusTile(q, r, true)`. This is immediate minimap camera focus, not cancellable remote fly-to. |
| `frontend/game/maps/{GlobalMapOverlay.ts,global-map.css}` | `M` opens an 80vw × 80vh chamfered dialog over the blurred live scene, with a stage-sized canvas, resize observer, legend, coordinate readout, reset, focus trap/restore and backdrop close. Empty surroundings are a flat translucent fill; keep the owner's removal of the decorative hex lattice. |
| `frontend/game/maps/{globalMapViewport.ts,openCloseController.ts}` | Wheel/pinch zoom is **0.35×–8×**, with bounded drag pan; the exported `maxPan()` determines bounds. WASD/arrows pan, Shift speeds pan, Q/E or +/- zoom, 0/Home reset while open. M/Escape close and RTS camera input is suspended. Do not restore the historical plan's 1×–4× limits or describe navigation as infinite. |
| `frontend/game/maps/{MinimapHud.ts,minimapInput.ts,cameraTrapezoid.ts}` | Minimap click/drag pans through the existing focus service, expand opens the map, Resources shares chip state, and the camera footprint overlays the map. Preserve pointer capture and exclusion of HUD controls from pan. |
| `frontend/game/maps/{types.ts,layerRegistry.ts,layerChipsState.ts,builtinLayers.ts}` and `shared/contracts/src/maps/index.ts` | `MapLayerDrawView`, wave-gated layer metadata/registry, and `terra.mapLayers` preferences already exist. Runtime built-ins come from `createBuiltinW04Layers()` (Territory, Terrain, Resources, Units); the feature's metadata helper alone is not the runtime registration list. New sector overlays extend the typed IDs/metadata and registry. Do not recreate chips or drop existing preferences. |
| `frontend/game/maps/{tileColors.ts,resourceLayer.ts,entityDots.ts}` | Terrain/prep colors, owner outlines, explored visible-deposit dots and up to 1,500 entity dots already render. Resources reads public `deposit`, never hidden `subDeposit`. Absent exploration currently has permissive fallbacks; do not use those to represent unloaded data. Other planned layer names are not proof of shipped renderers. |
| `frontend/game/maps/{rasterCache.ts,redrawScheduler.ts}` | Default raster is 256² per `planetId:radius`; cache mirrors dense tile arrays. Dirty-index updates are supported, but `updateFromView` does not supply indices and scans for differences. Scheduler coalesces data redraws at 4 Hz minimap / 2 Hz global; camera, viewport, resize and forced renders also draw directly. Counters are not proof that all rendering meets those rates or time budgets. |
| `frontend/game/app/RTSCamera.ts`, `frontend/game/store/replica/viewCodec.ts` | Current camera and decoded tile/entity interfaces are integration points. Do not assume W04's planned camera relocation, selection-follow or fly-to API has landed. |
| `shared/sim/src/grid/{hex.ts,sectors.ts}`, `shared/sim/src/gen/world/` | Current finite hex indexing and 8×8 axial storage sectors support generation/query/dirty tracking. Gameplay atlas sectors must have distinct IDs and lookup APIs; preserve these internal buckets and existing generation profiles. |

## W11: adapt the map for 4× isolated gameplay sectors and 19-sector Global Map / Orbital Picker

In W11, in-game `PlanetState.grid` loads a **single isolated sector** of radius `R=48` (`7,057` tiles/sector — 4× the previous `R=24` / `1,801`-tile hex area), while the `AtlasManifestV1` / `SectorPartition` metadata defines all `19` surrounding sectors (`7` land sectors = `49,399` land tiles + `12` ocean halo sectors = `84,684` ocean tiles; `134,083` total tiles, `W11_MAX_SMALL_ATLAS_TILES = 140,000`). Crossing sector boundaries in gameplay is blocked in W11 (`reason: 'cross_sector_disabled'`), and infinite/streaming multi-sector loading and seamless cross-sector traversal are deferred to W27.

- **W11-38/-42:** introduce a map read/projection adapter over the shared atlas manifest/query interface. Active gameplay raster painting, terrain/resources/territory, entity fog lookup, minimap picking, coordinate readout and camera bounds/footprint operate on the active `R=48` (`7,057`-tile) isolated sector, while the Global Map (`M` dialog) and Orbital Picker render all `19` surrounding sectors (`7` land + `12` ocean) from the `AtlasManifestV1` / `SectorPartition` metadata. Keep the legacy adapter when W11 is off. Holes/ocean/outside-sector cells must not become invented playable tiles.
- **W11-37/-39/-42:** propagate wide owner identity and viewer-specific exploration through `ClientTiles`, `PlanetRasterEntry.owner` (currently `Int8Array`), dirty comparisons, territory colors and entity-dot classification. Test owners above 127 and 2,250, colony 9 exploration and negative sentinels. A codec-only migration leaves the map truncating identities or leaking visibility.
- **W11-42:** reuse registry/chips for the `'sectors'` overlay, selected sector, home/location and occupancy across all `19` sectors (`7` land + `12` ocean) on both the Orbital Picker and Global Map (`M` dialog), with sector selection, hover, biome/resource summaries, and colony presence badges. In-game crossing of sector boundaries is blocked in W11 (`reason: 'cross_sector_disabled'`); W27 unlocks seamless cross-sector traversal and multi-sector territory outlines. Selecting a sector only changes selection/admission intent; minimap camera pan never reserves a seat or moves a unit.
- **W11-42/-43:** key/invalidate map caches by immutable world/topology identity and viewer where needed. Switching planet or colony, reconnecting and changing flags must discard stale terrain/fog/selection. Publish measured raster scan/paint and layer costs on the `R=48` (`7,057`-tile) active sector and 19-sector manifest fixture (`134,083` total manifest tiles), including camera motion; the fixed canvas resolution alone does not bound CPU work.
- **W11-45:** hand W27 the adapter contracts, manifest/save fixtures, map regression cases, measured bounds and exact completed W04 rows. Do not make W11 depend on W27 summaries or interest subscriptions.

## W27: scale that adapter, unlock cross-sector streaming, and intentionally migrate navigation

- **W27-22/-26/-27:** keep W11's coordinate/identity/query semantics (`R=48`, `7,057` tiles/sector), unlock multi-sector streaming and cross-sector boundary traversal, and extend map views with explicit summary/detail level, revision and unloaded/loading/error state. Use bounded per-sector rasters and manifest summaries; never derive planet radius from the resident tile count, expand a planet-wide canvas, or scan every atlas tile on each update. Include viewer/manifest/subscription invalidation so stale or private tactical data cannot survive reuse.
- **W27-25/-27:** cluster authorized markers instead of silently relying on the 1,500-dot truncation. Keep selected/home cues readable; loaded-neighbour queries must suppress false territory edges across streamed sectors. Unknown detail is not unclaimed terrain, black exploration fog or public enemy information.
- **W27-28/-40–44:** adapt the existing feature service, open/close controller, minimap focus and ground camera to one navigation state. The planned `M` planet-band behavior is an intentional W27-only replacement of today's dialog behavior. Preserve W11/W04 behavior with W27 off; route all active input to one owner, preserve layer preferences/focus restoration, and explicitly map overlay Home/reset versus ground Home/follow. Do not leave the old wheel/key handlers active alongside the new controller.
- **W27-26/-35:** measure dirty detection, layer composition and direct camera/interaction redraws as well as scheduled repaint counters. Evict rasters/listeners with sector resources; zooming out must fetch summaries without subscribing to all fine terrain.

## Required regression evidence

Run the existing baseline before implementation and extend its tests with the owning wave:

```sh
npm test -- frontend/game/maps frontend/game/features/maps
```

The map directory already contains raster, colors, resource, territory/composite, entity-dot, layer-state, minimap-input, viewport, overlay, open/close and scheduler specs. Keep these behavioral cases, adapting assertions only for an intentional wave-gated change.

| Gate | Required evidence |
|---|---|
| W11-32/-42/-43 | Three-profile 19-sector manifest fixture (`7` land + `12` ocean sectors, `R=48`, `7,057` tiles/sector, `134,083` total tiles) with isolated active-sector grid (`PlanetState.grid.radius = 48`): negative coordinates and active-sector tiles pick/paint the canonical tile; all `19` surrounding sectors render on the Orbital Picker and Global Map (`M`); cross-sector gameplay is blocked (`reason: 'cross_sector_disabled'`); high-owner and per-viewer fog cases pass; Resources and `SECTORS` toggles stay synchronized; resize/zoom/pan/readout agree; switching/reconnecting does not reuse stale caches. |
| W27-26–28/-35/-45 | Same W11 fixture after upgrade plus 150/450-sector overview: multi-sector streaming and cross-sector boundary traversal unlocked, summary-only fetches, bounded cache/scan work, unloaded vs unexplored distinction, stale-epoch rejection, clustered dots and latest-request-wins fly-to. |
| Both wave owner checks | Existing minimap controls, layers, keyboard/focus/typing protection and flag-off behavior still work. Record actual URLs, screenshots and performance results; W27 additionally proves reversible ground/globe navigation without duplicate input. |

Limitations tracked in [FF-64 and FF-65](../questions-and-limitations/frontend-features.md#w04-maps--camera-2026-11-03). Update this handoff as code lands; do not mark these gates passed from documentation review alone.
