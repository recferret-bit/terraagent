# W25 — Launch Ops & Submission

> **Track:** Ops (O) · **Flag:** `W25` (ops-only; no gameplay toggles) · **Tag:** `wave-25` · **Scenario:** `scenarios/w25-demo.ts` (hosted demo planet) · **Depends on:** W00. The wave grows with every other wave: its checks run against whatever waves are enabled.
>
> **Specs:**
> - [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §1–§9 (`DEP-01..09`)
> - [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §4, §15
> - [`CLIENT.md`](../../spec/CLIENT.md) §10 (analytics, consent, funnel, KPIs)
> - [`SIMULATION.md`](../../spec/SIMULATION.md) §12 (`SIM-P`)
> - [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §5.5, §8.3 (AC-01..04)
> - [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) §5
> - D-23, D-24, D-25, D-27, D-30
> - Hackathon rules: Q-002, Q-005, Q-012, Q-014, Q-016, Q-017, the submission form
>
> **Owned paths:** `infra/**`, `.github/workflows/{deploy,nightly,load}.yml`, `scripts/{deploy,backup,load,bot}/**`, `tests/load/**`, `shared/sim/test/duels.spec.ts`, `backend/app/src/modules/analytics/**` (dashboards), `README.md` (final), `docs/submission/**`

## Goal

Take the app from "works on my machine" to a hosted, monitored, backed-up public demo that a judge (human or Claude Code/Codex) can reproduce from the README, and submit it. Infra issues can start right after W00 and run in parallel with every gameplay wave. Submission issues run last.

## Demo story (`e2e/w25.spec.ts`, run against the local prod-like stack)

1. Run `npm run stack:local` → **see** nginx, the app and Postgres start with `TLS_MODE=selfsigned`.
2. Run `npm run stack:local:smoke` → **see** all checks pass:
   - the landing page returns 200 with CSP;
   - the game returns 200 with the SPA fallback;
   - `/v1/healthz` returns 200;
   - a bad `hello` closes with `4000`;
   - guest → `/me/home`;
   - a restart resumes the planet from its snapshot.
3. Run `npm run deploy -- --dry-run` → **see** the plan: checks, upload, build, backup, migrate, restart (SIGTERM snapshot), static swap, smoke, with rollback armed.
4. Run `npm run backup && npm run backup:verify` → **see** the dump restored into a scratch DB with the planet count matching.
5. Open `/admin/analytics` → **see** the funnel from `landing_view` to `return_visit` with counts from the e2e runs.
6. Run `npm run e2e:readme` → **see** a fresh clone follow the README's "do X → see Y" steps headless and pass.
7. The hosted demo URL answers, the X post links to it, and the submission form is sent before 2026-11-14 20:00 UTC.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 3, 4, 7 (the e2e runs the smoke against the hosted demo instead of `stack:local`). `W25-33` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** `stack:local` (steps 1–2), analytics consent and the admin page (step 5), the README verification job (step 6, stretch), dashboards, load test, soak, off-site backups.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Ops env schema, metric names, analytics event registry (contract-first) | W25-01 |
| 2 | App image: multi-stage, non-root, read-only, healthcheck, `SIM_THREADS = cores − 1` | W25-02 |
| 3 | nginx image: static landing + game, `api.*` proxy, WS upgrade, headers, CSP, 404 default, no rate limits (D-25) | W25-03 |
| 4 | Prod compose (nginx, app, postgres internal, migrate profile) + compose test (DEP-01) | W25-04 |
| 5 | Cloudflare proxied DNS, Full (strict), Origin CA, CF real-IP list (D-23, DEPLOYMENT §3) | W25-05 |
| 6 | Secrets & env: `deploy:init`, `validate-env` (no `CHANGE_ME`, mainnet guard, mock-in-prod guard) (DEP-04, DEP-08) | W25-06 |
| 7 | Deploy pipeline with SIGTERM snapshot, static swap, smoke, auto-rollback (DEPLOYMENT §6, DEP-05..07, DEP-09) | W25-07, W25-08 |
| 8 | Backups: pre-deploy + daily `pg_dump`, retention, R2 off-site via rclone, restore drill (DEPLOYMENT §5) | W25-09, W25-10 |
| 9 | Local prod-like stack + smoke (DEPLOYMENT §7) | W25-11 |
| 10 | Monitoring: Prometheus `/metrics` coverage, dashboards, alert rules, alert destination | W25-12, W25-13 |
| 11 | Log correlation (request / planet / colony ids) and retention | W25-14 |
| 12 | Analytics: consent, funnel queries, KPI dashboard, server counters (CLIENT §10) | W25-15, W25-16 |
| 13 | Load test on the 4 vCPU / 8 GB host; set `MAX_ACTIVE_PLANETS`, `WORKER_MAX_PLANETS` (`SIM-P`, D-23) | W25-17, W25-18 |
| 14 | 24 h soak: coarse planets, snapshots, restart fast-run, memory | W25-19 |
| 15 | Balance harness: port `docs/game/tools/battle_duels.py` → `duels.spec.ts` with the §5.5 table as CI assertions (AC-04) | W25-20 |
| 16 | Reference-player bot: scripted play through the enabled stages; stage-time assertions (AC-01/02) over 5 seeds; nightly | W25-21, W25-22 |
| 17 | Stage telemetry `stage_reached` to the funnel (AC-08) | W25-23 |
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
| W25-01 | Contracts & data: ops env schema (`TA_DOMAIN`, `TLS_MODE`, `RELEASE`, backup and R2 vars, alert vars), metric name registry, analytics event registry with props schemas | contract | S | H | W00-05, W00-44 | Run `validate-env` on `.env.example` → see every documented var accepted and unknown ones flagged | DEPLOYMENT §4, CLIENT §10.3 | TA-01.6 |
| W25-02 | App Dockerfile: multi-stage build of the workspaces, non-root `node`, `read_only` + `tmpfs /tmp`, `/readyz` healthcheck, `SIM_THREADS` from cores | ops | M | H | W00-09 | Run `docker run --read-only terraagent-app` → see `/readyz` healthy with 3 sim threads on a 4-core box | DEPLOYMENT §1 | TA-02.3 |
| W25-03 | nginx image: both static `dist/` bundles, hosts `@ www game api`, `/v1` + `/ws` proxy (75 s read timeout), security headers, CSP with `CSP_CONNECT_EXTRA`, default 404, no `limit_req` | ops | M | H | W25-02 | Run `npm run nginx:test` → see WS upgrade work, an unknown host return 404 and the headers present | DEPLOYMENT §2, DEP-02/03 | TA-02.4 |
| W25-04 | Prod compose: nginx (only published ports), app, postgres on an `internal: true` network, `migrate` profile, log rotation; `compose-config.test.mjs` | ops | S | H | W25-02, W25-03 | Run the compose test → see only nginx with `ports` | DEP-01 | TA-02.5 |
| W25-05 | Cloudflare setup script/doc: proxied `@ www game api`, SSL Full (strict), Origin CA cert as file secrets, generated `cf-ips.conf` real-IP list, port 443 restricted to CF ranges | ops | S | H | W25-03 | Request the origin IP directly → see the connection refused; through CF → see 200 | DEPLOYMENT §3, D-23 | TA-02.5 |
| W25-06 | Secrets & env: `npm run deploy:init` (JWT secret, KEK, VAPID, PG password; never overwrites), `validate-env.mjs` gate (no `CHANGE_ME`, `NEAR_NETWORK=mainnet` only with `NEAR_ALLOW_MAINNET=1`, mock ports in prod only with `NEAR_ALLOW_MOCK_IN_PROD=true`) + tests | ops | S | H | W25-01, W00-31 | Run `validate-env` with a `CHANGE_ME` value → see a non-zero exit naming the var | DEP-04, DEP-08, NEAR §1a rule 3 | TA-02.5 |
| W25-07 | Deploy script: checks → plan → confirm → upload `git archive HEAD` → build on server → backup → `migrate deploy` → `SIGTERM` app (30 s snapshot budget) → start new → swap static → smoke | ops | M | H | W25-04, W25-06, W25-09 | Run `npm run deploy -- --dry-run` → see the full plan; a real deploy → see downtime ≤ 30 s and clients reconnect via `4012` | DEPLOYMENT §6, DEP-05..07, DEP-09 | TA-02.5 |
| W25-08 | Auto-rollback + `deploy:rollback` (previous image, no down-migration) + `deploy:restore` (manual) + `releases.log` | ops | S |  | W25-07 | Break the smoke check on purpose → see the previous release restored automatically | DEPLOYMENT §6 | TA-02.5 |
| W25-09 | Backups: `pg_dump -Fc` pre-deploy + daily 04:00 UTC; keep 14 daily + 5 pre-deploy | ops | S | H | W25-04 | Run `npm run backup` → see a timestamped dump and old ones pruned per policy | DEPLOYMENT §5 | TA-02.5 |
| W25-10 | Off-site to Cloudflare R2 (`rclone copy`, 30-day lifecycle) + restore drill `backup:verify` into a scratch DB | ops | S |  | W25-09 | Run `backup:verify` → see the dump downloaded from R2, restored, and planet/colony counts matching | DEPLOYMENT §5, D-23 | TA-02.5 |
| W25-11 | Local prod-like stack (`stack:local`, `terraagent.localhost`, self-signed TLS, mock AI/NEAR) + `stack:local:smoke` (DEPLOYMENT §7 checks) | ops | M |  | W25-04 | Run the smoke → see all checks pass, including the restart-resume step | DEPLOYMENT §7 | TA-02.6 |
| W25-12 | Metrics coverage: `ta_game_step_ms`, `ta_game_tick_lag_steps`, planets per thread, sockets, delta bytes/s, snapshot ms/KB, outbox backlog per port, LLM tokens/budget, notify sends, DB pool | server | S |  | W00-09 | Scrape `/v1/metrics` under load → see every listed series | ARCH §15, SIM-P | TA-07.8, TA-13.2 |
| W25-13 | Dashboards + alerts: Grafana (or lightweight equivalent) panels; alerts for tick lag, a faulted planet, readyz down, backup failed, outbox stuck, LLM budget at 90 %; destination is an owner choice (Telegram admin chat proposed) | ops | M |  | W25-12 | Kill a sim thread in staging → see an alert delivered within 2 min | TA-13.2 (owner open item) | TA-13.2 |
| W25-14 | Log correlation: request id, player, planet, colony on every log line; json-file rotation 10 MB × 5; log retention doc | server | S |  | W00-10 | Follow one command through the logs → see the same `requestId` from WS ingress to sim ack | DEPLOYMENT §1 | TA-13.2 |
| W25-15 | Analytics consent (CLIENT §10.1) + server counters (`ta_auth_guest_created_total` …) + funnel SQL views for events 1–10 | server | M |  | W00-44 | Decline consent → see no client events stored but server counters still increase | CLIENT §10.1–10.3 | TA-12.2 |
| W25-16 | Admin analytics page `/admin/analytics`: funnel, KPIs (CTR, seated, first command, D1/D7, queue p95), stage reach | client | S |  | W25-15 | Open the page after the e2e runs → see non-zero funnel steps | CLIENT §10.3 KPIs | — |
| W25-17 | Load-test harness (Node synthetic clients): N planets × M sockets, join + command mix; reports step p99, lag, delta bytes, CPU/RAM | test | M |  | W00-22 | Run `npm run load -- --planets 20 --sockets 100` → see a report with p99 and saturation | SIM-P, PROTOCOL `WS-04` | TA-13.5 |
| W25-18 | Capacity run on the 4 vCPU / 8 GB host: find `MAX_ACTIVE_PLANETS` / `WORKER_MAX_PLANETS` with ≥ 40 % headroom; update ARCHITECTURE §15 tunables | test | S |  | W25-17, W25-28 | Run the load test on the host → see chosen caps recorded with evidence | D-23, SIM-P | TA-13.5, TA-13.6 |
| W25-19 | 24 h soak: 60 planets, mostly coarse, snapshots, one forced restart (fast-run) at 12 h; memory and step-time drift checks | test | M |  | W25-17 | Run the nightly soak → see no memory growth > 10 % and all planets resumed after the restart | SIM-H-04..07 | TA-13.6 |
| W25-20 | Nightly balance report: run the W07-26 duel harness (plus W17/W19 rows when enabled) and publish the table as a CI artifact | test | S |  | W07-26 | Open the nightly CI run → see the duel table artifact, with rows of disabled waves skipped | §5.5, AC-04, D-28 | TA-14.7 |
| W25-21 | Reference-player bot: scripted player over the WS protocol with a build-order script per stage; runs headless against a scenario; logs stage reach times | test | M |  | W00-45 | Run `npm run bot -- --seed 1` with `..02` → see the bot found the colony and reach the economy milestones | AC-01 | TA-14.7 |
| W25-22 | Bot assertions + nightly: AC-01 stage windows (S1 ≤ 1:15 … S6 ≤ 40:00, only for enabled waves), AC-02 brownouts, 5 seeds, both planet types when Desert lands; trend report | test | S |  | W25-21 | Run the nightly → see a pass/fail table per stage and seed | AC-01, AC-02 | TA-14.7 |
| W25-23 | Stage telemetry: `stage_reached {stage, ms_since_landing}` into the funnel and the bot report (AC-08) | server | S |  | W25-15 | Reach S2 in the e2e → see one `stage_reached` row | AC-08 | TA-14.7 |
| W25-24 | Security baseline in CI: header + CSP check on the built nginx, `gitleaks` secret scan, `npm audit --omit=dev` report (informational) | ops | S |  | W25-03 | Commit a fake key → see the secret-scan job fail | DEP-02, DEP-04 | — |
| W25-25 | README final, part 1: product summary, problem, the "do X → see Y" quickstart per wave demo, scenario links, controls | docs | M | H | W00-48 | A reviewer follows the quickstart → see every listed result | Q-017 | TA-13.7 |
| W25-26 | README final, part 2: ports mock/real table generated from the running env (`npm run ports:table`), libraries list, AI-generated code statement, **pre-window baseline disclosure** (the `src/` prototype before 2026-11-01), LICENSE check | docs | S | H | W25-25 | Run `npm run ports:table` → see the table match `/v1/readyz` adapters | Q-002, Q-005, Q-014, D-30 | — |
| W25-27 | README verification job: fresh clone in CI runs the README steps headless (`e2e:readme`) | test | S | H+ | W25-25, W00-45 | Break a README command → see the job fail on that step | Q-017 | — |
| W25-28 | Hosted demo: deploy to the launch host, seed `w25-demo` (a planet with all enabled waves showcased), `NEAR_ALLOW_MOCK_IN_PROD=true`, real adapters only for ports that passed real contract suites | ops | M | H | W25-07, W25-05 | Open `https://game.terraagent.com` from a phone and a desktop → see the demo planet playable | Q-012, D-30 | TA-13.7 |
| W25-29 | Demo video: a 2–3 min script covering landfall → economy → terraform → combat → walls → cargo → market → Guild → profile; record and cut | docs | M | H | W25-28, W05-33, W07-32, W10-30, W12-32, W13-35, W14-28, W15-34 | Watch the video → see every scripted beat shown once | Form, Q-012 | — |
| W25-30 | X post: "built at NEAR HACKATHON", video, link to the repo and demo | docs | S | H | W25-29 | Open the post → see the video play and both links resolve | Submission rules | — |
| W25-31 | Submission form: name, team lead, email, team size solo, tracks (09 + 07 + 05, + 10/12 if F6/F7 qualify), mainnet prize wallet, repo link, post link, description (20–2 000 chars), website; the human confirms the payload | docs | S | H | W25-30, W25-26 | Submit → see the confirmation before 2026-11-14 20:00 UTC | Form fields, Q-016 | — |
| W25-32 | Launch checklist + production smoke (`npm run smoke:prod`): DNS/TLS, `/readyz`, guest → play, WS, a snapshot taken, a backup present, alerts armed, analytics flowing | ops | S |  | W25-28, W25-13, W25-10 | Run `smoke:prod` → see every checklist line green | TA-13.7 | TA-13.7 |
| W25-33 | Wave e2e `e2e/w25.spec.ts` (demo steps 1–6 against `stack:local`; the hackathon `@hack` run is steps 3, 4 and 7 against the hosted demo) + scenario `w25-demo` + tag `wave-25` | test | S | H | all above | Run `npm run e2e -- --waves ..25` → see all enabled wave suites plus W25 pass; then tag `wave-25` | PRODUCT_WAVES §3 | TA-13.3 |

## Wave DoD

- `stack:local:smoke` and `e2e/w25.spec.ts` pass.
- A deploy dry run and a backup restore drill succeed. Capacity caps are measured on the real host and recorded.
- `duels.spec.ts` and the nightly bot are green for every enabled wave.
- The README passes the fresh-clone job, and its mock/real table matches the running adapters.
- The hosted demo is live. The video, X post and submission form are done before the deadline.
- Tag `wave-25` is created.
