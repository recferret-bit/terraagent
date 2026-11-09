# W16 — Player-directed AI Strategy

> **Status:** Replanned 2026-11-04; implementation and live-provider verification remain to be done.
> **Track:** Autonomy · **Flag:** `W16` · **Tag:** `wave-16` · **Scenario:** `tests/scenarios/w16-director.ts` · **E2E:** `tests/e2e/w16.spec.ts`
> **Depends on waves:** W08 (landed HQ goals, independent priorities and rule engine).
> **Optional integrations:** W09 away policy/digest; W11 persistent sectors; W15 Guild; W27 streamed summaries. Test explicit capability absence when off. Later-wave skill bodies activate only when their executors land.
> **Spec:** [AI_ORCHESTRATOR](../../spec/AI_ORCHESTRATOR.md) is the revised normative contract; historical TA-09 issues are traceability only.
> **Owned paths:** `backend/director/`, existing `backend/app/src/ai/`, `shared/contracts/src/ai/`, `shared/db/prisma/ai.prisma`, shared sim policy/context/directive modules, existing game Director/HQ UI; workspace/stack wiring and structure checks. Match actual landed paths before implementation.

## Goal

A strategic director follows the player's existing goals and priorities, with **Conservative** and **Risky** play styles. It can propose resource specialization, defensive positions, scouting, frontier expansion, terraforming and permitted aggression. Runtime skills form a broad versioned registry; only enabled, authorized skills reach a request. Every action goes through the existing HQ goals, shared rules and order queue.

Both mock and real Z.ai integration belong to this wave. Isolate provider work in a separate worker, use private MCP for scoped queries/proposals and a bounded Postgres queue for scheduling. The game remains authoritative and continues without the worker. See the spec for exact caps, security boundary, tool contracts and acceptance criteria.

## Landed integration and readiness

- Reuse `shared/sim/src/systems/goals/{catalog,handlers,priorities,types}.ts`: the five sliders are independent 0–100 values, default 50 each. The old sum-to-100 clamp is removed. Existing 2/3/5 goal slots, progressive payment and learned-lane gates apply.
- Verify the required W08 goal executors, not merely a wave tag. Missing bodies must land in their owning wave; do not expose contract-only goals as working skills.
- W11 is currently replanned, not presumed landed: build its versioned context adapter against foundation contracts and verify against real W11 when available. W16 base mode still works without W11.
- W27 shares W11 identity/topology and adds summaries/residency. Ship bounded synthetic fixtures now; real scale validation belongs to W27's integration gate. Neither wave must wait for the other to implement its unrelated core.
- D-24's scoped worker/queue exception is recorded in DECISIONS. Existing owner changes to W11/W27 are preserved. Risk affects gameplay decisions, never authentication or financial authority.

## Demo story and owner check

1. Start the game plus director worker in mock mode; open `/play.html?scenario=w16`. Director shows inherited HQ goals, independent priorities, Conservative, current permissions and budget.
2. Select Resources and Conservative, trigger a shortage: see a budgeted goal, linked orders and acknowledged rationale. Reset the fixture and choose Risky: see a different allowed commitment/strategy with its cost and uncertainty.
3. Select Terraforming or Defence and protect a manual goal/area. Trigger a conflicting opportunity: director respects the player choice and reports the rejected alternative.
4. Change priorities or cancel an AI goal while a mock call is delayed. The old plan is superseded; cancellation suppresses immediate re-proposal. Reload preserves preferences.
5. Enable Aggressive/Risky with away raids disabled. A raid-proposal fault cannot create an unauthorized raid. A valid W18 fixture exercises only eligible targets; disabled W18 hides the skill.
6. Inject invalid JSON, hostile tool text, a foreign colony ID, timeout and duplicate job delivery. No unauthorized/duplicate command occurs; colony keeps running. Use an authenticated admin control to stop AI mid-call and verify late results cannot apply.
7. Exercise W11 isolated-sector (`R=48`, `7,057` tiles/sector) + 19-sector manifest context and W27 fake streamed cross-sector summaries: active sector and surrounding manifest summaries remain explicit; unknown/unloaded sectors stay explicit; no whole-world load or overflow world creation.
8. Flood the scheduler and kill/restart the worker. Show queue bounds, fairness, stale rejection, budget accounting and responsive gameplay. Return from away to the narrative-only digest when W09 is enabled.
9. Disable W16: no AI jobs/panel/MCP listener, prior-wave play remains functional. Run local-host pure mock parity separately.
10. Run the manual live-provider eval and one real player-directed scenario; attach model/version, redacted results, cost and latency report. Mock completion alone does not satisfy this step.

The implementation owner writes exact worktree URLs, commands and authenticated admin steps to `docs/plan/checks/w16-check.md` after exercising this story. This planning edit does not claim that the scenario or new commands already exist.

## Issues

Existing IDs 01–27 remain, with revised acceptance; 28–49 make the added architecture, security, skills and integration work explicit. All are post-hackathon; sizes are planning units, not measured delivery estimates.

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W16-01 | Versioned job, context, DirectiveV2 and policy contracts reusing landed command schemas | contract | M |  | W08-01 | Unknown actions/fields fail; independent priorities remain independent | AI §2, §6 | TA-09 |
| W16-02 | Deterministic mock plus policy, injection, stale and fault modes | server | M |  | W16-01 | Same brief in two risk profiles yields permitted distinct plans; failures never bypass guards | AI §11 | TA-09 |
| W16-03 | Live Z.ai adapter behind LlmProviderPort; SDK compatibility and usage/abort contract tests | server | M |  | W16-02, W16-28 | Owner model returns typed tools/JSON and metered usage; unsupported options handled explicitly | AI §8 | TA-09 |
| W16-04 | Fail-closed adapter/env selection; explicit live opt-in and production mock guard | server | S |  | W16-03 | Unknown provider and non-prod zai without AI_LIVE fail boot; secrets absent from logs | AI AI-13 | TA-09 |
| W16-05 | Authoritative trigger projection, hysteresis and director feedback-loop suppression | server | M |  | W16-01 | Burst and director-generated events coalesce without repeated self-triggering | AI §3 | TA-09 |
| W16-06 | Bounded context builder over sim views, player actions, goals and policy revisions | sim | M |  | W16-01 | Context contains current manual orders and goals, stays in byte cap and makes no atlas scan | AI §5 | TA-09 |
| W16-07 | Atomic per-colony attempt/cooldown/in-flight budgets | server | M |  | W16-15 | Two workers racing one colony reserve at most one active plan and respect day limits | AI AI-03, AI-05 | TA-09 |
| W16-08 | Atomic global token/cost reservations and usage reconciliation | server | M |  | W16-15 | Retries, unknown usage and UTC rollover cannot overspend reservations | AI AI-04 | TA-09 |
| W16-09 | Versioned prompt/schema builder using native Zod 4 JSON Schema and bounded skill selection | server | S |  | W16-06, W16-35 | Golden context exposes at most six eligible skills and fits aggregate token cap | AI §5, §8 | TA-09 |
| W16-10 | Strict input/output validation and colony-scoped reference checks | server | M |  | W16-01 | Malformed/deep/oversized JSON and cross-colony IDs are rejected before commands | AI AI-06, AI-17 | TA-09 |
| W16-11 | Shared conservative/risky policy predicates and cumulative batch preview | sim | M |  | W16-10, W16-34 | Batch cannot reuse the same free resources or goal slot; risky does not bypass caps | AI §4, §6 | TA-09 |
| W16-12 | Proposal outbox, fencing and freshness/intent checks at authoritative ingress | server | M |  | W16-11, W16-31 | Late worker or player-revised plan is superseded; duplicate proposal produces one result | AI AI-08, AI-09 | TA-09 |
| W16-13 | Apply directives via ordinary goal/order handlers with per-action acknowledgements | sim | M |  | W16-12 | Manual work is preserved; valid actions pay progressively and rejected actions report reasons | AI §6 | TA-09 |
| W16-14 | Provider circuit, bounded retry/abort and rules-only fallback | server | S |  | W16-03 | Failure storm opens circuit; rule-engine commands continue during worker outage | AI §7 | TA-09 |
| W16-15 | AI schema migrations, attempt/decision/result audit and settings | server | M |  | W16-01 | Round-trip versioned records and expire context without deleting durable player policy | AI §10 | TA-09 |
| W16-16 | Sanitized raw logging, hashes, retention and secret redaction | server | S |  | W16-15 | Injected secrets/tokens never reach prompt storage; raw columns purge at 14 days | AI AI-14 | TA-09 |
| W16-17 | Authenticated kill switch with durable scopes and in-flight revocation | server | S |  | W16-15, W16-32 | Kill during tool execution rejects late result within 5 seconds; unauthorized admin rejected | AI AI-11 | TA-09 |
| W16-18 | HUD explanation, goal linkage, proposed/applied/rejected states and ordinary cancel | client | S |  | W16-13 | Sim rejection is never displayed as applied; malicious rationale renders as text | AI AI-10 | TA-09 |
| W16-19 | Director controls integrated with W08 priorities/goals and W09 mode | client | M |  | W16-34, W16-18 | Edit preset, individual weights and risk; reload preserves effective policy without rescaling sliders | AI §4 | TA-09 |
| W16-20 | Away story provider using shared budget and narrative-only capability | server | S |  | W16-08, W09-18 | Return digest gets bounded story; failure omits it and narrative cannot submit actions | AI §6, §7 | TA-09 |
| W16-21 | Guild strategy provider with separate NPC principal and shared global budget | server | S |  | W16-08, W15-13 | Hourly NPC strategy cannot read or command unrelated player colony | AI §6 | TA-09 |
| W16-22 | Evaluation harness with at least 60 paired-risk/security/world fixtures | test | M |  | W16-11, W16-36 | Report separates zero-tolerance invariants, strategic variation and model-quality scores | AI §12 | TA-09 |
| W16-23 | Metrics and alerts for budget, queue, tool denials, worker health and sim regression | ops | S |  | W16-15, W16-30 | Load run reports bounded labels, oldest wait and accurate per-action outcomes | AI §13 | TA-09 |
| W16-24 | Policy, authorization, revocation and malformed-input regression suite | test | M |  | W16-17, W16-33 | Hostile tool/text, forged principal, expired scope and risky escalation yield zero violations | AI §2, §12 | TA-09 |
| W16-25 | Consent-aware risk/preset/decision analytics using existing pipeline | client | S |  | W16-19 | Consent-off emits nothing; enabled events report bounded enums without free text | AI §13 | TA-09 |
| W16-26 | Dev tools for trigger/mock/brief/policy/queue inspection; update DEV_TOOLS | client | S |  | W16-05, W16-30 | Mock scenario explains queue/fence/revision; production denies fault and reset commands | AI §9, §11 | TA-09 |
| W16-27 | Wave e2e, owner guide and live acceptance artifact; tag only after complete gates | test | M |  | all W16 | Demo, crash, security, load and live reports pass; earlier suites pass with W16 off | AI §14 | TA-09 |
| W16-28 | Library/version/license/advisory spike for Node, Zod 4, MCP, AI SDK and pg-boss | server | S |  | W16-01 | Locked compatible versions pass small MCP/provider/PG smoke; record unsupported features | AI §8 | — |
| W16-29 | Separate director worker workspace and dependency boundary | server | M |  | W16-28 | Worker boots alone; cannot import backend/app internals or access game DB writes | AI §1, §9 | — |
| W16-30 | Bounded durable pg-boss scheduler, fairness and coalescing | server | M |  | W16-29, W16-15 | 1000 simultaneous events retain at most 512 pending and one pending per colony | AI §7 | — |
| W16-31 | Claim leases/fences, trigger outbox and restart reconciliation | server | M |  | W16-30 | Crash at claim/response/ack boundaries rejects stale fences and does not duplicate commands | AI §7 | — |
| W16-32 | Private MCP transport and workload/capability authentication | server | M |  | W16-29 | Wrong audience, missing scope, revoked job and browser-origin abuse are denied | AI §2 | — |
| W16-33 | MCP bounded read/proposal tools with pinned schemas and hostile-input checks | server | M |  | W16-32, W16-06 | Allowlisted tools enforce identity, result caps, no arbitrary URLs and no direct mutation | AI §2, §6 | — |
| W16-34 | Persisted player risk/preset/permission policy with authoritative intent revision | sim | M |  | W16-01 | Changing player intent invalidates old plans; risk toggle never enables away raids | AI §3, §4 | — |
| W16-35 | Runtime skill registry and capability-filtered selection | server | M |  | W16-01, W16-34 | Each skill declares prerequisites, permissions, variants and fixtures; disabled executor absent | AI §6 | — |
| W16-36 | Core skill strategies: survival, power and economy | server | M |  | W16-35, W16-11 | Both risk profiles achieve goal-specific fixtures through existing executors | AI §6 | — |
| W16-37 | Spatial skill strategies: defence, scouting, expansion and terraforming | server | M |  | W16-35, W16-11 | Flank/frontier/terraform variants remain within observed routes and protected areas | AI §6 | — |
| W16-38 | Wave-gated strategy adapters: trade, tech, aggression and settlement | server | M |  | W16-35, W16-11 | Disabled wave/stage removes skills; raid/upgrade/launch permissions stay mandatory | AI §6 | — |
| W16-39 | Bounded action history, intent invalidation and cancellation suppression | server | M |  | W16-06, W16-34 | Cancel a goal during provider call: stale plan drops and equivalent re-proposal is suppressed | AI §3 | — |
| W16-40 | W11 world/context adapter and persistent sector compatibility | server | M |  | W16-06 | Canonical IDs, isolated R=48 founding-sector context and 19-sector manifest summaries survive restart; cross-sector actions respect W11 isolation until W27 | AI §5 | — |
| W16-41 | W27 summary/read port and unknown/stale/unloaded fake streaming fixtures | contract | M |  | W16-40 | 450-sector synthetic world returns bounded relevant summaries with no forced full residency | AI §5 | — |
| W16-42 | MCP/AI planning loop caps and proposal-only side effects | server | M |  | W16-09, W16-33 | Loop stops at 3 turns/6 tools/deadline; all attempts share token reservations | AI §7 | — |
| W16-43 | Player command and preview parity; temporary priority overlay and rollback | sim | M |  | W16-13, W16-39 | Expiry restores latest player baseline; repeated away calls never ratchet beyond guard band | AI §3, §6 | — |
| W16-44 | Postgres multiworker delivery and budget crash integration suite | test | M |  | W16-31, W16-08, W16-12 | Kill worker/game around commit boundaries and midnight; no duplicate effects or cap bypass | AI §12 | — |
| W16-45 | UI flow for strategic controls and same-state conservative/risky comparison | test | M |  | W16-19, W16-37 | Two permitted strategies differ visibly; locked player goals and cancel controls remain effective | AI §4 | — |
| W16-46 | Stack deployment, resource limits, private network/DB grants and rollback | ops | M |  | W16-29, W16-32 | Stop/restart director independently; game remains ready and unauthorized DB writes fail | AI §9 | — |
| W16-47 | Load benchmark with AI off/on, critical flood and W27 synthetic context | test | M |  | W16-23, W16-41, W16-42 | Publish latency/memory/DB evidence meeting §12 bounds; no simulated capacity claims | AI §12 | — |
| W16-48 | Manual live provider evaluation and cost calibration | test | M |  | W16-22, W16-38, W16-42 | Real model passes JSON/tool/usage and strategy gates; credentials absent leaves acceptance open | AI §8, §12 | — |
| W16-49 | Local-host mock parity and wave-mask regression coverage | test | M |  | W16-43 | Local and online shared policy outcomes match; W16-off opens no worker jobs or MCP | AI §11 | — |

## Wave DoD

- All issue acceptance checks pass, including security and real Postgres crash/replay tests.
- Owner story covers both risk profiles, player intent changes, W11 context compatibility and W27 synthetic partial-world contracts.
- Performance report meets AI §12 gates with actual hardware/load stated; real W27 scale is separately validated when W27 lands.
- Manual live Z.ai report passes; missing key/model support is explicitly **live-blocked**, not complete W16.
- Prior-wave e2e and local shared-policy parity pass with W16 on/off. Deployment/rollback and DEV_TOOLS are current.
- Commit the exercised owner guide on the wave branch before owner landing and `wave-16` tag.

## W12 progression integration gate (revised)

Follow [Progression persistence and delivery](../../spec/PROGRESSION_ENGINE.md). Identify any new statistics producers and reuse the W12 catalogue, transaction and effect queue; do not introduce parallel counters or reward callbacks.

Acceptance: producer-to-profile persistence, replay/restart, concurrent inputs, threshold boundaries, independent queue retries and disabled-wave behavior are covered by unit and PostgreSQL integration tests. New achievement conditions use catalogue configuration; new event semantics use registered producers. Keep earned achievements and lifetime statistics across colony transitions. ME opens in a new tab from authenticated landing/selection only; the hub's W12 mock is explicit.
