# W08 — Stages & HQ Goals: owner check

> The wave's demo story ([`waves/W08-stages-goals.md`](../waves/W08-stages-goals.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 15 minutes. Step 7 is not in this landing.

## Before you start

- **Where it runs:** branch `wave/w08-stages-goals`, worktree `../TerraAgent-wt/w08`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4200` → app **4201**, client **5373** (`TA_DB_NAME=terra_wave_w08_stages_goals`). Below, `<client>` = `http://127.0.0.1:5373`, `<app>` = `http://127.0.0.1:4201`.
- **Start the stack** (if it isn't already up): `cd ../TerraAgent-wt/w08 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background. Restart the app only with `npm run dev:restart` (Vite keeps running).
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **Earlier waves on this branch:** `main` (W00, W01, W02, W06) is merged here. `?scenario=w08` creates a fresh temperate colony at `S0 Landing` with the HQ drone deployed at `(0, 0)`, morning `06:00`, stock `500 Metals / 400 Minerals / 400 Biomass / 400 Water`, nearby metals and minerals deposits, the compact **Goals · S0** button between Tick and Resources (click it to open the Stage Track HUD), the **HQ Goals** panel (top right), and a **Priorities** tab in that same HQ panel.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **S0 Landfall & suggestion card.** Open `<client>/play.html?scenario=w08&skip=1`. Click **Goals · S0** between Tick and Resources. The **Stage Track HUD** shows 11 segments (`S0`–`S10`) with **S0** lit in orange (`S0 LANDING`, `Prepare ground, then build`, next condition `Command Hub T1 complete · 1 min`). Top right, the **HQ GOALS** panel (`0 / 2`) shows a suggestion card titled **Establish Colony** (`Prepare site, place Command Hub, and build 1 extractor + 1 generator`) with **ACCEPT** and **DO IT MYSELF**. Bottom left in the **BUILD [B]** tab, **Command Hub** is enabled while **Metals Extractor** and **Solar Collector Array** are greyed out and read `Unlocks at S1: Command Hub T1 complete · 1 min`.
2. **Accept "Establish Colony".** Click **ACCEPT** on the suggestion card (or pick `Establish Colony` in the `GOAL` dropdown and click **ADD GOAL**). The suggestion card closes, the header reads `HQ GOALS 1 / 2`, and an active goal card **Establish Colony** (`ACTIVE`, progress bar `0% (0/4)`) appears in the list. In the **QUEUE** lane on the left, `Command Hub T1`, `Metals Extractor T1`, and `Solar Collector Array T1` are queued (`hq` orders) and the HQ drone starts preparing the Command Hub footprint.
3. **Command Hub completes → S1 First Light.** Open the dev console (**`` ` ``**) and run `warp 20`. Within a few seconds the Command Hub finishes; run `warp 1` to return to normal speed. A **STAGE REACHED** toast opens below the stage track reading **S1 First Light** (`Resources flow, and everything costs energy, terraforming included`) with an **UNLOCKED** reveal panel listing `Units: Worker Drone T1`, `Buildings: Metals Extractor, Solar Collector`, `Orders: Harvest`, and a **DISMISS** button. Segment **S1** is now lit in orange, the next condition reads `extractor + generator · 2 min`, and in the **BUILD [B]**, **PRODUCTION [U]**, and **TERRAFORM [T]** tabs **Metals Extractor**, **Solar Collector Array**, and **Worker Drone T1** are un-greyed, while next-stage items (**Pylon**, **Storage Depot**, **Worker Drone T2**, **FILL**, **BRIDGE**) appear greyed out with `Unlocks at S2: extractor + generator complete · 2 min`.
4. **S2 dwell countdown & `stage skip-dwell`.** In the dev console run `warp 20` until the HQ finishes the Metals Extractor and Solar Collector (`Establish Colony` reaches `4/4` and clears from `HQ GOALS`), then run `warp 1`. Look at the right end of the Stage Track HUD's next-condition row: the **dwell countdown badge** is active and counts down from `2:00` (`1:59`, `1:58`, …) — the colony stays at `S1` until the 2-minute minimum dwell elapses (`UO-LC-02`). In the dev console run `stage skip-dwell`. The console prints `stage dwell skipped (applied at tick …)` and the stage track immediately advances to **S2** (`S2 THE GRID`, `Grid reach, parallel workers, storage, night`) with the **STAGE REACHED — S2 The Grid** toast listing `Pylon`, `Depot`, `Storage Depot`, `Capacitor`, `Wind Turbine`, `Water Extractor`, `Petroleum Well`, `Supply Depot`, `Fill`, `Bridge`, `Dismantle`. (**Pylon**, **Storage Depot**, and **Worker Drone T2** are now un-greyed in the menus.)
5. **Priority sliders & rule-engine autopilot (`suggestion` at S2 vs `auto` at S3).** At `S2`, open the dev console and run `autopilot next`. Because the power lane was introduced at S1/S2, the rule engine only *suggests* at S2 (`UO-LC-05`): the console prints `autopilot next: energy (… bp) -> suggestion: wind (construction)`. Now look at the **HQ → PRIORITIES** tab (top right, `SUM 250`): drag the **EXPANSION** slider from `50` to `80` (the sum badge updates to `280`, and the slider state persists across a page reload). Run `autopilot next` in the dev console again → the top weighted need shifts to expansion and prints `autopilot next: expand (… bp) -> suggestion: outpostBeacon (construction)`. Next, run `stage set 3` followed by `autopilot next` → at `S3` the power lane is one stage past its introduction, so the console prints `autopilot next: energy (… bp) -> auto: wind (construction)` (queues an `auto` order instead of a suggestion).
6. **Safety override (`stage trigger fauna`) & HQ goal limit.** In the dev console run `stage set 2` to return to `S2 The Grid`, then run `help stage` (which lists `overrides: fauna, rival, resource, power, storage`). Run `stage trigger fauna`. Before any dwell timer expires, the S3 safety override fires: the stage track jumps to **S3** (`S3 FIRST CONTACT`, `Threat and defense, supply cap`) and the **STAGE REACHED — S3 First Contact** toast shows the badge **`Safety Override: fauna`**. To check the HQ T1 goal queue cap (`2`), run `goal clear`, `goal add grow_economy metals 100`, `goal add secure_power 100`, and `goal add grow_economy minerals 100` in the dev console → the first two queue (`HQ GOALS 2 / 2`) and the third prints `error: queueGoal rejected: goal_limit`; clicking `×` on a goal in `HQ GOALS` frees the slot.
7. **`/me.html` Ascendant progress counter** — *not in this landing* (W12 consumer; deferred with `W08-07` / `W08-28`, see `FF-70`). Skip.
8. **Wave off (`&waves=..07`).** Open `<client>/play.html?scenario=w08&waves=..07&skip=1` (or run `TA_WAVES=..07 npm run dev:restart` and reload `<client>/play.html?scenario=w08&skip=1`). There is **no** Stage Track HUD, **no** HQ Goals panel, **no** HQ Priorities panel, and **no** stage-locked items in the menus; the colony still ticks and plays normally.

## Automated checks (already green on the branch)

After merging `main` (W00, W01, W02, W06): `npm run check` (typecheck, lint, structure ≤ 500 lines/file & ≤ 100 lines/fn, `gen:check`) · `SIM_THREADS=1 npm test` (283 files, 1694 passed, 1 skipped) · `npm run test:integration` (17 files, 65 passed) · `npm run test:contract` (16 passed) · `npm run test:parity` (1 case, both hosts) · `npm run build` · `npm run e2e -- --waves 08` (4 passed, 1 skipped: Steps 1–4, 5, 6, and 8) · `npm run e2e -- --waves ..08 --hack` (W00, W01, W02, W06, and W08 `@hack` suites). `npm run wave -- land 08` re-runs `ci:fast` (`check`, unit tests, build) plus the wave e2e.

Step 7 is `test.skip` in `tests/e2e/w08.spec.ts` (`W12 Ascendant profile consumer not in H-slice`). Known H-slice scope boundaries are recorded in `GP-66` (`docs/questions-and-limitations/sim-gameplay.md`) and `FF-70` (`docs/questions-and-limitations/frontend-features.md`).

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 08`. It re-runs the gates, merges W08 into `main`, tags `wave-08`, pushes, and removes this worktree and branch.
- **Something is wrong:** tell the wave lead which step and what you saw. It is fixed on this branch before anything lands.

## Owner follow-up checks (2026-11-03)

Use **http://127.0.0.1:5373/play.html?host=local&scenario=w08&skip=1&waves=..08** for the browser-host version; use the same URL without `host=local` for the server stack on port 4201.

1. Open the in-game console with **`**, run `stage set 2`, then close the console with **`**. The stage popup shows **Closes in 30s** and counts down. Dismiss closes it immediately; otherwise it closes at zero.
2. Click **S2** to reopen its guide without a timer. Click **S1**: its lesson appears while the colony stays at S2. Click the tracker’s **−** button: the entire popup disappears. Click **Goals · S2** in the header to reopen it; click any stage to read its lesson. Click **S10**: it shows a preview and names W21 prerequisites; the simulation stays at S2. Previous / Next / Current and Show / Hide guide are removed.
3. Top right, click **Priorities**, change a slider, then **Goals**, then **Priorities**. There is one HQ popup and values persist. Keyboard Left/Right switches the focused tab.
4. Reload the URL for a fresh scenario. Accept **Establish Colony**, run `warp 20` in the console, wait for completion, then `warp 1`. Add **Grow Economy**, Metals, **100/min**. A real child order appears in Queue; the goal shows measured production and its current action/wait reason. Use `warp 20` to observe construction/harvesting and completion, then restore `warp 1`. If resources or storage block work, the goal must explain why.
5. Select Secure Power: it builds daytime capacity but only completes from the requested actual night balance. Solar alone cannot satisfy +10 E/s at night; the wait message names W03 night generators. Future goal kinds and Water growth are disabled rather than silently accepting work they cannot execute.
6. Browse S3–S10. Each guide names the next lesson and owning waves. S4 is the current W08 metadata boundary, not the end of the planned tutorial. The [progression contract](../W08-PROGRESSION-CONTRACT.md) assigns executable lessons and slider effects through rocket settlement.

Known scope entries: **GP-67** (missing mechanics and budget ceilings), **FF-71** (read-only stage navigation / previews). Prior automated-check counts above describe the original wave landing, not this follow-up.

### Follow-up verification results (2026-11-04)

- `npm run check` and `npm run build` passed (existing dependency-annotation / bundle-size build warnings remain).
- Full unit suite: all changed-area tests passed; unrelated backend/render timing failures passed when rerun with `--maxWorkers=2`. All 80 targeted stage, goal, priority and harvest tests passed after the final edits.
- Browser, local host: both new owner checks passed (guide replay/navigation/tabs; Establish Colony → Grow Metals 100/min → real production completion). The four existing runnable W08 demo checks passed separately. The existing W12 profile-page test remains deferred.
- Visually inspected the game screenshots for the guide, HQ tabs and growth flow. Browser verification used the local host; no new server-host browser run was made for this follow-up.


### Landing UI check (2026-11-04)

1. Open **http://127.0.0.1:5373/play.html?scenario=w08&skip=1**. Initially only **Goals · S0** is shown between Tick and Resources; click it to open the tracker.
2. Click any stage segment to open its untimed lesson. **Dismiss** closes that lesson; click its segment again to reopen it.
3. Click **−** to close the whole tracker. It must disappear completely; **Goals · S<n>** reopens it. HQ Goals/Priorities retain their existing tabs.
4. Continue the gameplay checklist above. **Full W08 Recheck remains open as [FF-72](../../questions-and-limitations/frontend-features.md#ff-72--full-w08-recheck)**; landing this UI change does not resolve the owner’s remaining W08 issues.


Merge review preserved W04/W10/W12 from `main` (`e1fce0f`). It regenerated the combined registries, retained both waves’ future integration gates, renumbered the W08 limitation entries to FF-70/71, routed Trade Hub access through W10’s shared rule, moved the unused extractor preview code off live Trade Hub kind 8, and corrected minimap dock selectors / popup stacking so header and popup controls remain clickable. The compact popup browser check and all 30 progression tests passed after those fixes; FF-72 remains open for the full owner recheck.

Merged server verification: all **6 runnable W08 browser checks passed**, including the compact popup and real Grow Metals completion. One W08-to-profile integration check remains skipped despite W12 now being present; enabling and validating it belongs to FF-72. The launcher stays between Tick and Resources; the expanded popup is centred to keep Build/Production tabs clickable.

Final pre-landing gates: `ci:fast` passed (typecheck, lint, structure, generated registries, **336 test files / 1,907 tests passed, 1 skipped**, and production build). Concurrent main planning edits were preserved by keeping their W08 obligations in the central progression contract.
