# W12 — Player Page & Achievements: owner check

> The wave's demo story ([`waves/W12-player-page-achievements.md`](../waves/W12-player-page-achievements.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 10 minutes.

## Before you start

- **Where it runs:** branch `wave/w12-player-page-achievements`, worktree `../TerraAgent-wt/w12`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4500` → app **4501**, client **5673** (`TA_DB_NAME=terra_wave_w12_player_page_achievements`). Below, `<client>` = `http://127.0.0.1:5673`, `<app>` = `http://127.0.0.1:4501`.
- **Start the stack** (it is already running in this worktree): if you need to start it yourself, run `cd ../TerraAgent-wt/w12 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** in the game page (`/play.html`) press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game canvas first if DevTools has focus.
- **Player page (`/me.html`):** linked from the top-left **PILOT / ME** HUD chip in the game, or open `<client>/me.html` directly in a second tab. Opening `/play.html?scenario=w12` seeds and remembers the `w12` dev pilot in `localStorage` (`ta_active_pilot`), or you can pass `?as=w12` explicitly on either URL.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Game HUD link and `/me.html` sticky tabs.**
   - **Where:** open `<client>/play.html?scenario=w12` in Tab 1, then open `<client>/me.html` in Tab 2 (or click the top-left **PILOT / ME** chip on the game HUD).
   - **How:** wait ~2 s for the temperate colony (`Aegis Basin`) to appear in Tab 1; in Tab 2 scroll down and back up on `/me.html`.
   - **See:** Tab 1 shows the **PILOT / ME** chip (`data-testid="hud-me-link"`) at top left and the **TICK** counter rising ~5/s. Tab 2 shows the sticky navigation bar at the top with six tabs: **PILOT · PROGRESS · PLANETS · HISTORY · ACHIEVEMENTS · PLAY**.

2. **Pilot section.**
   - **Where:** `<client>/me.html` (Tab 2), **PILOT** section at the top of the page.
   - **How:** inspect the Pilot card.
   - **See:** pilot handle **`w12`**, Pilot ID **`w12.terraagent.mock`**, **"Pilot since 2026-10-01"**, badge **`Level 4`**, XP progress bar reading **`1 120 / 1 500`**, and title **`Surveyor`**.

3. **Progress section & 16 stats tiles.**
   - **Where:** `<client>/me.html` (Tab 2), click the **PROGRESS** tab (or scroll to **PROGRESS**).
   - **How:** inspect the 11-segment stage track (`S0`–`S10`), the **Next Achievements** list, and the **Stats** grid below it.
   - **See:** segments **`S0` through `S4`** are lit (`unlockStage = 4`, `S5`–`S10` unlit) with the next stage unlock condition shown; **3 closest achievements** render with chamfered progress bars and `value / target` counters (`Hydro Engineer` `4 / 5`, `Groundbreaker` `800 / 1 000`, `Tech Ascendant` `4 / 5`); **16 stats tiles** render with thin-space formatted numbers (e.g. `Colonies Founded 3`, `Tiles Graded 800`, `Obstacles Removed 350`, `Living Tiles Created 20`, `Buildings Completed 150`, `Resources Produced 24 500`).

4. **Planets section** — *deferred to W12-17 (H+).* (The `/me.html` shell already renders the current colony card `Aegis Basin` with **Dive in** and the past colony cards, and hides Settled colonies unless `W21` is on.)

5. **History timeline** — *deferred to W12-10 / W12-11 / W12-18 (H+).* Skip.

6. **Achievements catalogue (20 families × 3 tiers) & keyboard / hover flip.**
   - **Where:** `<client>/me.html` (Tab 2), click the **ACHIEVEMENTS** tab.
   - **How:**
     1. Check the section header and family ladders.
     2. Hover any achievement card with the mouse.
     3. Press **Tab** until an achievement card has focus, then press **Enter** (or **Space**).
     4. Optional: in browser DevTools → Rendering → emulate `prefers-reduced-motion: reduce` and flip a card again.
   - **See:**
     - The header reads **`ACHIEVEMENTS · 9 / 60`** (`1 120 XP`).
     - **20 family blocks** render, each with a 3-card horizontal ladder (Bronze, Silver, Gold = **60 cards** total), custom hex-medallion badge art (`/img/achievements/<id>.svg`), tier rim colours, and **Share on X** button on the back face of earned cards.
     - Hovering flips the card in 3D with a diagonal sheen; pressing **Enter** or **Space** flips the focused card and sets `aria-expanded="true"` (pressing again flips back with `aria-expanded="false"`). With `prefers-reduced-motion: reduce`, cards crossfade without 3D rotation or sheen.

7. **Live progression via dev console (`fact add`, `xp add`, idempotent XP, and HUD toasts).**
   - **Where:** Tab 1 (`<client>/play.html?scenario=w12`) and Tab 2 (`<client>/me.html`).
   - **How:**
     1. In Tab 1 press **`` ` ``** to open the in-game dev console, type `fact add groundbreaker 900` and press Enter.
     2. Switch to Tab 2 (`<client>/me.html`) and reload the page.
     3. Back in Tab 1's dev console, run `fact add groundbreaker 900` a second time, then reload Tab 2.
     4. In Tab 1's dev console, type `xp add 1000` and press Enter, then reload Tab 2.
   - **See:**
     1. After the first `fact add groundbreaker 900`: the console prints `fact groundbreaker = 1700 (+900) · unlocked: Groundbreaker Silver (+150 XP) · 1270 XP (L4 Surveyor)`, and an **ACHIEVEMENT UNLOCKED** toast (`Groundbreaker · Silver (+150 XP)`) appears at bottom right with badge art and a **VIEW ON /ME** link.
     2. On `/me.html` after reload: the header updates to **`ACHIEVEMENTS · 10 / 60`**, the **Groundbreaker Silver** card (`groundbreaker-2`) is now **Earned** with a green checkmark date, and the Pilot XP bar reads **`1 270 / 1 500`**.
     3. After the second `fact add groundbreaker 900`: `groundbreaker` rises to `2600` (below Gold's `10 000` threshold), **no second Silver XP is awarded**, and `/me.html` still reads **`1 270 / 1 500`**.
     4. After `xp add 1000`: an in-game **LEVEL UP** toast (`Level 6 · Terraformer`) appears at bottom right, and `/me.html` updates to **`Level 6`** (`2 270 / 2 800`).
     5. *(Optional reset)* Run `profile reset` in the dev console (or `npm run dev:restart` in the terminal) to return the pilot to the fresh baseline.

8. **Card back badge minting outbox** — *deferred to W12-25 / W12-26 (post-hackathon).* (Seeded earned cards already display `Recorded (mock)` on their back face, and newly unlocked tiers in dev display `Badge minting…`.)

9. **Families whose producer wave is off show "Coming soon".**
   - **Where:** open `<client>/me.html?as=w12&waves=..12` (or run `TA_WAVES=..12 npm run dev:restart` and open `<client>/me.html`).
   - **How:** scroll to the **ACHIEVEMENTS** section and inspect the **Warlord** (`W15`), **Diplomat** (`W14`), **Merchant** (`W13`), and **Settler** (`W21`) family blocks.
   - **See:** all three tiers of **Warlord**, **Diplomat**, **Merchant**, and **Settler** have status **`Coming soon`** (`data-status="coming_soon"`) and show no progress bar (`0 / target` hidden).

10. **Wave flag `W12` off (`..11`).**
    - **Where:** open `<client>/play.html?scenario=w12&waves=..11` in Tab 1 and `<client>/me.html?waves=..11` in Tab 2 (or run `TA_WAVES=..11 npm run dev:restart`).
    - **How:** check the top-left HUD in Tab 1 and the page body in Tab 2; curl `<app>/v1/me/profile` when the server runs with `TA_WAVES=..11`.
    - **See:**
      - In Tab 1 (`/play.html?scenario=w12&waves=..11`): there is **no `PILOT / ME` link** in the HUD (`[data-testid="hud-me-link"]` count is 0), and the game ticks normally (~5/s).
      - In Tab 2 (`/me.html?waves=..11`): a Faction Plate card reads **"Player page is off"** (`data-testid="me-wave-disabled"`, HTTP 403 `wave_disabled` when `TA_WAVES=..11` on the server).

## Automated checks (already green on the branch)

`npm run check` · `npm test` · `npm run test:integration` · `npm run test:contract` · `npm run build` · `npm run e2e -- --waves 12 --hack` (steps 1, 2, 3, 6, 7, 9, 10) · `npm run e2e -- --waves ..12 --hack` (all earlier wave suites + W12).

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 12`. It re-runs the gates, merges W12 into `main`, tags `wave-12`, pushes, and removes the W12 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
