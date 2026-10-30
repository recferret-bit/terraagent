# W02 — First Light: owner check

> The wave's demo story ([`waves/W02-first-light.md`](../waves/W02-first-light.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 10 minutes.

## Before you start

- **Where it runs:** branch `wave/w02-first-light`, worktree `../TerraAgent-wt/w02`. Your main checkout is untouched.
- **Ports:** this worktree's `.env.worktree` sets `TA_PORT_BASE=4100` → app **4101**, client **5273** (`TA_DB_NAME=terra_wave_w02_first_light`). Below, `<client>` = `http://127.0.0.1:5273`, `<app>` = `http://127.0.0.1:4101`.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w02 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat .dev/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **Menus & queue shortcuts:** press **`B`** (or click **`[B] BUILD`** bottom-left) for the Construction menu, **`U`** (or click **`[U] UNITS`**) for the Units menu, and **`Q`** to toggle the Order Queue panel on the right.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Morning colony, family resource bar & power widget.** Open `<client>/play.html?scenario=w02` → a temperate hex planet loads in the morning (`06:00`) with a completed Command Hub T1 and HQ unit at `(0, 0)` surrounded by surface metals, minerals and forest deposits. At the top-centre **see** the family resource bar with three family chips — **Metals `400/500`**, **Minerals `250/500`**, **Bio `300/500`** (hover any chip to see its T1/T2/T3 sub-resource breakdown: `metals.t1 400`, `minerals.t1 250`, `bio.biomass 150`, `bio.water 150`) — plus the **Energy `+3 E/s`** chip. At the top-right **see** the power widget showing **`+8 supply / −5 demand`** and a sun icon (`DAY 06:00`).
2. **Produce a Harvester from the Hub.** Press **`U`** (or click **`[U] UNITS`**) to open the Units menu, select **Harvester** (`40 M · 15 Min · 5 Bio · 10 s`) and click **QUEUE** → **see** the Units lane entry in the Order Queue panel go **`IN PROGRESS`**, and stock drop by `40/15/5/0` at start (`Metals 360`, `Minerals 235`, `Bio 295`). About 10 s later (or ~1 s with `warp 10` in the dev console) a Harvester rolls out from the Hub edge and starts harvesting the nearest surface deposit by itself (`+0.5/s`).
3. **Place a Metals Extractor and a Solar Collector.** Press **`B`** (or click **`[B] BUILD`**) to open the Construction menu:
   1. Select **Metals Extractor T1** (`65 M · 20 Min · 10 W · 14 s · −6 E/s`). Hover near the metals deposit at `(3, 0)` — off the deposit the ghost turns red (`must cover a metals deposit`); on `(3, 0)` the deposit tiles glow and the ghost shows the prep bill. Click to place.
   2. Select **Solar Collector T1** (`60 M · 75 Min · 10 Bio · 5 W · 18 s · +20 E/s`) and click a buildable 2×2 spot within 3 tiles of the Hub (e.g. `(-3, 2)`).
   3. **See** both orders appear in the Construction lane, run linked terrain prep and then construct one after the other as the HQ walks between them (type `warp 10` in the dev console to speed up construction, then `warp 1`).
4. **Extractor income and Solar power.** Once both buildings finish → **see** the Metals chip income rise by **`+1.0/s`** (× deposit richness) while powered, and the power widget show Solar contributing **`+20 E/s`** (`+28 supply` total; type `power` in the dev console to print the component supply/demand breakdown).
5. **Queue waiting on missing resources + live ETA.** In the dev console run `fill minerals.t1 5` (sets `minerals.t1` to `5/500`, below the Extractor's `20 Min` cost), then place a second **Metals Extractor T1** on an uncovered metals deposit tile (e.g. `(4, 0)`) → **see** `waiting: Minerals 5/20 · ~30 s at +0.5/s` in the Order Queue panel. When Minerals reach `20` (from Harvester income, or immediately if you run `fill minerals.t1 250`), **see** the order start automatically.
6. **Night brownout and sunrise recovery.** In the dev console run `time night` → **see** Solar output drop to `0` (`−1 E/s` internal drain), demand exceed supply, a red **`OFFLINE: BROWNOUT`** banner appear in the power widget, and the Metals Extractor shed (`offline: brownout`, extraction paused). Run `time day` (or `skipnight`) → **see** daylight and `+20 E/s` Solar restored, the brownout banner clear, and the Extractor resume production.
7. **Storage cap halt and `waiting(storage)`.** In the dev console run `fill metals.t1` (or `fill metals.t1 9999`) → **see** the Metals chip at **`500/500`** (highlighted at cap) and the Metals Extractor pause extraction. In the dev console run `tune economy_t1_basic.solar.costMetals 600` and place a Solar Collector → **see** the queue entry show **`waiting(storage)`** with a greyed-out **"build a Supply Depot"** hint (the Supply Depot arrives in W03). Run `tune reset` afterwards.
8. **Cancel refunds (75 % in progress vs free while waiting).** Place a **Solar Collector T1** so it enters **`IN PROGRESS`** (charging `60 M / 75 Min / 10 Bio / 5 W` on start), then click its **`×` (Cancel)** button in the Order Queue panel → **see** **75 %** refunded in the stock chips (`+45 M`, `+56 Min`). Lower Minerals with `fill minerals.t1 5`, place another Solar so it stays **`WAITING`**, and click **`×` (Cancel)** → **see** it cancelled with nothing charged.

## Automated checks (already green on the branch)

`npm run check` · `npm test` · `npm run build` · `npm run ci:fast` · `npm run e2e -- --waves ..02 --hack` (W00 + W02 steps 1–8) · `npm run e2e -- --waves 02 --hack --host local`.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 02`. It re-runs the gates, merges W02 into `main`, tags `wave-02`, pushes, and removes the W02 worktree and branch. (Once W01 has landed in `main`, plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
