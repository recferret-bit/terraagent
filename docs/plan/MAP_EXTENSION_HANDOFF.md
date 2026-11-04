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

## W11: adapt the map before calling the small atlas playable

W11 may keep bounded full-state replication, but cannot feed concatenated sector arrays into today's single-radius map unchanged.

- **W11-38/-42:** introduce a map read/projection adapter over the shared atlas manifest/query interface. Current `radiusFromTileCount`, `hexIndex(radius)`, `inHex` and origin-centred pixel transforms assume one complete hex disk. Replace those assumptions for atlas mode throughout raster painting, terrain/resources/territory, entity fog lookup, minimap picking, coordinate readout and camera bounds/footprint. Keep the legacy adapter when W11 is off. Holes/ocean/outside-atlas cells must not become invented playable tiles.
- **W11-37/-39/-42:** propagate wide owner identity and viewer-specific exploration through `ClientTiles`, `PlanetRasterEntry.owner` (currently `Int8Array`), dirty comparisons, territory colors and entity-dot classification. Test owners above 127 and 2,250, colony 9 exploration and negative sentinels. A codec-only migration leaves the map truncating identities or leaking visibility.
- **W11-42:** reuse registry/chips for the sector overlay, selected sector, home/location and occupancy. Sector borders are distinct from territory borders; neighbour ownership queries cross sector edges so a continuous base does not acquire false internal outlines. Selecting a sector only changes selection/admission intent; minimap camera pan never reserves a seat or moves a unit.
- **W11-42/-43:** key/invalidate map caches by immutable world/topology identity and viewer where needed. Switching planet or colony, reconnecting and changing flags must discard stale terrain/fog/selection. Publish measured raster scan/paint and layer costs on the seven-sector fixture, including camera motion; the fixed canvas resolution alone does not bound CPU work.
- **W11-45:** hand W27 the adapter contracts, manifest/save fixtures, map regression cases, measured bounds and exact completed W04 rows. Do not make W11 depend on W27 summaries or interest subscriptions.

## W27: scale that adapter and intentionally migrate navigation

- **W27-22/-26/-27:** keep W11's coordinate/identity/query semantics and extend map views with explicit summary/detail level, revision and unloaded/loading/error state. Use bounded per-sector rasters and manifest summaries; never derive planet radius from the resident tile count, expand a planet-wide canvas, or scan every atlas tile on each update. Include viewer/manifest/subscription invalidation so stale or private tactical data cannot survive reuse.
- **W27-25/-27:** cluster authorized markers instead of silently relying on the 1,500-dot truncation. Keep selected/home cues readable; loaded-neighbour queries must suppress false territory edges. Unknown detail is not unclaimed terrain, black exploration fog or public enemy information.
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
| W11-32/-42/-43 | Three-profile seven-sector fixture: negative coordinates and all shared edges pick/paint the same canonical tile; cross-sector territory has no artificial border; high-owner and per-viewer fog cases pass; Resources toggle stays synchronized; resize/zoom/pan/readout agree; switching/reconnecting does not reuse stale caches. |
| W27-26–28/-35/-45 | Same W11 fixture after upgrade plus 150/450-sector overview: summary-only fetches, bounded cache/scan work, unloaded vs unexplored distinction, stale-epoch rejection, clustered dots and latest-request-wins fly-to. |
| Both wave owner checks | Existing minimap controls, layers, keyboard/focus/typing protection and flag-off behavior still work. Record actual URLs, screenshots and performance results; W27 additionally proves reversible ground/globe navigation without duplicate input. |

Limitations tracked in [FF-64 and FF-65](../questions-and-limitations/frontend-features.md#w04-maps--camera-2026-11-03). Update this handoff as code lands; do not mark these gates passed from documentation review alone.
