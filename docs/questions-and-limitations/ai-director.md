# AI director — questions and limitations

### AI-01 · Revised W16 is a plan, not a live integration

- **Status:** Open
- **Area / code:** [W16](../plan/waves/W16-ai-director.md), [AI spec](../spec/AI_ORCHESTRATOR.md), `backend/app/src/ai/`
- **What happens:** current code has provider selection/interface wiring; the new worker, queue, MCP tools, policies and live provider acceptance remain implementation work.
- **Why it is like this:** this task improves the wave plan; no feature implementation or paid call was requested.
- **Workaround / mitigation:** W16 DoD explicitly separates mock completion from live-blocked status; no package or runtime settings changed.
- **To resolve:** implement W16 issues and attach real provider, security, crash/replay and performance reports.
- **Found:** 2026-11-04, W16 planning review.

### AI-02 · Risk profiles need gameplay calibration

- **Status:** Open
- **Area / code:** [AI spec §4](../spec/AI_ORCHESTRATOR.md#4-player-strategy-and-risk-settings)
- **What happens:** Conservative/Risky reserve, commitment and combat thresholds are initial tunable defaults; they have not been measured for balance or enjoyment.
- **Why it is like this:** owner requested more adventurous behavior with two player-selectable levels; numeric values need actual scenario evidence.
- **Workaround / mitigation:** player ceilings and locked goals remain stricter; risk never grants permissions; paired behavior fixtures reject an always-hold director. W16-01 stores the spec §4 numbers in `shared/sim/src/data/director.ts` as the proposed default (conservative reserve 40% / commit 15% / strength 1.5, risky reserve 15% / commit 35% / strength 0.9). They are not calibrated.
- **To resolve:** evaluate profiles across three biomes, threats and objectives, publish results and calibrate defaults before rollout.
- **Found:** 2026-11-04, W16 planning review.

### AI-03 · Provider and library selection requires runtime verification

- **Status:** Open
- **Area / code:** [AI spec §8](../spec/AI_ORCHESTRATOR.md#8-library-selection-and-compatibility-gate)
- **What happens:** official docs support the selected MCP/AI SDK/Zod/pg-boss approach, but exact package versions, Z.ai glm-5.3 availability/tool support, prices and latency are not verified against an owner account.
- **Why it is like this:** documentation research cannot prove provider/account capability or package compatibility in this repo.
- **Workaround / mitigation:** compatibility spike, version locks, advisory review and live gate precede rollout; never silently substitute model/provider. No paid calls made here.
- **To resolve:** W16-28 and W16-48 record versions, measured usage/cost and real contract results.
- **Found:** 2026-11-04, W16 planning review.

### AI-05 · Director away-raid mirror is not the W09 setting yet

- **Status:** Open
- **Area / code:** `shared/sim/src/systems/director/store.ts` (`awayRaids`)
- **What happens:** director state stores `awayRaids: false`. `setDirectorPolicy`, including a switch to Risky, never writes `true`. The W09 away opt-in is not in this tree, so there is no second writer.
- **Why it is like this:** W16 must prove risk does not grant raids (AI-12) before W09's `setAutopilot` lands. The mirror is the checkable stand-in.
- **Workaround / mitigation:** the field stays false. A command that sends `awayRaids` is `invalid_args` because the policy schema has no such key.
- **To resolve:** when W09 away policy is in the sim, read that setting here and delete the mirror.
- **Found:** 2026-11-04, W16-34.

### AI-04 · Separate worker and large-world performance are unmeasured

- **Status:** Open
- **Area / code:** [AI spec §7](../spec/AI_ORCHESTRATOR.md#7-durable-scheduling-and-failure-handling), [W27](../plan/waves/W27-planet-sectors.md)
- **What happens:** the plan adopts a separate worker and pg-boss on existing Postgres; initial queue/concurrency/RSS/latency targets are unmeasured. W11/W27 world changes are also planned, not presumed landed.
- **Why it is like this:** isolate provider work without adding Redis; sharing Postgres still risks contention and must be benchmarked. Synthetic summaries cannot establish real streaming performance.
- **Workaround / mitigation:** bounded jobs/reads, DB grants/pools and kill switch; W16 tests fake streaming, W27 repeats on actual stack. Game retains D-24 snapshot rollback and rejects old AI epochs after restart.
- **To resolve:** publish W16 load report and real W11/W27 integration results; revisit queue choice only on measured contention.
- **Found:** 2026-11-04, W16 planning review.

### AI-06 · Director audit store is in-memory only

- **Status:** Open
- **Area / code:** `backend/app/src/ai/audit/memory-store.ts` (`MemoryDirectorAudit`), `shared/db/prisma/ai.prisma`
- **What happens:** policy, context and decision rows round-trip in memory. `expire` deletes context and decisions with `expiresAtMs <= now` and leaves `director_policy`. `director_attempt`, `director_proposal` and `director_action_result` have tables and no writer. Nothing here connects to Postgres. `loadUnchecked` exists so a test can plant corrupt policy JSON.
- **Why it is like this:** W16-15's acceptance is the expiry rule without a database. The Prisma class waits for worker wiring and must not be required by unit tests when Postgres is down.
- **Workaround / mitigation:** `partitionExpired` does not take policy rows. A later repository should implement `DirectorAuditPort` in `backend/app/src/ai/audit/types.ts`. Callers pass `expiresAtMs` (short-lived context, 30-day decision audit); this store does not choose those windows or redact secrets (W16-16).
- **To resolve:** add a Prisma `DirectorAuditPort` against the generated client, plus attempt and action-result writers, without expiring `director_policy`.
- **Found:** 2026-11-04, W16-15.

### AI-07 · Proposal outbox is in-memory

- **Status:** Open
- **Area / code:** `backend/app/src/ai/audit/outbox.ts` (`ProposalOutbox`), `shared/db/prisma/ai.prisma` (`DirectorProposal`)
- **What happens:** `accept` keeps the first action list for a `requestId` in process memory. A lower fence than that colony's latest accepted fence, or an `intentRevision` below `noteIntent`, returns `superseded` and stores nothing. A repeat `requestId` returns `duplicate: true` and does not append actions. Nothing is written to `director_proposal` or `director_action_result`. A process restart drops accepted proposals.
- **Why it is like this:** W16-12's acceptance is fencing and request-id dedupe. The task forbids Prisma edits, so the durable table stays unused.
- **Workaround / mitigation:** callers can read the one stored list with `results(requestId)`. Do not treat this object as crash-safe, and do not replay a superseded proposal under the same request id after raising the fence elsewhere.
- **To resolve:** persist the same accept rules in one transaction on `director_proposal`, still deduping `requestId`, without applying a stale fence or an older intent revision.
- **Found:** 2026-11-04, W16-12.

### AI-08 · Director metrics are in-memory counters, not alerts

- **Status:** Open
- **Area / code:** `backend/app/src/ai/metrics/director.ts` (`DirectorMetrics`)
- **What happens:** the load report stores bounded trigger/skill/risk labels, the max wait, and per-action counts. It does not export Prometheus series or raise the §13 alarms (budget 0.8/1.0, queue starvation, repeated authorization failures, missing worker heartbeat, tool denials, sim regression).
- **Why it is like this:** W16-23's acceptance here is that a load-style report cannot take colony ids as labels. Queue, budget and worker producers are not in this change.
- **Workaround / mitigation:** callers pass the small enums only. A label containing a prefixed id (`co_`, `pl_`, …), a colon, or more than 40 characters throws and is not stored. `oldestWaitMs` is the max observed `waitMs`, not a live queue age.
- **To resolve:** register the series on `MetricsRegistry` and wire the §13 alerts when those producers exist.
- **Found:** 2026-11-04, W16-23.

### AI-09 · Global token budget is process-local

- **Status:** Open
- **Area / code:** `backend/app/src/ai/budget/global.ts` (`GlobalTokenBudget`), `shared/db/prisma/ai.prisma` (`DirectorBudgetDay`)
- **What happens:** `reserve` / `reconcile` keep spent and outstanding tokens in a `Map` keyed by the day string. Another process, or this process after a restart, does not see those counters, so two workers can each reserve the full daily cap. `reconcile` closes the oldest outstanding reservation of the same token count. A repeat for that count, while another reservation of the same size is still open, closes the other one. Usage above the reservation is added to spent. Dollars are not tracked.
- **Why it is like this:** W16-08's acceptance is the reservation rule (retry, unknown usage, UTC day) without a database. `DirectorBudgetDay` has no writer.
- **Workaround / mitigation:** one process. Unknown usage (`actual: null`) charges the full reservation. A reconcile that matches no outstanding reservation does not lower spent. Callers that retry reconcile while another reservation of the same size is open can close the wrong one.
- **To resolve:** persist the same rules in one transaction (W16-44), with a reservation id so a retry cannot match a different row. The cost ceiling stays a separate check (AI §7).
- **Found:** 2026-11-04, W16-08.
