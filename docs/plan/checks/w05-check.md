# W05 — Shape the Land: owner check

> The wave's demo story ([`waves/W05-shape-the-land.md`](../waves/W05-shape-the-land.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 10–12 minutes.

## Before you start

- **Where it runs:** branch `wave/w05-shape-the-land`, worktree `../TerraAgent-wt/w05`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4200` → app **4201**, client **5373** (`TA_DB_NAME=terra_wave_w05_shape_the_land`). Below, `<client>` = `http://127.0.0.1:5373`, `<app>` = `http://127.0.0.1:4201`.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w05 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. Press **`` ` ``** or **Esc** to close it. It is **not** the browser's DevTools console.
- **Dock & overlay shortcuts:** use the bottom-left **Command Dock** tabs **`BUILD [B]`**, **`PRODUCTION [U]`**, **`TERRAFORM [T]`**, and **`QUEUE`**. Press **`L`** during gameplay to toggle the W05 **Living overlay mode** (`+10% move speed on Living tiles`).
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Open the W05 scenario (`?scenario=w05`).**
   - Open `<client>/play.html?scenario=w05` → a Stage 2 temperate colony (`w05-shape-the-land`) loads with a completed Command Hub T1 at `(0, 0)`, 2 Solar Collector Arrays + 1 Wind Turbine (`+58 E/s` daytime supply), HQ T1 + Builder Drone + Harvester, `900 Metals / 650 Minerals / 1000 Biomass / 900 Water`, a `2×2` sloped + crater minerals deposit site at **`(4, 0)`** (just right of the Hub), and a `5×5` shallow-water lake at **`(6, 6)`**.
   - In the top resource bar, **see** the W05 **Terraform %** meter (`[data-testid="hud-terraform"]`) reading **`Terraform 0 / 412 (0.0 %)`** (`0` Living tiles out of `412` owned eligible tiles; the 1 Deep Water tile at `(-6, 5)` is excluded from the denominator).
2. **Order a Terraformer Drone from the Units menu.**
   - In the bottom-left Command Dock, click **`PRODUCTION [U]`** → **see** the **`TERRAFORMER DRONE`** card (`12s`, `Supply 1`, `-2.5 E/s`, `50 Metals · 30 Minerals · 10 Biomass`).
   - Click **`QUEUE`** on the **Terraformer Drone** card. Open the in-game dev console (**`` ` ``**), run `warp 20` for ~2 seconds, then `warp 1` → **see** the Terraformer Drone spawn next to the Command Hub and the top-bar **Supply** counter step from `3 / 18` to **`4 / 18`**.
3. **Place a Resource Extractor on the slope + crater footprint (`(4, 0)`) and watch linked site prep run.**
   - In the Command Dock, click **`BUILD [B]`** → click **`Resource Extractor`** *(unified Metals/Minerals extractor per W03 owner feedback `GP-77`)*.
   - Move the cursor over the `2×2` minerals deposit at **`(4, 0)`** (two Slope hexes at `(4, 0)` and `(5, 0)`, one Hole/crater hex at `(4, 1)`, and one Flat Wild hex at `(5, 1)`).
   - On the 3D construction ghost banner (`[data-testid="ghost-prep-bill"]`), **see** the live linked site-prep bill:
     **`Prep: Level ×2 + Fill ×1 + Grade ×4 · 300 E · 38s · 9 Minerals · 10 Metals`**.
   - Left-click **`(4, 0)`** to confirm placement, then open the **`QUEUE`** tab in the Command Dock → **see** the extractor order in **`waiting(site: 0/4 tiles prepared)`** while the linked terraform prep jobs run first (`Level` on the 2 slopes, `Fill` on the crater, then `Grade` on all 4 footprint hexes).
   - Run `warp 20` in the dev console (**`` ` ``**) for a few seconds (then `warp 1`) → **see** the linked prep progress through `4/4` tiles prepared, and the Builder Drone immediately construct and finish the Resource Extractor on the levelled pad.
4. **Brush Reclaim (then Grade) over 6 shallow-water tiles in the lake (`(6, 6)`).**
   - In the Command Dock, click **`TERRAFORM [T]`** → **see** the W05 9-operation strip (`Clear`, `Break`, `Grade`, `Level`, `Fill`, `Reclaim`, `Deep Reclaim` disabled with **`needs T2 worker`**, `Irrigate`, `Seed`) and the area-brush strip (`1×1`, `Hex r=1`, `Hex r=2`, `Rect`, `Cancel Area`).
   - Click **`Reclaim`** (`[data-testid="tf-op-reclaim"]`) and select **`Hex r=1`** (`[data-testid="tf-brush-hex1"]`, 7-hex brush).
   - Click the shallow lake at **`(6, 6)`** and run `warp 20` in the dev console (**`` ` ``**) → **see** the area order split across your workers (`≤ 8` concurrent workers) and turn those shallow-water hexes (`0.5×` move speed) into **Flat** dry land (`1.0×` move speed, `20 Metals + 10 Minerals` per hex paid progressively).
   - Still in **`TERRAFORM [T]`** with **`Hex r=1`**, click **`Grade`** (`[data-testid="tf-op-grade"]`) and click **`(6, 6)`** again → **see** the reclaimed hexes finish grading into buildable **Prepared** ground.
5. **Brush Irrigate → Seed over 10 Prepared tiles → `Terraform 10 / 412 (2.4 %)` and `+10 %` move speed.**
   - In **`TERRAFORM [T]`**, click **`Irrigate`** (`[data-testid="tf-op-irrigate"]`):
     - With **`Hex r=1`** (`7` hexes), click the prepared pad at **`(-2, 0)`** (left of the Command Hub).
     - Switch the brush to **`1×1`** (`[data-testid="tf-brush-1x1"]`) and click **`(-4, 0)`**, **`(-4, 1)`**, and **`(-4, 2)`** (`10` Prepared tiles total).
   - At `warp 20`, **see** those 10 Prepared tiles darken with the wet **Irrigated** sheen (`15 Water` per hex).
   - Next, click **`Seed`** (`[data-testid="tf-op-seed"]`), select **`Hex r=1`** and click **`(-2, 0)`**, then select **`1×1`** and click **`(-4, 0)`**, **`(-4, 1)`**, and **`(-4, 2)`**.
   - As the 10 tiles finish seeding (`10 Water + 5 Minerals` per hex), **see**:
     - The 10 hexes turn lush green **Living** ground (`uTerraformMap` + `uTerraformedLush` shader blend with the frontier glow ring).
     - The top HUD **Terraform %** meter updates to **`Terraform 10 / 412 (2.4 %)`** (hover it to see `Living tiles: 10`, `Eligible owned: 412`, `Colony ratio: 2.4 %`, and the T2/T3 gate status).
   - Press **`L`** on the keyboard (with the dev console closed) → **see** the **Living overlay** highlight the 10 Living hexes in bright emerald and display the **`+10% move speed on Living tiles`** badge (`[data-testid="living-overlay-hint"]`). Right-click across the Living tiles with a selected unit to see it traverse them 10 % faster (`1.10×`). Press **`L`** again to turn the overlay off.
   - *(Optional 3D shader inspection: open `<client>/playground.html?hexterrain=1&tileState=mixed` to inspect `prepared`, `irrigated`, `living`, and `mixed` tile states side-by-side on the 3D hex terrain sample.)*
6. **Build a Territory Beacon T1 (`R 8` claim)** — *not in this landing* (`W05-12`, `W05-21`, `W05-25` are full-product scope, deferred out of the `H` slice; see [`frontend-features.md`](../../questions-and-limitations/frontend-features.md) FF-82). Skip.
7. **Frozen border (`spawnColony <q> <r>`)** — *not in this landing* (`W05-13`, `W05-31` are full-product scope). Skip.
8. **Destroy the beacon & 60 s revert countdown** — *not in this landing* (`W05-13`, `W05-21` are full-product scope). Skip.
9. **Storms, lightning strikes & Lightning Rod T1 (`startStorm`)** — *not in this landing* (`W05-14`, `W05-15`, `W05-26`, `W05-28` are stretch `H+` / full-product scope). Skip.
10. **Meteor impacts (`meteor <q> <r>`)** — *not in this landing* (`W05-16`, `W05-28`, `W05-31` are stretch `H+` / full-product scope). Skip.
11. **Op energy & group-1 brownout shedding (`time night` → `waiting(power)` → `time day`).**
    - On `<client>/play.html?scenario=w05` (set `warp 1` in the dev console **`` ` ``**), open **`TERRAFORM [T]`**, click **`Level`** (`[data-testid="tf-op-level"]`) and **`1×1`** (`[data-testid="tf-brush-1x1"]`), and click the slope hex at **`(-3, 4)`**.
    - Once a worker reaches `(-3, 4)` and starts levelling (or right after queuing), open the dev console (**`` ` ``**) and run:
      - `time night`
      - `cell 0` *(drains the HQ power cell store so the night solar drop immediately triggers brownout shedding)*
    - Open **`QUEUE`** (`Terraform` lane) in the Command Dock and run `power` in the dev console → **see** the terraform job pause first in shed group 1 with status **`waiting(power)`** (`paused work jobs: 1` in `power`), keeping its accumulated progress while the Command Hub stays powered.
    - Run `time day` in the dev console → **see** daytime solar power return, `waiting(power)` clear, and the worker finish levelling `(-3, 4)` from its saved progress.
12. **`desert` and `ocean` scenario terrain mixes (`w05-desert`, `w05-ocean`)** — *not in this landing* (`W05-17` is full-product scope; the D-38 `dune` and `oceanForest` world generators already shipped in W01). Skip.
13. **Resource tier gate (D-34) on `<client>/play.html?scenario=w05-tiers`.**
    - Open `<client>/play.html?scenario=w05-tiers` → a Stage 4 temperate colony loads with **`Terraform 116 / 331 (35.0 %)`** (`≥ 30 %` colony Living threshold for T2) and two Metals Extractors:
      - One at **`(5, 0)`** ringed by **`100 %` Living tiles** within radius 3 (`≥ 50 %` Irrigated/Living ring requirement met, plus `+5 %` Living adjacency bonus).
      - One at **`(-6, 0)`** on **unterraformed ground** (`0 %` Living in its radius-3 ring).
    - Hover the **Metals** chip (`[data-testid="hud-stock-metals"]`) in the top HUD → **see** the tier breakdown popover (`[data-testid="res-breakdown-metals"]`):
      - **`Raw Ore (T1)`** is unlocked and receiving income from both extractors (`+2.24/s`).
      - **`Light Alloys (T2)`** is **unlocked** (`data-locked="false"`) and receiving **`+0.47/s`** (`30 %` of the ringed extractor's `1.575/s` output; `70 / 30` T1/T2 split), while the second extractor on unterraformed ground contributes T1 only.
14. **Earlier waves stay clean (`&waves=..04`).**
    - Open `<client>/play.html?scenario=w04&waves=..04` → **see** no `Terraform %` chip in the top HUD, no `Terraformer Drone` in `PRODUCTION [U]`, only the W01 3-button toolset (`TERRAFORM [G]`, `REPAIR [R]`, `DISMANTLE [Z]`) in `TERRAFORM [T]` (no W05 op chips or area brushes), and pressing **`L`** does not activate the Living overlay.

## Automated checks (already green on the branch)

`npm run check` · `npm test` · `npm run build` · `npm run e2e -- --waves 05 --hack` (6/6 passing) · `npm run e2e -- --waves 05 --host local --hack` (5 passed, 1 server-only skipped) · `npm run e2e -- --waves ..05 --hack` (W00 + W01 + W02 + W03 + W04 + W05 = 42/42 passing).

## When you're done

- **All good:** from the main checkout (`/Users/ferretrec/work/TerraAgent`) run `npm run wave -- land 05`. It re-runs the gates, merges W05 into `main`, tags `wave-05`, pushes, and removes the W05 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
