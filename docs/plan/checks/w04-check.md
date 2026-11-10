# W04 — Maps & Camera: owner check

> The wave's demo story ([`waves/W04-maps-camera.md`](../waves/W04-maps-camera.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 10 minutes.

## Before you start

- **Where it runs:** branch `wave/w04-maps-camera`, worktree `../TerraAgent-wt/w04`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4300` → app **4301**, client **5473** (`TA_DB_NAME=terra_wave_w04_maps_camera`). Below, `<client>` = `http://127.0.0.1:5473`, `<app>` = `http://127.0.0.1:4301`.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w04 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. Press **`` ` ``** or **Esc** to close it. It is **not** the browser's DevTools console.
- **Map shortcuts & debug handle:** press **`M`** (or click the **`⤢`** expand button in the top-right corner of the minimap) to open the fullscreen **Global Planet Map**; press **`M`**, **`Esc`**, or click **`CLOSE [ESC]`** to close it. In the browser DevTools console, `window.__online.minimap` exposes `{ dirtyTiles, redrawHz, globalRedrawHz, cameraWorldPos }`.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Minimap HUD, tile-state colours, entity dots & camera footprint trapezoid.**
   - Open `<client>/play.html?scenario=w04` → the W04 scenario planet loads with Colony A at `(0, 0)` (Command Hub, HQ drone, 2 Worker Drones (T1), prepared pad and living ring) and Colony B at `(10, -8)` (Command Hub and HQ drone), plus flat grass, sand, rock, forest, water, and surface deposits across the disc.
   - In the **top-left corner** (`180 × 180 px` chamfered Faction Plate, the Colony book below it; the Command Dock is top right), **see** the **Minimap**:
     - Hex tiles coloured by state and terrain class from the `--ta-*` Faction Plate palette (Prepared pad grey, Living ring green, Wild flat/sand/rock/forest/water in their distinct terrain colours, deposits highlighted).
     - **Entity dots** on top of the terrain raster: your colony's Hub, HQ and Worker Drones (T1) in **Signal Orange**, and Colony B's Hub and HQ in its foreign colony colour.
     - A crisp **white camera footprint trapezoid** showing the 3D camera's ground-plane frustum around `(0, 0)`.
   - Press **`Q`** or **`E`** to yaw the 3D camera by `90°` → **see** the white trapezoid on the minimap rotate `90°` to match.
   - Open the in-game dev console (**`` ` ``**) and run `spawndeposit 3 -2 metals 1` → only that single hex is repainted in the offscreen raster cache (`window.__online.minimap.dirtyTiles === 1` in browser DevTools). Run `spawn robot.miner 4 -2` → **see** a new orange unit dot appear on the minimap and move as the robot walks.
   - *(Hackathon slice note: fog-of-war rendering W04-08 and foreign-territory diagonal border hatching W04-06 are deferred out of the `H` slice; see [`frontend-features.md`](../../questions-and-limitations/frontend-features.md) FF-64.)*
2. **Click on the minimap to pan the 3D camera.**
   - Click near the **far top-right or bottom-left corner** of the minimap canvas (away from the `⤢` expand button) → **see** the 3D diorama camera pan immediately to that part of the planet and the white camera trapezoid jump to the clicked spot.
   - Click the **`⤢`** expand button in the top-right corner of the minimap → **see** the Global Map open **without** panning the 3D camera; press **`Esc`** to close it.
3. **Drag across the minimap & responsive phone-landscape sizing.**
   - Press and hold the left mouse button inside the minimap and drag smoothly across the planet disc → **see** the 3D camera and white trapezoid follow the pointer continuously without jitter (`window.__online.minimap.redrawHz <= 4`).
   - Resize the browser viewport to phone landscape (`844 × 390` in responsive device toolbar) → **see** the minimap shrink to **`140 × 140 px`** cleanly with no HUD overlap; restore the desktop viewport size.
4. **Open the fullscreen Global Planet Map (`M` / expand button).**
   - Press **`M`** (or click **`⤢`** on the minimap) → **see** the **Global Planet Map** pop-up (`GLOBAL SECTOR MAP`): a bordered, chamfered dialog taking **80 %** of the screen, centred over a flat, half-transparent, blurred view of the game (clicking that blurred area outside the dialog closes it), with:
     - The **layer-chip bar** along the top (**`TERRITORY`**, **`TERRAIN`**, **`RESOURCES`**, **`UNITS`**, each lit in Signal Orange with dark void text when active).
     - The interactive 2D planet map filling the dialog on a flat translucent fill (no black square, no hex pattern around the planet), showing the hex grid, territory fill/outline rings for Colony A and Colony B, entity dots, and the white camera footprint trapezoid.
     - The **tile-colour legend** along the bottom (`Flat`, `Hill`, `Water`, `Prepared`, `Living`, `Ridge / Moat`, `Your Units`, `Other Colony`, `Fauna`).
     - The **`FIT [1×]`** and **`CLOSE [ESC]`** plates in the top-right header.
   - While the Global Map is open, press **`W` / `A` / `S` / `D`** (or drag with the mouse) → **see** the *map* pan (the 3D camera stays suspended); `Q` / `E` zoom, `0` recenters; the bottom-left readout shows zoom and map position. On the minimap, click **`◆`** → deposit dots (metals yellow, minerals pink, oil red) toggle. Press **`Tab`** repeatedly → focus cycles strictly inside the overlay's interactive buttons (`focus trap`).
5. **Layer chips toggle redraw & wave-gated layers (`&waves=..04`).**
   - In the Global Map's top chip bar, click **`TERRAIN`** to toggle it off (`aria-pressed="false"`) while keeping **`TERRITORY`** on → **see** the map redraw immediately over the flat translucent dialog fill, with the territory overlays + unit dots standing out clearly. Click **`TERRAIN`** again to turn it back on.
   - Toggle **`TERRITORY`** or **`UNITS`** off and on → **see** each layer redraw immediately (and persist across page reloads in `localStorage`).
   - Open `<client>/play.html?scenario=w04&waves=..04` and press **`M`** → **see** only the **`TERRITORY`**, **`TERRAIN`**, **`RESOURCES`** and **`UNITS`** chips; **`Market`** (`W13`), **`Threats`** (`W07`) and **`Walls`** (`W14`) chips are absent because their producer waves are off.
6. **Global map wheel-zoom (`1×–4×`) & pan** *(click-to-fly `W04-20` is stretch `H+`, not in this landing)*.
   - With the Global Map open (`M`), scroll the mouse wheel over the map canvas → **see** the map zoom toward the cursor (`0.35×`–`8×`), drag to pan freely (also at `1×`; the planet can leave the view but never entirely), and click **`RESET [0]`** to recenter.
   - Press **`M`** or **`Esc`** (or click **`CLOSE [ESC]`**) → **see** the Global Map close.
7. **Box selection & selection panel** — *not in this landing* (`W04-23` and `W04-24` are stretch `H+`). Left-clicking the HQ drone continues to use W01's click-select. Skip.
8. **Control groups (`Ctrl+1..9` / `1..9`)** — *not in this landing* (`W04-25` is full-product scope). Skip.
9. **Alert pings (`alert.ping`)** — *not in this landing* (`W04-02` and `W04-12` are stretch `H+`). Skip.
10. **Earlier waves stay clean (`&waves=..03`).**
    - Open `<client>/play.html?scenario=w04&waves=..03` → **see** no minimap, pressing **`M`** does nothing (no Global Map overlay opens), and camera controls behave identically to W01–W03.

## Automated checks (already green on the branch)

`npm run check` · `npm test` · `npm run build` · `npm run e2e -- --waves 04 --hack` (6/6 passing) · `npm run e2e -- --waves 04 --host local --hack` (6/6 passing) · `npm run e2e -- --waves ..04 --hack` (W00 + W01 + W02 + W04 = 27/27 passing) · `npm run e2e -- --waves ..04 --host local --hack` (12 passed, 15 server-only skipped).

## When you're done

- **All good:** from the main checkout (`/Users/ferretrec/work/TerraAgent`) run `npm run wave -- land 04`. It re-runs the gates, merges W04 into `main`, tags `wave-04`, pushes, and removes the W04 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
