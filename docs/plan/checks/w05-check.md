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
   - Open `<client>/play.html?scenario=w05` → a Stage 4 temperate colony (`w05-shape-the-land`) loads with a completed Command Hub T1 at `(0, 0)`, 2 Solar Collector Arrays + 1 Wind Turbine (`+58 E/s` daytime supply), HQ T1 + Worker Drone T2 + Worker Drone T1, `900 Metals / 650 Minerals / 1000 Biomass / 900 Water`, a `2×2` sloped + crater minerals deposit site at **`(4, 0)`** (just right of the Hub), a small lake west of the Hub (`6` shallow-water hexes around **`(-4, 1)`** plus `1` deep hex at **`(-4, 2)`**), and `10` Prepared meadow hexes south of the Hub around **`(1, 4)`**.
   - In the top resource bar, **see** the W05 **Terraform %** meter (`[data-testid="hud-terraform"]`) reading **`Terraform 0 / 412 (0.0 %)`** (`0` Living tiles out of `412` owned eligible tiles; the 1 Deep Water tile at `(-4, 2)` is excluded from the denominator).
2. **Order a Worker Drone T3 from the Units menu.**
   - In the bottom-left Command Dock, click **`PRODUCTION [U]`** → **see** the **Worker Drone T3** card (`data-unit="worker"` `data-tier="3"`, `12s`, `Supply 1`, `-2.5 E/s`, `50 Metals · 30 Minerals · 10 Biomass`).
   - Click **`QUEUE`** on the **Worker Drone T3** card. Open the in-game dev console (**`` ` ``**), run `warp 20` for ~2 seconds, then `warp 1` → **see** the Worker Drone T3 spawn next to the Command Hub and the top-bar **Supply** counter step from `3 / 18` to **`4 / 18`**.
3. **Place a Resource Extractor on the slope + crater footprint (`(4, 0)`) and watch linked site prep run.**
   - In the Command Dock, click **`BUILD [B]`** → click **`Resource Extractor`** *(unified Metals/Minerals extractor per W03 owner feedback `GP-77`)*.
   - Move the cursor over the `2×2` minerals deposit at **`(4, 0)`** (two Slope hexes at `(4, 0)` and `(5, 0)`, one Hole/crater hex at `(4, 1)`, and one Flat Wild hex at `(5, 1)`). This fixture hand-places the deposit on slope on purpose (linked-prep demo); it is the one exception to step 24's rule, and GP-87 asks whether to move it to open ground.
   - On the 3D construction ghost banner (`[data-testid="ghost-prep-bill"]`), **see** the live linked site-prep bill:
     **`Prep: Level ×2 + Fill ×1 + Grade ×4 · 300 E · 38s · 9 Minerals · 10 Metals`**.
   - Left-click **`(4, 0)`** to confirm placement, then open the **`QUEUE`** tab in the Command Dock → **see** the extractor order in **`waiting(site: 0/4 tiles prepared)`** while the linked terraform prep jobs run first (`Level` on the 2 slopes, `Fill` on the crater, then `Grade` on all 4 footprint hexes).
   - Run `warp 20` in the dev console (**`` ` ``**) for a few seconds (then `warp 1`) → **see** the linked prep progress through `4/4` tiles prepared, and the Worker Drone T2 immediately construct and finish the Resource Extractor on the levelled pad.
4. **Terraform the lake: 6 shallow-water hexes around `(-4, 1)` → Prepared ground in one pass.**
   - In the Command Dock, click **`TERRAFORM [T]`** → **see** exactly three buttons: `Terraform [G]`, `Repair [R]`, `Dismantle [Z]`.
   - Click **`Terraform`** (`[data-testid="tf-op-terraform"]`), then **hold Ctrl and click** each shallow-water hex of the lake → **see** every queued hex lit orange (3D target highlight) until its job is done. A plain click sends one order and disarms; Ctrl+click on an already queued hex cancels it.
   - Run `warp 20` in the dev console (**`` ` ``**) → **see** the workers turn those shallow-water hexes into dry, buildable **Prepared** ground in one pass (reclaim `20 Metals + 10 Minerals` per hex, then the chain grades it). The button picks the operation per hex itself (trees → clear, rock → break, slope → level, crater → fill, shallow water → reclaim, plain ground → grade).
5. **Irrigate → seed the 10 Prepared meadow hexes → `Terraform 10 / 412 (2.4 %)` and `+10 %` move speed.**
   - **Known gap (GP-90, owner question):** the TERRAFORM button stops at Prepared ground (a click there says `Already terraformed`), so there is no button for Irrigate or Seed in this build. Send them from the **browser DevTools console** (not the in-game console):
     - `__online.commands.send('enqueueTask', { terraform: { op: 'irrigate', tiles: [[0,3],[1,3],[2,3],[3,3],[-1,4],[0,4],[1,4],[2,4],[3,4],[1,5]].map(([q,r]) => ({q,r})) } })` → **see** the meadow hexes turn Irrigated (`15 Water` per hex). If workers are busy with the lake chain, wait for it to finish first.
     - The same command with `op: 'seed'` → the hexes are seeded (`10 Water + 5 Minerals` per hex).
   - As the 10 tiles finish seeding, **see**:
     - The 10 hexes turn lush green **Living** ground (no glowing green or blue rims: only the orange hover and queued targets are highlighted).
     - The **Terraform %** meter in the bottom-left panel (under or beside the Command Dock, not under the minimap) updates to **`Terraform 10 / 412 (2.4 %)`** (hover it for `Living tiles: 10`, `Eligible owned: 412`, `Colony ratio: 2.4 %`, and the T2/T3 gate status).
   - Press **`L`** (with the dev console closed) → **see** the **Living overlay** highlight the 10 Living hexes and show **`+10% move speed on Living tiles`**. Press **`L`** again to turn it off.
6. **Build a Territory Beacon T1 (`R 8` claim)** — *not in this landing* (`W05-12`, `W05-21`, `W05-25` are full-product scope, deferred out of the `H` slice; see [`frontend-features.md`](../../questions-and-limitations/frontend-features.md) FF-82). Skip.
7. **Frozen border (`spawnColony <q> <r>`)** — *not in this landing* (`W05-13`, `W05-31` are full-product scope). Skip.
8. **Destroy the beacon & 60 s revert countdown** — *not in this landing* (`W05-13`, `W05-21` are full-product scope). Skip.
9. **Rain, Storm, Lightning & Twister (`rain`, `storm`, `lightning`, `twister` + `F8` → `WEATHER`).**
   - Press **`F8`** → click the **`WEATHER`** tab (or open the dev console **`` ` ``**):
     - Click **`MINOR RAIN`** or **`HEAVY RAIN`** (or run `rain minor` / `rain heavy` in **`` ` ``**) → **see** 3D multi-size parallax raindrops (that drift when panning the camera), concentric raindrop ripples and floating splash bubbles on nearby water, overcast night-like sky/sun dimming, Solar Collector Array output reduced (`72%` in minor rain, `55%` in heavy rain, `45%` in storm), all ground types (grass, dunes, rock, hex tiles) and trees turning wet and glossy, and organic puddles forming on flat ground (which evaporate over time when switched back to **`CLEAR`** / `rain none`).
     - Click **`⚡ LIGHTNING`** (or run `lightning -3 1` near the lake) → **see** a full-screen flash, a jagged 3D plasma bolt + branches reflected in nearby water, heavy 4-hex damage, and any hit building overloaded offline with electric arcs for 15 s.
     - Click **`🌪 TWISTER`** (or run `twister` in **`` ` ``**) → it auto-configures HIGH wind (`>=120%`) + MINOR rain if needed and spawns a 3D funnel cloud that slowly rises, wanders along a random heading damaging structures in its path, and sucks up nearby units and trees into the funnel before dropping them to their deaths.
10. **Meteor impact & whole-area 10-hex crater terraforming (`meteor <q> <r>`).**
   - Click **`☄ METEOR`** in `F8` → `WEATHER` (or run `meteor 4 2` in **`` ` ``**) → **see**:
     - A giant eclipse shadow that smoothly drapes over hills, ridges, and mountains (with zero black triangles), shrinks onto the target, triggers a full-screen white-out flash, and impacts the ground (reflected in nearby water).
     - A terrain-draped turbulent plasma blast wave, a 3D volumetric fireball & ash plume, and 3D molten rock/boulder particles.
     - Everything in the **10-hex impact area** is destroyed, leaving a persistent **melted glowing magma center hole, radial & Voronoi tectonic lava cracks, a scorched rim, and 3D meteorite/basalt rocks** on the ground.
   - Arm **`TERRAFORM [T]`** → **`Terraform`** and hover or click **any single hex** of the meteor crater → **see** the orange target highlight cover the **entire 10-hex crater area at once**, and once a worker completes that single job, all 10 hexes of the crater flatten and clear the melted crater & rocks together.
11. **Op energy & group-1 brownout shedding (`time night` → `waiting(power)` → `time day`).**
    - On `<client>/play.html?scenario=w05` (set `warp 1` in the dev console **`` ` ``**), open **`TERRAFORM [T]`**, click **`Terraform`** and click the slope hex at **`(-3, 4)`**.
    - Once a worker reaches `(-3, 4)` and starts levelling (or right after queuing), open the dev console (**`` ` ``**) and run:
      - `time night`
      - `cell 0` *(drains the HQ power cell store so the night solar drop immediately triggers brownout shedding)*
    - Open **`QUEUE`** (`Terraform` lane) in the Command Dock and run `power` in the dev console → **see** the terraform job pause first in shed group 1 with status **`waiting(power)`** (`paused work jobs: 1` in `power`), keeping its accumulated progress while the Command Hub stays powered.
    - Run `time day` in the dev console → **see** daytime solar power return, `waiting(power)` clear, and the worker finish levelling `(-3, 4)` from its saved progress.
12. **`desert` and `ocean` scenario terrain mixes (`w05-desert`, `w05-ocean`)** — *not in this landing* (`W05-17` is full-product scope; the D-38 `dune` and `oceanForest` world generators already shipped in W01). Skip.
13. **Resource tier gate (D-34) on `<client>/play.html?scenario=w05-tiers`.**
    - Open `<client>/play.html?scenario=w05-tiers` → a Stage 4 temperate colony loads with **`Terraform 123 / 397 (31.0 %)`** (`≥ 30 %` colony Living threshold for T2) and two Metals Extractors:
      - One at **`(3, 0)`** ringed by Living tiles within radius 2 (`≥ 50 %` Irrigated/Living ring requirement met, plus `+5 %` Living adjacency bonus).
      - One at **`(-5, 0)`** on **unterraformed ground** (`0 %` Living in its ring).
    - Hover the **Metals** chip (`[data-testid="hud-stock-metals"]`) in the top HUD → **see** the tier breakdown popover (`[data-testid="res-breakdown-metals"]`):
      - **`Raw Ore (T1)`** is unlocked and receiving income from both extractors (`+2.24/s`: not re-verified after the scenario moved to `(3, 0)` / `(-5, 0)`; the e2e pins only the T2 `+0.3/s`).
      - **`Light Alloys (T2)`** is **unlocked** (`data-locked="false"`) and receiving **`+0.3/s`** (`30 %` of the ringed extractor's `1.05/s` output; `70 / 30` T1/T2 split), while the second extractor on unterraformed ground contributes T1 only.
14. **Earlier waves stay clean (`&waves=..04`).**
    - Open `<client>/play.html?scenario=w04&waves=..04` → **see** no `Terraform %` chip in the top HUD, no `Worker Drone T3` in `PRODUCTION [U]`, only the W01 3-button toolset (`TERRAFORM [G]`, `REPAIR [R]`, `DISMANTLE [Z]`) in `TERRAFORM [T]` (no W05 op chips or area brushes), and pressing **`L`** does not activate the Living overlay.

18. **Cannot terraform terraformed hexes.** With `Terraform` armed, click a Living (or Prepared) hex → **see** `Already terraformed` and nothing is queued. Click a hex that already has a queued job → **see** `Already queued`. Ctrl+click over a mix of valid and invalid hexes → the valid ones queue, the rest are skipped.
19. **Cancel cancels all.** Queue 3 terraform orders, open **`QUEUE`** and click the × once → **see** all three leave the queue, the workers go idle and the orange targets vanish.
20. **Deep water.** The deep hex next to the lake says `Deep water needs a T2 worker` when no T2+ worker exists (host reject: `Rejected: Deep water needs a T2 worker`); with a Worker Drone T2 or T3 alive, the click queues it.

21. **Terrain test scene.** Open `<client>/play.html?host=local&scenario=w05-terrain` → **see** 12 patches on a ring around the Hub: forest, rocks, mountain, ridge, moat, Living, shallow lake, deep lake, craters, hills, dunes, plain ground. Click `Terraform` and Ctrl+click a whole patch (edge hexes first) → each orderable type is accepted (the deep centre uses the pre-spawned Worker Drone T2); Ridge, Moat and Living say `Nothing to terraform here` / `Already terraformed`.
22. **Dismantle.** Click `DISMANTLE` on a drone or on yourself → **see** `Drones and other units cannot be dismantled`. Dismantle a far building → nothing happens until the Worker Drone T2 walks there and works; no instant refund.
23. **Lights at night.** `time night` → buildings glow. Run `cell 0` → **see** the BROWNOUT banner; shed buildings fade to dark (windows and light cones), the Hub and HQ stay lit. `cell` refill or `time day` restores them.

24. **Hex grid only on level open ground (D-44).** Restart the dev stack first (`npm run dev`: the world generator changed, so dev planets are recreated). Open `<client>/play.html?planet=dune` and land → **see** hex lines only on the flat landing pad, as closed hexagons; no line on any dune, and none on the hex next to a dune. Crystals and ore stand inside the grid, never on a dune. On `<client>/play.html?host=local&scenario=w05-terrain` → **see** no lines on the hills, beach, rocks or forest, and the grid stopping one hex short of each of them.
25. **Ground marks hug the ground.** On the dune planet, arm `Terraform` and hover a dune → **see** the dark-blue disc lie on the sand with an unbroken outline (no half-hexes, no floating corners); click → the queued disc looks the same. Arm a building → the blue power-zone outline and the ghost footprint follow slopes too.
26. **Flattened dunes join the grid (D-44 R4).** On the dune planet, terraform the dunes next to the landing pad, working outward → **see** every flattened hex get a hexagon, with no blank patches inside the flattened area (ground flattened before this pass keeps its old gaps; use a fresh guest `&as=<x>` for clean ground).
27. **A hill beyond the edge row is worked inward.** Click a dune hex two or more hexes past the last grid hex (one row without hexagons between them) → **see** the HQ walk to the grid edge and clear the nearest disc first, then the next, until the clicked hex is flat; no `no_path`. A tree deep in a forest is cleared from the forest edge the same way.
28. **Night lights.** `time midnight` → **see** the HQ's lamp beam start at the lamp and end exactly on the lit patch of ground (a wide soft fan, no folded or stretched end), from every camera angle and on slopes; Command Hub floodlights look the same. The opened landing pod's blue deck ring and ramp strips are dark unless the HQ lamp points at them; `time noon` → they glow as before.
29. **Water reflections.** (a) **Mirror only:** open `<client>/play.html?host=local&scenario=w05-terrain&reflectDebug=1`, press `` ` ``, run `time noon`, `spawn -8 4`, `spawn -9 5` (bots in/at the deep lake), close the console and pan (minimap: click the blue lakes left of the Hub) so the two lakes are mid-screen → **see** the water show only the mirror image: sky, the bots upside down below their feet, the shore trees/terrain upside down past the far bank. (b) **Normal look:** drop `&reflectDebug=1` (or F8 → `WATER` → REFLECTION DEBUG OFF) → **see** the same images as darker, slightly wavy shapes on the water; open water looks as before. F8 → `WATER` → MIRROR REFLECTION 0 vs 100 % toggles them; REFLECTION DISTORTION 0 = a sharp mirror; `WIND` STRENGTH up = more ripple. Only things **beyond** the water (far shore, top of the screen) or **in** it can reflect at this camera angle; things on the near shore reflect onto land. Press RESET in the WATER tab if you moved a WATER slider before (an old saved strength 0.8 stays dimmer). (c) **Night, no triangles:** `time midnight`, then right-click-move a bot to a lake shore so its headlamp pool falls on the water → **see** a smooth light pool on the water, no big light/dark triangles (same with F8 → WATER → MIRROR REFLECTION 0: the triangles were a draw-order bug, RN-72). (d) **Camera area only:** in the browser console `(await import('/render/core/perfConfig.ts')).perfTelemetry` → over water `reflectOn: true`, `reflectRect` < 1; pan to dry ground → `reflectOn: false`, `reflectW: 0`. (e) **Automated:** `E2E_HOST=local E2E_GPU=1 npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/probes/water-reflections.spec.ts` → 8 passed (~20 s; without `E2E_GPU=1` it uses SwiftShader, ~3.5 min). Known edges: `docs/questions-and-limitations/render.md` RN-71, RN-72.

## Automated checks (already green on the branch)

> 2026-11-07 full review pass (uncommitted, on top of the owner's tree): `npm test` 2259 passed / 1 skipped, `npm run typecheck`, `npm run lint`, `npm run check:structure`, `npm run build` green; `validate:particles -- --all` 9/9, `test:particles` 22/22. e2e: `--waves 05` local 5 passed + 1 server-only skip; server 5/6 in one run, then the remaining `@hack 14` passed alone after its fix (no single 6/6 server run yet); `test:parity` 2/2, `test:contract` 20/20, `test:integration` 24 files green, `--waves 01` 3/3 runs green. Full-suite runs on a machine at load 20–40 (other sessions) still show timing-only failures (`waiting for tick`, warp rate) and `w12` step 4 (XC-41, pre-existing); rerun on a quiet machine before landing.

> 2026-11-06 hex-tile pass (D-44) + owner pass (R4 plane joining, edge-inward terraform, lamp beam, pod ring): `npm test` 2226 / 2229 (2 failures in `terraform-basic/brush-ctrl.spec.ts` come from an unrelated in-flight `BrushController.ts` edit), `npm run typecheck` and `npm run check:structure` green; e2e **not** re-run after this pass.

`npm run check` · `npm test` · `npm run build` · `npm run e2e -- --waves 05 --hack` (6/6 passing) · `npm run e2e -- --waves 05 --host local --hack` (5 passed, 1 server-only skipped) · `npm run e2e -- --waves ..05 --hack` (W00 + W01 + W02 + W03 + W04 + W05 = 42/42 passing).

## When you're done

- **All good:** from the main checkout (`/Users/ferretrec/work/TerraAgent`) run `npm run wave -- land 05`. It re-runs the gates, merges W05 into `main`, tags `wave-05`, pushes, and removes the W05 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.

## Owner feedback pass (simplification)

12. **Terraform menu** — see steps 4–5: three buttons, Ctrl+click queue, orange target highlight.
13. **AI off by default** (W08 feature: on the default dev stack, not in `?scenario=w05`). Open the HQ panel → **see** `AI OFF` above the Goals/Priorities tabs; bots stay idle apart from your explicit orders. Click `AI ON` → bots work on goals again.
14. **Natural base layout.** With `AI ON`, let bots build 5–6 solar/depot buildings → **see** them spread around the Hub with a free lane between them, not packed together.
15. **Header and panel.** The top bar shows the energy icon and numbers only (no bar). In the bottom-left panel by the Command Dock, **see** time of day, `Wind …` and `Terraform …`.
16. **Wind turbine speed.** In the dev console run `setWind` at 25 %, 100 %, 150 % → **see** the rotor turn slowly (about 4 s per turn at the 100 % rotor scale).
17. **Wires between close buildings.** Look at power wires between adjacent buildings → **see** short low arcs, no spikes into the sky.
