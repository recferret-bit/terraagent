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
4. **Terraform the lake: reclaim, then grade, over 6 shallow-water tiles (`(6, 6)`).**
   - In the Command Dock, click **`TERRAFORM [T]`** → **see** exactly three buttons: `Terraform [G]`, `Repair [R]`, `Dismantle [Z]`.
   - Click **`Terraform`** (`[data-testid="tf-op-terraform"]`), then **hold Ctrl and click** each shallow-water hex of the lake → **see** every queued hex lit orange (3D target highlight) until its job is done. A plain click sends one order and disarms; Ctrl+click on an already queued hex cancels it.
   - Run `warp 20` in the dev console (**`` ` ``**) → **see** the workers turn those shallow-water hexes into **Flat** dry land (`20 Metals + 10 Minerals` per hex), then Ctrl+click the same hexes again → they finish grading into buildable **Prepared** ground. The button picks the operation per hex itself (trees → clear, rock → break, slope → level, crater → fill, shallow water → reclaim, plain ground → grade).
5. **Terraform → irrigate → seed over 10 Prepared tiles → `Terraform 10 / 412 (2.4 %)` and `+10 %` move speed.**
   - With **`Terraform`** armed, Ctrl+click the prepared pad around **`(-2, 0)`** and **`(-4, 0)`**, **`(-4, 1)`**, **`(-4, 2)`** (`10` Prepared tiles) → **see** them irrigated (`15 Water` per hex). Ctrl+click them again → they are seeded (`10 Water + 5 Minerals` per hex). A mis-click on prepared ground costs water.
   - As the 10 tiles finish seeding, **see**:
     - The 10 hexes turn lush green **Living** ground (no glowing green or blue rims: only the orange hover and queued targets are highlighted).
     - The **Terraform %** meter in the panel **under the minimap** updates to **`Terraform 10 / 412 (2.4 %)`** (hover it for `Living tiles: 10`, `Eligible owned: 412`, `Colony ratio: 2.4 %`, and the T2/T3 gate status).
   - Press **`L`** (with the dev console closed) → **see** the **Living overlay** highlight the 10 Living hexes and show **`+10% move speed on Living tiles`**. Press **`L`** again to turn it off.
6. **Build a Territory Beacon T1 (`R 8` claim)** — *not in this landing* (`W05-12`, `W05-21`, `W05-25` are full-product scope, deferred out of the `H` slice; see [`frontend-features.md`](../../questions-and-limitations/frontend-features.md) FF-82). Skip.
7. **Frozen border (`spawnColony <q> <r>`)** — *not in this landing* (`W05-13`, `W05-31` are full-product scope). Skip.
8. **Destroy the beacon & 60 s revert countdown** — *not in this landing* (`W05-13`, `W05-21` are full-product scope). Skip.
9. **Storms, lightning strikes & Lightning Rod T1 (`startStorm`)** — *not in this landing* (`W05-14`, `W05-15`, `W05-26`, `W05-28` are stretch `H+` / full-product scope). Skip.
10. **Meteor impacts (`meteor <q> <r>`)** — *not in this landing* (`W05-16`, `W05-28`, `W05-31` are stretch `H+` / full-product scope). Skip.
11. **Op energy & group-1 brownout shedding (`time night` → `waiting(power)` → `time day`).**
    - On `<client>/play.html?scenario=w05` (set `warp 1` in the dev console **`` ` ``**), open **`TERRAFORM [T]`**, click **`Terraform`** and click the slope hex at **`(-3, 4)`**.
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

18. **Cannot terraform terraformed hexes.** With `Terraform` armed, click a Living hex → **see** `Already terraformed (Living)` and nothing is queued. Click a hex that already has a queued job → **see** `Already queued`. Ctrl+click over a mix of valid and invalid hexes → the valid ones queue, the rest are skipped.
19. **Cancel cancels all.** Queue 3 terraform orders, open **`QUEUE`** and click the × once → **see** all three leave the queue, the workers go idle and the orange targets vanish.
20. **Deep water.** The deep hex next to the lake says `Deep water needs a T2 worker` on click; order a Terraformer to reclaim it.

## Automated checks (already green on the branch)

`npm run check` · `npm test` · `npm run build` · `npm run e2e -- --waves 05 --hack` (6/6 passing) · `npm run e2e -- --waves 05 --host local --hack` (5 passed, 1 server-only skipped) · `npm run e2e -- --waves ..05 --hack` (W00 + W01 + W02 + W03 + W04 + W05 = 42/42 passing).

## When you're done

- **All good:** from the main checkout (`/Users/ferretrec/work/TerraAgent`) run `npm run wave -- land 05`. It re-runs the gates, merges W05 into `main`, tags `wave-05`, pushes, and removes the W05 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.

## Owner feedback pass (simplification)

12. **Terraform menu** — see steps 4–5: three buttons, Ctrl+click queue, orange target highlight.
13. **AI off by default.** Open the HQ panel → **see** `AI OFF` above the Goals/Priorities tabs; bots stay idle apart from your explicit orders. Click `AI ON` → bots work on goals again.
14. **Natural base layout.** With `AI ON`, let bots build 5–6 solar/depot buildings → **see** them spread around the Hub with a free lane between them, not packed together.
15. **Header and panel.** The top bar shows the energy icon and numbers only (no bar). Under the minimap, **see** the panel with time of day, `Wind …` and `Terraform …`.
16. **Wind turbine speed.** In the dev console run `setWind` at 25 %, 100 %, 150 % → **see** the rotor turn slowly (about 4 s per turn at the 100 % rotor scale).
17. **Wires between close buildings.** Look at power wires between adjacent buildings → **see** short low arcs, no spikes into the sky.
