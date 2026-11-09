---
name: wave-landing-validator
description: >-
  Full pre-landing wave validation skill and 2-iteration review-and-fix harness. Trigger immediately when the user says
  "validate the wave", "validate wave", "validate WNN", "review the wave", or before landing any wave / after large
  multi-file wave changes. Compares the wave branch against the initial wave task and specs, enforces full Test Pyramid
  coverage (every major feature covered by BOTH unit tests and integration tests, backend tested by E2E too, and every
  suite covering positive, negative, and corner/boundary cases), runs all test and domain gates, finds and fixes
  functional gaps, detects code duplication (AST function clones and block clones), enforces clean architecture and the
  Orchestrator + Services/Parts split, verifies end-to-end Client + Server + Shared Sim integration (online WS + local
  host + wave-flag fencing), iterates 2 full passes, and produces a structured pre-landing summary.
---

# Full Wave Pre-Landing Validator (`wave-landing-validator`)

> **Natural-Language Trigger (`"validate the wave"`):** Whenever the user says **"validate the wave"** (or `"validate wave"`, `"validate WNN"`, `"review the wave"`), immediately run `npm run validate:wave` (auto-detects the current worktree's wave or the open wave in the plan), execute the **2-iteration review-and-fix loop** in §1 below across all modified files, run `npm run validate:wave -- <NN> --gates`, and report the 6-part structured summary.

Before a wave branch (`wave/wNN-<slug>`) is handed to the owner or merged into `main`, it must pass a rigorous **pre-landing quality, architecture, test-pyramid, and task-parity validation**. Large wave implementations across multiple subagents frequently accumulate subtle gaps against the initial wave task, happy-path-only tests missing negative/corner cases, features with unit tests but no integration or backend E2E tests, duplicated helper blocks, oversized orchestrators that mix wiring with business logic, or client/server/sim boundary drift.

This skill and its CLI harness (`npm run validate:wave` / `npm run wave:validate`) combine **automated AST, duplication, architecture, contract-wiring, and Test Pyramid + Positive/Negative/Corner-case checks** (`scripts/wave/audit-wave.mjs`, `scripts/wave/audit-ast.mjs`, `scripts/wave/audit-tests.mjs`) with a **mandatory 2-iteration review-and-fix protocol** synthesizing best practices across all our projects (**TerraAgent**, **OmniSwarm**, **Yardos**, and **TinyWarp**).

---

## 1. Extended 2-Iteration Master Prompt (Copy-Paste or Auto-Launch)

Use this extended prompt whenever you finish a wave or large batch of changes (or launch it automatically with `npm run wave:validate -- <NN>`):

```markdown
I made a huge amount of changes in this wave. Fully review the entire implementation and compare it against the initial wave task and specs, pass all the tests, find every possible issue and gap, and fix all of them. Find and eliminate code duplication and violations of clean and architectural principles. Make sure all new logic is cleanly split across services and orchestrators. Make sure all new logic works end-to-end across client + server + shared sim. Verify full Test Pyramid coverage (every major feature covered by BOTH unit and integration tests, backend tested by E2E too, and every suite testing positive, negative, and corner/boundary cases). Execute this as a strict **2-iteration review-and-fix loop** following our cross-project best practices, then give me a structured summary:

### Pillar 1 — Compare Against Initial Wave Task, Specs & Acceptance Checks
- Diff the full wave branch against `main` (`git diff main...HEAD`, `git log main..HEAD`) and cross-check every item in the wave task file (`docs/plan/waves/WNN-*.md` / `ORCHESTRATOR.md` / `PLAN.md`):
  - **Goal & Features Covered**: verify every promised mechanic, formula, data row, and UI interaction is actually implemented (not stubbed or hardcoded).
  - **Issue Table (`WNN-01..XX`)**: verify every in-scope issue's exact `"do X → see Y"` acceptance check holds in code and tests.
  - **Specs & Decisions**: verify compliance with every cited spec section and `DECISIONS.md` rule (`D-01..D-44`).
  - **Demo Story & Wave Flag Fencing**: verify every demo step works end-to-end, and verify that running with earlier wave flags (`TA_WAVES=..<prev>` / `?waves=..<prev>`) hides all UI/menus/systems of this wave and rejects disabled commands with `wave_disabled`.
  - **Owned Paths**: verify no files outside the wave's declared **Owned paths** were modified without an explicit wave-file allowance.

### Pillar 2 — Find & Fix All Functional Gaps, Edge Cases & Boundary Bugs
- Hunt for happy-path stubs, off-by-one / tick-rate (`dt`) bugs, snapshot/restore round-trip loss, reconnect/delta desyncs, resource/cap clamping edge cases, and stale UI state.
- **No swallowed errors (Yardos R4.3)**: never leave empty `catch {}` blocks; every catch must rethrow, return a typed reject/failure code, or log with structured context.
- **Boundary validation (Yardos R4.2 / OmniSwarm)**: validate all external/wire inputs (WS messages, HTTP bodies/queries, LLM/CLI outputs, snapshots) with Zod schemas from `@terra/contracts`; eliminate unvalidated `any`.
- **Sim purity & movement invariants (`SIM-D-06`, `SIM-M-01`)**: `shared/sim/src/` must be 100% synchronous and deterministic (no `Date`, `Math.random`, engine-dependent `Math.sin/cos/pow`, timers, or locale methods), and only `locomotion.ts` (or `placeSpawnedEntity` / `adminRelocateEntity`) may write entity `x/y/q/r`.

### Pillar 3 — Eliminate Code Duplication (DRY & Open Registries)
- Scan all new and modified files for copy-pasted functions, repeated validation/math blocks, duplicated DOM/UI builders, and magic balance numbers outside data tables (`D-35`).
- **Second copy = extract**: consolidate duplicated code into shared helpers, pure functions, base hosts (`StageHost`), or open registries (`KitbashRegistry`, `ParticlePresetRegistry`, `BiomeMaterialRegistry`, sim system registries, client feature auto-discovery) rather than `if/else` ladders.

### Pillar 4 — Clean Architecture & Service / Orchestrator Split
- **Orchestrators compose; Services & Parts do the work (`AGENTS.md` §6)**:
  - Keep **Orchestrators** (`*Runner`, `*App`, `*Stage`, `*Module`, `*Host`, sim system `index.ts` pipelines) thin: they wire lifecycle, route commands/events, and coordinate flow, with zero heavy domain math, raw DOM construction, or complex state mutations inline.
  - Extract domain logic, evaluators, sub-stage rendering, and UI panels into focused single-purpose **Services / Parts** (`parts/`, `services/`, `stages/`, `panels/`, `sections/`, `handlers/`), each in its own file with a narrow, testable interface.
- **Strict Layering & Size Limits (`check:structure` / TinyWarp metrics)**:
  - Every file ≤ 500 lines (aim ≤ 400), every function/method/closure ≤ 100 lines (aim ≤ 60, control-flow nesting ≤ 3). Fix by extracting modules, never by compressing lines.
  - Layers point inward: `shared/*` imports no `frontend/` or `backend/`; `frontend/render/` imports no app and no `@terra/sim` internals (only hex/sector geometry); apps never import other apps; client `features/*` never cross-import sibling features; backend modules depend on abstract `*Port` interfaces, never concrete `adapters/`.

### Pillar 5 — Verify Client + Server + Shared Sim End-to-End Parity
- Trace every new feature across all four layers:
  1. **Contracts (`@terra/contracts`)**: command & event Zod schemas, reject codes, and byte-stable codegen (`npm run gen:check`).
  2. **Shared Sim (`@terra/sim`)**: **One Rule, One Function (`D-31`, `D-37`)** — placement (`evaluatePlacement`), costs, eligibility (`dispatch/eligibility.ts`), progressive queue payment (`D-42`), and solar clock (`systems/time`) live once in `@terra/sim` and are called by both server and client ghost/preview; hidden layers (`FieldDef.hidden`) stripped via `forClient: true`.
  3. **Backend Server (`backend/app`)**: WS command ingress, authoritative `PlanetHost` tick thread, Postgres snapshot/ledger/outbox persistence, port/mock adapters, and REST/dev routes.
  4. **Frontend Client (`frontend/game`, `frontend/render`)**: command dispatch (client never mutates world state directly), optimistic prediction + server reconciliation, replica store selectors, Faction Plate `--ta-*` CSS tokens (no raw hex, no `border-radius`), and 3D kitbash/particle/shader visuals.
- Verify **Dual-Host Parity**: every gameplay flow must work identically on the online server (`?scenario=wNN`) AND the browser-only local host (`?host=local&scenario=wNN`), guarded by `npm run test:parity`.

### Pillar 6 — Full Test Pyramid Coverage (Unit + Integration + Backend E2E) & Positive / Negative / Corner Cases
- **Every Major Feature MUST Be Covered by BOTH Unit Tests AND Integration Tests**:
  - **Unit Tests (`*.spec.ts`)**: every major feature (`shared/sim/src/systems/<feature>/`, `backend/app/src/<domain>/`, `frontend/game/features/<feature>/`, `frontend/game/pages/<page>/`, `shared/ledger/src/`) must have dedicated unit tests covering its pure logic, evaluators, services, stores, and components.
  - **Integration Tests (`*.int.spec.ts` / multi-module integration specs)**:
    - **Backend (`backend/app/src/<domain>/`)**: must have `*.int.spec.ts` (real Postgres via `@terra/db/testing` or `createApp()`), `*.contract.spec.ts` (port contracts), or multi-module HTTP/WS/`PlanetHost` integration specs. Any backend domain that executes Prisma/DB queries (`prisma.*`, `$transaction`) MUST have a `*.int.spec.ts` file.
    - **Shared Sim (`shared/sim/src/systems/<feature>/`)**: must have multi-tick `SimHost` / `step(` / `createRegistryPipeline` / command-dispatch / snapshot round-trip / scenario (`tests/scenarios/test/`) / parity (`tests/e2e/parity/`) integration tests — never isolated helper unit tests alone.
    - **Frontend (`frontend/game/`)**: must have integration tests wiring `OnlineSession` / `ReplicaStore` / `CommandBus` / DOM events and wave E2E coverage.
  - **Backend End-to-End (E2E) Coverage (`tests/e2e/wNN.spec.ts`)**:
    - Whenever `backend/app/src/` is touched, `tests/e2e/wNN.spec.ts` MUST exercise the online backend server end-to-end (`loadScenario`, `sendSimCmd`, `devConsole`, HTTP `/v1/*` routes, WS state deltas, DB persistence, and server-backed pages) — never local-only or skipped on the server host.
- **Mandatory Positive, Negative & Corner/Boundary Cases in Every Suite**:
  - **Positive cases (happy path)**: valid inputs, expected state transitions, successful command execution, and normal UI/API flows.
  - **Negative cases (rejection & error paths)**: invalid/malformed inputs, unauthorized/unseated/wrong-owner calls (`401`/`403`/`404`/`409`), command rejections (`ok: false`, `rejectReason`), insufficient resources/power/cap, disabled wave flags (`wave_disabled`, `?waves=..<prev>`), and transaction rollback on error.
  - **Corner / boundary cases (edge conditions)**: `0` / empty / `-1` / exact threshold & cap boundaries (`cap - 1`, `cap`, `cap + 1`), clamping, duplicate/idempotent replay, concurrent calls (`Promise.all`), mid-progress cancel/disconnect/reconnect, brownout/zero-cell transitions, and snapshot serialize/restore round-trips.
  - Every `it(...)` / `test(...)` block must contain real assertions (`expect(...)` / `assert*`).

### Pillar 7 — Mandatory 2-Iteration Review & Fix Protocol
Do NOT stop after a single pass. Execute two complete iterations in sequence:
1. **ITERATION 1 (Deep Audit, Gap Closure, Service/Orchestrator Refactor, Test Pyramid & Fix Pass):**
   - Run `npm run validate:wave -- <NN>` and audit the full wave diff against the wave task & specs.
   - Fix all functional gaps, client/server wiring issues, duplications, and orchestrator/service split violations directly in code.
   - Add any missing unit tests, integration tests (`*.int.spec.ts`, `SimHost`/pipeline specs), backend E2E tests (`tests/e2e/wNN.spec.ts`), and missing negative or corner/boundary test cases, then run all gates until 100% green.
2. **ITERATION 2 (Cold-Eye Re-Audit, Second-Order Regression Sweep & Final Verification):**
   - Reset assumptions and re-audit the post-Iteration-1 branch from scratch (`npm run validate:wave -- <NN> --gates` + `git diff main...HEAD`).
   - Scrutinize every file modified in Iteration 1 for newly introduced regressions, broken imports, uncleaned listeners, client-prediction vs server-authority edge cases, missing negative/corner test cases, or residual code smells.
   - Fix all Iteration 2 findings, update `docs/plan/checks/wNN-check.md`, `docs/dev/DEV_TOOLS.md`, and `docs/questions-and-limitations/<area>.md`, and re-run all automated gates (`npm run ci:fast`, `npm run test:integration`, `npm run test:contract`, `npm run test:parity`, `npm run validate:models -- --all`, `npm run validate:particles -- --all`, `npm run e2e -- --waves ..<NN> --hack`) until 0 errors and 0 warnings remain.

### Final Summary Format
Provide a concise, structured summary with:
1. **Wave Task vs Implementation Matrix** (Goal, Features, Issues `WNN-01..XX`, Demo Story steps → Status)
2. **Iteration 1 Findings & Fixes** (gaps, bugs, duplications, test pyramid additions, and refactors completed in Pass 1)
3. **Iteration 2 Cold-Eye Findings & Fixes** (second-order edge cases, parity fixes, and polish completed in Pass 2)
4. **Architecture & Service/Orchestrator Split Map** (how new logic is divided across thin orchestrators and focused services/parts)
5. **Client ↔ Server ↔ Shared Sim & Test Pyramid Matrix** (per-feature Unit + Integration + Backend E2E coverage, plus Positive / Negative / Corner case counts)
6. **Automated Gate Results & Owner Check Guide Readiness**
```

---

## 2. CLI Commands & Harness Modes

```bash
# 1. Fast static, AST duplication, orchestrator/service split, test-pyramid & task-parity audit on wave NN:
npm run validate:wave -- 02
npm run validate:wave -- 02 --strict          # also fail exit code on warnings
npm run validate:wave -- 02 --json            # machine-readable JSON report (includes testPyramid metrics)

# 2. Full static audit + automated test & domain gates (ci:fast, test:parity, test:integration, test:contract, validate:models, validate:particles, e2e):
npm run validate:wave -- 02 --gates
npm run validate:wave -- 02 --gates --e2e

# 3. Print the wave-specific Extended 2-Iteration Validation Prompt (with live pre-audit findings embedded):
npm run wave:validate -- 02 --print-prompt

# 4. Launch the wave's AI runner (claude / agy / grok) in the wave worktree to execute the 2-iteration loop,
#    then automatically verify post-validation gates:
npm run wave:validate -- 02
npm run wave:validate -- 02 --rounds 2        # spawn 2 sequential fresh-context runner sessions + final gate check

# 5. Run the validator self-test suite (synthetic good/bad fixtures + wave sandbox tests):
npm run test:wave:validator
npm run test:wave
```

---

## 3. What the Automated Validator Checks

| Code | Severity | Pillar | Meaning | Typical Fix |
| :--- | :--- | :--- | :--- | :--- |
| `ISSUES_INCOMPLETE` | error | Task Parity | One or more in-scope `WNN-XX` issues have not been merged into the wave branch | Build and merge remaining issues with commit subject `WNN-XX: <title>` |
| `MISSING_SCENARIO` | error | Task Parity | Wave scenario `tests/scenarios/wNN-*.ts` declared in the wave header is missing | Create the deterministic seed scenario for `wNN` |
| `MISSING_E2E` | warn | Task Parity | Wave E2E spec `tests/e2e/wNN.spec.ts` is missing | Add Playwright E2E covering the wave's demo story and `@hack` slice |
| `MISSING_BACKEND_E2E` | error | Test Pyramid | Wave modifies `backend/app/src/` code, but `tests/e2e/wNN.spec.ts` is missing or does not test the online backend server end-to-end | Add/update `tests/e2e/wNN.spec.ts` to exercise the online server (`loadScenario`, `sendSimCmd`, `/v1/*` routes, WS deltas, persistence) |
| `MISSING_FEATURE_UNIT_TESTS` | error | Test Pyramid | Major feature touched in `shared/sim/`, `backend/app/src/`, `frontend/game/`, or `shared/ledger/` has 0 unit test files (`*.spec.ts`) | Add unit tests covering the feature's functions, services, and components |
| `MISSING_FEATURE_INTEGRATION_TESTS` | error | Test Pyramid | Major feature has unit tests only and lacks integration tests (`*.int.spec.ts` for backend DB/HTTP/WS, `SimHost`/`step` pipeline specs for sim, or store/session/E2E wiring for frontend) | Add `*.int.spec.ts` (using `@terra/db/testing` / `createApp`), multi-tick `SimHost` integration specs, or client store/session integration specs |
| `MISSING_NEGATIVE_TESTS` | error / warn | Test Cases | Feature test suite (`error`) or standalone spec file (`warn`) tests only positive happy paths with 0 negative/rejection/error cases | Add negative cases: invalid inputs, rejected commands (`ok: false`), `401`/`403`/`404`/`409`, insufficient resources, `wave_disabled` |
| `MISSING_CORNER_CASE_TESTS` | error / warn | Test Cases | Feature test suite (`error`) or standalone spec file (`warn`) has 0 boundary/corner test cases | Add corner/boundary cases: `0`/empty/max cap limits, duplicate/idempotent replay, concurrency (`Promise.all`), cancel/rollback, snapshot round-trip |
| `TEST_WITHOUT_ASSERTION` | warn | Test Cases | An `it(...)` / `test(...)` block has no `expect(...)` or `assert*` verification | Add explicit assertions verifying state, output, DOM, or error rejection |
| `MISSING_OWNER_GUIDE` | warn | Task Parity | `docs/plan/checks/wNN-check.md` has not been written yet | Play the demo on the worktree's stack and write `wNN-check.md` |
| `INCOMPLETE_OWNER_GUIDE` | warn | Task Parity | `wNN-check.md` is missing `Before you start`, `Automated checks`, or `npm run wave -- land NN` | Complete all required sections per `docs/plan/checks/README.md` |
| `OWNED_PATH_DRIFT` | warn | Architecture | Modified files fall outside the wave's declared **Owned paths** and standard shared lead paths | Verify cross-track edits are allowed by the wave spec or revert unintended changes |
| `DEV_TOOLS_UNDOCUMENTED` | warn | Docs Parity | New `?param=` URL query parameter used in `frontend/` is missing from `docs/dev/DEV_TOOLS.md` | Document new URL parameters, console commands, and env vars in `docs/dev/DEV_TOOLS.md` |
| `CONTRACT_UNWIRED_SIM` | error | Client+Server | Command literal declared in `shared/contracts/src/commands/` is never handled in `shared/sim/src/` | Wire the command handler in `shared/sim/src/systems/` (`D-31`) |
| `CONTRACT_UNWIRED_CLIENT_SERVER` | warn | Client+Server | Command literal declared in `shared/contracts/src/commands/` has no caller/handler in `frontend/` or `backend/` | Connect client command dispatch and/or backend ingress |
| `DUPLICATE_FUNCTION` | warn | Duplication | Two functions (≥ 55 AST tokens, ≥ 7 lines) have identical normalized syntax trees | Extract a single shared function, service, or registry helper |
| `DUPLICATE_BLOCK` | warn | Duplication | A ≥ 10-line normalized code block is duplicated across files | Extract shared logic into a reusable helper or service (`AGENTS.md` §6) |
| `GOD_ORCHESTRATOR` | warn | Clean Arch | Large module (> 360 lines with ≥ 12 functions, or ≥ 10 class methods) does not delegate to `parts/` or `services/` | Split into a thin orchestrator + focused single-purpose services/parts |
| `FEATURE_CROSS_IMPORT` | warn | Clean Arch | `frontend/game/features/<A>/` directly imports sibling feature `frontend/game/features/<B>/` | Move shared state/types to `frontend/game/core/` or `shared/*` |
| `FILE_OVER_LIMIT` | error | Clean Arch | File exceeds 500 lines | Extract cohesive services/parts (`npm run check:structure`) |
| `FILE_NEAR_LIMIT` | warn | Clean Arch | Production code file exceeds 440 lines (approaching 500-line hard limit) | Proactively split orchestrator and service/part modules |
| `FUNC_OVER_LIMIT` | error | Clean Arch | Function/method/closure exceeds 100 lines | Extract helper functions or service methods |
| `FUNC_NEAR_LIMIT` | warn | Clean Arch | Function/method/closure exceeds 80 lines (approaching 100-line hard limit) | Decompose into smaller single-purpose steps |
| `DEEP_NESTING` | warn | Clean Arch | Function has control-flow nesting depth > 4 (and > 25 lines) | Use early returns / guard clauses or extract inner branch handlers |
| `SWALLOWED_ERROR` | warn | Hygiene | Empty `catch {}` block with no comment, log, or rethrow | Rethrow, return a typed reject/failure, log with context, or document why ignoring is safe |
| `UNVALIDATED_BOUNDARY_ANY` | warn | Hygiene | Explicit `any` in `shared/contracts/`, `shared/sim/`, or `backend/app/src/` | Use a concrete type or `unknown` parsed through a Zod schema |
| `RAW_HEX_UI_TOKEN` | warn | UI Tokens | Raw `#rrggbb` hex colour in `frontend/{game,landing,playground}/**/*.css` | Use Faction Plate `--ta-*` tokens from `frontend/design/css/tokens.css` |
| `UNTRACKED_TODO` | warn | Hygiene | `TODO` or `FIXME` comment without a `WNN-XX` or limitation ID (`GP-NN`, `XC-NN`) | Resolve the TODO now or tag it with an issue ID and `docs/questions-and-limitations/` entry |
| `SECRET_SHAPE` | error | Security | Private key header or live API token pattern in source file | Remove immediately and read secrets from environment variables only |
| `GATE_FAILED` | error | Gates | One of the automated test or validator gates (`ci:fast`, `test:parity`, `test:integration`, `test:contract`, `validate:models`, `validate:particles`, `e2e`) failed | Run the failing gate command and fix all errors |

---

## 4. Where It Fits in the Wave Lifecycle

| Step | Command / Skill | Purpose |
| :--- | :--- | :--- |
| 1. Open & Build Issues | `npm run wave` / `npm run wave:issue -- WNN-XX` | Build each issue in its isolated worktree and merge into `wave/wNN-<slug>` |
| 2. **Pre-Landing 2-Iteration Validation** | **`npm run validate:wave -- NN`**<br>**`npm run wave:validate -- NN`**<br>(`wave-landing-validator`) | **Audit wave task parity, enforce full Test Pyramid coverage (unit + integration per major feature + backend E2E + positive/negative/corner cases), eliminate duplication, enforce orchestrator/service split, verify client+server+sim wiring, and iterate 2 full passes until all gates are 100% green** |
| 3. Owner Check | `npm run wave:check -- NN` | Print `docs/plan/checks/wNN-check.md` and worktree URLs for manual playtest |
| 4. Land & Propagate | `npm run wave:land -- NN`<br>(`wave-land-and-sync`) | 3-iteration merge reconciliation with `main`, tag `wave-NN`, push, and propagate self-review extensions to future waves |
