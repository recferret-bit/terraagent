# W00 — Platform Skeleton: owner check

> The wave's demo story ([`waves/W00-platform-skeleton.md`](../waves/W00-platform-skeleton.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 10 minutes.

## Before you start

- **Where it runs:** branch `wave/w00-platform-skeleton`, worktree `../TerraAgent-wt/w00`. Your main checkout is untouched.
- **Ports:** this worktree's `.env.worktree` sets `TA_PORT_BASE=4100` → app **4101**, client **5273** (`TA_DB_NAME=terra_wave_w00_platform_skeleton`). Below, `<client>` = `http://127.0.0.1:5273`, `<app>` = `http://127.0.0.1:4101`.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w00 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat .dev/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console (typing `chain.ping` in DevTools gives `ReferenceError`). Click the game first if DevTools has focus.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Server is up.** In a terminal: `curl <app>/v1/readyz` → `{"db":"ok","simThreads":N}` (N = CPU cores − 1).
2. **Planet renders and ticks.** Open `<client>/play.html?scenario=w00` → a flat green hex-tiled planet with a small builder robot in the middle (the test entity), no orbit menu or descent. The **TICK** chip (top left) counts up about 5 per second. Mouse wheel zooms, WASD pans, Q/E rotates.
3. **Time warp.** Dev console: `help` → the command list. `warp 10` → the tick counter runs about 50/s and an orange **`×10`** badge appears. `warp 1` → back to about 5/s, badge gone.
4. **State inspector** — *not in this landing* (W00-43 is H+). Skip.
5. **Wave flags.** The **WAVES** panel (top right) shows all 26 waves on. Open `<client>/play.html?scenario=w00&waves=..00` → only **W00** is lit.
6. **Survives a restart.** Keep the play page open; in the worktree terminal run `npm run dev:restart` → the page shows **"Reconnecting…"** for a few seconds, then carries on from the tick it had reached (not 0), same planet.
7. **Mock blockchain receipt.** Open `<client>/dev/chain/` in a second tab (mock chain explorer). In the play tab's dev console type `chain.ping` → it prints a `mock:…` hash after about 1 s; within 1–2 s the same hash appears as a new highlighted row in the explorer. (The explorer's **CHAIN.PING** button does the same.)
8. **CI** — nothing to click: CI has never run on GitHub (nothing is pushed). Optional: `npm run ci:fast` in the worktree ends green.
9. **Browser-only mode (no server).**
   1. Stop the stack: `kill $(cat .dev/runner.pid)` (or Ctrl-C in its terminal).
   2. Start only the client: `npx vite --host 127.0.0.1 --port 5273 --strictPort`.
   3. Open `<client>/play.html?host=local&scenario=w00` → the same planet ticks about 5/s with no server.
   4. Dev console `warp 10` → about 50/s here too; `warp 1`.
   5. Wait ~10 s, reload → the tick continues where it was (saved in the browser's IndexedDB).
   6. Ctrl-C the client, `npm run dev` again.
10. **Instant response under lag.** Open `<client>/play.html?scenario=w00&lag=300` (300 ms artificial delay each way). Dev console `nudge 1` → the robot steps one tile **immediately**; "dev.nudge ok, applied at tick N" arrives ~0.6 s later. `teleport! 1 6 0` (server-only move) → the robot **glides** ~12 m over a short blend instead of jumping. The overlay bottom right shows the prediction numbers. Automated half: `npm run test:parity` → `PASS`.

## Automated checks (already green on the branch)

`npm run check` · `npm test` · `npm run test:integration` · `npm run test:contract` · `npm run build:strict` · `npm run test:parity` · `npm run e2e -- --waves ..00` (steps 1–3, 5–7, 9, 10) · `npm run e2e -- --waves ..00 --host local --hack`.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 00`. It re-runs the gates, merges W00 into `main`, tags `wave-00`, pushes, and removes the W00 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
