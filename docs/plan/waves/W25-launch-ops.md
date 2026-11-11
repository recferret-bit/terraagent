# W25 — Launch Ops & Submission

> **Track:** Ops (O) · **Flag:** `W25` (ops-only; no gameplay toggles) · **Tag:** `wave-25` · **Scenario:** `tests/scenarios/w25-demo.ts` (hosted demo planet) · **Depends on:** W00, W26, W23. Optional: the demo video W25-29 and launch smoke verify the complete Hackathon Vertical Slice (`W00..W13, W15, W16, W18, W20, W22, W23, W26`; `W14, W17, W19, W21, W24, W27` are POSTPONED). The wave grows with every other wave: its checks run against whatever waves are enabled.
>
> **Specs:**
> - [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) v0.3. Hosting, nginx and the four compose files are **W26** (D-40). This wave adds what W26 left for later: image hardening, CSP, backups, the rollback deploy, monitoring, analytics, load and the submission
> - [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §9 (`DEP-04..07`, `DEP-09`)
> - [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §4, §15
> - [`CLIENT.md`](../../spec/CLIENT.md) §10 (analytics, consent, funnel, KPIs)
> - [`SIMULATION.md`](../../spec/SIMULATION.md) §12 (`SIM-P`)
> - [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §5.5, §8.3 (AC-01..04)
> - [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) §5
> - D-23, D-24, D-25, D-27, D-30
> - Hackathon rules: Q-002, Q-005, Q-012, Q-014, Q-016, Q-017, the submission form
>
> **Owned paths:** `.github/workflows/{deploy,nightly,load,security,readme}.yml` (new files only; W00-46 owns the CI workflow), `scripts/{deploy,backup,load,bot}/**` (the later rollback pipeline; W26 owns `scripts/sites/**` and the simple `deploy:*` commands), `tests/load/**`, `backend/app/src/analytics/**` (dashboards), `frontend/game/pages/admin/**` (`/admin/analytics`), `README.md` (final; W00-48 writes the skeleton), `docs/submission/**`. W26 owns `infra/compose/**`, `infra/nginx/**` and `infra/hosts/**`. The duel harness `shared/sim/test/duels.spec.ts` is W07-26's; W25-20 only schedules and publishes it.
>
> **Overlap with W00 (checked 2026-10-30):** none of these rows rebuilds W00 work. W25 extends W00-09 (`/v1/metrics`), W00-10 (logging), W00-44 (`track()` + consent stub), W00-46 (CI: new workflow files only), W00-48 (README skeleton) and uses the W00-45 e2e harness. There is no Docker/nginx/compose in W00 (W00-03's `npm run dev` only).

## Goal

Take the hosts W26 already serves and add monitoring, backups, a rollback deploy, the README and the submission. W26 is the hackathon hosting path (D-40): HTTP on `terraagent.fun`, four compose files, SSH to `DEPLOY_HOST`. This wave does not rebuild that stack and does not add Cloudflare. Submission issues run last.

## Demo story (`tests/e2e/w25.spec.ts`, run against the local prod-like stack)

1. Run `npm run stack:local` (W26) → **see** the eight `terraagent.fun` hosts answer on port 80. This wave does not bring that stack up.
2. Run `npm run stack:local:smoke` (W26) → **see** the host checks pass. The restart-resume check is W25-11 and lands with that row.
3. Run `npm run deploy -- --dry-run` (W26-09) → **see** an SSH plan to `DEPLOY_USER@DEPLOY_HOST` for the four compose files, with no Cloudflare. The later plan (backup, SIGTERM snapshot, auto-rollback) is W25-07 and is not in the hackathon slice.
4. Run `npm run backup && npm run backup:verify` → **see** the dump restored into a scratch DB with the planet count matching.
5. Open `/admin/analytics` (after a few runs of `npm run e2e`) → **see** the funnel from `landing_view` to `return_visit` with counts from the e2e runs.
6. Run `npm run e2e:readme` → **see** a fresh clone follow the README's "do X → see Y" steps headless and pass.
7. (Manual, outside the game) The hosted demo URL answers, the X post links to it, and the submission form is sent before 2026-11-14 20:00 UTC.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 4 (only `npm run backup`; `backup:verify` lands with W25-10, post-hackathon) and 7 (the hosted names from W26, over HTTP). Step 3's dry-run is W26's e2e. `W25-33` tags steps 4 and 7 `@hack`.
- **Deferred:** analytics consent and the admin page (step 5), the README verification job (step 6, stretch), dashboards, load test, soak, off-site backups, TLS, Cloudflare, the rollback deploy (W25-07). Hosting itself is W26, not deferred.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Ops env schema, metric names, analytics event registry (contract-first) | W25-01 |
| 2 | Harden the W26 app image: non-root, read-only, `tmpfs /tmp` (post-hackathon) | W25-02 |
| 3 | CSP on the W26 nginx for every public host. Hosts and proxies are W26 | W25-03 |
| 4 | Compose test over the four W26 files: only nginx publishes a port (DEP-01) | W25-04 |
| 5 | DNS: each D-40 name is an A record to `DEPLOY_HOST`. No Cloudflare proxy | W25-05 |
| 6 | Secrets & env: `deploy:init`, `validate-env` (no `CHANGE_ME`, mainnet guard, mock-in-prod guard) (DEP-04, DEP-08) | W25-06 |
| 7 | Later deploy pipeline on top of W26's `deploy`: backup, SIGTERM snapshot, auto-rollback (DEP-05..07, DEP-09). Not the hackathon path | W25-07, W25-08 |
| 8 | Backups: pre-deploy + daily `pg_dump`, retention. R2 off-site is post-hackathon (D-40) | W25-09, W25-10 |
| 9 | Restart-resume smoke on the W26 stack | W25-11 |
| 10 | Monitoring: Prometheus `/metrics` coverage, dashboards, alert rules, alert destination | W25-12, W25-13 |
| 11 | Log correlation (request / planet / colony ids) and retention | W25-14 |
| 12 | Analytics: consent, funnel queries, KPI dashboard, server counters (CLIENT §10) | W25-15, W25-16 |
| 13 | Load test on the 4 vCPU / 8 GB host; set `MAX_ACTIVE_PLANETS`, `WORKER_MAX_PLANETS` (`SIM-P`, D-23) | W25-17, W25-18 |
| 14 | 24 h soak: coarse planets, snapshots, restart fast-run, memory | W25-19 |
| 15 | Nightly balance report from W07-26's duel harness (`duels.spec.ts`, §5.5 table, AC-04) | W25-20 |
| 16 | Reference-player bot: scripted play through the enabled stages; stage-time assertions (AC-01/02) over 5 seeds; nightly | W25-21, W25-22 |
| 17 | Stage funnel from W08-29's `stage_reached` (AC-08) | W25-23 |
| 18 | Security baseline: headers check, CSP check, secret scan in CI (not anti-cheat, D-25) | W25-24 |
| 19 | README final: "do X → see Y" per wave demo, mock/real ports table generated from env, libraries, AI-generated code, pre-window baseline, LICENSE (Q-002/005/014/017) | W25-25, W25-26 |
| 20 | README verification: fresh-clone run in CI (screening reproducibility) | W25-27 |
| 21 | Hosted demo on the launch host with a seeded demo planet and `NEAR_ALLOW_MOCK_IN_PROD=true` | W25-28 |
| 22 | Demo video (2–3 min), X post, submission form, prize wallet (Q-012, Q-016, form fields) | W25-29, W25-30, W25-31 |
| 23 | Launch checklist + production smoke | W25-32 |
| 24 | Wave e2e (prod-like smoke) + tag | W25-33 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W25-01 | Contracts & data: ops env schema for this wave (`RELEASE`, backup vars, alert vars). `TA_DOMAIN`, `DEPLOY_HOST` and `DEPLOY_USER` belong to W26-01 and are not redefined here. Metric name registry, analytics event registry with props schemas | contract | S | H | W00-05, W00-44 | Run `validate-env` on this wave's example → see every documented var accepted and unknown ones flagged | CLIENT §10.3, DEP-04 | TA-01.6 |
| W25-02 | Harden the W26 app image: non-root `node`, `read_only` + `tmpfs /tmp`, keep `/readyz`. The image and the healthcheck already exist (W26-06) | ops | M |  | W26-06 | Run the app image with a read-only root → see `/readyz` still healthy | DEPLOYMENT §9 | TA-02.3 |
| W25-03 | CSP on the W26 nginx: `connect-src 'self'` on `play`, the §2 security headers on every catalog host, `CSP_CONNECT_EXTRA` when it is set. No new hosts and no Cloudflare | ops | S | H | W26-02 | Run the header check → see CSP on `play` and the security headers on all eight hosts | DEP-02 | TA-02.4 |
| W25-04 | Compose-port test over the four W26 files (`infra/compose/test/ports.test.mjs`): the only `ports:` key is nginx `80` | ops | S | H | W26-02, W26-03, W26-06, W26-07 | Run the test → see a failure if any other service publishes a port | DEP-01 | TA-02.5 |
| W25-05 | DNS check: `npm run dns:check` compares each D-40 name to `DEPLOY_HOST`. Records are plain A records, not proxied. The live records are an owner task; the script is tested against a stub resolver | ops | S | H | W26-09 | Run `dns:check` against a stub that returns `DEPLOY_HOST` for every name → see exit 0. Change one name's answer → see that name in the error | D-40, OWNER_TASKS | TA-02.5 |
| W25-06 | Secrets & env: `npm run deploy:init` (JWT secret, KEK, VAPID, PG password; never overwrites), `validate-env.mjs` gate (no `CHANGE_ME`, `NEAR_NETWORK=mainnet` only with `NEAR_ALLOW_MAINNET=1`, mock ports in prod only with `NEAR_ALLOW_MOCK_IN_PROD=true`; the W13 emulated-chain fault injection must be off in prod, and bot API real-cash mode stays off without the W23-48 gate record) + tests | ops | S | H | W25-01, W00-31 | Run `validate-env` with a `CHANGE_ME` value → see a non-zero exit naming the var | DEP-04, DEP-08, NEAR §1a rule 3 | TA-02.5 |
| W25-07 | Later deploy pipeline wrapped around W26's `deploy`: backup, then `migrate deploy`, then `SIGTERM` (30 s snapshot budget), then smoke, with rollback armed. Does not replace `npm run deploy` | ops | M |  | W25-04, W25-06, W25-09, W26-09 | Run `npm run deploy:release -- --dry-run` → see backup, SIGTERM snapshot and rollback in the plan, and see `npm run deploy` still the W26 command | DEP-05, DEP-06, DEP-07, DEP-09 | TA-02.5 |
| W25-08 | Auto-rollback + `deploy:rollback` (previous image, no down-migration) + `deploy:restore` (manual) + `releases.log` | ops | S |  | W25-07 | Break the smoke check on purpose → see the previous release restored automatically | DEPLOYMENT §6 | TA-02.5 |
| W25-09 | Backups: `pg_dump -Fc` pre-deploy + daily 04:00 UTC; keep 14 daily + 5 pre-deploy | ops | S | H | W25-04 | Run `npm run backup` → see a timestamped dump and old ones pruned per policy | DEPLOYMENT §5 | TA-02.5 |
| W25-10 | Off-site backup to an object store the owner names later (R2 was D-23; D-40 leaves it out) + restore drill `backup:verify` into a scratch DB | ops | S |  | W25-09 | Run `backup:verify` → see the dump restored and planet/colony counts matching | DEP-05 | TA-02.5 |
| W25-11 | Restart-resume smoke on the W26 stack: restart the app container and see the planet come back from its snapshot. Host checks stay in W26-08 | test | S | H | W26-08, W00-29 | Restart the app during `stack:local` → see the planet resume from the snapshot tick | DEP-07 | TA-02.6 |
| W25-12 | Metrics coverage test against W25-01's metric registry: every registered series is exported (producers own theirs: W00-19 tick lag, W06-24 NEAR tx, W09-29 presence/notify, W16-23 AI, W13-29/W13-59 market and bot API: orders/rejects by code, rate-limited requests, active keys, kill-switch state, allowance usage, organic vs non-organic fills); this issue adds only the unowned ones (`ta_game_step_ms`, planets per thread, sockets, delta bytes/s, snapshot ms/KB, outbox backlog per port, DB pool) | server | S | H | W00-09, W25-01 | Scrape `/v1/metrics` under load → see every series in the registry present | ARCH §15, SIM-P | TA-07.8, TA-13.2 |
| W25-13 | Dashboards + alerts: Grafana (or lightweight equivalent) panels; alerts for tick lag, a faulted planet, readyz down, backup failed; outbox-stuck, relayer-balance and AI-budget alerts reuse the producers' rules and thresholds (W23-07, W16-23 at 0.8 / 1.0); bot API (D-45) alerts: kill switch tripped, allowance usage ≥ 0.8 / 1.0, rate-limit rejects spike, repeated `idempotency_conflict`, unknown settlement outcomes pending, reference price stale; destination is an owner choice (Telegram admin chat proposed) | ops | M |  | W25-12 | Kill a sim thread in staging → see an alert delivered within 2 min | ARCH §15, SIM-P | TA-13.2 |
| W25-14 | Log correlation: request id, player, planet, colony on every log line; json-file rotation 10 MB × 5; log retention doc | server | S |  | W00-10 | Follow one command through the logs → see the same `requestId` from WS ingress to sim ack | DEPLOYMENT §1 | TA-13.2 |
| W25-15 | Analytics consent (CLIENT §10.1; the W02-29 and W03-26 `first_*` / `brownout_seen` / `queue_wait_seen` events join the funnel) + server counters (`ta_auth_guest_created_total` …) + funnel SQL views for events 1–10 | server | M |  | W00-44 | Decline consent → see no client events stored but server counters still increase | CLIENT §10.1–10.3 | TA-12.2 |
| W25-16 | Admin analytics page `/admin/analytics`: funnel, KPIs (CTR, seated, first command, D1/D7, queue p95), stage reach | client | S |  | W25-15 | Open the page after the e2e runs → see non-zero funnel steps | CLIENT §10.3 KPIs | — |
| W25-17 | Load-test harness (Node synthetic clients): N planets × M sockets, join + command mix, plus N bot API keys (`/v1/trade/*`) placing/cancelling orders at their rate limits against the shared books (these are trading bots, unlike the W25-21 play-through bot); reports step p99, lag, delta bytes, CPU/RAM | test | M |  | W00-22 | Run `npm run load -- --planets 20 --sockets 100` → see a report with p99 and saturation | SIM-P, PROTOCOL `WS-04` | TA-13.5 |
| W25-18 | Capacity run on the 4 vCPU / 8 GB host: find `MAX_ACTIVE_PLANETS` / `WORKER_MAX_PLANETS` with ≥ 40 % headroom; update ARCHITECTURE §15 tunables | test | S |  | W25-17, W25-28 | Run the load test on the host → see chosen caps recorded with evidence | D-23, SIM-P | TA-13.5, TA-13.6 |
| W25-19 | 24 h soak: 60 planets, mostly coarse, snapshots, one forced restart (fast-run) at 12 h; memory and step-time drift checks | test | M |  | W25-17 | Run the nightly soak → see no memory growth > 10 % and all planets resumed after the restart | SIM-H-04..07 | TA-13.6 |
| W25-20 | Nightly balance report: run the W07-26 duel harness (plus W17/W19 rows when enabled) and publish the table as a CI artifact | test | S |  | W07-26 | Open the nightly CI run → see the duel table artifact, with rows of disabled waves skipped | §5.5, AC-04, D-28 | TA-14.7 |
| W25-21 | Reference-player bot (a play-through test client, not a W13 trading bot): scripted player over the WS protocol with a build-order script per stage; runs headless against a scenario; logs stage reach times | test | M |  | W00-45 | Run `npm run bot -- --seed 1` with `..02` → see the bot found the colony and reach the economy milestones | AC-01 | TA-14.7 |
| W25-22 | Bot assertions + nightly: AC-01 stage windows (S1 ≤ 1:15 … S4 ≤ 25:00 for the Tier-1 vertical slice; the S0–S1 rows of units spec §6.4 and the −6 E/s night result of W02-32 are asserted here, `pacing-s0-s1.spec.ts` was never written), AC-02 brownouts, 5 seeds, all three planet types (D-33) once W05-17 lands `desert` and `ocean`; trend report | test | S |  | W25-21 | Run the nightly → see a pass/fail table per stage and seed | AC-01, AC-02 | TA-14.7 |
| W25-23 | Stage funnel: add W08-29's `stage_reached {stage, seconds}` event (no new event) to the funnel SQL views and the bot report | server | S |  | W25-15, W08-29 | Reach S2 in the e2e → see the S2 step in the funnel view count one colony | AC-08, CLIENT §10.3 | TA-14.7 |
| W25-24 | Security baseline in CI (`.github/workflows/security.yml`): header + CSP check on the built nginx, `gitleaks` secret scan, `npm audit --omit=dev` report (informational) | ops | S |  | W25-03 | Commit a fake key → see the secret-scan job fail | DEP-02, DEP-04 | — |
| W25-25 | README final, part 1: product summary, problem, the "do X → see Y" quickstart per wave demo, scenario links, controls | docs | M | H | W00-48 | A reviewer follows the quickstart → see every listed result | Q-017 | TA-13.7 |
| W25-26 | README final, part 2: ports mock/real table generated from the running env (`npm run ports:table`), libraries list, AI-generated code statement, **pre-window baseline disclosure** (the `frontend/` prototype before 2026-11-01), LICENSE check | docs | S | H | W25-25, W23-44 | Run `npm run ports:table` → see the table match `/v1/readyz` adapters | Q-002, Q-005, Q-014, D-30 | — |
| W25-27 | README verification job (`.github/workflows/readme.yml`): fresh clone in CI runs the README steps headless (`e2e:readme`) | test | S | H | W25-25, W00-45 | Break a README command → see the job fail on that step | Q-017 | — |
| W25-28 | Hosted demo: `npm run deploy` to `DEPLOY_HOST`, seed `w25-demo` (a planet with all enabled waves showcased), `NEAR_ALLOW_MOCK_IN_PROD=true`, real adapters only for ports that passed real contract suites | ops | M | H | W26-09, W25-05, W25-06 | Open `http://play.terraagent.fun` and `http://terraagent.fun` from a phone and a desktop → see the demo planet playable and the landing up | Q-012, D-30, D-40 | TA-13.7 |
| W25-29 | Demo video: a 2–3 min script covering the Tier-1 Hackathon Vertical Slice — landfall → economy → terraform → W07 bug combat → W11 persistent multiplayer sectors → W16 AI Director → W09 offline play → W10/W13/W15/W22 NEAR cargo/market/Guild/DAO/bounties → W18 diplomacy & raids → W20 Colony Deed & staking → W23 `NEAR_MODE=testnet` switch; record and cut | docs | M | H | W25-28, W05-33, W07-32, W08-33, W09-33, W10-30, W11-32, W12-32, W13-35, W15-34, W16-27, W18-29, W20-28, W22-36, W23-47 | Watch the video → see every scripted beat shown once | Form, Q-012 | — |
| W25-30 | X post: "built at NEAR HACKATHON", video, link to the repo and demo | docs | S | H | W25-29 | Open the post → see the video play and both links resolve | Submission rules | — |
| W25-31 | Submission form: name, team lead, email, team size solo, tracks (09 + 07 + 05, + 10/12 if F6/F7 qualify), mainnet prize wallet, repo link, post link, description (20–2 000 chars), website; the human confirms the payload | docs | S | H | W25-30, W25-26 | Submit → see the confirmation before 2026-11-14 20:00 UTC | Form fields, Q-016 | — |
| W25-32 | Launch checklist + production smoke (`npm run smoke:prod`): DNS/TLS, `/readyz`, guest → play, WS, a snapshot taken, a backup present, alerts armed, analytics flowing | ops | S |  | W25-28, W25-13, W25-10 | Run `smoke:prod` → see every checklist line green | DEPLOYMENT §7, §9 | TA-13.7 |
| W25-34 | Export W16 DirectorMetrics and PrismaDirectorStore budget/kill-switch gauges on /v1/metrics and verify AI_PROVIDER/AI_ALLOW_MOCK_IN_PROD in validate-env | ops | S | H | W25-06, W25-12, W16-15, W16-23 | Scrape /v1/metrics and run validate-env -> W16 director action/budget/kill-switch metrics are exported with bounded enum labels and unapproved prod mock AI config fails validation | AI §13, ARCH §15, DEP-04 | — |
| W25-35 | Register W20 deed/staking Prometheus metrics, analytics events, NEAR_STAKING_POOLS env validation, and /deed/:tokenId public share route smoke | ops | S | H | W25-01, W25-06, W25-12, W20-08, W20-12, W20-17, W20-26 | Scrape /v1/metrics, run validate-env, and curl /deed/deed:col_0 -> deed_updates_pending, staking_positions, and near_tx_total{kind=deed_*} are exported, NEAR_STAKING_POOLS is validated, and public deed share page & OG PNG resolve | NEAR §12, §14, CLIENT §10, DEP-04, W20 handoff | — |
| W25-36 | Verify W09 continuity/notifier Prometheus metrics, NOTIFY_ADAPTER env guard, and restart fast-run catch-up in launch ops smoke | ops | S | H | W25-06, W25-11, W25-12, W09-06, W09-20, W09-29 | Scrape /v1/metrics, run validate-env, and restart app container -> ta_game_planet_mode, restart_fastrun_seconds, notify_sent_total, notify_suppressed_connected_total, and digest_rows are exported and planet catches up from snapshot | CONTINUITY §9, CT-51, DEP-04, DEP-07, W09 handoff | — |
| W25-37 | Register W18 PvP/diplomacy analytics events (raid_started, colony_eliminated, truce_signed, truce_broken) and verify elimination sector accounting & alert routing in launch ops smoke | ops | S | H | W25-01, W25-12, W18-17, W18-24, W18-29, W18-33 | Run w25-demo and scrape /v1/metrics + /v1/dev/notify -> W18 raid/truce/elimination analytics events validate against AnalyticsBatchV1, sector liveColonies updates on elimination, and AlertRouter delivers under_attack/truce_offered/colony_critical/colony_eliminated | CLIENT §10, CONTINUITY §5a, SIM §7.7, W18 handoff | — |
| W25-33 | Wave e2e `tests/e2e/w25.spec.ts` (demo steps 4–6; the hackathon `@hack` run is steps 4 and 7 against the W26 hosts) + scenario `w25-demo` + tag `wave-25` | test | S | H | all above | Run `npm run e2e -- --waves ..25` → see all enabled wave suites plus W25 pass; then tag `wave-25` | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `stack:local:smoke` and `tests/e2e/w25.spec.ts` pass.
- A deploy dry run and a backup restore drill succeed. Capacity caps are measured on the real host and recorded.
- `duels.spec.ts` and the nightly bot are green for every enabled wave.
- The README passes the fresh-clone job, and its mock/real table matches the running adapters.
- The hosted demo is live. The video, X post and submission form are done before the deadline.
- Tag `wave-25` is created.

## W08 follow-up: executable progression and priorities

Gate release on the complete available tutorial chain and priority-policy regressions.

Mandatory landing criteria: [Progression, tutorial goals and priorities contract](../W08-PROGRESSION-CONTRACT.md). Add a real accept → orders → progress → completion owner check, blocked/resume and reload tests, relevant slider low/high decision tests, and a later-waves-off test. Unimplemented goals stay unavailable; stage previews do not authorize gameplay.

## W12 progression integration gate (revised)

Follow [Progression persistence and delivery](../../spec/PROGRESSION_ENGINE.md). Monitor pending age, attempt count, lease expiry and errors; document replay and recovery without direct counter edits.

Acceptance: producer-to-profile persistence, replay/restart, concurrent inputs, threshold boundaries, independent queue retries and disabled-wave behavior are covered by unit and PostgreSQL integration tests. New achievement conditions use catalogue configuration; new event semantics use registered producers. Keep earned achievements and lifetime statistics across colony transitions. ME opens in a new tab from authenticated landing/selection only; the hub's W12 mock is explicit.

## Vertical Slice Testing, Full-Game Integration & Mock/Real Switch Gates

1. **Full Vertical Slice Verification (`W00..W13, W15, W16, W18, W20, W22, W23, W26`):**
   - `W14`, `W17`, `W19`, `W21`, `W24`, and `W27` are **POSTPONED**. Launch verification runs across the complete Tier-1 (`S0–S4`) vertical slice with zero Tier 2/3 assets.
2. **End-to-End & Stack Integration Gates:**
   - `npm run stack:local` + `npm run stack:local:smoke` + container restart-resume (`W25-11`) + Prometheus `/v1/metrics` coverage (`W25-12`) + env validation (`W25-06`) + `npm run ports:table` mock/real matrix (`W25-26`) + full Playwright E2E suite (`tests/e2e/w25.spec.ts`) in both `NEAR_MODE=mock` and `NEAR_MODE=testnet` smoke modes.
