# W01 — Landfall: owner check

> The wave's demo story ([`waves/W01-landfall.md`](../waves/W01-landfall.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 10 minutes.

## Before you start

- **Where it runs:** branch `wave/w01-landfall`, worktree `../TerraAgent-wt/w01`. Your main checkout is untouched.
- **Ports:** this worktree's `.env.worktree` sets `TA_PORT_BASE=4200` → app **4201**, client **5373** (`TA_DB_NAME=terra_wave_w01_landfall`). Below, `<client>` = `http://127.0.0.1:5373`, `<app>` = `http://127.0.0.1:4201`.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w01 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat .dev/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. Press **`` ` ``** or **Esc** to close it so it doesn't cover the bottom menus. It is **not** the browser's DevTools console.
- **Second player / fresh guest profile:** open a private/incognito window (or pass `?as=b`, `?as=c`, …) so a new `terra.deviceSecret` is generated.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Hub, Planet Selection & Full 3D Drop-Pod Descent (`full` mode).**
   - Open `<client>/` (`http://127.0.0.1:5373/`) → you see 4 primary cards: **01 · Landing** (`/landing.html`), **02 · Planet Selection** (`/play.html?planet=dune` with quick links to `KHARON DUNES`, `THALASSA VERDE`, `GRANITE HOLLOW`), **03 · Play** (`/play.html`), and **04 · Playground** (`/playground.html`).
   - Click **02 · Planet Selection** (`http://127.0.0.1:5373/play.html?planet=dune`, `oceanForest`, or `forestRock`) → select a planet (e.g. **KHARON DUNES**) and click **DEPLOY COLONY**:
     - The `full` descent state machine plays seamlessly through `orbit` → `release` → `freefall` → `reentry` → `chute` → `approach` (where the chute releases at `155 m → 21 m` and the camera swings smoothly into the 28° isometric diorama angle over the matching biome terrain, with no `CONNECTING...` flash or terrain pop) → surface `retro` (`21 m → 0 m`).
     - At touchdown (`impact_wait`, `2.0 s`), the pod slams into the hex tile creating a **3D impact crater**, shockwave rings, flying debris, and dust burst while the retro engines throttle down. **No UI/HUD is visible for 2 full seconds**.
     - Next (`egress`, `1.25 s`), the pod's **4 conical petals and front ramp open**, the **Hero Explorer** (`robot.hero`) rolls out down the ramp onto the hex tile while the pod shell retracts into the crater (no pod remains sitting in place), and at `done` (`5.0 s`) the gameplay HUD appears.
   - Verify the ground (D-38): the dev planet is a **desert** — around the landing you see a round, perfectly flat sand disc (the levelled landing zone, like terraformed ground) easing into **dune fields**, **mesas / buttes** with rock crags and **mountain ridges**; no forest, no water. Look around with the arrow keys: dunes are real relief (the camera and the HQ follow the height), not painted sand. Clearing / breaking a rock tile can reveal a buried deposit (event `groundRevealed`). Scenario planets keep their type: `?scenario=w01` is temperate (forest + water + highland rock).
   - Press **Esc** in-game → click **Return to orbit** → you return to the 3D Planet Selection screen and the URL updates to `<client>/play.html?planet=<kind>` (so pressing **F5** on Planet Selection reloads Planet Selection, whereas pressing **F5** while in-game reloads `<client>/play.html`).
2. **Short Landing Sequence & Compact Icon HUD (`<client>/play.html`, `short` mode).**
   - Open `http://127.0.0.1:5373/play.html` directly (or `http://127.0.0.1:5373/play.html?scenario=w01` for a fresh scenario planet) → it runs the `short` state machine (`retro` → `impact_wait` 2s with no UI → `egress` 4-petal pod open + Hero Explorer rollout → `done`). Neither the Command Hub nor the Hero Explorer is pre-placed before the pod lands and opens.
   - Once `done` (`5.0 s`), the **compact icon resource header** at the top-centre shows crisp SVG icons + numbers (hover any pill for its tooltip): **Metals `600/500`**, **Minerals `350/500`**, **Bio `400/500`**, **Supply `0/0`**, and **HQ Cell `800/800 E`**.
   - The top-left **HQ Status Panel** shows **HULL HP `900 / 900`**, **POWER CELL `800 / 800 E`**, and task `idle`. Left-clicking the Hero Explorer (or clicking `SELECT HQ`) selects it; right-clicking any passable hex tile orders `moveUnit` and the HQ walks there smoothly along the hex A\* path (around trees, rock and deposits). Right-click a tree, rock or crystal tile → **one** toast `Rejected: Site blocked` (not one per click event); right-click a tile walled in by obstacles → **one** toast `No path: the HQ cannot reach that tile` and the HQ stays put. Same in solo mode (`?host=local&scenario=w01`).
3. **Construction menu, 3×3 Hub ghost and placement rules.** In the bottom-right **CONSTRUCTION** panel, only **`Command Hub [H] · 200 Metals · 100 Minerals · 50 Biomass · 50 Water`** is listed. Click it (or press **`H`**) → the 3×3 **Hub placement ghost** opens on the nearest valid site to the HQ (`Valid site (3×3)`, green 3D footprint + translucent Hub) with the live prep bill (`N/9 tiles to prepare`, `Grade N · Clear 0 · Break 0`, `…s (HQ 1.5×)`, `… E`).
   - Move the mouse over **trees** → the footprint turns red on the forest tiles and the card reads `trees: clear them first`; over **rock** → `rock: break it first`; over **water** → `water`; over a **resource deposit** (metal / crystal / oil props) → `resource deposit`; over another colony's land → `not your territory`. **CONFIRM** is disabled on every red site.
   - Server check (the client cannot bypass it): open the **browser DevTools** console (not the in-game one) and run `__online.commands.send('placeBuilding', { building: 'commandHub', q: <forest q>, r: <forest r> })` for a forest tile → it resolves `{ ok: false, code: 'terrain_unbuildable' }`. Same result with `?host=local&scenario=w01` (single player, Worker host).
   - Terraform first: select **CLEAR [C]** in **TERRAFORM OPS**, clear a tree tile at the edge of a site, wait until it is Flat → hovering that site turns green.
   - Click **CONFIRM** on a valid site.
4. **Linked site preparation (Grade only).** Confirm a site **8–10 tiles away** from the HQ. Watch the HQ **walk** there smoothly at a constant pace along a path around trees, rock and resource deposits (blue crystals, ore, oil): it never jumps, snaps, or steps back and forth, even if you right-click the same tile several times or start it from a corner, stop 1–2 tiles from the nearest un-prepared tile, face it and Grade the tiles one by one, nearest first (`Wild → Prepared`), walking between them. As each tile finishes:
   - The hex tile blends smoothly (0.4 s shader transition) into the **Prepared** foundation hex-plate pad material.
   - The **HQ CELL** bar drains `20 E` per Grade (tip: type `warp 10` in the dev console and press **`` ` ``** to close the console so you can watch at 10× speed).
   - While tiles are being prepared, the **CONSTRUCTION** order row reads `waiting(site: n/9)`.
5. **Command Hub construction & scaffold stages.** As soon as all 9 footprint tiles are `Prepared` (`9/9`), construction starts automatically:
   - Nothing is deducted up front: colony stock drains **gradually over the build** (total **200 Metals, 100 Minerals, 50 Biomass, 50 Water**, spent in proportion to progress). The HQ first walks out of the footprint to a tile 2–3 tiles from the site centre (the order reads `waiting(builder: HQ en route)` meanwhile); progress only advances while it stands there. Right-click elsewhere mid-build → the HQ walks away and the build pauses; it walks back by itself once idle. Stop test: in the browser DevTools console, `__online.commands.send('stopUnit', { entityId: <hq id> })` halts it on the spot and it resumes queued work after 5 s. If stock runs short the order shows `waiting(resources: …)` and resumes when stock arrives. Cancelling refunds 75 % of what was spent so far.
   - The order status changes to `in_progress` and the `building.commandHub` mesh rises through its 4 vertical shader construction stages (`0%` foundation → `33%` skeleton → `66%` hull → `100%` active spire + beacon).
   - After 20 s of HQ build time (`30 s` base at HQ `1.5×`, ~2 s under `warp 10`), the **Command Hub** completes (`buildingCompleted` + `colonyFounded`).
6. **Territory ring (R 10) & Hub caps.** When the Command Hub completes:
   - A glowing **R 10 territory border ring** appears around the Hub in the colony's faction colour (click **`BORDER: SOLID`** in the top-right panel or run `border-hatch on` in the dev console to toggle the colour-blind diagonal hatch pattern).
   - The top-centre HUD shows storage caps **`500`** per resource family (`Metals … / 500`, `Minerals … / 500`, `Bio … / 500`) and **`Supply 0 / 10`**.
7. **Survives a server restart.** Keep the browser tab open after the Command Hub is built. In a terminal inside `../TerraAgent-wt/w01`, run `npm run dev:restart` → the page shows the **"Reconnecting…"** banner for a few seconds, then reconnects and restores the exact same colony with its completed Command Hub, prepared 3×3 pad tiles, territory border ring, and `Supply 0 / 10`.
8. **Auto-placement after 60 s idle (`UO-LC-07`)** — *not in this landing* (`W01-18` is stretch `H+`). Skip.

## 3D Kitbash & Playground QA (Pillar 1 & Pillar 4)

- Open `<client>/playground.html?inspect=robot.hero&validate=1` and `<client>/playground.html?inspect=building.commandHub&validate=1` (check `iso`, `front`, `side`, `top` views and `dune`, `oceanForest`, `forestRock` biomes):
  - `robot.hero` (HQ T1): **3 428 tris** (< 3.5 k budget), `minY = 0.000`, 0 validator errors / 0 warnings.
  - `building.commandHub` (Command Hub): **3 084 tris** (< 3.5 k budget), `minY = 0.000`, 0 validator errors / 0 warnings.

## Automated checks (already green on the branch)

`npm run check` · `npm test` (93 suites, 500 tests) · `npm run validate:models -- robot.hero building.commandHub` · `npm run ci:fast` · `npm run e2e -- --waves ..01 --hack` (all 8 W00 `@hack` steps + all 7 W01 `@hack` steps = 15/15 passing).

## When you're done

- **All good:** from the main checkout (`/Users/ferretrec/work/TerraAgent`) run `npm run wave -- land 01`. It re-runs the gates, merges W01 into `main`, tags `wave-01`, pushes, and removes the W01 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
