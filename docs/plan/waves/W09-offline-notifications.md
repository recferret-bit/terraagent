# W09 — Offline & Notifications

> **Track:** Autonomy (P) · **Flag:** `W09` · **Tag:** `wave-09` · **Scenario:** `scenarios/w09-offline.ts` · **E2E:** `e2e/w09.spec.ts`
> **Depends on waves:** W02 (spine). The away story needs W16, and the elimination causes come from W07 / W18. If those are off, the dev console triggers the events instead.
> **Specs:** [CONTINUITY](../../spec/CONTINUITY.md) §3 (`CT-10..14`), §4 (`AW-01..23`), §5 (`CT-30..34`), §5a (`CT-35..38`), §6 (`CT-40..45`), §7 (`CT-50..54`), §8–§10 · [SIMULATION](../../spec/SIMULATION.md) `SIM-H-03..08`, `SIM-D-03` · [ARCHITECTURE](../../spec/ARCHITECTURE.md) §15 · [NEAR](../../spec/NEAR.md) §1a (port pattern for `NotifierPort`) · D-17, D-24, D-30
> **Owned paths:** `backend/app/src/game/{presence,snapshot,restart}/`, `backend/app/src/notify/**`, `shared/sim/src/systems/away/`, `shared/contracts/src/{commands,events}/{presence,autopilot,notify}.ts`, `client/src/features/{away,notify}/`, `client/public/sw.js`

## Goal

Leaving is safe and honest. A colony keeps running while its player is away: the planet switches to coarse stepping when empty and fast-runs missed time after a restart. Automation respects a player-set away budget. The player gets a "while you were away" digest and is notified by Web Push or Telegram when something critical happens. Hard mode applies (D-17): an away colony **can** be eliminated, and the player is told in time.

## Demo story (e2e)

1. Load `?scenario=w09` (a colony at S3) → open the **Away settings** panel: set the away budget to 30 % of metals, turn `autoTrade` off and `awayRaids` off, switch the autopilot mode to `rules_only`.
2. Open **Notifications** → enable Web Push (a mock permission in e2e) → see the subscription row; open "Link Telegram" → see a one-time code `/start ABC123` (mock Telegram adapter).
3. Close the tab → after 60 s the server log shows `presence away`, and the planet steps coarse (`ta_game_planet_mode{mode="coarse"}` = 1).
4. Dev console `away.warp 8h` and `raid spawn` → the mock notifier records `under_attack` once (debounced), and the colony survives (or does not; hard mode).
5. Kill the server with `kill -9`, restart → the planet loads from its snapshot and fast-runs the gap; the notifications found during the fast-run are sent once.
6. Reopen the deep link `/c/{colonyId}` → the game resumes straight into the colony, and the **"While you were away"** modal shows resources before/after, losses, the raid, and AI decisions.
7. Open the game in a second tab → the first tab shows "Opened on another tab — Resume here" (`bye 4001`).
8. Set `TA_WAVES=..08` → no away panel, no digest, no notifications. Presence and coarse stepping still work (they are the platform), but nothing is shown.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 3, 4 (the colony survives; hard-mode elimination is post), 5, 6 (reopen normally; deep links are post), 8. `W09-33` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** the Away settings panel (step 1), Web Push and Telegram (step 2; the mock notifier's dev viewer shows the rows), one socket per colony (step 7), coarse-dt parity test.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Spec item | Issues |
|---|---|---|
| 1 | Presence in memory, 60 s away timer, blip handling, `last_seen_at` (`CT-10, 11, 13`) | W09-02 |
| 2 | `system.presence` command into the sim (`CT-12`) | W09-02 |
| 3 | Active (5 TPS) / coarse (1 step/s, `dt=5`) switching (`CT-14`, `SIM-H-03, 04`) | W09-03 |
| 4 | Coarse-`dt` parity: production, timers, hazards (`SIM-D-03`) | W09-04 |
| 5 | Lag cap: ≤ 5 steps per pass (`SIM-H-05`) | W09-03 |
| 6 | Snapshot hardening: staggered 60 s, on seal/end/shutdown, async compress/write (`CT-50`, `SIM-H-06`) | W09-05 |
| 7 | Restart fast-run, capped at 24 h (`CT-51`, `SIM-H-07`) | W09-06 |
| 8 | Graceful deploy: stop intake, snapshot all ≤ 30 s, `4012` (`CT-52`) | W09-07 |
| 9 | Fault quarantine + one retry (`CT-53`, `SIM-H-08`) | W09-08 |
| 10 | `awayPolicy` pure function (`AW-01..15`), versioned in the snapshot (`AW-21`) | W09-09, W09-10 |
| 11 | Player-set away budget; defense and repair uncapped; `away_budget_exhausted` (`AW-20`) | W09-11 |
| 12 | Rejection logging and metric, player commands exempt (`AW-22, 23`) | W09-12 |
| 13 | `autoTrade` limits contract + enforcement hook (`AW-13`; consumers W13 / W15) | W09-13 |
| 14 | `setAutopilot` (mode `director`/`rules_only`, `awayRaids`, away budget, `autoTrade`) + settings UI | W09-01, W09-14 |
| 15 | Digest open / fold / flush / close, 7 d retention, merge (`CT-30..33`) | W09-15 |
| 16 | `welcome.away` + `/me/home.awaySummary` (`CT-32`, `CT-04`) | W09-16 |
| 17 | "While you were away" modal | W09-17 |
| 18 | Away story hook (`CT-34`, flag `AWAY_STORY_ENABLED`, body in W16) | W09-18 |
| 19 | Hard mode: away colonies take the same threat; critical / eliminated events → notify, digest, home route (`UO-T-09`, `CT-54`) | W09-19 |
| 20 | `NotifierPort` + Postgres mock adapter, idempotency, no notification while connected (`CT-38`, D-30) | W09-20 |
| 21 | Event → alert routing for 8 kinds, `under_attack` debounce 10 min, per-colony config (`CT-36`) | W09-21 |
| 22 | Web Push adapter (VAPID, subscriptions, expiry cleanup) + service worker + permission UX (`CT-35`) | W09-22, W09-23 |
| 23 | Telegram adapter + one-time-code link flow (`CT-35`) | W09-24 |
| 24 | Notification settings UI + "send test" | W09-25 |
| 25 | Deep link `/c/{colonyId}` → resume (`CT-37`) | W09-26 |
| 26 | Fast-run notifications sent after completion, deduplicated (`CT-54`) | W09-27 |
| 27 | One socket per colony, `bye 4001` takeover, unconfirmed commands (`CT-41, 44`) | W09-28 |
| 28 | Close-code handling `4012` / `4010` / `4011` / `4003` (`CT-43`) | W09-28 |
| 29 | Resume ≤ 2 s p75 (`CT-45`) | W09-33 |
| 30 | Telemetry (§9) | W09-29 |
| 31 | Analytics: away return, notification opt-in, notification click | W09-30 |
| 32 | Dev console: force away, away warp, fire notification, crash-restart helper | W09-31 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W09-01 | Contracts: `system.presence`, `setAutopilot{mode, awayRaids, awayBudget, autoTrade}`, events `colonyAway` / `colonyBack`, `AwayDigestV1`, `NotificationKind`, `NotifierPort`, `notification_subscription` schema, flag `W09` | contract | M | H | W02-01 | Parse the `setAutopilot` sample with per-resource budgets → valid; a budget pct > 100 → rejected | `AW-20`, `CT-35..38` | TA-08.2, TA-08.6, TA-08.7 |
| W09-02 | Server: presence tracker (connect/close, 60 s away timer, blip < 60 s ignored, `last_seen_at`) → posts `system.presence` | server | M | H | W09-01 | Close the socket and reconnect after 30 s → no away event; after 70 s → one `colonyAway` and `last_seen_at` updated | `CT-10..13` | TA-08.1 |
| W09-03 | Server: active/coarse planet mode switch + lag cap (≤ 5 steps per pass, `ta_game_tick_lag_steps`) | server | M | H | W09-02 | Last socket on a planet closes → the planet steps once per second with `dt=5` within 2 s; a join switches back to 5 TPS | `CT-14`, `SIM-H-03..05` | TA-07.2 |
| W09-04 | Test: coarse-`dt` parity over 1 h game time (production, timers, raid schedule, hazards within tolerance) | test | M | H+ | W09-03 | `npm test coarse-dt` → coarse vs fine production within 2 %; dwell and raid timers fire within 5 s | `SIM-D-03` | TA-06.1 |
| W09-05 | Server: snapshot hardening **on top of W00-29**: extra save points on seal / end, async compress + write off the tick path, keep last N per planet, and a load test proving no burst | server | M | H | W00-29 | 10 planets → snapshot writes are spread over 60 s (no burst > 2 in the same second); each planet has a fresh row ≤ 60 s old | `CT-50`, `SIM-H-06` | TA-07.6, TA-03.3 |
| W09-06 | Server: restart fast-run (load every live planet, run `now − savedAt` capped at 24 h in coarse steps, faster than real time, then resume) | server | M | H | W09-05, W09-03 | Stop the app, wait 10 min, start → each planet's game time catches up by 10 min within 30 s; `restart_fastrun_seconds` recorded | `CT-51`, `SIM-H-07` | TA-07.9 |
| W09-07 | Server: graceful shutdown/deploy (stop intake → snapshot all ≤ 30 s → close sockets with `4012`) | server | S |  | W09-05 | Send SIGTERM → every planet snapshots, clients get `4012` and reconnect after restart | `CT-52` | TA-07.6 |
| W09-08 | Server: fault quarantine **player side** (W00-20 owns the mechanism): faulted planet → owners get a notification, the home screen shows "planet under maintenance", and the digest records it | server | S |  | W00-20, W09-21 | Inject a throw into one planet's step → its owners see the maintenance state and a notification; other planets unaffected | `CT-53`, `SIM-H-08` | TA-07.2 |
| W09-09 | Sim: `awayPolicy(view, command)` pure function for `AW-01..07` (allow list) | sim | M | H | W09-01 | Table test: away colony, `rebuild destroyed turret same tile` → allow; `queueBuild T1 extractor` within budget → allow | `AW-01..07, 21` | TA-08.2 |
| W09-10 | Sim: `awayPolicy` deny rules `AW-10..15` + `AWAY_POLICY_VERSION` stored in the snapshot | sim | M |  | W09-09 | Table test: away + `demolish` → reject `AW-10`; away + `raid` with `awayRaids=false` → reject `AW-11`; away + T3 build → reject `AW-15` | `AW-10..15, 21` | TA-08.2 |
| W09-11 | Sim: away budget accounting per away session (per-directive %, per-session %, defense/repair uncapped, `away_budget_exhausted` event) | sim | M |  | W09-09 | Away with a 30 % metals budget → automated spend stops at 30 % of away-start metals; turret rebuilds still happen; one `away_budget_exhausted` event | `AW-20` | TA-08.6 |
| W09-12 | Sim + server: rejection logging `cmd.reject {code:'away_policy', rule}`, metric `away_policy_rejections_total`, player commands exempt | sim | S |  | W09-10 | A player `demolish` while the colony is flagged away → accepted; an AI `demolish` → rejected and counted | `AW-22, 23` | TA-08.2 |
| W09-13 | Sim: `autoTrade` limits contract + `withinAutoTrade(order)` check used by W13 / W15 | sim | S | H | W09-01 | Unit test: give 200 metals with a per-trade max of 100 → `false`; below the floor → `false` | `AW-13` | TA-08.6 |
| W09-14 | Client: Away settings panel (autopilot mode, away budget sliders per resource, `awayRaids` toggle, `autoTrade` limits per resource and partners) | client | M |  | W09-01 | Set metals budget 30 % and save → `setAutopilot` acked; reload → values persist; usable on a phone in landscape | `AW-11, 13, 20` | TA-08.6 |
| W09-15 | Server: digest open on away (baseline), fold events (counters + capped lists), flush with snapshots, close on return, 7 d purge, merge older unseen | server | M | H | W09-02, W09-05 | Away 10 min with 2 raids → the digest row has `attacks.count=2`; restart in between → the digest is still complete | `CT-30, 31, 33` | TA-08.3 |
| W09-16 | Server: `welcome.away` on return ≥ 60 s + `/me/home.awaySummary` (300 ms budget, omitted on timeout) | server | S | H | W09-15 | Return after 2 min → `welcome.away` contains the digest; `/me/home` returns `awaySummary.durationS ≈ 120` | `CT-32`, `CT-04` | TA-08.3 |
| W09-17 | Client: "While you were away" modal (headline, resources before/after, built, lost by cause, attacks, hazards, AI highlights, trades, alerts) | client | M | H | W09-16 | Return from a 10 min away with a raid → the modal shows "1 raid, 1 repelled" and resource deltas; Esc closes it; no `innerHTML` | `CT-32`, CLIENT §5.3 | TA-11.3 |
| W09-18 | Server: away-story hook → asks the `ai` module (W16) for one paragraph ≤ 600 chars behind `AWAY_STORY_ENABLED`; omitted when W16 is off or the call fails | server | S |  | W09-15 | With the W16 mock on → the modal shows a story paragraph above the digest; with W16 off → only the structured digest | `CT-34` | TA-08.3 |
| W09-19 | Server + sim: hard mode path (away colonies get the same threat; `colonyCritical` / `colonyEliminated` → notify, digest entry, home `ELIMINATED`) | server | M | H+ | W09-15, W09-21 | Dev console `colony eliminate` while away → a notification is recorded, and on return the client routes to the elimination recap | `UO-T-09`, D-17 | TA-08.5, TA-08.6 |
| W09-20 | Server: `NotifierPort` + Postgres mock adapter + dev viewer; idempotent per `(colonyId, eventId, channel)`; nothing sent while connected | server | M | H | W09-01 | Fire the same `under_attack` event twice → one row in `mock_notify`; fire while the player is connected → zero rows | `CT-38`, D-30 | TA-08.7 |
| W09-21 | Server: alert routing for the 8 kinds, `under_attack` debounce 10 min, per-colony on/off config | server | M | H | W09-20 | 3 attacks in 5 min → one `under_attack` notification; turning `trade_offer` off → no rows for that kind | `CT-36` | TA-08.7 |
| W09-22 | Server: Web Push adapter (VAPID keys from env, `web-push`, subscription store, 404/410 cleanup) | server | M |  | W09-20 | Send to a subscription that returns 410 → the subscription row is deleted; a valid one → push delivered (local push test server) | `CT-35` | TA-08.7 |
| W09-23 | Client: push subscription as a handler module in the W24-07 service worker (registers a minimal `sw.js` itself when W24 is off), permission prompt in-app (no native dialog first), iOS PWA hint | client | M |  | W09-22 | Click "Enable alerts" → the in-app explainer, then the browser prompt; on accept a subscription is posted; on iOS Safari (not installed) → "Add to Home Screen to get alerts" | `CT-35`, `CL-12` | TA-11.10 |
| W09-24 | Server: Telegram adapter (Bot API `sendMessage`) + link flow (one-time code, `/start <code>` webhook, unlink) | server | M |  | W09-20 | Request a code, send `/start CODE` to the bot (mock webhook in e2e) → the account shows "Telegram linked"; a notification goes to that chat | `CT-35` | TA-08.7 |
| W09-25 | Client: Notification settings (channels, per-kind toggles, link Telegram, "Send test") | client | M |  | W09-23, W09-24 | Toggle `rocket_ready` off and press "Send test" → the test arrives; settings persist after reload | `CT-36` | TA-11.10 |
| W09-26 | Client + server: deep link `/c/{colonyId}` → home → join that colony (phone opens landscape fullscreen) | client | S |  | W09-16 | Open `/c/{id}` from a notification → the game loads straight into the colony in ≤ 2 s on a warm cache | `CT-37` | TA-08.4 |
| W09-27 | Server: notifications found during a restart fast-run are queued and sent once after it completes, deduplicated | server | S |  | W09-06, W09-21 | Fast-run with a raid in the gap → exactly one `under_attack` notification after the fast-run, not during it | `CT-54` | TA-08.6 |
| W09-28 | Server + client: one socket per colony, `bye 4001 replaced`, the replaced tab does not auto-reconnect, unconfirmed commands shown, close codes `4012/4010/4011/4003` | server | M |  | W09-02 | Open the colony in tab B → tab A shows "Resume here"; tab A's pending command shows "unconfirmed" | `CT-40..44` | TA-08.4, TA-07.3 |
| W09-29 | Telemetry: `presence_*`, `away_policy_rejections_total`, `away_digest_*`, `restart_fastrun_seconds`, `planet_faulted_total`, `notify_sent_total` | ops | S |  | W09-21 | `curl /metrics` after the demo → every listed metric is present and non-zero | CONTINUITY §9 | TA-13.2 |
| W09-30 | Analytics: `away_returned{durationS}`, `notify_opt_in{channel}`, `notify_clicked{kind}` | client | S |  | W09-17, W09-25 | Accept push with consent on → one `notify_opt_in` row | CLIENT §10.3 | — |
| W09-31 | Dev console: `presence away`, `away.warp <h>`, `notify fire <kind>`, `server crash` (dev-only restart helper) | client | S | H | W09-02, W09-20 | Type `notify fire rocket_ready` → a row in the mock notifier viewer | PRODUCT_WAVES §3 | — |
| W09-32 | Test: `restart-fastrun.int` (kill -9, restart, gap simulated, ≤ 60 s command loss) + `away-policy.spec` (one case per AW rule, reproducible) | test | M |  | W09-06, W09-10 | `npm run test:int restart-fastrun away-policy` → green | CONTINUITY §10 | TA-13.4 |
| W09-33 | Wave e2e + seed scenario `w09-offline` + tag `wave-09` (includes the resume ≤ 2 s timing assertion) | test | M | H | all W09 | `npm run e2e -- --waves ..09` → the demo story passes, and every earlier suite passes | PRODUCT_WAVES §3, `CT-45` | TA-13.3 |

## Wave DoD

- `e2e/w09.spec.ts` passes, together with all earlier suites.
- `?scenario=w09` loads a colony at S3 with the away panel.
- `TA_WAVES=..08` hides the away panel, digest and notification UI; presence and coarse stepping keep running as platform behaviour.
- Tag `wave-09` is created.
- Every `CT-*` and `AW-*` rule in CONTINUITY is mapped above. `CT-01..05` home routing is in W11.
