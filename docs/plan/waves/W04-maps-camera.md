# W04 — Maps & Camera

> **Track:** Client (C) · **Flag:** `W04` · **Tag:** `wave-04` · **Scenario:** `scenarios/w04-maps-camera.ts` · **Depends on:** W01 (rendered planet, HQ, Hub, full-state store)
> **Specs:** [`CLIENT.md`](../../spec/CLIENT.md) §8b (minimap, global map, rings), §9 (performance), §11 (devices, accessibility) · [`AGENTS.md`](../../../AGENTS.md) Pillar 4 (28° telephoto diorama viewport) · D-22, D-24 (full state, client-side fog), D-29 · [`CLAUDE.md`](../../../CLAUDE.md) (Faction Plate UI rules)
> **Owned paths:** `frontend/game/maps/**`, `frontend/game/camera/**`, `frontend/game/core/selection/**`, `frontend/game/core/input/**` (except `core/input/touch/**`, owned by W24).
>
> **Already exists (prototype):** `frontend/game/app/RTSCamera.ts` (28° diorama camera: WASD/arrows and 8 px edge pan with zoom-scaled speed, MMB drag, wheel zoom clamped 20–95, `Q`/`E` 90° yaw, pan clamped to the surface bounds, hero follow on `Home`/held `F`, `focus()`), driven from `frontend/game/app/Gameplay.ts`. W04-26 moves it to `frontend/game/camera/` and only adds what is missing. There is no minimap, global map, box selection or control groups yet; click-select of the HQ comes from W01-26.

## Goal

The player always knows where they are on the planet and can move anywhere in one gesture:
- an always-on **minimap**;
- a fullscreen **global planet map** with data layers;
- proper **unit selection** (click, box, control groups);
- a polished RTS **camera** (edge pan, zoom limits, follow, click-to-fly).

Layers and markers belonging to waves that are not enabled stay hidden. W04 depends only on W01, so it can be built in parallel with W02, W03 and the rest.

## Demo story (`e2e/w04.spec.ts`)

1. Open `/play.html?scenario=w04`: a W01 colony (HQ, Hub, prepared ground), a second colony far away, and the map partly explored → **see** the minimap at the bottom-left showing tile states, own territory in orange, explored tiles dim and unexplored tiles black, and a white camera trapezoid.
2. Click the far corner of the minimap → **see** the camera pan there and the trapezoid move.
3. Drag on the minimap → **see** the camera follow the drag continuously.
4. Press `M` → **see** the global map fullscreen, with layer chips.
5. In the map's layer chips toggle `Terrain` off and `Territory` on → **see** the map redraw. Reload with `&waves=..04` (or `TA_WAVES=..04 npm run dev:restart`) → the `Market`, `Threats` and `Walls` chips are absent.
6. Wheel-zoom to 3× and click a tile → **see** the overlay close and the camera fly to that tile.
7. Drag a selection box around the HQ → **see** the selection ring and the selection panel.
8. Press `Ctrl+1`, deselect, press `1` → **see** the HQ selected again; press `1` twice → **see** the camera centre on it.
9. In the dev console run `alert.ping 40 12` → **see** a pulse on the minimap at that spot for 5 s.
10. Reload with `&waves=..03` → **see** no minimap, no `M` handling and the old W01 camera behaviour.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–5, 10. Step 1 is checked without fog and foreign-territory hatching (W04-08 is post-hackathon, W04-06 is a stretch): the `@hack` run asserts only the minimap tile colours and the camera trapezoid. `W04-33` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** click-to-fly (step 6), selection core and control groups (steps 7–8), alert pings (step 9), fog, hover cards, the 3D tile overlay, camera polish.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Minimap plate 180 × 180 px (140 px in phone landscape), chamfered, bottom-left HUD (§8b) | W04-04, W04-05 |
| 2 | Cached 2D canvas of the hex grid, tile colours by state: Wild by terrain class, Prepared grey, Living green, Ridge/Moat dark, water blue (§8b) | W04-03, W04-04 |
| 3 | Territory borders in colony colour plus hatch pattern (colour-blind rule §11) | W04-06 |
| 4 | Dots: own units and buildings orange, other colonies in their colour, fauna red, Guild ship blue (§8b) | W04-07 |
| 5 | Fog from the full state (CL-16): unexplored black, explored dim | W04-08 |
| 6 | Camera footprint trapezoid | W04-09 |
| 7 | Click or tap to pan, drag to pan continuously | W04-10 |
| 8 | Expand icon or `M` opens the global map | W04-11 |
| 9 | Alert pulses (`underAttack`, raid incoming, meteor) at their position for 5 s | W04-12 |
| 10 | Global map: fullscreen overlay, close on `Esc` / `M` / close plate | W04-13 |
| 11 | Zoom 1×–4× (wheel and pinch), fit to screen | W04-14 |
| 12 | Layers Territory · Terrain · Terraform % (heat map) · Resources/deposits · Units · Threats · Market · Walls, as toggle chips (orange when active). Layers of disabled waves are hidden | W04-15 … W04-18 |
| 13 | Colony hover card: name, stage, truce state | W04-19 |
| 14 | Click to fly the camera; shift-click places rally / attack-move for the selection (hook used by W07) | W04-20, W04-21 |
| 15 | 2D canvas layer (not the 3D scene), redrawn on deltas at ≤ 2 Hz | W04-03, W04-22 |
| 16 | Selection: click, box select, shift-add, double-click selects the same type on screen, control groups `Ctrl+1..9` / `1..9`, double-tap to centre | W04-23 … W04-25 |
| 17 | Camera: edge pan, WASD / arrows, `Q`/`E` 90° yaw and bounds clamp already exist; add follow the selection (`F`), smooth fly-to, zoom limits per planet size, `prefers-reduced-motion` disables easing (§11) | W04-26, W04-27 |
| 18 | Tile-state overlay in 3D (Wild / Prepared / Living / Wall) shown with the Terraform menu or a ghost footprint (UO-TF, D-16) | W04-28 |
| 19 | Hover card for tiles, units and buildings in 3D (terrain, prep state, owner, HP) | W04-29 |
| 20 | Keyboard shortcuts in the `?` overlay; Tab order; focus rings; ARIA labels on minimap and chips (§11 WCAG 2.2 AA) | W04-30 |
| 21 | Performance: minimap redraw ≤ 1 ms p95, global map redraw ≤ 8 ms at ≤ 2 Hz, total draw calls still ≤ 60 (§9) | W04-31 |
| 22 | Touch basics for maps: tap the minimap, pinch the global map (full touch camera is in W24) | W04-14, W04-10 |
| 23 | Analytics: `map_opened`, `minimap_jump`, `map_layer_toggled`, `control_group_set` | W04-32 |
| 24 | Dev console: `alert.ping x y`, `fog.reset`, `camera.goto x y` (`reveal` is W01-35's) | W04-02 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W04-01 | Contracts & data: register flag `W04`; client-only `MapLayer` registry contract (`id`, `wave`, `draw(ctx, view)`); `alertPing` event schema; map layer ids | contract | S | H | W01-01 | Boot with `TA_WAVES=..03` → see the `W04` flag reported off in the flag panel and no layer registered | PRODUCT_WAVES §3–4 | — |
| W04-02 | Dev console commands `alert.ping`, `fog.reset`, `camera.goto` (`reveal` is W01-35's) | client | S | H+ | W00-40, W04-01 | Run `camera.goto 40 12` → see the camera move to tile 40,12 | PRODUCT_WAVES §3 | — |
| W04-03 | Hex-grid → 2D raster cache: one offscreen canvas per planet; repaint only dirty tiles from deltas | client | M | H | W04-01 | Change one tile's prep state with the console → see only that tile repainted (counter `minimap.dirtyTiles = 1`) | CLIENT §8b | TA-15.6 |
| W04-04 | Tile colour table (terrain classes, Prepared, Living, Ridge/Moat, Shallow/Deep water) from `--ta-*` tokens | data | S | H | W04-03 | Load the scenario → see every terrain class in its own colour, matching the legend in the `?` overlay | CLIENT §8b, UO-TF | TA-15.6 |
| W04-05 | Minimap HUD plate: 180 px chamfered Faction Plate, bottom-left, expand icon; 140 px in phone landscape | client | S | H | W04-03 | Resize to 844 × 390 → see the minimap at 140 px with no overlap with the HUD | CLIENT §8b, CLAUDE.md | TA-15.6 |
| W04-06 | Territory borders: colony colour plus diagonal hatch for foreign territory, from tile owners | client | S | H+ | W04-03 | Load the scenario → see own borders in orange and the second colony hatched in its colour | CLIENT §8b, §11 | TA-15.6 |
| W04-07 | Entity dots layer: own orange, foreign colony colour, fauna red, Guild blue; ≤ 1 500 dots | client | S | H | W04-03 | Spawn 20 robots with the console → see 20 orange dots updating as they move | CLIENT §8b | TA-15.6 |
| W04-08 | Fog render from the full state: draw the sim's explored mask (`grid.explored`, W01-08) and visible set (W07-08's colony view set when W07 is on; with W07 off every explored tile counts as visible); the client never recomputes visibility | client | M |  | W04-03, W01-08 | Run `fog.reset` → see the map black except the colony's view; move the HQ → see newly explored tiles turn dim | CLIENT CL-16, D-24 | TA-15.6 |
| W04-09 | Camera footprint trapezoid: project the 4 frustum corners onto the ground plane | client | S | H | W04-05 | Yaw with `Q` → see the trapezoid on the minimap rotate 90° | CLIENT §8b | TA-15.6 |
| W04-10 | Minimap input: click/tap pans, drag pans continuously, pointer capture; no pan when the click lands on the expand icon | client | S | H | W04-09 | Drag across the minimap → see the camera follow without jitter | CLIENT §8b | TA-15.6 |
| W04-11 | Open/close wiring: expand icon and `M` open; `Esc`, `M` or close plate close; the 3D input is suspended while open | client | S | H | W04-05 | Press `M` twice → see the overlay open and close; WASD does not move the camera while it is open | CLIENT §8b | TA-15.7 |
| W04-12 | Alert pings: subscribe to `underAttack`, `raidIncoming`, `meteorWarning` events (no-ops if their waves are off); 5 s pulse on minimap and global map | client | S | H+ | W04-07 | Run `alert.ping 10 10` → see a red pulse at 10,10 for 5 s | CLIENT §8b | TA-15.6 |
| W04-13 | Global map overlay shell: fullscreen Faction Plate overlay, legend, layer-chip bar, close plate, focus trap | client | M | H | W04-11 | Press `M` → see the fullscreen map with chips, legend and close plate; Tab cycles inside the overlay only | CLIENT §8b, §11 | TA-15.7 |
| W04-14 | Global map zoom and pan: fit to screen, wheel and pinch 1×–4×, drag pan, clamp to the planet bounds | client | S | H | W04-13 | Pinch on a touch emulator → see the zoom clamp at 4× | CLIENT §8b | TA-15.7 |
| W04-15 | Layer registry plus chips: each layer declares a `wave`; a chip shows only if its flag is on; chip state persisted in `localStorage` (try/catch) | client | S | H | W04-13 | Run with `TA_WAVES=..04` → see only the Territory, Terrain and Units chips | PRODUCT_WAVES §3, CLIENT §8b | TA-15.7 |
| W04-16 | Layers Territory, Terrain, Units (built in), drawn from the W04-03 cache | client | S | H | W04-15 | Toggle Terrain off → see a flat background with territory and units only | CLIENT §8b | TA-15.7 |
| W04-17 | Layers Terraform % heat map (per-region Living ratio) and Resources/deposits (icons plus colour + shape, never colour only) | client | M |  | W04-15 | Enable Resources → see deposit icons with a shape per resource family (Metals / Minerals / Bio, D-34) | CLIENT §8b, §11 | TA-15.7 |
| W04-18 | Threats, Market and Walls layer renderers (owned here; producer waves only supply data): Threats = nests and raid markers from the full state (W07), Market = price tags from W13-25's `/v1/market/{planetId}/stalls`, Walls = Ridge/Moat/Gate tiles from the full state (W14); each chip registers with its producer's wave flag and the layer stays empty while that wave is off | client | M |  | W04-15 | Run with `TA_WAVES=all` but no W07 data → see the Threats chip render an empty layer without errors | PRODUCT_WAVES §4 | TA-15.7 |
| W04-19 | Colony hover card on the global map: name, stage, online/away, truce state (fields hidden until their waves are on) | client | S |  | W04-16 | Hover the second colony → see its name and stage card | CLIENT §8b | TA-15.7 |
| W04-20 | Click-to-fly: click a map point → close the overlay and ease the camera there (instant with reduced motion) | client | S | H+ | W04-14, W04-26 | Click a far tile → see the overlay close and the camera arrive within 0.6 s | CLIENT §8b, §11 | TA-15.7 |
| W04-21 | Order hook: shift-click on the minimap or global map emits `mapOrderIntent {x, y, kind}` for the current selection; W07 binds rally and attack-move to it | client | S |  | W04-20, W04-23 | Shift-click with the HQ selected → see a `mapOrderIntent` logged in the dev console | CLIENT §8b, UO-M | TA-15.7 |
| W04-22 | Redraw scheduler: coalesce deltas, ≤ 2 Hz for the global map and ≤ 4 Hz for the minimap, paused when the tab is hidden | client | S | H | W04-03 | Spawn 300 moving units → see the redraw counters stay at ≤ 2 Hz / ≤ 4 Hz | CLIENT §8b, §9 | TA-15.6 |
| W04-23 | Selection core (extends W01-26's click-select of the HQ): shift-add, box select (screen-space rect over instanced entities), double-click selects the same type on screen; selection store | client | M | H+ | W01-26 | Box-select 5 harvesters (scenario) → see 5 selection rings and "5 selected" | CLIENT §8 | TA-11.6 |
| W04-24 | Selection rings and selection panel (single: name, HP, task; multi: type counts), Faction Plate | client | S | H+ | W04-23 | Select the Hub → see its name, HP and queue summary in the panel | CLIENT §8, CLAUDE.md | TA-11.7 |
| W04-25 | Control groups: `Ctrl+1..9` assign, `1..9` recall, double-press centres the camera; groups survive reconnect (client memory) | client | S |  | W04-23 | Assign the HQ to group 1, deselect, press 1 twice → see the HQ selected and centred | CLIENT §11 | — |
| W04-26 | Move the existing `frontend/game/app/RTSCamera.ts` to `frontend/game/camera/`; add `flyTo(target, ms)` with easing; turn the hero-only `followTarget` (`Home` / held `F`) into a `follow(entity)` toggle on `F` bound to the selection store | client | S | H+ | W01-26 | Select the HQ, press `F` → see the camera follow the walking HQ | AGENTS.md Pillar 4 | TA-11.5 |
| W04-27 | Camera polish (pan, edge pan, yaw and bounds clamp already exist): zoom limits from the planet size instead of the fixed 20–95, no edge pan while the pointer is over the HUD or minimap, reduced motion disables yaw/zoom/fly easing | client | S |  | W04-26 | Enable `prefers-reduced-motion` and press `Q` → see the yaw snap 90° with no easing | CLIENT §11, Pillar 4 | TA-11.5 |
| W04-28 | Instanced tile-state decal: replace W01-27's tile-state overlay with one instanced hex decal per tile coloured by state (one draw call), shown while the Terraform menu or a ghost footprint is open | visual | M |  | W04-04, W01-27 | Open the Terraform menu → see Wild, Prepared and Living tiles tinted; close it → see the overlay gone | UO-TF-01, CLIENT §8 | TA-11.8 |
| W04-29 | 3D hover card: raycast to a tile or entity; show terrain class, prep state, owner, HP; delayed 250 ms — extend the existing `frontend/game/app/groundPick.ts` raycast | client | S |  | W04-23 | Hover a rock tile → see "Rock · Wild · unclaimed" | CLIENT §8 | — |
| W04-30 | Accessibility: `?` shortcut overlay lists the map, selection and camera keys; ARIA labels on minimap, chips and map; visible focus rings; contrast ≥ 4.5:1 on chips | client | S |  | W04-13 | Run the e2e axe check with the global map and the `?` overlay open → see 0 violations | CLIENT §11 | — |
| W04-31 | Performance probe: minimap repaint ≤ 1 ms p95, global map redraw ≤ 8 ms p95, draw calls ≤ 60 with the overlay closed | test | S |  | W04-22, W04-28 | Run `npm run e2e:perf -- w04` → see all three budgets green | CLIENT §9 | — |
| W04-32 | Analytics events `map_opened`, `minimap_jump`, `map_layer_toggled`, `control_group_set` via `track()` | client | S |  | W04-11, W04-25 | Open the map → see `map_opened` in the dev analytics log | CLIENT §10 | — |
| W04-33 | Wave e2e `e2e/w04.spec.ts` + scenario `w04-maps-camera` (two colonies, partial exploration) + tag `wave-04` | test | M | H | W04-02 … W04-32 | Run `npm run e2e -- --waves ..04` → see the demo story pass and the W00–W03 suites still green | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w04.spec.ts` passes, and every earlier wave's e2e still passes.
- `?scenario=w04` loads into the demo state.
- With `TA_WAVES=..03` there is no minimap, no global map and no `M` handling, and the camera behaves as in W01.
- Tag `wave-04` exists.
- Every row of the features table is covered by a closed issue.
