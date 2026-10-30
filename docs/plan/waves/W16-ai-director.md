# W16 — AI Director

> **Track:** Autonomy (P) · **Flag:** `W16` · **Tag:** `wave-16` · **Scenario:** `scenarios/w16-director.ts` · **E2E:** `e2e/w16.spec.ts`
> **Depends on waves:** W08 (goals, rule engine, priorities). Directive actions that target later waves are offered only when those waves are on: market orders (W13), Guild (W15), truces and raids (W18), Tech Up to T2 (W17). The away story serves W09.
> **Specs:** [AI_ORCHESTRATOR](../../spec/AI_ORCHESTRATOR.md) §1–§15 (`AI-01..15`) · [SIMULATION](../../spec/SIMULATION.md) `SIM-R-04, 06` · [CONTINUITY](../../spec/CONTINUITY.md) `AW-06, 11, 22`, `CT-34` · units spec §7 rows 7, 16 · [NEAR](../../spec/NEAR.md) §1a (port pattern) · D-09, D-17, D-25, D-30
> **Owned paths:** `backend/app/src/ai/**`, `prisma/ai.prisma`, `shared/contracts/src/ai/`, `shared/sim/src/systems/ai-brief/`, `shared/sim/src/systems/directive/`, `client/src/features/director/`

## Goal

Add a strategic LLM director that makes the rare high-level calls, about 5–10 % of decisions. It is called only on significant events, within strict budgets. Its output is a validated, clamped `DirectiveV1` (v2 actions) that the sim applies as an ordinary command. If the director is missing, late or wrong, the colony keeps running on the rule engine. Players see the director's reasoning in the HUD.

## Demo story (e2e)

1. Load `?scenario=w16` (a colony at S4, mock LLM) → open the **Director** panel → it shows mode `director`, "next call allowed in —", and budget 0 / 20M.
2. Dev console `water drain` → `resource.critical(W)` fires → within 2 s the event log shows "Director: Water critical — building 2 pumps near the oasis" and two `ai`-tagged orders appear.
3. Fire `resource.critical` again within 120 s → the log shows "rate limited", and nothing else happens.
4. Set `AI_MOCK_MODE=invalid_json` → the next trigger is logged `invalid`; the colony keeps running on rules.
5. Admin `POST /v1/admin/ai {op:'disable'}` → the next trigger is logged `disabled` within 5 s.
6. Go away (W09) with `awayRaids=false` and let the mock propose a raid → the raid is **clamped** away (`clampedFields:['actions.raid']`).
7. Return from away → the digest shows a one-paragraph **away story** (W09 modal).
8. Set `TA_WAVES=..15` → no director panel, no LLM calls, and the colony runs on rules alone.

## Features covered

| # | Spec item | Issues |
|---|---|---|
| 1 | `AiRequestV1`, `ColonyBriefV1`, `DirectiveV1` v2 (`queueUnit`, `queueGoal`, `truceOffer`/`truceRespond`, `marketOrder`, tier 1–3), `ai.directive` command, outcome enum | W16-01 |
| 2 | `LlmProviderPort` + deterministic mock + `AI_MOCK_MODE` faults (§11) | W16-02 |
| 3 | Z.ai `glm-5.3` adapter (general endpoint, JSON mode, thinking disabled, verify support, 20 s, 1 retry) | W16-03 |
| 4 | Config guards: prod + mock refused; `zai` outside prod needs `AI_LIVE=1` (`AI-13`) | W16-04 |
| 5 | 14 triggers from sim events with 60 s hysteresis + `idle.checkpoint` timer (§3, `AI-02`) | W16-05 |
| 6 | Brief builder on the sim thread (fixed order, ≤ 1 200 chars, market/cargo/Guild fields when their waves are on) | W16-06 |
| 7 | Gate: per-colony 300 s / critical 120 s / 150 per day, in-flight dedupe, global token budget (`AI-03..05`) | W16-07, W16-08 |
| 8 | Prompt: system v1 + embedded JSON schema + brief (`PROMPT_VERSION`) | W16-09 |
| 9 | Validation: parse → extract → strict zod → reference checks (`AI-06`, §6.2) | W16-10 |
| 10 | Clamping table incl. raid removal while away without opt-in and tier clamp by Hub tier and `unlockStage` (`AI-07`, §6.3) | W16-11 |
| 11 | Staleness and publish with `commandId = requestId` (`AI-08, 09`) | W16-12 |
| 12 | Sim apply: priority override for `ttlTicks`, `ai` tasks/goals, away policy, dedupe, guard band ±1 step (`SIM-R-04`, `AI-12`, `AW-06`) | W16-13 |
| 13 | Circuit breaker and fallback outcomes (§7) | W16-14 |
| 14 | Persistence: `ai_decision`, `ai_colony_budget`, `ai_usage_daily`, `ai_settings`; raw logs 14 d purge; redaction (`AI-10, 14`) | W16-15, W16-16 |
| 15 | Kill switch (env + admin, global/planet, ≤ 5 s) (`AI-11`) | W16-17 |
| 16 | Rationale in the HUD event log + director panel | W16-18, W16-19 |
| 17 | Away story generation (`CT-34`) | W16-20 |
| 18 | Guild strategy hook for W15 (hourly strategy call, mock) | W16-21 |
| 19 | Eval harness ≥ 30 fixtures, report, live gate (§12) | W16-22 |
| 20 | Telemetry + budget alarms 0.8 / 1.0 (§9, §13) | W16-23 |
| 21 | Test matrix (§14) | W16-24 |
| 22 | No per-player throttling beyond budgets (`AI-15`) | W16-07 (only budgets implemented) |
| 23 | Analytics, dev console | W16-25, W16-26 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W16-01 | Contracts: `AiRequestV1`, `ColonyBriefV1`, `DirectiveV1` v2 (actions incl. `queueUnit`, `queueGoal`, `truceOffer`, `truceRespond`, `marketOrder`; tiers 1–3), `ai.directive` command, outcome enum, flag `W16` | contract | M |  | W08-01 | Parse the v2 sample with `queueGoal` → valid; a v1-only `queueRobot` → rejected; an extra key → rejected (strict) | §6.1, units §7 rows 7, 16 | TA-09.3, TA-09.6 |
| W16-02 | Server: `LlmProviderPort` (abstract class) + `MockLlmProvider` (deterministic rules for the §11 triggers) + `AI_MOCK_MODE` (`ok`, `timeout`, `invalid_json`, `schema_violation`, `http_429`, `http_500`, `slow:<ms>`) | server | M |  | W16-01 | Mock with `resource.critical(W)` → a `queueBuild pump` action; `AI_MOCK_MODE=http_429` → the adapter raises a provider error | §11, D-30 | TA-09.1 |
| W16-03 | Server: Z.ai `glm-5.3` adapter (`/api/paas/v4/chat/completions`, JSON mode, `thinking` disabled, drop unsupported fields, 20 s timeout, 1 retry with jitter if ≥ 8 s remain) | server | M |  | W16-02 | Contract test (manual, `AI_LIVE=1`) → a valid JSON response for a fixture brief; without a key → a clear config error | §5.3, D-09 | TA-09.1 |
| W16-04 | Server: zod env + config guards (`AI_PROVIDER`, `AI_LIVE`, prod refuses mock, key never logged) | server | S |  | W16-02 | Start with `NODE_ENV=production AI_PROVIDER=mock` → boot fails with `AI_MOCK_IN_PROD`; start non-prod with `zai` and no `AI_LIVE` → boot fails | `AI-13, 14` | TA-09.1 |
| W16-05 | Server (game): trigger emission for the 14 triggers from sim events with 60 s hysteresis per trigger + `idle.checkpoint` (30 min, away only) | server | M |  | W16-01 | Keep water critical for 3 min → exactly 3 `resource.critical` requests (one per 60 s); away 30 min with no call → one `idle.checkpoint` | §3, `AI-02` | TA-09.2 |
| W16-06 | Sim: `ColonyBriefV1` builder (fixed field order, ints, ≤ 1 200 chars; adds market, cargo and Guild lines only when W10 / W13 / W15 are on) | sim | M |  | W16-01 | Build a brief for the scenario colony → it matches the §5.2 golden fixture; length ≤ 1 200 | §5.2 | TA-09.3 |
| W16-07 | Server: per-colony gate (atomic `UPDATE … RETURNING` on `ai_colony_budget`: 300 s normal, 120 s critical, 150 per UTC day, in-flight 20 s) | server | M |  | W16-15 | Two concurrent requests for one colony → one call, one `duplicate`; a critical 60 s after a normal call → allowed and resets the normal interval | `AI-03, 05, 15` | TA-09.2 |
| W16-08 | Server: global daily token budget (estimate = prompt tokens + `max_tokens`; `budget_exhausted` until 00:00 UTC; `ai_usage_daily`) | server | S |  | W16-15 | Set the budget to 2 000 tokens → the 3rd call gets `budget_exhausted`; at the UTC rollover (fake clock) → calls resume | `AI-04` | TA-09.2 |
| W16-09 | Server: prompt builder (static system prompt v1 + JSON schema via `zod-to-json-schema` + brief; ≤ 450 tokens system) | server | S |  | W16-06 | Snapshot test of the system prompt; the token estimate of the system prompt ≤ 450 | §5.1 | TA-09.3 |
| W16-10 | Server: validation pipeline (JSON.parse → extract first `{…}` once → strict zod → reference checks against the brief: ids in catalogue, `offerId` exists, target is a neighbour) | server | M |  | W16-01 | Response with prose around the JSON → extracted and valid; unknown building id → dropped by reference check; garbage → `invalid` with zod issues stored | §6.2, `AI-06` | TA-09.3 |
| W16-11 | Server: clamping (normalise priorities to 100, dedupe/drop unknown actions, keep 5, `count ≤ affordable`, trade give ≤ 20 % of stock, remove `raid` when away without `awayRaids` or no hostility, `ttlTicks` 600–6 000, tier ≤ Hub tier and ≤ `unlockStage`) | server | M |  | W16-10 | Table test with ≥ 25 cases → each expected `clampedFields`; a raid while away without opt-in → removed | §6.3, `AI-07` | TA-09.3, TA-09.6 |
| W16-12 | Server: staleness (> 20 s since enqueue, or `basedOnTick` older than 600 ticks) + publish `ai.directive` with `commandId = requestId` | server | S |  | W16-11 | `AI_MOCK_MODE=slow:25000` → outcome `stale`, nothing published | `AI-08, 09` | TA-09.4 |
| W16-13 | Sim: apply `ai.directive` (priority override for `ttlTicks`, guard band ±1 step while away, actions → `ai` orders/goals, away policy check, ignore duplicate `requestId`) | sim | M |  | W16-12, W09-09 | Apply the same directive twice → orders appear once; while away, a priority jump of +3 steps → clamped to +1 | `SIM-R-04, 06`, `AW-06`, `AI-12` | TA-06.7, TA-09.4 |
| W16-14 | Server: circuit breaker (5 consecutive `provider_error`/`timeout` → open 60 s → half-open probe) + fallback outcomes | server | S |  | W16-02 | `AI_MOCK_MODE=http_500` × 5 → the 6th request is `provider_error` without a provider call; after 60 s one probe runs | §7 | TA-09.4 |
| W16-15 | Server: Prisma `ai.prisma` (`ai_decision`, `ai_colony_budget`, `ai_usage_daily`, `ai_settings`) + one decision row per attempted call | server | M |  | W16-01 | Run 3 calls → 3 `ai_decision` rows with outcome, tokens, latency; pre-call rejections → no rows, only metrics | §10, `AI-10` | TA-09.4 |
| W16-16 | Server: raw prompt/response logging (`AI_LOG_RAW=1` in prod), SHA-256 hashes, daily purge of raw columns after 14 d, 30 d row retention, redaction test | server | S |  | W16-15 | Fake clock +15 d, run the purge → raw columns `null`, hashes kept; the logger output never contains the key | `AI-14` | TA-09.5, TA-09.6 |
| W16-17 | Server: kill switch (`AI_ENABLED` env + `POST /v1/admin/ai {disable \| enable \| status, scope}`, persisted in `ai_settings`, effective ≤ 5 s) | server | S |  | W16-15 | Disable for one planet → that planet's next request is `disabled`, the other planets still call | `AI-11`, §9 | TA-09.5 |
| W16-18 | Client: rationale in the HUD event log ("Director: …", outcome badge, link to the orders it created) | client | S |  | W16-12 | Trigger a directive → the event log shows the rationale ≤ 200 chars and an `applied` badge | §15 #4 | TA-09.6 |
| W16-19 | Client: Director panel (mode `director`/`rules_only` from W09, last 10 decisions with outcome, next call allowed in, budget used today) | client | M |  | W16-15 | Open the panel after 3 calls → 3 rows with outcomes and a "next call in 4:10" countdown | §2, §4 | TA-09.6 |
| W16-20 | Server: away story (`trigger: away.story` on digest close, ≤ 600 chars, flag `AWAY_STORY_ENABLED`, counts against the budget, failure → omitted) | server | S |  | W16-07, W09-15 | Return from away with the mock → the digest gets a story ≤ 600 chars; with `AI_MOCK_MODE=timeout` → the digest has no story and still shows | `CT-34` | TA-08.3 |
| W16-21 | Server: Guild strategy hook (`strategyFor(guildNpc, marketBrief)` hourly via the same port and budget; mock returns a stockpile/visit plan) | server | S |  | W16-07 | With W15 on, warp 1 h → one strategy call per Guild NPC is logged; with W15 off → none | NEAR §7 (F3) | TA-10.11 |
| W16-22 | Server: eval harness `npm run ai:eval [-- --live]` (≥ 30 fixtures covering all triggers on both planet types, property expectations, `report.json`, live gate thresholds) | test | M |  | W16-11 | `npm run ai:eval` (mock) → validity 100 %; the report lists property-pass, clamp rate, latency, tokens | §12 | TA-09.5 |
| W16-23 | Telemetry: `ai_requests_total`, `ai_provider_latency_seconds`, `ai_tokens_total`, `ai_est_cost_usd_total`, `ai_budget_used_ratio` (alerts 0.8 / 1.0), `ai_circuit_open`, `ai_clamped_fields_total`, `ai_inflight` | ops | S |  | W16-15 | `curl /metrics` after the demo → every metric present; the budget ratio crosses 0.8 in a test → alert rule fires | §13, §9 | TA-09.5, TA-13.2 |
| W16-24 | Test: §14 matrix (`ai-fallback`, `rate-limiter`, `ai-budget`, `ai-dedupe`, `directive-validator`, `clamp`, `staleness`, `ai-directive-dedupe`, `decision-log`, `kill-switch`, `config`, `redaction`) | test | M |  | W16-17 | `npm run test ai` → all suites green | §14 | TA-09.1–09.5 |
| W16-25 | Analytics: `director_decision_seen{outcome}`, `director_mode_changed{mode}` | client | S |  | W16-18 | Toggle the mode with consent on → one `director_mode_changed` row | CLIENT §10.3 | — |
| W16-26 | Dev console: `ai trigger <kind>`, `ai mock <mode>`, `ai brief` (prints the brief), `ai budget reset` | client | S |  | W16-05 | `ai brief` → the current brief text printed in the console | PRODUCT_WAVES §3 | — |
| W16-27 | Wave e2e + seed scenario `w16-director` + tag `wave-16` | test | M |  | all W16 | `npm run e2e -- --waves ..16` → the demo story passes, and every earlier suite passes | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w16.spec.ts` passes (mock provider), together with all earlier suites.
- `?scenario=w16` loads an S4 colony.
- `TA_WAVES=..15` disables every AI call and hides the panel; the colony runs on rules.
- Tag `wave-16` is created.
- `AI-01..15` and the §14 test matrix are mapped above.
- A live Z.ai eval run is a manual gate, not part of the e2e.
