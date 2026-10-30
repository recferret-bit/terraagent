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

1. **Orbital boot splash & guest auto-seat.** Open `<client>/play.html` in a fresh private window (no `?scenario`) → you briefly see the Faction Plate **ORBITAL UPLINK** splash (`Contacting orbit…` → `Establishing guest credentials…` → `Checking colony assignment…` → `Deploying drop pod…`) while `POST /v1/auth/guest` and `GET /v1/me/home` run silently, then it hands over to `pl_dev` with no click required.
2. **Drop-pod descent & HQ deployment.** On `<client>/play.html` (or `<client>/play.html?scenario=w01` for a fresh scenario planet), watch the drop pod descend onto the colony's guaranteed spawn slot and the **HQ T1 · Commander Drone** deploy (press **Space** or **Esc** during descent, or type `warp 10` / `land` in the dev console, to fast-forward). Once landed:
   - The top-centre **Minimal HUD** shows **Metals `600 / 500`**, **Minerals `350 / 500`**, **Bio `400 / 500`** (`Biomass 200 · Water 200`), **Supply `0 / 0`**, and **HQ CELL `800 / 800 E`**.
   - The top-left **HQ Status Panel** shows **HULL HP `900 / 900`**, **POWER CELL `800 / 800 E`**, and task `idle`. Left-clicking the HQ (or clicking `SELECT HQ`) selects it; right-clicking any passable hex tile orders `moveUnit` and moves the HQ along the hex A\* path.
3. **Construction menu & 3×3 Hub ghost bill.** In the bottom-right **CONSTRUCTION** panel, only **`Command Hub [H] · 200 Metals · 100 Minerals · 50 Biomass · 50 Water`** is listed. Click it (or press **`H`**) → the 3×3 **Hub placement ghost** card opens on a valid 3×3 site near the HQ (`Valid site (3×3)`, green tint) and displays the live prep bill:
   - `N/9 tiles to prepare`
   - `Grade … · Clear … · Break …`
   - `…s (HQ 1.5×)` and `… E`
   - lump yields (`+5 bio.biomass` per forest tile, `+10 metals.t1` per rock tile)
   Hovering other tiles on the terrain updates the 3×3 footprint and bill live (water or out-of-range tiles turn red with the rejection reason). Click **CONFIRM** on a valid 3×3 site.
4. **Linked site preparation (Grade / Clear / Break).** Watch the HQ walk to the 3×3 footprint and prepare each un-prepared tile one by one (`Wild → Flat → Prepared`). As each tile finishes:
   - The hex tile blends smoothly (0.4 s shader transition) into the **Prepared** foundation hex-plate pad material.
   - The **HQ CELL** bar drains (`20 E` per Grade, `30 E` per Clear, `50 E` per Break; tip: type `warp 10` in the dev console and press **`` ` ``** to close the console so you can watch at 10× speed).
   - Clearing forest tiles adds `+5 bio.biomass` and breaking rock tiles adds `+10 metals.t1` to colony stock.
   - While tiles are being prepared, the **CONSTRUCTION** order row reads `waiting(site: n/9)`.
5. **Command Hub construction & scaffold stages.** As soon as all 9 footprint tiles are `Prepared` (`9/9`), construction starts automatically:
   - Colony stock drops by **200 Metals, 100 Minerals, 50 Biomass, 50 Water** (paid on start, `UO-Q-01`).
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
