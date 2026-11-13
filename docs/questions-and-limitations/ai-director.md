# AI director — questions and limitations

### AI-01 · Revised W16 is a plan, not a live integration

- **Status:** Resolved (`3105e2dc`, `1d5a59e7`, `6c7631ad`)
- **Area / code:** [W16](../plan/waves/W16-ai-director.md), [AI spec](../spec/AI_ORCHESTRATOR.md), `backend/app/src/ai/colony-agent/colony-agent-loop.service.ts`, `backend/app/src/ai/adapters/nearai-llm.adapter.ts`, `shared/sim/src/systems/rival-ai/governor.ts`, `frontend/game/features/director/DirectorPanel.ts`
- **What happens:** `ColonyAgentLoopService` (`backend/app/src/ai/colony-agent/`) connects the autonomous governor (`stepColonyAutonomousGovernor` in `@terra/sim`) and `LlmProviderPort` (`NearAiLlmAdapter` with `/v1/signature/{chat_id}` TEE SHA-256 verification and `z-ai/glm-5.3`, or deterministic `MockLlmAdapter`) directly to live `SimThreadPool` planets. Non-player rival AI bots are batched into a single `NearAiLlmAdapter` request per planet sweep (`180s` cadence + `120s` state-digest cache), while human players can connect their own NEAR.AI API key and select a model in `/me.html` so their autopilot/away colonies use their personal credentials. Human colonies stay 100% manual while online by default (`AI AUTOPILOT: OFF`) and are governed only when the player toggles `AI AUTOPILOT: ON` (`[data-testid="director-autopilot-toggle"]`, `setAiEnabled`) or goes offline (`colonyIsAway`), while 2 seeded Rival AI Colonies (`Iron Guild Outpost` & `Crimson Vanguard`, `TA_SEED_RIVAL_AI=1`) run continuously.
- **Why it is like this:** Preserves human-first RTS agency while delivering real autonomous multi-colony diplomacy, raids, trading, and terraforming with 3 hard server-enforced Track `07` guardrails (`AW-13` Oathbreaker truce-cancel block, `403 AI_STAKING_FORBIDDEN`, and trade allowance cap + kill switch).
- **Workaround / mitigation:** Set `TA_SEED_RIVAL_AI=1` (or call `POST /v1/dev/ai-colonies/seed` / `/dev/economy-sim/`) to inspect multi-agent equilibrium on demand while keeping deterministic unit/E2E suites isolated by default.
- **To resolve:** Resolved in `3105e2dc`, `1d5a59e7`, and `6c7631ad`.
- **Found:** 2026-11-04, W16 planning review. Resolved 2026-11-11.

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
- **What happens:** official docs support the selected MCP/AI SDK/Zod/pg-boss approach, and the direct Z.ai (`api.z.ai`) adapter has been replaced with NEAR AI Cloud (`https://cloud-api.near.ai/v1`, model `z-ai/glm-5.3`), but live production token prices and tail latency under multi-planet load are not yet measured against a production account.
- **Why it is like this:** documentation research cannot prove provider/account capability or package compatibility in this repo.
- **Workaround / mitigation:** compatibility spike, version locks, advisory review and live gate precede rollout; never silently substitute model/provider. No paid calls made here.
- **To resolve:** W16-28 and W16-48 record versions, measured usage/cost and real contract results.
- **Found:** 2026-11-04, W16 planning review.

### AI-05 · Director away-raid mirror is written by setAutopilot

- **Status:** Resolved (W09-34)
- **Area / code:** `shared/sim/src/systems/director/store.ts` (`mirrorAutopilotOnDirector`, `awayRaids`, `autopilotMode`), `shared/sim/src/systems/away/autopilot.ts`, `shared/sim/src/systems/director/policy.ts`
- **What happens:** `setAutopilot` writes `awayRaids` and `autopilotMode` (`director` | `rules_only`, default `director`) onto that colony's director record in the same tick. A patch that omits a field leaves the record's current value. `setDirectorPolicy` does not write either field, so Risky neither grants nor clears raids. The mirror stays. `coreSkillLimits` still returns `awayRaids: false`; the away gate reads the away blob. A throw from the director helpers is ignored so `setAutopilot` still stores the away blob when the W16 table is missing.
- **Why it is like this:** W09-34 is the writer. Deleting the mirror would make W16 re-read the away blob. Risk must still not grant raids (AI-12).
- **Workaround / mitigation:** a `setDirectorPolicy` payload with `awayRaids` is `invalid_args`. Callers that build preview limits pass `awayRaids` themselves.
- **To resolve:** resolved in W09-34. Do not have `setDirectorPolicy` write these fields.
- **Found:** 2026-11-04, W16-34. Resolved 2026-11-09, W09-34.

### AI-04 · Separate worker and large-world performance are unmeasured

- **Status:** Open
- **Area / code:** [AI spec §7](../spec/AI_ORCHESTRATOR.md#7-durable-scheduling-and-failure-handling), [W27](../plan/waves/W27-planet-sectors.md)
- **What happens:** the plan adopts a separate worker and pg-boss on existing Postgres; initial queue/concurrency/RSS/latency targets are unmeasured. W11/W27 world changes are also planned, not presumed landed.
- **Why it is like this:** isolate provider work without adding Redis; sharing Postgres still risks contention and must be benchmarked. Synthetic summaries cannot establish real streaming performance.
- **Workaround / mitigation:** bounded jobs/reads, DB grants/pools and kill switch; W16 tests fake streaming, W27 repeats on actual stack. Game retains D-24 snapshot rollback and rejects old AI epochs after restart.
- **To resolve:** publish W16 load report and real W11/W27 integration results; revisit queue choice only on measured contention.
- **Found:** 2026-11-04, W16 planning review.

### AI-06 · Director audit store is in-memory only

- **Status:** Resolved (`wave-16`)
- **Area / code:** `backend/app/src/ai/audit/prisma-store.ts` (`PrismaDirectorStore`), `backend/app/src/ai/audit/memory-store.ts` (`MemoryDirectorAudit`), `shared/db/prisma/ai.prisma`
- **What happens:** `PrismaDirectorStore` implements `DirectorAuditPort` over `@terra/db` (`director_policy`, `director_context`, `director_decision`, `director_proposal`, `director_action_result`, `director_budget_day`, `director_attempt`, `director_kill_switch`), expiring context and decisions while preserving `director_policy`. `MemoryDirectorAudit` remains for fast unit tests without Postgres.
- **Why it is like this:** unit tests run without a database while `backend/app/test/ai/director-persistence.int.spec.ts` verifies the real Postgres store.
- **Workaround / mitigation:** use `PrismaDirectorStore` for durable Postgres persistence and `MemoryDirectorAudit` for unit tests.
- **To resolve:** resolved in `backend/app/src/ai/audit/prisma-store.ts`.
- **Found:** 2026-11-04, W16-15.

### AI-07 · Proposal outbox is in-memory

- **Status:** Resolved (`wave-16`)
- **Area / code:** `backend/app/src/ai/audit/prisma-store.ts` (`PrismaDirectorStore.acceptProposal`), `backend/app/src/ai/audit/outbox.ts` (`ProposalOutbox`), `shared/db/prisma/ai.prisma` (`DirectorProposal`)
- **What happens:** `PrismaDirectorStore.acceptProposal` persists proposals and action results in a single Postgres transaction on `director_proposal` and `director_action_result`, enforcing `(planetEpoch, stateTick)` and `intentRevision` fencing and `requestId` deduplication across restarts and workers.
- **Why it is like this:** `ProposalOutbox` remains as the pure in-memory reference implementation for unit tests, while `PrismaDirectorStore` provides crash-safe Postgres persistence.
- **Workaround / mitigation:** use `PrismaDirectorStore.acceptProposal` and `results(requestId)` when backed by Postgres.
- **To resolve:** resolved in `backend/app/src/ai/audit/prisma-store.ts`.
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

- **Status:** Resolved (`wave-16`)
- **Area / code:** `backend/app/src/ai/audit/prisma-store.ts` (`PrismaDirectorStore.reserveAttemptBudget` / `reconcileAttemptBudget`), `backend/app/src/ai/budget/global.ts` (`GlobalTokenBudget`), `shared/db/prisma/ai.prisma` (`DirectorBudgetDay`, `DirectorAttempt`)
- **What happens:** `PrismaDirectorStore.reserveAttemptBudget` and `reconcileAttemptBudget` persist daily token reservations and attempt rows (`attemptId`) inside a Postgres transaction using `SELECT ... FOR UPDATE` on `director_budget_day` and `director_attempt`, preventing concurrent workers from exceeding the daily cap and ensuring idempotent per-attempt reconciliation.
- **Why it is like this:** `GlobalTokenBudget` stays available for pure unit tests while `PrismaDirectorStore` enforces multi-worker transactional caps on Postgres.
- **Workaround / mitigation:** pass a unique `id` per provider attempt to `reserveAttemptBudget` and `reconcileAttemptBudget`.
- **To resolve:** resolved in `backend/app/src/ai/audit/prisma-store.ts` and tested in `backend/app/test/ai/director-persistence.int.spec.ts`.
- **Found:** 2026-11-04, W16-08.

### AI-10 · Library pins are loaded, live model behavior is not

- **Status:** Open
- **Area / code:** `backend/app/src/ai/versions.ts`, `backend/app/package.json`
- **What happens:** `ai@7.0.162`, `@ai-sdk/openai-compatible@3.0.84`, `@ai-sdk/mcp@2.0.90`, `@modelcontextprotocol/sdk@1.32.2`, and `pg-boss@12.38.0` import on Node 24. pg-boss is a named export `PgBoss` (no default). Sampling, elicitation, resource subscriptions, and remote MCP discovery stay unsupported. `npm audit` still reports high advisories in the tree after the install. One glm-5.3 ping returned usage (`docs/plan/w16-live-report.md`: 21 input tokens, 16 output tokens, 1763 ms). Tool calls, JSON schema, and abort were not part of that ping.
- **Why it is like this:** W16-28 locks versions. W16-48 made one credentialed call and stopped. The key stays in the gitignored env file.
- **Workaround / mitigation:** do not enable the unsupported MCP features. Do not swap the model if a call fails. Do not treat the ping as a strategy-gate pass.
- **To resolve:** run the live provider against the eval fixtures, including tools, JSON, and abort, and revisit the audit findings before rollout.
- **Found:** 2026-11-04, W16-28.

### AI-11 · Eval report scores supplied outcomes and does not call a model

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/ai/eval/report.ts` (`scoreEval`), `backend/app/src/ai/eval/fixtures.ts` (`buildFixtures`)
- **What happens:** `scoreEval` reads a caller-supplied outcome per fixture id. It returns three separate counters: invariant violations (only when `invariant !== 'none'`), paired-risk variation (`varied` is pairs where both risks are marked varied), and valid/total quality. It does not add those into one score, call a provider, or write `eval/out/report.json`. The fixture skill axis includes `power`, which is not a `DirectorSkillFamily`.
- **Why it is like this:** W16-22's acceptance is the split report over at least 60 paired fixtures. Live model, latency and token gates are W16-48.
- **Workaround / mitigation:** tests pass synthetic outcomes. A violation never changes `quality.valid`. One risk marked varied does not count as strategic variation.
- **To resolve:** W16-48 runs the live provider against these fixtures and fills the outcome map from validator results.
- **Found:** 2026-11-04, W16-22.

### AI-12 · Load bench is in-process

- **Status:** Open
- **Area / code:** `backend/director/src/bench.ts`, `docs/plan/w16-director-load.md`, `backend/app/test/ai/director-persistence.int.spec.ts`
- **What happens:** multi-worker budget contention, proposal fencing, and kill-switch persistence now run against real Postgres in `backend/app/test/ai/director-persistence.int.spec.ts`. W16-47 (`bench.ts`) still times `summarizeRelevant` on a 450-sector synthetic world in-process (50 samples, p95 0.014 ms, RSS 145 MB on the machine named in the load report; pool `in-memory 1`, oldest job age `0`).
- **Why it is like this:** the W16-47 benchmark measures context-summarizer CPU/RSS bounds deterministically without background worker noise.
- **Workaround / mitigation:** read `docs/plan/w16-director-load.md` as the summarizer benchmark and `director-persistence.int.spec.ts` as the Postgres transactional proof.
- **To resolve:** publish a combined pg-boss + W27 live sector load report when W27 lands.
- **Found:** 2026-11-04, W16-27.

### AI-13 · The director plate does not show live policy during play

- **Status:** Resolved (`wave-16`)
- **Area / code:** `frontend/game/features/director/index.ts`, `DirectorPanel.ts`, `DirectorControls.ts`, `devCommands.ts`, `shared/sim/src/systems/director/store.ts` (`readDirectorView`)
- **What happens:** `readDirectorView` reads the colony's authoritative `ColonyDirectorRecord` from `view.blobs.director`. `DirectorPanel` displays `[data-testid="director-policy-summary"]` (`conservative · resources · 15% commit / 40% reserve`, or `35% commit / 15% reserve` under `risky`, plus `PAUSED`), mounts `DirectorControls` (`risk`, `preset`, `paused`, `note`) wired to `setDirectorPolicy`, supersedes open action rows when `intentRevision` increments, and updates `director.plan` / `director.trace` from live policy.
- **Why it is like this:** `SimView.blobs.director` is replicated to `ClientView.blobs.director` on both the server host and `?host=local`.
- **Workaround / mitigation:** none needed; the plate updates live and hides when `&waves=..15`.
- **To resolve:** resolved in `frontend/game/features/director/`.
- **Found:** 2026-11-04, W16-27.

### AI-14 · Player NEAR.AI API keys are stored in plaintext in Postgres

- **Status:** Resolved (AES-256-GCM `NEAR_KEK` envelope encryption)
- **Area / code:** `shared/db/prisma/core.prisma` (`Player.nearAiApiKey`), `backend/app/src/profile/player-ai-settings.store.ts`, `backend/app/src/profile/me-profile.controller.ts`, `backend/app/src/near/keystore/`
- **What happens:** Players save and clear a personal NEAR.AI API key and model selection in `/me.html` (`GET / PUT / POST / DELETE /v1/me/ai-settings`). `PlayerAiSettingsStore` seals every saved key with `AES-256-GCM` (`enc:v1:<kekVersion>:<base64>`) via `loadKekRing` / `NEAR_KEK` before persisting to `Player.nearAiApiKey`, masks API responses (`apiKeyPreview` only), and strips `sk-*` / `nearai_*` / `Bearer` tokens in audit redaction.
- **Why it is like this:** Uses the existing KEK ring (`DEV_KEK` only outside `NODE_ENV=production`; production requires real 32-byte `NEAR_KEK`) with backwards-compatible decryption for any pre-encryption rows.
- **Workaround / mitigation:** API responses never return the raw key (`apiKeyPreview` only), and players can clear their key at any time via `DELETE /v1/me/ai-settings` or `/me.html`.
- **To resolve:** Resolved in `backend/app/src/profile/player-ai-settings.store.ts` (`sealPlayerApiKey` / `openPlayerApiKey`).
- **Found:** 2026-11-12, NEAR.AI rework. Resolved 2026-11-13.

## W05 AI switch (2026-11-05)

- **Owner question: should AI off stop idle Worker Drones?** Worker Drone T1 auto-targeting (`systems/harvest`, `goalHarvestWeights`) is not gated; only goal breakdown and the rule-engine autopilot are.
- **Goals queued by the player sit idle while AI is off**, and the UI does not say so yet.
- **Existing `hq`/`ai` queue entries are not cancelled** when AI is switched off; they finish.
- **Spacing is a soft rule** (`siteSpacing.ts`): it falls back to touching sites when no lane site exists; hub and extractor pickers are unchanged; manual placement is not constrained.
