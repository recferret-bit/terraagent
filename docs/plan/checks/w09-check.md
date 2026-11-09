# W09 — Offline & Notifications: owner check

> The wave's demo story ([`waves/W09-offline-notifications.md`](../waves/W09-offline-notifications.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 15 minutes.

## Before you start

- **Where it runs:** branch `wave/w09-offline-notifications`, worktree `../TerraAgent-wt/w09`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4100` → app **4101**, client **5273** (`TA_DB_NAME=terra_wave_w09_offline_notifications`). Below, `<client>` = `http://127.0.0.1:5273`, `<app>` = `http://127.0.0.1:4101`.
- **Start the stack** (if it isn't running): `cd ../TerraAgent-wt/w09 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background.
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **Away plate:** with W09 on, the top-right of the play page has an **AWAY** plate. Click **AWAY** to open or collapse it.
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Away budget.** Open `<client>/play.html?scenario=w09`. The **AWAY** plate is in the top right. Set **Metals** to **30** and press **SAVE**. The console (or the plate) keeps 30. Reload the same URL → Metals is still **30**. (That memory is this browser's last ack, not the colony record. See FF-98.)
2. **Catch-up after a gap.** Note the **TICK** chip. Stop the stack (`kill $(cat scripts/dev/.out/runner.pid)`), wait about 20 seconds, then `npm run dev` again and reopen the same play URL. The tick is ahead of where you left it by roughly five ticks for each second you were down (a 20 second gap is about 100 ticks), not by one tick per real second of waiting. The automated check of a 10 minute gap (3000 ticks, under a second of run time) is `npm run e2e -- --waves 09 --hack` plus `backend/app/test/game/restart-fastrun.spec.ts`. A gap past 24 hours stops at 24 hours (BE-60).
3. **Welcome digest.** On `<client>/play.html?scenario=w09`, dev console: `away` → it prints `away at tick N`. Reload the page. A plate titled along the lines of **while you were away** appears with a duration. Resource nets on this scenario stay **0** (BE-67: the digest is keyed by the home id, and the sim row is `col_w09`).
4. **The plate is the headline.** The same plate shows duration, attacks, and at most three alert lines. It does not list built, lost, hazards, trades, or AI lines (FF-99). Press **Continue** or **Esc** → the plate is gone. Reload again → it does not come back for that same away.
5. **Away rules.** Not a click on this page. An AI `demolish` while the colony is away is rejected `away_policy` / `AW-10` and counted. A player demolish is applied. Covered by `shared/sim/test/systems/away-gate.spec.ts` and `shared/sim/test/systems/away-deny.spec.ts`.
6. **One attack notification.** Close the play tab first. A connected socket suppresses the row. In a terminal, with a real colony id (`co_` plus 26 Crockford characters; the e2e reads it from the welcome): `curl -s -X POST <app>/v1/dev/notify/test -H 'content-type: application/json' -d '{"colonyId":"<colonyId>","eventId":"evt_1"}'` → `{"kind":"under_attack","sent":1}`. The same body again → `"sent":0` and still one row. `curl -s '<app>/v1/dev/notify?colonyId=<colonyId>'` lists that one `under_attack` row. Do not send a `kind` field; the route always routes `under_attack`.
7. **One socket per colony.** Open `<client>/play.html?scenario=w09` in two tabs. The first tab's socket closes (code 4001, replaced). Open a second colony with `&as=b` if the scenario seats one; that tab stays up while the first colony's tab stays up. A dev socket with no colony does not kick a playing colony (BE-63).
8. **Restart keeps the world.** Leave the play page open. In the worktree: `npm run dev:restart`. The page shows **Reconnecting…**, then continues. The tick does not go back to 0. Snapshots are written about once a minute, spread across the minute, including a seal on admission pause and an end row when a world is archived (BE-56).
9. **Dev console.** On the play page, press **`` ` ``**. `warp 10` → the tick runs much faster and a warp badge shows. `warp 1` → back to about five ticks a second. `away` → `away at tick N`. `away` again → `already away`. `back` → `back at tick N`. `colony eliminate` while away → `colonyEliminated` and a hard-mode clock time. Then `curl -s <app>/v1/me/home` (with the same player the page used) includes `"state":"ELIMINATED"`. `colony eliminate` while present, after `back`, prints `error: not_away`. The clock is forgotten on process restart (BE-65, BE-66).
10. **Metrics.** `curl -s <app>/v1/metrics` includes `away_policy_rejections_total`, `ta_game_planet_mode`, `restart_fastrun_seconds`, `notify_sent_total`, `notify_suppressed_connected_total`, and `digest_rows`. (`/metrics` without `/v1` is 404.)

**Not in this landing (H+):** full reconnect with prediction (step 11), direct Web Push and Telegram (steps 12–13), push deep links (step 14), and the per-kind settings UI (step 15). `NOTIFY_ADAPTER=webpush`, `telegram`, or `live` fails boot because no live adapter is registered (BE-54).

## Automated checks (already green on the branch)

`npm run validate:wave -- 09` (26/26 issues, 0 errors) · `node scripts/check-structure.mjs` · `npm run gen:check` · the W09 unit and integration specs named in the issues · `npm run e2e -- --waves 09 --hack` (rejoin plate and one mock `under_attack` row).

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 09`. It re-runs the gates, merges W09 into `main`, tags `wave-09`, pushes, and removes the W09 worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch before anything lands.
