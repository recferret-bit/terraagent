# W03 — The Grid: owner check

For the latest owner-requested fixes, use [W03 feedback checks](./w03-feedback-check.md). It supersedes the separate Quarry, old wind-output, and unpadded counter expectations below.

> The wave's demo story ([`waves/W03-the-grid.md`](../waves/W03-the-grid.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 25 minutes. Updated 2026-11-04 after the owner-feedback pass (W04 merged in, power zones, HQ-cell night store and energy retune, single Power Pylon card, grid cables, timed dismantle, crews, unit supply).

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
  - **Distant Minerals Deposit** at `(10, 0)` (outside the Hub's power zone)
- **Power zones (new):** only the **Command Hub** may stand anywhere. Every other building, Power Pylons included, must stand inside a **power zone**: 6 tiles around the Hub, 5 tiles around each Power Pylon. Outside it the game refuses with **"outside the power zone"**. The zone is drawn in **blue** on the ground while a building card is armed.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

---

## Step-by-Step Check

### 1. Morning colony from the end of W02
- **Open:** `http://127.0.0.1:5273/play.html?scenario=w03`
- **See on map:** A temperate hex planet at `06:00` morning with a finished **Command Hub T1** at `(0, 0)`, **Metals Extractor T1** at `(3, 0)`, **Solar Array T1** at `(-3, 2)`, **HQ Drone** at `(2, -1)`, and **2 Harvesters** at `(2, 2)` and `(-2, 2)`. Dark cables run from the Hub to the Extractor and the Solar, with **cyan lightning pulses** travelling outward along them.
- **See in top bar:**
  - **Metals:** `400 / 500` · **Minerals:** `250 / 500` · **Bio:** `400 / 500` (hover: `Biomass: 200 · Water: 200`)
  - **Supply:** `2 / 10` (hover: `Units: 2`, `In production: 0`, `Command Hub ×1 +10`)
  - **HQ Power Cell:** `800 / 800 E`; hover shows **`Income (Supply): +29 E/s`**, **`Spending (Demand): −19 E/s`**, **`Net: +10 E/s`** (no `Stored` line while the cell is full)
  - **Planet clock:** **`☀ 06:00 100%`**
- **Optional:** dev console (**`` ` ``**) → `power` → `supply 29 (core 16, solar 13 …)`, `demand 19 (buildings 15, units 4)`.

### 2. Produce a Builder Drone at the Hub & run 2 constructions in parallel
- **Do (queue Builder):**
  1. Press **`U`** (or click **`PRODUCTION [U]`**). The Builder Drone card shows its cost and **`Supply 1`**.
  2. Click **Builder Drone**, then open the dev console (**`` ` ``**), run `warp 10`, and close it with **`` ` ``**.
- **See:** After ~1–2 s the **Builder Drone** rolls out of the Hub; the top bar reads **`Supply: 3 / 10`**.
- **Do (parallel build):**
  1. Press **`B`**, click **Power Pylon** (`15 Metals · 5 Minerals · −2.5 E/s`) — the **blue power zone** appears on the ground around the Hub.
  2. Click `(4, -2)`; click **Power Pylon** again and click `(-4, -2)`.
- **See:** Both orders go **`IN PROGRESS`** at the same time — the HQ Drone and the Builder each take one site. When a pylon finishes, a cable with lightning pulses connects it.
- **Reset speed:** `warp 1`.

### 3. Power zones: one Power Pylon card, the zone grows pylon by pylon
- **Do:**
  1. Press **`B`** and look at the cards: there is **one** power-node card, **Power Pylon** (no separate "Power Line" tool any more).
  2. Click **Solar Collector Array** and hover far east, e.g. `(9, 0)`: the ghost is **red** and says **"outside the power zone"**; hover inside the blue area: it turns **green**. Press **Esc**: the blue zone disappears.
  3. Click **Power Pylon** and place it at `(3, -1)` (inside the Hub zone). Without waiting, place two more at `(6, -1)` and `(9, -1)` — each queued pylon already extends the blue zone, so the next one is accepted.
- **See:**
  - The **`QUEUE`** tab shows three separate **`Power Pylon T1`** orders.
  - The blue zone visibly grows around every pylon you place.
  - `warp 20` until they are built → cables with cyan lightning link Hub → (3,-1) → (6,-1) → (9,-1). `warp 1`.

### 4. Distant Minerals Quarry: refused outside the zone → online inside it → offline when the bridge is lost
- **Do (refused):**
  1. Open a fresh `http://127.0.0.1:5273/play.html?scenario=w03`.
  2. Press **`B`**, click **Minerals Quarry** (`−10 E/s`) and try to place it on the deposit at `(10, 0)`.
- **See:** It is refused — the ghost stays **red** with **`OUTSIDE THE POWER ZONE`**, and clicking does not place it (nothing is queued). *(A direct command from another client is rejected by the host with `outside_power_zone`, toast `Rejected: Outside the power zone (build a Power Pylon to extend it)`.)*
- **Do (connect):**
  1. Place **Power Pylons** at `(3, -1)`, `(6, -1)`, `(9, -1)` as in step 3, then place the **Minerals Quarry** at `(10, 0)` — now accepted.
  2. Run `warp 20` until everything is built, then `warp 1`, and click the Quarry.
- **See:** The Quarry's inspector shows **`ONLINE`**; a cable runs to it; Minerals income rises. The energy hover now shows the grid running a small deficit by day (about `Income +29`, `Spending −36.5`) and a **`Stored: −7.5 E/s (draining)`** line: this is **expected** with the new, stricter power budget — build a Wind Turbine / Solar (step 5) to fix it.
- **Do (lose the bridge):** click the pylon at `(6, -1)`, read its `#id` in the bottom selection bar, and run `damage <id> 100`.
- **See:** The Quarry turns **`OFFLINE: NO GRID`** and its cable goes dark. *(A destroyed pylon is not auto-repaired or rebuilt — recorded as GP-72.)*

### 5. Supply Depot (`500` → `1 500` caps, supply `10` → `18`), Wind Turbine & Capacitor Bank
- **Do:**
  1. Press **`B`**, select **Supply Depot** (`2×2 · −3 E/s`) and place it at `(-3, -3)`; `warp 20` until it is built.
  2. Place a **Wind Turbine** (`+12 E/s`) at `(0, -4)` and a **Capacitor Bank** (`−2 E/s · 1500 E`) at `(3, -3)`.
- **See:**
  - When the Depot completes: all three resource caps go **`/ 500` → `/ 1500`**, and **`Supply: … / 18`** (hover: `Supply Depot ×1 +8`).
  - Dev console `power` → wind output (it varies with the wind factor; `setWind 0..1` sets it) and the capacitor charging toward `1500 E`.

### 6. Night: the HQ cell carries the colony; brownout only when the stores can't cover it
- **Do:** on a fresh `http://127.0.0.1:5273/play.html?scenario=w03`, open the dev console and run `time night`. Watch for ~1 minute.
- **See:**
  - Clock switches to **`☾`**, Solar shows **`offline: night`** — but **no brownout banner**, the Extractor keeps working.
  - The **HQ Power Cell** chip drains slowly: `800` → about `600` after ~70 s. Hover: **`Income +16`**, **`Spending −19`**, **`Net −3 E/s`**, **`Stored: −3 E/s (draining)`**.
  - The cell lasts most of a night with working Harvesters (all night when they idle) and refills within ~70 s after sunrise.
- **Do (force a brownout):** run `addLoad 200`.
- **See:** Within a moment the top-right banner reads **`BROWNOUT — SHEDDING GROUP 3 · 8 E/S OFFLINE`** (the stores can give at most 30 E/s); clicking the **Metals Extractor** shows **`OFFLINE: BROWNOUT`**; its cable goes dark and the remaining cables sputter amber.
- **Optional:** `cell 0` instead of `addLoad`: with the HQ store empty, the night deficit sheds at once.
- **Reset:** `addLoad 0`, `time day`.

### 7. Per-pylon max load (`> 80 E/s` on a T1 Pylon) & branch overload
- **Do:**
  1. Place a **Power Pylon** at `(5, -1)` and a **Water Extractor** (`2×2 · −9 E/s`) at `(7, -1)` (it attaches through that pylon); `warp 20` until both finish.
  2. Run `addLoad 85`.
- **See:**
  - Banner **`POWER OVERLOAD — PYLON CAPACITY EXCEEDED`**; the pylon at `(5, -1)` shows **`OVERLOAD`** (about `104.5 / 80 E/s`); its cable flickers crimson.
  - The **Water Extractor** shows **`OFFLINE: OVERLOAD`**.
- **Reset:** `addLoad 0`, `warp 1`. *(`addLoad` also drains the HQ cell; run `cell 800` afterwards.)*

### 8. Building `#id`, auto-repair that costs resources, crews that speed it up
- **Do:**
  1. Order a **Builder Drone** (step 2) if you don't have one. Click the **Metals Extractor** at `(3, 0)`: the bottom bar shows the badge **`#2`**.
  2. Note the Metals / Minerals values, then run `damage 2 60`.
- **See:**
  - HP drops to `200 / 500`; an auto-queued **`Repair #2`** appears in the Construction lane (`SYS`).
  - A Builder walks to `(3, 0)` and repairs it to `500 / 500` (Builder works at `1.5×`).
  - **New:** Metals / Minerals **drop a little while it repairs** (repair costs 40 % of the building cost × the missing HP share, paid as it goes; with an empty stock it waits on `resources`).
  - **Crews:** with two Builders, both join and the repair finishes visibly faster for the same total cost (each extra worker adds 60 %, 36 %, … of its speed; max 4).

### 9. `waiting: storage` & the `Build Supply Depot (+1 000 cap)` button
- **Do:**
  1. Fresh `http://127.0.0.1:5273/play.html?scenario=w03`. Dev console:
     ```text
     tune economyT1Basic.solar.cost '{"metals.t1":600,"minerals.t1":75,"bio.biomass":10,"bio.water":5}'
     ```
  2. Close the console, press **`B`**, click **Solar Collector Array**, and place it at `(5, -4)`. Open the **`QUEUE`** tab.
- **See:** the Solar entry shows **`waiting: storage (no ETA)`** with the button **`Build Supply Depot (+1 000 cap)`**; clicking it switches to **`BUILD [B]`** with the Supply Depot ghost armed (and the blue zone shown).
- **Cleanup:** cancel the Solar entry (`×`) and run `tune reset`.

### 10. Queue Panel v2: lane tabs & 60 s earmark
- **Do:**
  1. **`QUEUE`** tab → lane tabs **`ALL`**, **`BUILD (0/20)`**, **`TERRA (0/20)`**, **`UNITS (0/10)`**, **`HQ (0/1)`**.
  2. Dev console `fill bio.water 0`; **`B`** → **Solar Collector Array** at `(5, -4)`; back to **`QUEUE`** → **`waiting: Bio 0/5`**.
  3. `warp 20` for ~3 real seconds, then `warp 1`.
- **See:** the entry earmarks **`earmarked: Water 5`** and the bar **`Earmarked: Water 5`** appears at the top of the Queue panel.

### 11. Night Survived & Night Shift progression *(deferred)*
- Deferred: `W03-15` and `W03-25` are outside the H slice (`XC-34`). The lightning on grid cables (owner feedback) now covers the "grid arcs" visual.

### 12. Earlier waves stay clean (`?waves=..02`)
- **Open:** `http://127.0.0.1:5273/play.html?scenario=w03&waves=..02`
- **See:** no lane tab bar in the Queue panel, no W03 building cards (**Power Pylon**, **Capacitor Bank**, **Wind Turbine**, **Thermal Plant**, **Supply Depot**, **Minerals Quarry**, **Water Extractor**, **Petroleum Well**) under **`BUILD [B]`**, no **Builder Drone** under **`PRODUCTION [U]`**.

### 13. Unit supply (owner feedback #2)
- **Do:** fresh `http://127.0.0.1:5273/play.html?scenario=w03`; press **`U`** and queue **Harvesters** one by one (8 in total); `warp 20`.
- **See:**
  - The top-bar **Supply** chip counts up: `3 / 10` … it turns **orange at `8 / 10`** and **red at `10 / 10`**; hover shows `Units`, `In production` and the cap sources.
  - At the cap the Harvester's **QUEUE** button is disabled with **"Supply cap reached — build a Supply Depot"**; a queued Harvester waits with **`waiting: supply`** and a **`BUILD SUPPLY DEPOT`** button.
  - Build a **Supply Depot** (step 5): when it is finished and powered the chip shows **`… / 18`** and the waiting Harvester starts.
- **Optional (host validation):** in the browser DevTools console, at the cap: `__online.commands.send('enqueueTask',{task:{kind:'buildUnit',unit:'harvester'}})` → toast **"Supply cap reached — build a Supply Depot"** (`supply_cap`).

### 14. Dismantle takes time and refunds step by step (owner feedback #6)
- **Do:** order a **Builder Drone** (step 2). Click the **Solar Array** at `(-3, 2)`. Press **`T`** (TERRAFORM), then **`Z`** (DISMANTLE), and click the Solar.
- **See:**
  - The **`QUEUE`** tab shows **`Dismantle Solar Array T1`** — `waiting: worker (en route)` for a few seconds, then **`Dismantling n%`**; the Builder walks over (no teleport) and works with sparks; the Solar goes offline and comes down.
  - Metals / Minerals / Bio rise **in small steps**; after ~9 s of work (half the Solar's build time) the Solar is gone, and you got back **50 %** of its cost in total (`30 Metals · 37.5 Minerals · 5 Biomass · 2.5 Water`).
  - Pressing **`Z`** on it again while it is being dismantled → **`Rejected: Already being dismantled`**.
  - **Cancel:** on another building, press **CANCEL JOB** halfway → it stays standing but damaged, and a Builder repairs it (which costs resources again — no free refund loop).
  - Without a Builder, the **HQ Drone** does the job.

### 15. Pylon light & grid cables (owner feedback #4, #5)
- **Do:** after step 3, zoom in on a pylon; run `time night`.
- **See:** each pylon casts **one** cyan light pool (from its top core) — not four; cables sag between Hub, pylons and buildings with travelling lightning (cyan online, amber sputter in a brownout, crimson on an overloaded pylon, none when unpowered).
- **Playground:** `http://127.0.0.1:5273/playground.html?inspect=building.pylon&lights=1` → one light.

### 16. W04 Maps & Camera alongside the W03 HUD
- **Open:** `http://127.0.0.1:5273/play.html?scenario=w04` (the `w03` scenario runs with waves `..03`, so it has no minimap; `w04` has the W03 HUD and the maps).
- **Do:** at a 1280×720-ish window, open **`BUILD [B]`**; then press **`M`**; press **`B`**, **`U`**, **`Z`**, **`X`**, `R`; press **`` ` ``**; then **`M`** / **Esc**.
- **See:** the **minimap** (bottom-left) and the **Command Dock** stack without overlapping, and the dock never leaves the screen; buildings are small squares and units dots on the minimap. While the global map is open the game hotkeys do nothing (no dock toggles, no ghost rotation, no unit stop); the dev console opens **above** the map and keeps typing focus. Closing the map returns the camera; it does not open while the game is paused (`Esc` pause → `M` does nothing).

---

## 3D Kitbash & Playground QA (Pillar 1 & Pillar 4)

Open the W03 kitbash archetypes in the 3D Playground with `&validate=1` (all pass `npm run validate:models -- --all` with 0 errors and 0 warnings):
- **Builder Drone (`robot.builder`):** `http://127.0.0.1:5273/playground.html?inspect=robot.builder&validate=1`
- **Power Pylon (`building.pylon`):** `http://127.0.0.1:5273/playground.html?inspect=building.pylon&validate=1`
- **Wind Turbine (`building.wind`):** `http://127.0.0.1:5273/playground.html?inspect=building.wind&validate=1`
- **Thermal Plant (`building.coalGen`):** `http://127.0.0.1:5273/playground.html?inspect=building.coalGen&validate=1`
- **Capacitor Bank (`building.capacitor`):** `http://127.0.0.1:5273/playground.html?inspect=building.capacitor&validate=1`
- **Supply Depot (`building.supplyDepot`):** `http://127.0.0.1:5273/playground.html?inspect=building.supplyDepot&validate=1`
- **Minerals Quarry (`building.mine`):** `http://127.0.0.1:5273/playground.html?inspect=building.mine&validate=1`
- **Water Extractor (`building.waterPump`):** `http://127.0.0.1:5273/playground.html?inspect=building.waterPump&validate=1`

---

## Automated checks (green on the branch, 2026-11-04)

`npm run typecheck` · `npm test` (307 files, 1766 passed, 1 skipped) · `npm run build` · `npm run check:structure` · `npm run gen:check` · `npm run test:parity` (w00-empty, w03-supply) · `npm run validate:models -- --all` (35/35) · `npm run test:models` · `npm run validate:particles -- --all` · `npm run test:particles` · `npm run e2e` (all suites, server host: 47 passed, 4 skipped, 0 failed — w00, w01, w02, w03, w04, w06, w26) · `npm run e2e -- --waves ..03 --host local` (14 passed, 18 server-only skipped).

## When you're done

- **All good:** from the main checkout (`/Users/ferretrec/work/TerraAgent`) run:
  ```bash
  npm run wave -- land 03
  ```
  It re-runs the gates, merges W03 into `main`, tags `wave-03`, pushes, and removes the W03 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
