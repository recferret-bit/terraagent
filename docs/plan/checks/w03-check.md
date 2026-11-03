# W03 — The Grid: owner check

> The wave's demo story ([`waves/W03-the-grid.md`](../waves/W03-the-grid.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 15 minutes.

## Before you start

- **Where it runs:** branch `wave/w03-the-grid`, worktree `../TerraAgent-wt/w03`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4100` → app **4101**, client **5273** (`TA_DB_NAME=terra_wave_w03_the_grid`).
  - Client: `http://127.0.0.1:5273`
  - App API: `http://127.0.0.1:4101`
- **Start / restart the stack:** `cd ../TerraAgent-wt/w03 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **In-game dev console (`` ` `` key):** press **`` ` ``** (the backtick key under `Esc`) inside the game page to toggle the dark terminal plate at the bottom. Type commands there and press `Enter`. Press **`` ` ``** or `Esc` to close it so it doesn't cover the bottom Command Dock. *(This is **not** the browser's DevTools console. Note: `tune` requires the server host and does not work on `?host=local`.)*
- **Command Dock shortcuts (bottom-left):**
  - **`B`** (or click **`BUILD [B]`**) → Construction menu
  - **`U`** (or click **`PRODUCTION [U]`**) → Units menu
  - **`T`** (or click **`TERRAFORM [T]`**) → Terraform tools
  - Click **`QUEUE`** → Order Queue (**`Q`** collapses / expands the dock)
- **Starting layout (`?scenario=w03`):**
  - **Command Hub T1** at `(0, 0)`
  - **Metals Extractor T1** (`#2`) at `(3, 0)`
  - **Solar Array T1** (`#3`) at `(-3, 2)`
  - **HQ Drone** (`#4`) at `(2, -1)`
  - **2 Harvesters** (`#5`, `#6`) at `(2, 2)` and `(-2, 2)`
  - **Distant Minerals Deposit** at `(10, 0)` (outside the Hub's 3-tile grid radius)
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

---

## Step-by-Step Check

### 1. Morning colony from the end of W02
- **Open:** `http://127.0.0.1:5273/play.html?scenario=w03`
- **See on map:** A temperate hex planet at `06:00` morning with a finished **Command Hub T1** at `(0, 0)`, **Metals Extractor T1** at `(3, 0)`, **Solar Array T1** at `(-3, 2)`, **HQ Drone** at `(2, -1)`, and **2 Harvesters** at `(2, 2)` and `(-2, 2)`.
- **See in top bar:**
  - **Metals:** `400 / 500`
  - **Minerals:** `250 / 500`
  - **Bio:** `400 / 500` (hover shows `Biomass: 200 · Water: 200`)
  - **Supply:** `2 / 10`
  - **HQ Power Cell:** `800 / 800 E` (hover shows **`Income (Supply): +28 E/s`**, **`Spending (Demand): −15 E/s`**, **`Net: +13 E/s`**)
  - **Planet clock:** **`☀ 06:00 100%`**

### 2. Produce a Builder drone at the Hub & run 2 constructions in parallel
- **Do (queue Builder):**
  1. Press **`U`** (or click **`PRODUCTION [U]`** in the bottom-left Command Dock).
  2. Click **Builder Drone** (`55 Metals · 25 Minerals · 10 Biomass · 12s`).
  3. Open the dev console (**`` ` ``**), run `warp 10`, and press **`` ` ``** to close it.
- **See:** After ~1.2 s, the **Builder Drone** rolls out from the Hub edge (`Supply: 3 / 10`).
- **Do (parallel build):**
  1. Press **`B`** (or click **`BUILD [B]`**).
  2. Click **Power Pylon** (`15 Metals · 5 Minerals · 4s`) and click a flat hex to the east, e.g. `(4, -2)`.
  3. Click **Power Pylon** again and click a flat hex to the west, e.g. `(-4, -2)`.
- **See:** Both Construction orders go **`IN PROGRESS`** at the same time — the **HQ Drone** and the **Builder Drone** each take one site and build both pylons in parallel.
- **Reset speed:** Open dev console (**`` ` ``**) and run `warp 1`.

### 3. Power-Line drag tool (3 pylons = 1 queue entry)
- **Do:**
  1. Press **`B`** to open the Construction menu and click **Power Line** (`Chain (≤6 span) · 4s · −0.5 E/s / pylon · 15 Metals · 5 Minerals`).
  2. Click-and-drag (or click start then end) from **`(3, -1)`** east toward **`(9, -1)`** (just west of the distant minerals deposit at `(10, 0)`).
- **See:**
  - While dragging: a chain of **3 auto-spaced pylon ghosts** (`(3, -1)`, `(6, -1)`, `(9, -1)`) previews the span (`≤ 6` tiles per hop) and total cost (`45 Metals · 15 Minerals`).
  - After confirming: click the **`QUEUE`** tab → **1 single Construction entry** appears for the entire chain (**`Power Line (×3)`**) instead of 3 separate queue rows, and workers build the sub-sites in sequence (`warp 10` speeds it up).
  - *(Note: the `P` 3D power-arc overlay is `W03-18` (`H+`, deferred); in the H slice, inspect grid nodes via the top-right building inspector or the `power` dev console command.)*

### 4. Distant Minerals Quarry: `OFFLINE: NO GRID` → `ONLINE` when connected
- **Do (build disconnected Quarry first):**
  1. Open a fresh scenario (`http://127.0.0.1:5273/play.html?scenario=w03`) so the east power line isn't built yet.
  2. Press **`B`**, click **Minerals Quarry** (`2×2 · 16s · −8 E/s · 75 Metals · 30 Minerals · 5 Biomass · 15 Water`), and place it on the distant minerals deposit at **`(10, 0)`** (beyond the Hub's 3-tile connection radius).
  3. Run `warp 20` in the dev console (**`` ` ``**) until the Quarry finishes building, then click the Quarry at `(10, 0)`.
- **See (disconnected):** The top-right building inspector reads **`OFFLINE: NO GRID`** (`offline: no grid`) and Minerals income does not increase.
- **Do (connect the grid):**
  1. Press **`B`**, select **Power Line**, and drag/place the 3-pylon chain from **`(3, -1)`** to **`(9, -1)`** (bridging the Hub at `(0, 0)` to the Quarry at `(10, 0)`).
- **See (connected):** As soon as the 3 pylons finish, the Quarry at `(10, 0)` automatically switches to **`ONLINE`** in the top-right inspector and the **Minerals** chip income rises by **`+0.75/s`**.

### 5. Supply Depot (`500` → `1 500` cap), Wind Turbine & Capacitor Bank
- **Do:**
  1. Press **`B`**, select **Supply Depot** (`2×2 · 12s · −2 E/s · 60 Metals · 25 Minerals · 10 Biomass`), and place it at **`(-3, -3)`** (use `warp 20` to finish quickly).
  2. Optionally place a **Wind Turbine** (`+15 E/s`) at **`(0, -4)`** and a **Capacitor Bank** (`1500 E`) at **`(3, -3)`**.
- **See:**
  - When the **Supply Depot** completes, all three top-bar resource family caps jump from **`/ 500`** to **`/ 1500`** (`Metals … / 1500`, `Minerals … / 1500`, `Bio … / 1500`).
  - Open the dev console (**`` ` ``**) and run `power` → **see** wind output (`setWind 0..1` adjusts wind factor) and capacitor stored energy charging toward `1500 E`.

### 6. Night brownout, Capacitor discharge & priority-group shedding
- **Do:**
  1. Open the dev console (**`` ` ``**) and run:
     ```text
     time night
     ```
  2. Then push grid demand above supply by running:
     ```text
     addLoad 200
     ```
- **See:**
  - At `time night`: the planet clock switches to **`☾`**, Solar output drops to `0`, Wind holds steady, and any charged Capacitor discharges up to `30 E/s` to buffer the grid.
  - With `addLoad 200` (once the Capacitor / HQ cell drains):
    - The red alert banner at the top-right reads **`BROWNOUT — SHEDDING GROUP … · N E/s OFFLINE`** (shedding lower-priority groups first: `group 1` → `group 2` → `group 3`).
    - Clicking a shed consumer (e.g. the **Metals Extractor** at `(3, 0)` or **Minerals Quarry** at `(10, 0)`) shows **`OFFLINE: BROWNOUT`** (`offline: brownout`) in the top-right building inspector.
- **Reset:** Run `addLoad 0` and `time day` in the dev console.

### 7. Per-pylon max load (`> 80 E/s` on a T1 Pylon) & branch overload
- **Do:**
  1. Press **`B`**, place a **Power Pylon** (`1×1`) at **`(5, -1)`**, and place a **Water Extractor** (`2×2 · −7 E/s`) at **`(7, -1)`** so the Water Extractor attaches to the grid through the pylon at `(5, -1)`.
  2. Run `warp 20` until both finish, then run in the dev console (**`` ` ``**):
     ```text
     addLoad 85
     ```
     *(This pushes flow through the T1 Pylon past its `80 E/s` max load while keeping the Command Hub below its `150 E/s` limit.)*
- **See:**
  - The top-right alert banner reads **`POWER OVERLOAD — PYLON CAPACITY EXCEEDED`**.
  - Clicking the **Power Pylon** at `(5, -1)` shows **`OVERLOAD`** (`91 / 80 E/s`) in the top-right inspector.
  - Clicking the downstream **Water Extractor** at `(7, -1)` shows **`OFFLINE: OVERLOAD`** (`offline: overload`).
- **Reset:** Run `addLoad 0` and `warp 1` in the dev console.

### 8. Building `#id` in the selection panel & auto-queued `1.5×` Builder repair
- **Do:**
  1. Click the **Metals Extractor** at **`(3, 0)`**.
  2. Look at the bottom selection bar → **see** the entity ID badge **`#2`** (`[data-testid="selection-entity-id"]`) next to `METALS EXTRACTOR T1`.
  3. Open the dev console (**`` ` ``**) and run:
     ```text
     damage 2 60
     ```
     *(Damages entity `#2` by 60%, dropping its hull from `500 / 500 HP` to `200 / 500 HP`.)*
- **See:**
  - Entity `#2`'s HP bar drops to `200 / 500` (40%).
  - An auto-queued **`Repair #2`** order immediately appears in the Construction lane at `system` precedence.
  - A **Builder Drone** (or HQ Drone) walks to `(3, 0)` and repairs it back to **`500 / 500 HP`** at the Builder's `1.5×` repair speed (`warp 10` speeds it up).

### 9. `waiting: storage` & the interactive `Build Supply Depot (+1 000 cap)` button
- **Do:**
  1. Open a fresh scenario (`http://127.0.0.1:5273/play.html?scenario=w03`) where no Supply Depot is built yet (caps are `500`).
  2. Open the dev console (**`` ` ``**) and run (keep the single quotes):
     ```text
     tune economyT1Basic.solar.cost '{"metals.t1":600,"minerals.t1":75,"bio.biomass":10,"bio.water":5}'
     ```
  3. Press **`` ` ``** to close the console, press **`B`**, click **Solar Collector Array**, and place it at **`(5, -4)`**.
  4. Click the **`QUEUE`** tab in the bottom-left Command Dock.
- **See:**
  - The queued Solar entry shows **`waiting: storage (no ETA)`** and an interactive button **`Build Supply Depot (+1 000 cap)`** (`[data-testid="queue-storage-hint"]`).
  - Click **`Build Supply Depot (+1 000 cap)`** → the Command Dock automatically switches to the **`BUILD [B]`** tab with **Supply Depot** selected and the Supply Depot 2×2 placement ghost active on the map.
- **Cleanup:** Cancel the test Solar entry (`×` in the Queue tab) and run `tune reset` in the dev console.

### 10. Queue Panel v2: 4 lane tabs (`ALL`, `BUILD`, `TERRA`, `UNITS`, `HQ`) & 60 s earmark
- **Do:**
  1. Click the **`QUEUE`** tab in the Command Dock → **see** the lane filter tabs **`ALL`**, **`BUILD (0/20)`**, **`TERRA (0/20)`**, **`UNITS (0/10)`**, and **`HQ (0/1)`**.
  2. Open the dev console (**`` ` ``**) and drain water to `0` (Harvesters only gather Metals and Minerals, so Water will stay at `0`):
     ```text
     fill bio.water 0
     ```
  3. Press **`B`**, select **Solar Collector Array** (which costs `5 Water`), and place it at **`(5, -4)`**.
  4. Switch back to the **`QUEUE`** tab → the entry reads **`waiting: Bio 0/5`**.
  5. Open the dev console (**`` ` ``**) and run `warp 20` for ~3 real seconds (60 s of game time), then `warp 1`.
- **See:**
  - After 60 s of game time waiting on a missing resource, the entry **earmarks** its required resources (`earmarked: Water 5`).
  - A summary bar (`[data-testid="queue-earmark-bar"]`) appears at the top of the Queue panel reading **`Earmarked: Water 5`**, reserving that resource against lower-precedence orders.

### 11. Night Survived & Night Shift progression *(deferred)*
- Deferred: `W03-15` (Night Survived toast & Night Shift progression card) and `W03-25` (grid-overload lightning arcs) are outside the 15-issue H slice (recorded in [`docs/questions-and-limitations/cross-cutting.md`](../../questions-and-limitations/cross-cutting.md) `XC-34`).

### 12. Earlier waves stay clean (`?waves=..02`)
- **Open:** `http://127.0.0.1:5273/play.html?scenario=w03&waves=..02`
- **See:** The W02 game without any W03 UI:
  - No four-lane tab bar (`[data-testid="queue-lane-tabs"]`) in the Queue panel
  - No W03 building cards (**Power Pylon**, **Power Line**, **Capacitor Bank**, **Wind Turbine**, **Thermal Plant**, **Supply Depot**, **Minerals Quarry**, **Water Extractor**, **Petroleum Well**) in the **`BUILD [B]`** tab
  - No **Builder Drone** card in the **`PRODUCTION [U]`** tab

---

## 3D Kitbash & Playground QA (Pillar 1 & Pillar 4)

Open any of the 8 W03 kitbash archetypes in the 3D Playground with `&validate=1` (all pass `npm run validate:models -- --all` with 0 errors and 0 warnings):
- **Builder Drone (`robot.builder`):** `http://127.0.0.1:5273/playground.html?inspect=robot.builder&validate=1`
- **Power Pylon (`building.powerPylon`):** `http://127.0.0.1:5273/playground.html?inspect=building.powerPylon&validate=1`
- **Wind Turbine (`building.windTurbine`):** `http://127.0.0.1:5273/playground.html?inspect=building.windTurbine&validate=1`
- **Thermal Plant (`building.thermalGenerator`):** `http://127.0.0.1:5273/playground.html?inspect=building.thermalGenerator&validate=1`
- **Capacitor Bank (`building.capacitor`):** `http://127.0.0.1:5273/playground.html?inspect=building.capacitor&validate=1`
- **Supply Depot (`building.supplyDepot`):** `http://127.0.0.1:5273/playground.html?inspect=building.supplyDepot&validate=1`
- **Minerals Quarry (`building.crystalExtractor`):** `http://127.0.0.1:5273/playground.html?inspect=building.crystalExtractor&validate=1`
- **Water Extractor (`building.waterExtractor`):** `http://127.0.0.1:5273/playground.html?inspect=building.waterExtractor&validate=1`

---

## Automated checks (already green on the branch)

`npm run check` · `npm test -- --run` · `npm run build` · `npm run test:parity` · `npm run validate:models -- --all` · `npm run test:models` · `npm run validate:particles -- --all` · `npm run test:particles` · `npm run e2e -- --waves ..03` (27/27 active tests across W00 + W01 + W02 + W03 passing on server host with `TA_WAVES=..03`) · `npm run e2e -- --waves ..03 --host local` (11/11 local-host tests passing).

## When you're done

- **All good:** from the main checkout (`/Users/ferretrec/work/TerraAgent`) run:
  ```bash
  npm run wave -- land 03
  ```
  It re-runs the gates, merges W03 into `main`, tags `wave-03`, pushes, and removes the W03 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
