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

### AI-04 · Separate worker and large-world performance are unmeasured

- **Status:** Open
- **Area / code:** [AI spec §7](../spec/AI_ORCHESTRATOR.md#7-durable-scheduling-and-failure-handling), [W27](../plan/waves/W27-planet-sectors.md)
- **What happens:** the plan adopts a separate worker and pg-boss on existing Postgres; initial queue/concurrency/RSS/latency targets are unmeasured. W11/W27 world changes are also planned, not presumed landed.
- **Why it is like this:** isolate provider work without adding Redis; sharing Postgres still risks contention and must be benchmarked. Synthetic summaries cannot establish real streaming performance.
- **Workaround / mitigation:** bounded jobs/reads, DB grants/pools and kill switch; W16 tests fake streaming, W27 repeats on actual stack. Game retains D-24 snapshot rollback and rejects old AI epochs after restart.
- **To resolve:** publish W16 load report and real W11/W27 integration results; revisit queue choice only on measured contention.
- **Found:** 2026-11-04, W16 planning review.

### AI-05 · Director audit store is in-memory only

- **Status:** Open
- **Area / code:** `backend/app/src/ai/audit/memory-store.ts` (`MemoryDirectorAudit`), `shared/db/prisma/ai.prisma`
- **What happens:** policy, context and decision rows round-trip in memory. `expire` deletes context and decisions with `expiresAtMs <= now` and leaves `director_policy`. `director_attempt`, `director_proposal` and `director_action_result` have tables and no writer. Nothing here connects to Postgres. `loadUnchecked` exists so a test can plant corrupt policy JSON.
- **Why it is like this:** W16-15's acceptance is the expiry rule without a database. The Prisma class waits for worker wiring and must not be required by unit tests when Postgres is down.
- **Workaround / mitigation:** `partitionExpired` does not take policy rows. A later repository should implement `DirectorAuditPort` in `backend/app/src/ai/audit/types.ts`. Callers pass `expiresAtMs` (short-lived context, 30-day decision audit); this store does not choose those windows or redact secrets (W16-16).
- **To resolve:** add a Prisma `DirectorAuditPort` against the generated client, plus attempt and action-result writers, without expiring `director_policy`.
- **Found:** 2026-11-04, W16-15.
