# W09 — Offline & Notifications

> **Track:** Autonomy (P) · **Flag:** `W09` · **Tag:** `wave-09` · **Scenario:** `tests/scenarios/w09-offline.ts` · **E2E:** `tests/e2e/w09.spec.ts`
> **Depends on waves:** W02 (spine). The away story needs W16, and the elimination causes come from W07 / W18. If those are off, the dev console triggers the events instead.
> **Specs:** [CONTINUITY](../../spec/CONTINUITY.md) §3 (`CT-10..14`), §4 (`AW-01..23`), §5 (`CT-30..34`), §5a (`CT-35..38`), §6 (`CT-40..45`), §7 (`CT-50..54`), §8–§10 · [SIMULATION](../../spec/SIMULATION.md) `SIM-H-03..08`, `SIM-D-03` · [ARCHITECTURE](../../spec/ARCHITECTURE.md) §15 · [NEAR](../../spec/NEAR.md) §1a (port pattern for `NotifierPort`) · D-17, D-24, D-30
> **Owned paths:** `backend/app/src/game/{presence,snapshot,restart}/` (sub-folders of W00's `game` module: presence stays in memory in the one app, D-24, no NATS or leases), `backend/app/src/notify/**`, `shared/db/prisma/notify.prisma`, the `awaySummary` field of W01's `backend/app/src/home/`, `shared/sim/src/systems/away/`, `shared/contracts/src/{commands,events}/{presence,autopilot,notify}.ts`, `frontend/game/features/{away,notify}/`, `frontend/game/sw/push.ts` (push handler module with standalone minimal service worker; W24 is POSTPONED)
> **Builds on W00:** the scheduler's `dt` hook and lag cap (W00-19), 60 s snapshots + SIGTERM save + load on boot (W00-29), fault quarantine (W00-20), the `NotifierPort` abstract class and its adapter switch (W00-30, W00-31), `bye` codes 4000/4001/4003/4012 (W00-22, W00-25)

## Goal

Leaving is safe and honest. A colony keeps running while its player is away: the planet switches to coarse stepping when empty and fast-runs missed time after a restart. Automation respects a player-set away budget. The player gets a "while you were away" digest and is notified by Web Push or Telegram when something critical happens. Hard mode applies (D-17): an away colony **can** be eliminated, and the player is told in time.

## Demo story (e2e)

1. Open `/play.html?scenario=w09` (a colony at S3) → open the **Away settings** panel: set the away budget to 30 % of metals, turn `awayRaids` off, switch the autopilot mode to `rules_only`.
2. Open **Notifications** → enable Web Push (a mock permission in e2e) → see the subscription row; open "Link Telegram" → see a one-time code `/start ABC123` (mock Telegram adapter).
3. Close the tab → after 60 s the terminal running `npm run dev` logs `presence away`, and `curl /v1/metrics` shows `ta_game_planet_mode{mode="coarse"} 1`. (Dev console `presence away` does it at once.)
4. In a tab opened again (`/play.html?scenario=w09`) run `away.warp 8` and `spawnRaid 3` in the dev console → the mock notifier (its dev viewer, see W09-20) records `under_attack` once (debounced), and the colony survives (or does not; hard mode).
5. Run `server crash` in the dev console (dev-only restart helper; or `kill -9` the app, then `npm run dev:restart`) → the planet loads from its snapshot and fast-runs the gap; the notifications found during the fast-run are sent once.
6. Reopen the deep link (`/play.html?colony={colonyId}` locally; CT-37's `/c/{colonyId}` in production) → the game resumes straight into the colony, and the **"While you were away"** modal shows resources before/after, losses, the raid, and AI decisions.
7. Open `/play.html` (same browser) in a second tab → the first tab shows "Opened on another tab — Resume here" (`bye 4001`).
8. Run `TA_WAVES=..08 npm run dev:restart` and reload `/play.html?scenario=w09` → no away panel, no digest, no notifications. Presence and coarse stepping still work (they are the platform), but nothing is shown.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 3, 4 (the colony survives; hard-mode elimination is post), 5 (snapshot load + fast-run; the once-only fast-run notification of W09-27 is post), 6 (reopen normally; deep links are post), 8. `W09-33` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** the Away settings panel (step 1), Web Push and Telegram (step 2; the mock notifier's dev viewer shows the rows), one socket per colony (step 7), coarse-dt parity test.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Spec item | Issues |
|---|---|---|
| 1 | Presence in memory, 60 s away timer, blip handling, `last_seen_at` (`CT-10, 11, 13`) | W09-02 |
| 2 | `system.presence` command into the sim (`CT-12`) | W09-02 |
| 3 | Active (5 TPS) / coarse (1 step/s, `dt=5`) switching (`CT-14`, `SIM-H-03, 04`) on W00-19's `dt` hook | W09-03 |
| 4 | Coarse-`dt` parity: production, timers, hazards (`SIM-D-03`) | W09-04 |
| 5 | Lag cap: ≤ 5 steps per pass (`SIM-H-05`): already W00-19; W09-04 checks it under coarse stepping | W09-04 |
| 6 | Snapshot hardening: staggered 60 s, on seal/end/shutdown, async compress/write (`CT-50`, `SIM-H-06`) | W09-05 |
| 7 | Restart fast-run, capped at 24 h (`CT-51`, `SIM-H-07`) | W09-06 |
| 8 | Graceful deploy: stop intake, snapshot all ≤ 30 s, `4012` (`CT-52`) | W09-07 |
| 9 | Fault quarantine + one retry (`CT-53`, `SIM-H-08`) | W09-08 |
| 10 | `awayPolicy` pure function (`AW-01..15`), versioned in the snapshot (`AW-21`) | W09-09, W09-10 |
| 11 | Player-set away budget; defense and repair uncapped; `awayBudgetExhausted` → notification kind `away_budget_exhausted` (`AW-20`) | W09-11 |
| 12 | Rejection logging and metric, player commands exempt (`AW-22, 23`) | W09-12 |
| 13 | `autoTrade` limits contract + enforcement hook (`AW-13`; consumers W13 / W15) | W09-13 |
| 14 | `setAutopilot` (mode `director`/`rules_only`, `awayRaids`, away budget) + settings UI (the `autoTrade` section is W15-23's) | W09-01, W09-14 |
| 15 | Digest open / fold / flush / close, 7 d retention, merge (`CT-30..33`) | W09-15 |
| 16 | `welcome.away` + `/me/home.awaySummary` (`CT-32`, `CT-04`) | W09-16 |
| 17 | "While you were away" modal | W09-17 |
| 18 | Away story hook (`CT-34`, flag `AWAY_STORY_ENABLED`, body in W16) | W09-18 |
| 19 | Hard mode: away colonies take the same threat; critical / eliminated events → notify, digest, home route (`UO-T-09`, `CT-54`) | W09-19 |
| 20 | Postgres mock adapter for W00-30's `NotifierPort`, idempotency, no notification while connected (`CT-38`, D-30) | W09-20 |
| 21 | Event → alert routing for 8 kinds, `under_attack` debounce 10 min, per-colony config (`CT-36`) | W09-21 |
| 22 | Web Push adapter (VAPID, subscriptions, expiry cleanup) + service worker + permission UX (`CT-35`) | W09-22, W09-23 |
| 23 | Telegram adapter + one-time-code link flow (`CT-35`) | W09-24 |
| 24 | Notification settings UI + "send test" | W09-25 |
| 25 | Deep link → resume (`CT-37`; `/play.html?colony=` locally) | W09-26 |
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
| W09-01 | Contracts: `system.presence`, `setAutopilot{mode, awayRaids, awayBudget}` (`autoTrade` limits are W09-13's, its command is W15-01's `setAutoTrade`), events `colonyAway` / `colonyBack`, `awayBudgetExhausted {resource}`, `colonyCritical` / `colonyEliminated` (declared here because W09-19 and W11-16 consume them first; W18-01 reuses them), `AwayDigestV1`, `NotificationKind` (the 8 kinds of `CT-36`), notification payload and `notification_subscription` schemas for W00-30's `NotifierPort`, flag `W09` | contract | M | H | W02-01, W00-30 | Parse the `setAutopilot` sample with per-resource budgets → valid; a budget pct > 100 → rejected | `AW-20`, `CT-35..38` | TA-08.2, TA-08.6, TA-08.7 |
| W09-02 | Server: presence tracker (connect/close, 60 s away timer, blip < 60 s ignored, `last_seen_at`) → posts `system.presence` | server | M | H | W09-01 | Close the socket and reconnect after 30 s → no away event; after 70 s → one `colonyAway` and `last_seen_at` updated | `CT-10..13` | TA-08.1 |
| W09-03 | Server: active/coarse planet mode switch on W00-19's `dt` hook (last socket leaves → coarse `dt=5` once per second; a join → 5 TPS at the next step), gauge `ta_game_planet_mode` | server | S | H | W09-02 | Last socket on a planet closes → the planet steps once per second with `dt=5` within 2 s; a join switches back to 5 TPS | `CT-14`, `SIM-H-03, 04` | TA-07.2 |
| W09-04 | Test: coarse-`dt` parity over 1 h game time (production, timers, raid schedule, hazards within tolerance; W00-19's 5-step lag cap holds under coarse stepping) | test | M | H | W09-03 | `npm test coarse-dt` → coarse vs fine production within 2 %; dwell and raid timers fire within 5 s | `SIM-D-03`, `SIM-H-05` | TA-06.1 |
| W09-05 | Server: snapshot hardening **on top of W00-29**: extra save points on seal / end, async compress + write off the tick path, keep last N per planet, and a load test proving no burst | server | M | H | W00-29 | 10 planets → snapshot writes are spread over 60 s (no burst > 2 in the same second); each planet has a fresh row ≤ 60 s old | `CT-50`, `SIM-H-06` | TA-07.6, TA-03.3 |
| W09-06 | Server: restart fast-run (load every live planet, run `now − savedAt` capped at 24 h in coarse steps, faster than real time, then resume) | server | M | H | W09-05, W09-03 | Stop the app, wait 10 min, start → each planet's game time catches up by 10 min within 30 s; `restart_fastrun_seconds` recorded | `CT-51`, `SIM-H-07` | TA-07.9 |
| W09-07 | Server: graceful deploy on top of W00-29's SIGTERM snapshot — stop command and join intake first, then close every socket with `4012 server_restarting` | server | S | H+ | W09-05 | Send SIGTERM → new joins are refused, every planet snapshots, clients get `4012` and reconnect after restart | `CT-52` | TA-07.6 |
| W09-08 | Server: fault quarantine **player side** (W00-20 owns the mechanism): faulted planet → owners get a notification, the home screen shows "planet under maintenance", and the digest records it | server | S | H+ | W00-20, W09-21 | Inject a throw into one planet's step → its owners see the maintenance state and a notification; other planets unaffected | `CT-53`, `SIM-H-08` | TA-07.2 |
| W09-09 | Sim: `awayPolicy(view, command)` pure function for `AW-01..07` (allow list) | sim | M | H | W09-01 | Table test: away colony, `rebuild destroyed turret same tile` → allow; `queueBuild T1 extractor` within budget → allow | `AW-01..07, 21` | TA-08.2 |
| W09-10 | Sim: `awayPolicy` deny rules `AW-10..15` (demolish, unauthorized raids, truce cancel, over-cap trades, and data-driven high-tier/endgame capability guards while T2/T3 are postponed) + `AWAY_POLICY_VERSION` stored in the snapshot | sim | M | H | W09-09 | Table test: away + `demolish` → reject `AW-10`; away + `raid` with `awayRaids=false` → reject `AW-11`; away + disallowed high-risk action → reject `AW-15` | `AW-10..15, 21` | TA-08.2 |
| W09-11 | Sim: away budget accounting per away session (per-directive %, per-session %, defense/repair uncapped, `awayBudgetExhausted` event, notified as kind `away_budget_exhausted`) | sim | M | H | W09-09 | Away with a 30 % metals budget → automated spend stops at 30 % of away-start metals; turret rebuilds still happen; one `awayBudgetExhausted` event | `AW-20` | TA-08.6 |
| W09-12 | Sim + server: rejection logging `cmd.reject {code:'away_policy', rule}`, metric `away_policy_rejections_total`, player commands exempt | sim | S | H | W09-10 | A player `demolish` while the colony is flagged away → accepted; an AI `demolish` → rejected and counted | `AW-22, 23` | TA-08.2 |
| W09-13 | Sim: `autoTrade` limits contract + `withinAutoTrade(order)` check used by W13 / W15 | sim | S | H | W09-01 | Unit test: give 200 metals with a per-trade max of 100 → `false`; below the floor → `false` | `AW-13` | TA-08.6 |
| W09-14 | Client: Away settings panel (autopilot mode, away budget sliders per resource family (Metals / Minerals / Bio, D-34), `awayRaids` toggle; the `autoTrade` section is W15-23's) | client | M | H | W09-01 | Set metals budget 30 % and save → `setAutopilot` acked; reload → values persist; usable on a phone in landscape | `AW-11, 13, 20` | TA-08.6 |
| W09-15 | Server: digest open on away (baseline), fold events (counters + capped lists), flush with snapshots, close on return, 7 d purge, merge older unseen | server | M | H | W09-02, W09-05 | Away 10 min with 2 raids → the digest row has `attacks.count=2`; restart in between → the digest is still complete | `CT-30, 31, 33` | TA-08.3 |
| W09-16 | Server: `welcome.away` on return ≥ 60 s + `/me/home.awaySummary` (300 ms budget, omitted on timeout) | server | S | H | W09-15 | Return after 2 min → `welcome.away` contains the digest; `/me/home` returns `awaySummary.durationS ≈ 120` | `CT-32`, `CT-04` | TA-08.3 |
| W09-17 | Client: "While you were away" modal (headline, resources before/after, built, lost by cause, attacks, hazards, AI highlights, trades, alerts) | client | M | H | W09-16 | Return from a 10 min away with a raid → the modal shows "1 raid, 1 repelled" and resource deltas; Esc closes it; no `innerHTML` | `CT-32`, CLIENT §5.3 | TA-11.3 |
| W09-18 | Server: away-story hook in the digest — an `AwayStoryProvider` slot (filled by W16-20; empty when W16 is off) asked for one paragraph ≤ 600 chars behind `AWAY_STORY_ENABLED`; omitted when empty or failing | server | S | H | W09-15 | Register a stub provider → the modal shows a story paragraph above the digest; with no provider → only the structured digest | `CT-34` | TA-08.3 |
| W09-19 | Server + sim: hard mode path (away colonies get the same threat; `colonyCritical` / `colonyEliminated` → notify, digest entry, home `ELIMINATED`) | server | M | H | W09-15, W09-21, W09-31 | Dev console `colony eliminate` while away → a notification is recorded, and on return the client routes to the elimination recap | `UO-T-09`, D-17 | TA-08.5, TA-08.6 |
| W09-20 | Server: Postgres mock adapter for W00-30's `NotifierPort` (bound through W00-31's `NOTIFY_ADAPTER`) + dev viewer; idempotent per `(colonyId, eventId, channel)`; nothing sent while connected | server | M | H | W09-01, W00-31 | Fire the same `under_attack` event twice → one row in `mock_notify`; fire while the player is connected → zero rows | `CT-38`, D-30 | TA-08.7 |
| W09-21 | Server: alert routing for the 8 kinds, `under_attack` debounce 10 min, per-colony on/off config | server | M | H | W09-20 | 3 attacks in 5 min → one `under_attack` notification; turning `trade_offer` off → no rows for that kind | `CT-36` | TA-08.7 |
| W09-22 | Server: Web Push adapter (VAPID keys from env, `web-push`, subscription store, 404/410 cleanup) | server | M | H+ | W09-20 | Send to a subscription that returns 410 → the subscription row is deleted; a valid one → push delivered (local push test server) | `CT-35` | TA-08.7 |
| W09-23 | Client: push subscription as a handler module `frontend/game/sw/push.ts` (registers a standalone minimal service worker `/sw-notify.js` without needing postponed W24), permission prompt in-app | client | M | H+ | W09-22 | Click "Enable alerts" → the in-app explainer, then the browser prompt; on accept a subscription is posted | `CT-35`, `CL-12` | TA-11.10 |
| W09-24 | Server: Telegram adapter (Bot API `sendMessage`) + link flow (one-time code, `/start <code>` webhook, unlink) | server | M | H+ | W09-20 | Request a code, send `/start CODE` to the bot (mock webhook in e2e) → the account shows "Telegram linked"; a notification goes to that chat | `CT-35` | TA-08.7 |
| W09-25 | Client: Notification settings (channels, per-kind toggles, link Telegram, "Send test") | client | M | H+ | W09-23, W09-24 | Toggle `rocket_ready` off and press "Send test" → the test arrives; settings persist after reload | `CT-36` | TA-11.10 |
| W09-26 | Client + server: deep link → home → join that colony; locally `/play.html?colony={id}` (CT-37's `/c/{colonyId}` is a production rewrite); a phone opens landscape fullscreen | client | S | H+ | W09-16 | Open `/play.html?colony={id}` from a notification → the game loads straight into the colony in ≤ 2 s on a warm cache | `CT-37` | TA-08.4 |
| W09-27 | Server: notifications found during a restart fast-run are queued and sent once after it completes, deduplicated | server | S | H | W09-06, W09-21 | Fast-run with a raid in the gap → exactly one `under_attack` notification after the fast-run, not during it | `CT-54` | TA-08.6 |
| W09-28 | Server + client: one socket per colony — a second `join` replaces the first with W00-22's `bye 4001`; this issue adds only the per-colony replace rule, a 4001 → "Resume here" branch without auto-reconnect in W00-25's state machine, unconfirmed-command marks and the new close codes `4010/4011` | server | M | H | W09-02, W00-22, W00-25 | Open the colony in tab B → tab A shows "Resume here"; tab A's pending command shows "unconfirmed" | `CT-40..44` | TA-08.4, TA-07.3 |
| W09-29 | Telemetry: `presence_*`, `away_policy_rejections_total`, `away_digest_*`, `restart_fastrun_seconds`, `planet_faulted_total`, `notify_sent_total` | ops | S | H | W09-21 | `curl /metrics` after the demo → every listed metric is present and non-zero | CONTINUITY §9 | TA-13.2 |
| W09-30 | Analytics: `away_returned{durationS}`, `notify_opt_in{channel}`, `notify_clicked{kind}` | client | S | H+ | W09-17, W09-25 | Accept push with consent on → one `notify_opt_in` row | CLIENT §10.3 | — |
| W09-31 | Dev console: `presence away`, `away.warp <h>`, `notify fire <kind>`, `colony eliminate` (also used by W11-29), `server crash` (dev-only restart helper) | client | S | H | W09-02, W09-20 | Type `notify fire rocket_ready` → a row in the mock notifier viewer | PRODUCT_WAVES §3 | — |
| W09-32 | Test: `restart-fastrun.int` (kill -9, restart, gap simulated, ≤ 60 s command loss) + `away-policy.spec` (one case per AW rule, reproducible) | test | M | H | W09-06, W09-10 | `npm run test:int restart-fastrun away-policy` → green | CONTINUITY §10 | TA-13.4 |
| W09-33 | Wave e2e + seed scenario `w09-offline` + tag `wave-09` (includes the resume ≤ 2 s timing assertion) | test | M | H | all W09 | `npm run e2e -- --waves ..09` → the demo story passes, and every earlier suite passes | PRODUCT_WAVES §3, `CT-45` | TA-13.3 |

## Wave DoD

- `tests/e2e/w09.spec.ts` passes, together with all earlier suites.
- `?scenario=w09` loads a colony at S3 with the away panel.
- `TA_WAVES=..08` hides the away panel, digest and notification UI; presence and coarse stepping keep running as platform behaviour.
- Tag `wave-09` is created.
- Every `CT-*` and `AW-*` rule in CONTINUITY is mapped above. `CT-01..05` home routing is in W11.

## W08 follow-up: executable progression and priorities

Preserve goals, tutorial position and priorities across away/resume; enforce away permission and budget limits.

Mandatory landing criteria: [Progression, tutorial goals and priorities contract](../W08-PROGRESSION-CONTRACT.md). Add a real accept → orders → progress → completion owner check, blocked/resume and reload tests, relevant slider low/high decision tests, and a later-waves-off test. Unimplemented goals stay unavailable; stage previews do not authorize gameplay.

## W12 progression integration gate (revised)

Follow [Progression persistence and delivery](../../spec/PROGRESSION_ENGINE.md). Extend the existing in-app notification consumer with a separate opt-in external-push effect; preserve persisted delivery state and effect-ID deduplication. Use the authenticated `colonyId` resume route.

Acceptance: producer-to-profile persistence, replay/restart, concurrent inputs, threshold boundaries, independent queue retries and disabled-wave behavior are covered by unit and PostgreSQL integration tests. New achievement conditions use catalogue configuration; new event semantics use registered producers. Keep earned achievements and lifetime statistics across colony transitions. ME opens in a new tab from authenticated landing/selection only; the hub's W12 mock is explicit.

## Vertical Slice Testing, Full-Game Integration & Mock/Real Switch Gates

1. **Tier-1 Vertical Slice Scope (`S0–S4` Only):**
   - `W17`/`W19` (Tier 2/3), `W21` (Rocket), and `W24` (Mobile/PWA) are **POSTPONED**. Offline play, coarse-step simulation (`dt=5`), away budgets, and away digests operate 100% on Tier-1 (`S0–S4`) resources (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`, `Energy`), buildings, and units (`worker`, `robot.recon`, W07 bug waves).
2. **Unit & Integration Test Matrix (Positive / Negative / Corner):**
   - **Unit (`away-policy.spec.ts`, `coarse-dt.spec.ts`):** every `AW-01..23` allow/deny rule, per-resource away budget exhaustion (defense/repair uncapped), `withinAutoTrade` boundary checks, and 1 h coarse-`dt` vs fine-`dt` production/timer/hazard parity (positive, negative, and boundary cases: 0% budget, 100% budget, exact 60 s blip boundary, duplicate alert debounce within 10 min).
   - **Integration (`restart-fastrun.int.spec.ts`):** real Postgres snapshot save → server stop → 10 min gap → boot fast-run catch-up → deduplicated post-fastrun notification emission, plus single-socket colony takeover (`bye 4001`).
3. **Full Game Integration + Online Server E2E (`tests/e2e/w09.spec.ts`):**
   - End-to-end integration across `shared/sim/src/systems/away/`, `backend/app/src/game/{presence,snapshot,restart}/`, `backend/app/src/notify/`, `W16-20` `AwayStoryProvider`, and `frontend/game/features/{away,notify}/` ("While you were away" modal & Away settings), verified by online Playwright E2E against the running backend and `TA_WAVES=..08` flag-off check.
4. **100% Working Mocked Mode + Adapter Switch (`NOTIFY_ADAPTER=mock|webpush|telegram`):**
   - Runs 100% working out-of-the-box with `NOTIFY_ADAPTER=mock` (`MockNotifier` storing idempotent rows in Postgres `mock_notify` and surfacing them in `/dev/outbox` / dev console) and switches via `NOTIFY_ADAPTER` to Web Push or Telegram without touching game or sim code.
