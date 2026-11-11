# W18 — PvP & Diplomacy: owner check

> The wave's demo story ([`waves/W18-pvp-diplomacy.md`](../waves/W18-pvp-diplomacy.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 12 minutes.

## Before you start

- **Where it runs:** branch `wave/w18-pvp-diplomacy`, worktree `../TerraAgent-wt/w18`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4200` → app **4201**, client **5373** (`TA_DB_NAME=terra_wave_w18_pvp_diplomacy`). Below, `<client>` = `http://127.0.0.1:5373`, `<app>` = `http://127.0.0.1:4201`.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w18 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **Second player tabs (`as=b`, `as=c`, `as=d`, `as=e`):** in Colony A's dev console type `planet b` (or `planet c`, `planet d`, `planet e`). Open the printed `<client>/play.html?join=<planetId>&as=<letter>` link in another tab to control Colony B (`col_1`), Colony C (`col_2`), Colony D (`col_3`), or Colony E (`col_4`) on the same live planet.
- **Scenario (`?scenario=w18`):** seeds 5 discovered colonies in sector `sec_0_0`: Colony A (`col_0`, Stage 4, Hub + HQ + 4 Recons), Colony B (`col_1`, Stage 4, unshielded, Hub + HQ + 2 Turrets + Supply Depot + 500 stock per T1 resource), Colony C (`col_2`, Stage 3 aged 1 h, `newcomer shield: 5 h left`), Colony D (`col_3`, Stage 4, unshielded, away-AI truce enabled), and Colony E (`col_4`, Stage 4, unshielded).
- **HQ tab (Raid Target Picker & Diplomacy Panel):** click **`HQ`** in the left-edge Colony book (`[data-testid="colony-tab-hq"]`) to open the **RAID TARGETS** picker (`[data-testid="raid-target-picker"]`) and **DIPLOMACY** panel (`[data-testid="diplomacy-panel"]`).
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Launch a raid and siphon from Colony B's depot.**
   - **Where:** open `<client>/play.html?scenario=w18&as=a` (Colony A, Stage 4, 4 Recons). Click **`HQ`** in the left Colony book (`[data-testid="colony-tab-hq"]`) to reveal **RAID TARGETS** (`[data-testid="raid-target-picker"]`).
   - **How:** in the `Colony B` row (`[data-testid="raid-target-row"][data-colony-id="col_1"]`), click **`Dispatch`** (`[data-testid="raid-target-dispatch"]`). Press **`` ` ``** and run `warp 50` for ~5 seconds so A's 4 Recons march to `(16, 0)`, then run `warp 1`.
   - **See:** the path indicator shows `Target: Colony B (16, 0)`. Colony A's Recons march into Colony B's base, B's turrets engage them, and while A's Recons stand beside B's Supply Depot at `(19, 0)` (no living B combat units within 4 tiles), Colony A's top-bar Metals/Minerals/Bio stock climbs while Colony B's stock drops (`2 units/s` per siphoning Recon, capped at `25%` of B's stock per raid).

2. **Newcomer raid shield on Colony C.**
   - **Where:** still in Colony A's **`HQ`** tab → **RAID TARGETS** list, inspect the `Colony C` row (`[data-testid="raid-target-row"][data-colony-id="col_2"]`).
   - **How:** hover or read the reason badge on `Colony C` (`[data-testid="raid-target-reason"]`). In Colony A's dev console, run `planet c`, open the printed `?join=<planetId>&as=c` URL in a second tab (Colony C), press **`` ` ``** in Colony C's tab, and run `setShield 3`.
   - **See:** `Colony C`'s **`Dispatch`** button is disabled (`data-disabled="true"`) with reason badge `Protected 300:00 (newcomer shield: 5 h left)` (and any direct `raid` command against `col_2` is rejected with `raid_protected`). After running `setShield 3` in Colony C, the badge updates live to `newcomer shield: 3 h left`.

3. **HQ reprint, critical state, and full colony elimination into ruins.**
   - **Where:** in Colony A's dev console run `planet b`, then open the printed `<client>/play.html?join=<planetId>&as=b` link in a second tab (Colony B).
   - **How:**
     1. In Colony B's dev console (press **`` ` ``**), run `killHq` → check the **QUEUE [Q]** panel (`[data-testid="hq-reprint-status"]`). Run `warp 80` for ~2 seconds so the 60 s reprint finishes, then `warp 1`.
     2. In Colony B's dev console, run `killHub`.
     3. In Colony B's dev console, run `killHq` a second time.
   - **See:**
     1. After the first `killHq`, Colony B's Hub queues an automatic free HQ reprint (`units` lane, `cost = {}`, `60 s`) and `[data-testid="hq-reprint-status"]` displays **`HQ REPRINTING`**. After `warp 80`, the reprinted HQ spawns at Colony B's Hub.
     2. After `killHub` (with the reprinted HQ alive), the top red banner (`[data-testid="colony-critical-banner"]`) appears with **`HUB LOST — REBUILD WITHIN 24:00`** (`[data-testid="colony-critical-title"]`) and a **`Place Hub`** button.
     3. After the second `killHq` (with no Hub and no HQ remaining), Colony B is eliminated: the **`COLONY ELIMINATED`** modal (`[data-testid="colony-eliminated-modal"]`) appears with a **`Found New Colony`** button, B's remaining buildings turn into dark neutral ruins (`ENTITY_STATE.ruined`, scrapable for `50%` of build cost), and `GET <app>/v1/planets/<planetId>/sectors` shows `sec_0_0`'s living colony count decremented while retaining its founded seat reservation (`foundedSeats >= 4`).

4. **Propose and accept a 6-hour bilateral truce.**
   - **Where:** in Colony A's **`HQ`** tab → **DIPLOMACY** panel (`[data-testid="diplomacy-panel"]`), and in a second tab joined as Colony D (`planet d` → `<client>/play.html?join=<planetId>&as=d`).
   - **How:** in Colony A's Diplomacy panel, select `Colony #3` (Colony D) in `[data-testid="propose-target-colony"]`, click **`6h`** (`[data-testid="duration-chip-6h"]`), and click **`Offer Truce`** (`[data-action="propose-truce"]`). Switch to Colony D's tab, open the **`HQ`** tab, and click **`Accept`** (`[data-action="accept-truce"]`) on the incoming truce banner (`[data-testid="diplomacy-offer-banner"]`).
   - **See:** both Colony A and Colony D show an active truce badge (`[data-testid="diplomacy-truce-badge"]`, status `ACTIVE`, `6h` countdown timer). Selecting one of A's Recons and issuing an attack-move into Colony D's territory (`(0, -16)`) is rejected with `truce_active`.

5. **Cancel a truce early (10-minute notice & 24-hour Oathbreaker marker).**
   - **Where:** in Colony A's **`HQ`** tab → **DIPLOMACY** panel (`[data-testid="diplomacy-panel"]`).
   - **How:** click **`Cancel`** (`[data-action="cancel-truce"]`) on the active truce badge with Colony D.
   - **See:** the truce badge switches to **`NOTICE`** with a `Notice: 10:00` countdown (`[data-testid="truce-timer"]`) during which attacks remain blocked (`truce_active`), and Colony A displays the **`⚠ OATHBREAKER (24h 0m)`** banner (`[data-testid="diplomacy-oathbreaker"]`) and disables **`Offer Truce`**.

6. **Away AI Director accepts an incoming truce offer.**
   - **Where:** in Colony D's tab (`?join=<planetId>&as=d`) and a tab joined as Colony E (`planet e` → `<client>/play.html?join=<planetId>&as=e`).
   - **How:** in Colony D's dev console, run `presence away` (marks Colony D away; D's away policy has AI truce acceptance enabled). In Colony E's dev console, run `offerTruce d 6`, then `warp 10` for ~2 seconds, then `warp 1`.
   - **See:** Colony D's away evaluator accepts Colony E's 6 h truce offer automatically, and an active truce between Colony D (`#3`) and Colony E (`#4`) appears in the Diplomacy panel.

7. **3D ruin shader in the Playground & `?waves=..17` wave-flag gate.**
   - **Where:** open `<client>/playground.html?inspect=building.solar&ruin=1`, then open `<client>/play.html?scenario=w18&waves=..17`.
   - **How:** inspect the ruined Solar Collector in the Playground (toggle **`RUIN [1/0]`** in the info panel). Then on `<client>/play.html?scenario=w18&waves=..17`, open the **`HQ`** tab and check the UI and console.
   - **See:** in the Playground with `?ruin=1`, `building.solar` renders with the Unifier Shader ruin modifier (charred soot desaturation, moss/weathering boost, and zero emissive glow). On `/play.html?scenario=w18&waves=..17`, neither the Raid Target Picker nor the Diplomacy Panel is mounted, and `raid` / `diplomacy.proposeTruce` reject with `wave_disabled`.

## Automated checks (already green on the branch)

`npm run validate:wave -- 18 --gates` · `npm test` · `npm run test:integration` · `npm run test:contract` · `npm run build` · `npm run test:parity` · `npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/w18.spec.ts` · `E2E_HOST=local npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/w18.spec.ts` · `npm run e2e -- --waves ..18`.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 18`. It re-runs the gates, merges W18 into `main`, tags `wave-18`, pushes, and removes the W18 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
