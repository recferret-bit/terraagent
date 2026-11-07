// Full pre-landing wave validation harness & 2-iteration review/fix loop (`npm run validate:wave`, `npm run wave:validate`).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fail, out, tryOut } from './sh.mjs';
import { waveProgress, waveTitle } from './plan.mjs';
import { ensureWorktreeEnv } from './isolation.mjs';
import { resolvePreset, buildRunnerCommand, GROK_CONTEXT_WINDOW } from './prompt.mjs';
import { analyzeWaveFiles } from './audit-ast.mjs';
import { auditWaveTaskAndWiring } from './audit-wave.mjs';
import { auditWaveTestPyramid } from './audit-tests.mjs';

const pad = (n) => String(n).padStart(2, '0');

function runGateStep(cwd, label, cmd, args) {
  console.log(`$ ${[cmd, ...args].join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return { label, command: `${cmd} ${args.join(' ')}`, ok: r.status === 0, status: r.status ?? 1 };
}

function executeValidationGates(cwd, waveNumber, {
  e2e = false,
  touchedModels = false,
  touchedParticles = false,
  touchedSimOrClient = false,
  touchedBackend = false,
} = {}) {
  if (process.env.TA_WAVE_GATES) {
    const r = runGateStep(cwd, 'custom-gates', 'sh', ['-c', process.env.TA_WAVE_GATES]);
    return [r];
  }
  const results = [];
  results.push(runGateStep(cwd, 'ci:fast (check + unit tests + build)', 'npm', ['run', 'ci:fast']));
  if (touchedSimOrClient) {
    results.push(runGateStep(cwd, 'test:parity (sim/client dual-host parity)', 'npm', ['run', 'test:parity']));
  }
  if (touchedBackend && e2e) {
    results.push(runGateStep(cwd, 'test:integration (*.int.spec.ts)', 'npm', ['run', 'test:integration']));
    results.push(runGateStep(cwd, 'test:contract (port contracts)', 'npm', ['run', 'test:contract']));
  }
  if (touchedModels) results.push(runGateStep(cwd, 'validate:models', 'npm', ['run', 'validate:models', '--', '--all', '--quiet']));
  if (touchedParticles) results.push(runGateStep(cwd, 'validate:particles', 'npm', ['run', 'validate:particles', '--', '--all', '--quiet']));
  if ((e2e || touchedBackend) && e2e && waveNumber != null) {
    results.push(runGateStep(cwd, `e2e (..${pad(waveNumber)})`, 'npm', ['run', 'e2e', '--', '--waves', `..${pad(waveNumber)}`, '--hack']));
  }
  return results;
}

export function runWaveValidation(root, wave, {
  cwd = existsSync(wave.worktree) ? wave.worktree : root,
  tags = ['H'],
  baseRef = 'main',
  gates = false,
  e2e = false,
} = {}) {
  const rawProgress = waveProgress(wave, tags);
  const progress = wave.landed && !wave.open
    ? { total: rawProgress.total, done: rawProgress.total, remaining: [], complete: true }
    : rawProgress;
  const taskAudit = auditWaveTaskAndWiring(root, cwd, wave, { progress, baseRef });
  const astAudit = analyzeWaveFiles(cwd, taskAudit.changedFiles);
  const testAudit = auditWaveTestPyramid(cwd, wave, taskAudit.changedFiles);
  const issues = [...taskAudit.issues, ...astAudit.issues, ...testAudit.issues];

  const gateResults = gates
    ? executeValidationGates(cwd, Number(wave.id.slice(1)), {
      e2e,
      touchedModels: taskAudit.touchedModels,
      touchedParticles: taskAudit.touchedParticles,
      touchedSimOrClient: testAudit.touchedSimOrClient,
      touchedBackend: testAudit.touchedBackend,
    })
    : [];

  for (const g of gateResults) {
    if (!g.ok) {
      issues.push({
        code: 'GATE_FAILED',
        severity: 'error',
        file: wave.file,
        line: 1,
        message: `Automated gate '${g.label}' failed (${g.command}, exit ${g.status}).`,
        fix: `Run '${g.command}' in ${cwd} and fix all failing checks or tests.`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warn').length;
  return {
    waveId: wave.id,
    branch: wave.branch,
    cwd,
    progress,
    changedFilesCount: taskAudit.changedFiles.length,
    filesAnalyzed: astAudit.filesAnalyzed,
    touchedModels: taskAudit.touchedModels,
    touchedParticles: taskAudit.touchedParticles,
    touchedBackend: testAudit.touchedBackend,
    testPyramid: testAudit.testPyramid,
    demoStepsCount: taskAudit.spec.demoSteps.length,
    gateResults,
    errors,
    warnings,
    pass: errors === 0,
    issues,
  };
}

export function formatWaveValidationReport(report, { quiet = false } = {}) {
  const status = report.pass ? (report.warnings > 0 ? 'PASS (with warnings)' : 'PASS ✔') : 'FAIL ✖';
  const header = `${report.waveId} [${report.branch}] — ${status} · ${report.progress.done.length}/${report.progress.total.length} issues merged · ${report.changedFilesCount} files changed · ${report.errors} errors, ${report.warnings} warnings`;
  if (quiet) return header;

  const lines = [header];
  if (report.testPyramid) {
    const tp = report.testPyramid;
    const beStatus = report.touchedBackend ? (tp.backendE2eOk ? ' · backend E2E ✔' : ' · backend E2E ✖') : '';
    lines.push(
      `  Test Pyramid: ${tp.unitCoveredFeatures}/${tp.majorFeatures} features unit-tested · ` +
      `${tp.integrationCoveredFeatures}/${tp.majorFeatures} integration-tested${beStatus} · ` +
      `cases (+pos / -neg / ◇corner): +${tp.positiveCases} / -${tp.negativeCases} / ◇${tp.cornerCases}`,
    );
  }
  if (report.issues.length > 0) {
    lines.push('');
    for (const issue of report.issues) {
      const icon = issue.severity === 'error' ? '✖ ERROR' : '⚠ WARN ';
      lines.push(`  ${icon} [${issue.code}] ${issue.file}:${issue.line} — ${issue.message}`);
      if (issue.fix) lines.push(`          fix: ${issue.fix}`);
    }
  }
  if (report.gateResults.length > 0) {
    lines.push('\n  Gates:');
    for (const g of report.gateResults) {
      lines.push(`    ${g.ok ? '✔' : '✖'} ${g.label}: ${g.command}`);
    }
  }
  return lines.join('\n');
}

function formatAuditLeadsBlock(report) {
  if (!report || report.issues.length === 0) {
    return 'Static pre-audit (`npm run validate:wave`) found 0 immediate structural/wiring issues; perform a deep semantic review of all changed files.';
  }
  const items = report.issues.slice(0, 15).map(
    (i) => `- [${i.severity.toUpperCase()} · \`${i.code}\`] \`${i.file}:${i.line}\` — ${i.message} (Fix: ${i.fix})`,
  );
  if (report.issues.length > 15) items.push(`- …and ${report.issues.length - 15} more (run \`npm run validate:wave -- ${report.waveId.slice(1)}\` for full list).`);
  return `Pre-detected static/wiring findings to resolve in Iteration 1:\n${items.join('\n')}`;
}

function validationPillarsText(w, nn, prevNn) {
  return `## Mandatory 6-Pillar Audit Checklist (Best Practices Across All Projects)

1. **Wave Task, Spec & Acceptance Criteria Parity (\`${w.file}\`):**
   - Compare \`git diff main...${w.branch}\` and \`git log main..${w.branch}\` against every section of \`${w.file}\`: **Goal**, **Features covered**, every in-scope **Issue row** (\`${w.id}-01..\`) and its exact \`"do X → see Y"\` acceptance criterion, **Demo story** steps, and **Hackathon slice** (\`@hack\`).
   - Verify **Wave Flag Fencing**: with \`TA_WAVES=..${prevNn}\` / \`?waves=..${prevNn}\`, zero UI chrome, menus, commands, or systems from ${w.id} may leak through; disabled-wave commands must reject with \`wave_disabled\`.
   - Check **Owned Paths**: verify changes stay within ${w.id}'s declared **Owned paths** (or documented lead pre-steps).

2. **Functional Gaps, Edge Cases, Determinism & Error Hygiene:**
   - Hunt for partial stubs, unimplemented edge cases, off-by-one/tick-rate (\`dt\`) bugs, snapshot/restore round-trip loss, reconnect/delta desyncs, and race conditions.
   - **No swallowed errors**: never leave empty \`catch {}\` blocks; every catch must rethrow, return a typed reject/failure code, or log with structured context.
   - **Boundary validation**: parse external/wire inputs (WS messages, HTTP bodies/queries, CLI/LLM payloads, storage snapshots) through \`@terra/contracts\` Zod schemas; eliminate unvalidated \`any\` at boundaries.
   - **Sim purity & movement invariants (\`SIM-D-06\`, \`SIM-M-01\`)**: \`shared/sim/src/\` must stay 100% synchronous and deterministic (no \`Date\`, \`Math.random\`, engine-dependent trig, timers, or locale methods), and only \`locomotion.ts\` (or \`placeSpawnedEntity\` / \`adminRelocateEntity\`) may write entity \`x/y/q/r\`.

3. **Code Duplication & Data-Driven Registries (DRY):**
   - Scan all new and touched files for copy-pasted functions, duplicated validation/math blocks, repeated DOM builders, and hardcoded balance numbers outside \`shared/sim/src/data/\` (D-35).
   - **Second copy = extract**: consolidate duplicated logic into shared helpers, base abstractions (\`StageHost\`), or open registries (\`KitbashRegistry\`, \`ParticlePresetRegistry\`, \`BiomeMaterialRegistry\`, sim system registries, client feature auto-discovery) instead of \`if/else\` ladders.

4. **Clean Architecture & Orchestrator / Service Split (AGENTS.md §6):**
   - **Orchestrators compose; Services & Parts do the work**:
     - Orchestrators (\`*Runner\`, \`*App\`, \`*Stage\`, \`*Module\`, \`*Host\`, sim system \`index.ts\` pipelines) must be thin composition roots that wire lifecycle, route commands/events, and coordinate flow.
     - Move domain calculations, placement/rule evaluation, sub-stage rendering, and UI panel construction into focused single-purpose modules under \`parts/\`, \`services/\`, \`stages/\`, \`panels/\`, \`sections/\`, or \`handlers/\`.
   - **Strict Layering & Size Limits**:
     - Every file ≤ 500 lines (aim ≤ 400), every function/method/closure ≤ 100 lines (aim ≤ 60, control-flow nesting ≤ 3). Fix by extracting cohesive modules, never by compressing lines.
     - Inward dependency arrows: \`shared/*\` imports no \`frontend/\` or \`backend/\`; \`frontend/render/\` imports no app and no \`@terra/sim\` internals (except hex/sector geometry); apps never import other apps; \`frontend/game/features/*\` never cross-import sibling features; backend modules depend on abstract \`*Port\` interfaces, never concrete \`adapters/\`.

5. **Client + Server + Shared Sim End-to-End Integration:**
   - Trace every new feature across all four layers:
     1. **Contracts (\`@terra/contracts\`)**: command & event Zod schemas, reject codes, and byte-stable codegen (\`npm run gen:check\`).
     2. **Shared Sim (\`@terra/sim\`)**: **One Rule, One Function (D-31 / D-37)** — placement, costs, eligibility, and game rules live once in \`@terra/sim\` and are called by both server and client ghost/preview; hidden fields (\`FieldDef.hidden\`) stripped via \`forClient: true\`.
     3. **Backend Server (\`backend/app\`)**: WS ingress routing, authoritative \`PlanetHost\` sim thread, Postgres snapshot/ledger/outbox persistence, port/mock adapters, and dev routes.
     4. **Frontend Client (\`frontend/game\`, \`frontend/render\`)**: command dispatch (client never mutates world state directly), optimistic prediction + server reconciliation, replica store selectors, Faction Plate \`--ta-*\` CSS tokens (no raw hex or \`border-radius\`), and 3D kitbash/particle/shader visuals.
   - Verify **Dual-Host Parity**: new gameplay logic must work identically on the online server (\`/play.html?scenario=w${nn}\`) AND the browser-only local host (\`/play.html?host=local&scenario=w${nn}\`).

6. **Full Test Pyramid Coverage (Unit + Integration + Backend E2E) & Positive / Negative / Corner Cases:**
   - **Every major feature MUST be covered by BOTH Unit Tests AND Integration Tests**:
     - **Unit tests (\`*.spec.ts\`)**: test every pure function, evaluator, service, store, and UI component in isolation.
     - **Integration tests**:
       - For \`backend/app/src/<domain>/\`: require \`*.int.spec.ts\` (real Postgres via \`@terra/db/testing\` or \`createApp()\`), \`*.contract.spec.ts\`, or multi-module HTTP/WS/PlanetHost integration specs.
       - For \`shared/sim/src/systems/<feature>/\`: require multi-tick \`SimHost\` / \`step(\` / \`createRegistryPipeline\` / command-dispatch / snapshot round-trip / scenario / parity integration specs (never pure-function unit tests alone).
       - For \`frontend/game/\`: require store/session/DOM/command-bus integration specs and wave E2E coverage.
     - **Backend E2E Requirement**: whenever \`backend/app/src/\` is touched, \`tests/e2e/w${nn}.spec.ts\` MUST test the online backend server end-to-end (\`loadScenario\`, \`sendSimCmd\`, \`/v1/*\` HTTP routes, WS deltas, persistence, and server-backed pages — never local-only or skipped on server).
   - **Mandatory Positive, Negative & Corner/Boundary Cases**:
     - **Positive cases**: valid inputs, expected state transitions, happy-path command execution, and UI updates.
     - **Negative cases**: invalid/malformed inputs, unauthorized/unseated/wrong-owner requests (\`401\`/\`403\`/\`404\`/\`409\`), command rejections (\`ok: false\`, \`rejectReason\`), insufficient resources/power/cap, disabled wave flags (\`wave_disabled\`, \`?waves=..${prevNn}\`), and error/rollback paths.
     - **Corner / boundary cases**: \`0\` / empty / negative / max cap & threshold edges (\`cap - 1\`, \`cap\`, \`cap + 1\`), duplicate/idempotent replay, concurrent calls (\`Promise.all\`), mid-progress cancel/disconnect/reconnect, brownout/zero-cell transitions, and snapshot/restore round-trips.
   - If any 3D model or particle preset changed, run \`npm run validate:models -- --all\` and \`npm run validate:particles -- --all\` (0 errors, 0 warnings) and verify the 4 diagnostic views in \`/playground.html\`.`;
}

function validationIterationsText(w, nn, prevNn) {
  return `## Mandatory 2-Iteration Execution Loop

You MUST execute **two complete review-and-fix iterations** in order. Do not stop after Iteration 1.

### 🔄 ITERATION 1 — Deep Audit, Gap Closure, Service/Orchestrator Split, Test Pyramid & Fix Pass
1. Run \`npm run validate:wave -- ${nn}\` and inspect \`git diff main...${w.branch}\` against \`${w.file}\`.
2. Enumerate every functional gap, missing acceptance criterion, client/server wiring bug, code duplication, orchestrator/service split violation, and missing test pyramid layer (unit, integration, backend E2E, or missing positive/negative/corner cases) across the wave.
3. **Fix all of them directly in code**: implement missing behavior, refactor fat orchestrators into thin orchestrators + focused services/parts, extract duplicated blocks/functions, fix boundary/error handling, and ensure every major feature has **unit tests + integration tests + backend E2E** covering **positive, negative, and corner cases**.
4. Run the verification suite (\`npm run validate:wave -- ${nn}\`, \`npm run check\`, \`npm test\`, \`npm run test:integration\`, \`npm run test:contract\`, \`npm run test:parity\`, \`npm run build\`, \`npm run e2e -- --waves ..${nn} --hack\`) and fix all failures until green. Commit your Iteration 1 fixes cleanly on \`${w.branch}\`.

### 🔄 ITERATION 2 — Cold-Eye Re-Audit, Second-Order Regression Sweep & Final Polish
1. **Reset your assumptions** and review the post-Iteration-1 codebase with a cold eye, as if auditing someone else's pull request from scratch.
2. Re-run \`npm run validate:wave -- ${nn} --gates\` and inspect the full diff (\`git diff main...${w.branch}\`), paying special attention to code touched in Iteration 1:
   - Did Iteration 1's refactoring introduce any subtle regressions, broken imports, uncleaned listeners, or edge-case desyncs between client prediction and server authority?
   - Does every major feature have both unit and integration tests, is the backend tested end-to-end in \`tests/e2e/w${nn}.spec.ts\`, and does every test file include positive, negative, and corner/boundary cases?
   - Are there any remaining functions > 75 lines, files > 420 lines, residual copy-paste blocks, raw hex colours in CSS, or undocumented dev tools?
   - Does every step of the Demo Story in \`${w.file}\` work smoothly end-to-end on both online and \`?host=local\` (where applicable) and with \`?waves=..${prevNn}\`?
3. Fix every issue, edge case, or warning uncovered in Iteration 2.
4. Update documentation in the same commit:
   - Write or update the **owner check guide** \`docs/plan/checks/w${nn}-check.md\` (following \`docs/plan/checks/README.md\`: worktree ports from \`infra/.env.worktree\`, how to start/stop, exact URL/console/click steps matching \`${w.file}\`, automated checks, and \`npm run wave -- land ${nn}\`).
   - Document any new URL parameters, dev console commands, dev pages, or env variables in \`docs/dev/DEV_TOOLS.md\`.
   - Record any knowingly deferred items, deliberate trade-offs, or open owner questions in \`docs/questions-and-limitations/<area>.md\` (AGENTS.md §5).
5. Re-run \`npm run validate:wave -- ${nn} --gates --e2e\` so all static checks, unit/integration/contract/parity tests, build, and wave E2E suites pass with 0 errors. Commit any final Iteration 2 changes on \`${w.branch}\`.

---

## Required Final Output Summary

Conclude with a clear, structured **Wave ${w.id} Pre-Landing Validation Summary** containing:
1. **Wave Task vs Implementation Matrix:** table of ${w.id} features, issues (\`${w.id}-01..\`), and demo story steps with verification status.
2. **Iteration 1 Findings & Fixes:** bulleted list of functional gaps, bugs, duplications, and architectural issues found and fixed in Pass 1.
3. **Iteration 2 Cold-Eye Findings & Fixes:** second-order issues, edge cases, client/server parity fixes, and polish applied in Pass 2.
4. **Architecture & Service/Orchestrator Split:** how new logic is organized across thin orchestrators and focused services/parts/registries.
5. **Client + Server + Shared Sim Parity & Test Pyramid Matrix:** confirmation of contracts → sim → backend (\`PlanetHost\`/WS/DB) → client (online + \`?host=local\`) wiring, plus per-feature Unit + Integration + Backend E2E coverage and Positive / Negative / Corner case counts.
6. **Automated Gate Results & Owner Check Guide:** exact commands run with pass counts, new \`docs/questions-and-limitations/\` entries recorded, and the complete \`docs/plan/checks/w${nn}-check.md\` guide.`;
}

export function waveValidationPrompt(w, title, { preset, progress, report = null, round = null } = {}) {
  const nn = w.id.slice(1);
  const prevNn = pad(Math.max(0, Number(nn) - 1));
  const roundBanner = round ? ` ( Pass ${round} of 2 )` : '';
  const skillsLine = [
    '.agents/skills/wave-landing-validator/SKILL.md',
    ...(preset?.skills ?? []).map((s) => `.agents/skills/${s}/SKILL.md`),
  ].map((s) => `\`${s}\``).join(', ');

  return `You are conducting the **Full Pre-Landing Wave Validation${roundBanner}** for wave ${w.id} — ${title} — on branch \`${w.branch}\`.

We made a large amount of changes in this wave. Your mission is to **fully review the entire implementation, compare it against the initial wave task and specs, pass all tests, find every possible issue and gap, and fix all of them**. You must eliminate code duplication and violations of clean and architectural principles, ensure all new logic is cleanly split across services and orchestrators, verify that all new logic works end-to-end across client + server + shared sim, and execute a strict **2-iteration review-and-fix protocol** before delivering your final summary.

Read first: ${skillsLine}, \`CLAUDE.md\`, \`AGENTS.md\` (§2 4 Pillars, §5 Questions & Limitations, §6 Frontend & Sim Architecture), \`docs/plan/PRODUCT_WAVES.md\` §3–§7, the wave task file \`${w.file}\`, every spec section and \`DECISIONS.md\` rule it cites, and \`docs/plan/OWNER_TASKS.md\`.

Wave status: ${progress.done.length}/${progress.total.length} in-scope issues merged (${progress.remaining.length ? `remaining: ${progress.remaining.join(', ')}` : 'all merged'}).
${formatAuditLeadsBlock(report)}

---

${validationPillarsText(w, nn, prevNn)}

---

${validationIterationsText(w, nn, prevNn)}`;
}

function runValidationRunnerSessions(root, wave, cwd, title, preset, initialReport, rounds) {
  const totalRounds = Math.max(1, Number(rounds) || 1);
  for (let r = 1; r <= totalRounds; r++) {
    const roundReport = r === 1 ? initialReport : runWaveValidation(root, wave, { cwd, tags: preset.tags, gates: false });
    const roundPrompt = waveValidationPrompt(wave, title, {
      preset,
      progress: roundReport.progress,
      report: roundReport,
      round: totalRounds > 1 ? r : null,
    });
    const { cmd, args: cmdArgs, env: extraEnv } = buildRunnerCommand(preset, roundPrompt, [dirname(cwd), root]);
    console.log(
      `\n▶ Validating ${wave.id} ${wave.slug}${totalRounds > 1 ? ` [Round ${r}/${totalRounds}]` : ' [2-Iteration Protocol]'} in ${cwd}` +
      ` — preset ${preset.label}${preset.runner === 'grok' ? ` (context=${GROK_CONTEXT_WINDOW})` : ''}`,
    );
    const res = spawnSync(cmd, cmdArgs, {
      cwd,
      stdio: 'inherit',
      env: extraEnv ? { ...process.env, ...extraEnv } : undefined,
    });
    if (res.error) fail(`could not start \`${cmd}\` (${res.error.message}); run with --no-launch and start it yourself`);
    if (res.status !== 0) fail(`validation runner exited with status ${res.status}`);
  }
}

export function validateWaveCli(root, wave, {
  overrides = {},
  dryRun = false,
  checkOnly = false,
  printPrompt = false,
  noLaunch = false,
  gates = false,
  e2e = false,
  strict = false,
  json = false,
  quiet = false,
  rounds = 1,
} = {}) {
  const preset = resolvePreset(wave, overrides);
  const cwd = existsSync(wave.worktree) ? wave.worktree : root;
  const title = waveTitle(root, wave);

  if (dryRun) {
    const modeDesc = checkOnly
      ? `run static & structural wave validation${gates ? ' + gates' : ''}`
      : `run pre-audit, launch ${preset.label} for 2-iteration wave validation (${rounds} session round${rounds === 1 ? '' : 's'}), then verify gates`;
    console.log(`would validate ${wave.id} (${wave.branch}) in ${cwd}: ${modeDesc}`);
    return 0;
  }

  if (wave.open && existsSync(wave.worktree)) {
    ensureWorktreeEnv(root, wave.worktree, wave.branch);
  }

  const report = runWaveValidation(root, wave, { cwd, tags: preset.tags, gates: checkOnly && gates, e2e });
  const failed = (rep) => !rep.pass || (strict && rep.warnings > 0);

  if (json && checkOnly && !printPrompt) {
    console.log(JSON.stringify(report, null, 2));
    return failed(report) ? 1 : 0;
  }

  if (!json) console.log(formatWaveValidationReport(report, { quiet }));

  const prompt = waveValidationPrompt(wave, title, { preset, progress: report.progress, report });
  if (printPrompt || noLaunch) {
    const { cmd, args: cmdArgs, env: extraEnv } = buildRunnerCommand(preset, prompt, [dirname(cwd), root]);
    const envPrefix = extraEnv ? `${Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`).join(' ')} ` : '';
    console.log(`\n# Runner command (${preset.label}):\ncd ${cwd} && ${envPrefix}${cmd} ${cmdArgs.slice(0, -1).join(' ')} "<prompt below>"\n\n${prompt}`);
    return checkOnly && failed(report) ? 1 : 0;
  }

  if (checkOnly) return failed(report) ? 1 : 0;
  if (!wave.open || !existsSync(wave.worktree)) {
    fail(`${wave.id} has no open worktree at ${wave.worktree}; run \`npm run wave:open -- ${wave.id.slice(1)}\` or pass \`--check-only\` / \`--print-prompt\`.`);
  }

  runValidationRunnerSessions(root, wave, cwd, title, preset, report, rounds);

  console.log(`\n▶ Running post-validation audit & gates for ${wave.id} in ${cwd}…`);
  if (!out('git', ['status', '--porcelain', '--untracked-files=no'], { cwd })) {
    tryOut('git', ['merge', '--no-edit', 'main'], { cwd });
  }
  const finalReport = runWaveValidation(root, wave, { cwd, tags: preset.tags, gates: true, e2e });
  console.log(formatWaveValidationReport(finalReport));
  if (failed(finalReport)) {
    fail(`${wave.id} post-validation check failed (${finalReport.errors} errors, ${finalReport.warnings} warnings)`);
  }
  return 0;
}
