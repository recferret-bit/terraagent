#!/usr/bin/env node
// Self-test for `wave-landing-validator` (`npm run test:wave:validator`).
// Proves every AST, duplication, clean-architecture, boundary-hygiene, and client+server wiring check
// catches known-bad fixtures and passes known-good fixtures, and verifies the 2-iteration prompt & CLI harness.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWaveFiles } from '../../../../scripts/wave/audit-ast.mjs';
import { expandBracePattern, parseWaveSpec, auditWaveTaskAndWiring } from '../../../../scripts/wave/audit-wave.mjs';
import { auditWaveTestPyramid } from '../../../../scripts/wave/audit-tests.mjs';
import { waveValidationPrompt, formatWaveValidationReport } from '../../../../scripts/wave/validate.mjs';
import { makeSandbox, openWaveBranch, git } from '../../../../scripts/wave/testkit.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'wave-validator-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRel(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

const cases = [];
const t = (name, fn) => cases.push({ name, fn });

t('clean orchestrator + service split passes with 0 AST issues', () => withTempDir((dir) => {
  writeRel(dir, 'frontend/game/features/solar-hud/services/calcNetPower.ts', [
    'export function calcNetPower(supply: number, demand: number): number {',
    '  return Math.max(0, supply) - Math.max(0, demand);',
    '}',
  ].join('\n'));
  writeRel(dir, 'frontend/game/features/solar-hud/SolarHudOrchestrator.ts', [
    "import { calcNetPower } from './services/calcNetPower';",
    'export class SolarHudOrchestrator {',
    '  update(supply: number, demand: number): number {',
    '    return calcNetPower(supply, demand);',
    '  }',
    '}',
  ].join('\n'));
  const res = analyzeWaveFiles(dir, [
    'frontend/game/features/solar-hud/services/calcNetPower.ts',
    'frontend/game/features/solar-hud/SolarHudOrchestrator.ts',
  ]);
  assert.equal(res.issues.length, 0, JSON.stringify(res.issues));
}));

t('catches DUPLICATE_FUNCTION across files even when local variables are renamed', () => withTempDir((dir) => {
  const makeFn = (fnName, v1, v2) => [
    `export function ${fnName}(items: number[], cap: number, scale: number) {`,
    `  let ${v1} = 0;`,
    `  for (let i = 0; i < items.length; i++) {`,
    `    const ${v2} = items[i] * scale;`,
    `    if (${v1} + ${v2} > cap) {`,
    `      ${v1} = cap;`,
    '    } else {',
    `      ${v1} += ${v2};`,
    '    }',
    '  }',
    `  return Math.floor(${v1});`,
    '}',
  ].join('\n');
  writeRel(dir, 'shared/sim/src/systems/a.ts', makeFn('computeAlpha', 'total', 'delta'));
  writeRel(dir, 'shared/sim/src/systems/b.ts', makeFn('computeBeta', 'acc', 'stepVal'));
  const res = analyzeWaveFiles(dir, ['shared/sim/src/systems/a.ts', 'shared/sim/src/systems/b.ts']);
  assert.ok(res.issues.some((i) => i.code === 'DUPLICATE_FUNCTION'), 'expected DUPLICATE_FUNCTION');
}));

t('catches DUPLICATE_BLOCK when >= 10 normalized code lines are copy-pasted', () => withTempDir((dir) => {
  const block = Array.from({ length: 11 }, (_, i) => `  const stepValue${i} = Math.max(0, inputVal + ${i + 10} * factor);`).join('\n');
  writeRel(dir, 'frontend/game/app/one.ts', `export function runOne(inputVal: number, factor: number) {\n${block}\n  return stepValue10;\n}`);
  writeRel(dir, 'frontend/game/app/two.ts', `export function runTwo(inputVal: number, factor: number) {\n${block}\n  return stepValue10;\n}`);
  const res = analyzeWaveFiles(dir, ['frontend/game/app/one.ts', 'frontend/game/app/two.ts']);
  assert.ok(res.issues.some((i) => i.code === 'DUPLICATE_BLOCK'), 'expected DUPLICATE_BLOCK');
}));

t('catches GOD_ORCHESTRATOR when a >360-line module has >=12 functions and 0 service/part delegations', () => withTempDir((dir) => {
  const fns = Array.from({ length: 13 }, (_, i) => {
    const body = Array.from({ length: 26 }, (__, j) => `  const v${j} = x + ${i * 100 + j};`).join('\n');
    return `export function helper${i}(x: number) {\n${body}\n  return v0;\n}`;
  }).join('\n\n');
  writeRel(dir, 'frontend/game/app/MonolithController.ts', fns);
  const res = analyzeWaveFiles(dir, ['frontend/game/app/MonolithController.ts']);
  assert.ok(res.issues.some((i) => i.code === 'GOD_ORCHESTRATOR'), 'expected GOD_ORCHESTRATOR');
}));

t('catches FEATURE_CROSS_IMPORT when one client feature imports another directly', () => withTempDir((dir) => {
  writeRel(dir, 'frontend/game/features/queue-panel/index.ts', "import { openBuild } from '../construction-menu/open';\nexport const x = openBuild;\n");
  const res = analyzeWaveFiles(dir, ['frontend/game/features/queue-panel/index.ts']);
  assert.ok(res.issues.some((i) => i.code === 'FEATURE_CROSS_IMPORT'), 'expected FEATURE_CROSS_IMPORT');
}));

t('catches SWALLOWED_ERROR, UNVALIDATED_BOUNDARY_ANY, RAW_HEX_UI_TOKEN, UNTRACKED_TODO, and SECRET_SHAPE', () => withTempDir((dir) => {
  writeRel(dir, 'backend/app/src/market/handler.ts', [
    '// TODO: wire slippage check later',
    'export function handleOrder(payload: any) {',
    '  try { JSON.parse(String(payload)); } catch (err) {}',
    '  const k = "-----BEGIN PRIVATE KEY-----";',
    '  return k;',
    '}',
  ].join('\n'));
  writeRel(dir, 'frontend/game/features/market/market.css', '.market-card { color: #ff6600; }\n');
  const res = analyzeWaveFiles(dir, [
    'backend/app/src/market/handler.ts',
    'frontend/game/features/market/market.css',
  ]);
  const codes = new Set(res.issues.map((i) => i.code));
  assert.ok(codes.has('UNTRACKED_TODO'), 'expected UNTRACKED_TODO');
  assert.ok(codes.has('UNVALIDATED_BOUNDARY_ANY'), 'expected UNVALIDATED_BOUNDARY_ANY');
  assert.ok(codes.has('SWALLOWED_ERROR'), 'expected SWALLOWED_ERROR');
  assert.ok(codes.has('SECRET_SHAPE'), 'expected SECRET_SHAPE');
  assert.ok(codes.has('RAW_HEX_UI_TOKEN'), 'expected RAW_HEX_UI_TOKEN');
}));

t('catches FILE_OVER_LIMIT, FUNC_OVER_LIMIT, and DEEP_NESTING', () => withTempDir((dir) => {
  const deepBody = [
    '  if (a > 0) {',
    '    for (let i = 0; i < a; i++) {',
    '      while (a > 1) {',
    '        if (i % 2 === 0) {',
    '          if (a > 2) {',
    ...Array.from({ length: 100 }, (_, k) => `            const line${k} = i + ${k};`),
    '          }',
    '        }',
    '        break;',
    '      }',
    '    }',
    '  }',
  ].join('\n');
  const padding = Array.from({ length: 405 }, (_, i) => `export const c${i} = ${i};`).join('\n');
  writeRel(dir, 'shared/sim/src/systems/oversized.ts', `export function huge(a: number) {\n${deepBody}\n}\n${padding}\n`);
  const res = analyzeWaveFiles(dir, ['shared/sim/src/systems/oversized.ts']);
  const codes = new Set(res.issues.map((i) => i.code));
  assert.ok(codes.has('FILE_OVER_LIMIT'), 'expected FILE_OVER_LIMIT');
  assert.ok(codes.has('FUNC_OVER_LIMIT'), 'expected FUNC_OVER_LIMIT');
  assert.ok(codes.has('DEEP_NESTING'), 'expected DEEP_NESTING');
}));

t('parseWaveSpec and expandBracePattern extract owned paths, scenario, demo steps, and issue rows', () => {
  const expanded = expandBracePattern('shared/sim/src/systems/{economy,queue}/');
  assert.deepEqual(expanded, ['shared/sim/src/systems/economy/', 'shared/sim/src/systems/queue/']);

  const spec = parseWaveSpec([
    '# W02 — First Light',
    '> **Track:** Spine · **Flag:** `W02` · **Scenario:** `tests/scenarios/w02-first-light.ts`',
    '> **Owned paths:**',
    '> - `shared/sim/src/systems/{economy,queue}/`',
    '## Demo story',
    '1. Open `/play.html?scenario=w02` → see resources.',
    '2. Queue Harvester → see in_progress.',
    '## Issues',
    '| ID | Title | Type | Size | H | Deps | Acceptance | Spec | Replaces |',
    '|---|---|---|---|---|---|---|---|---|',
    '| W02-01 | Contracts & data | contract | M | H | W01-01 | Run gen → see rows | econ | — |',
  ].join('\n'));

  assert.equal(spec.flag, 'W02');
  assert.equal(spec.scenario, 'tests/scenarios/w02-first-light.ts');
  assert.deepEqual(spec.ownedPaths, ['shared/sim/src/systems/economy/', 'shared/sim/src/systems/queue/']);
  assert.equal(spec.demoSteps.length, 2);
  assert.equal(spec.issueRows.length, 1);
  assert.equal(spec.issueRows[0].id, 'W02-01');
});

t('auditWaveTaskAndWiring catches unwired contracts, missing owner guide, and owned-path drift', () => withTempDir((dir) => {
  git(dir, 'init', '-b', 'main');
  writeRel(dir, 'docs/plan/waves/W02-first-light.md', [
    '# W02 — First Light',
    '> **Flag:** `W02` · **Scenario:** `tests/scenarios/w02-first-light.ts`',
    '> **Owned paths:**',
    '> - `shared/sim/src/systems/economy/`',
    '## Demo story',
    '1. Step one.',
  ].join('\n'));
  writeRel(dir, 'docs/dev/DEV_TOOLS.md', '# Dev Tools\nKnown params: `?scenario=`\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'base');
  git(dir, 'checkout', '-b', 'wave/w02-first-light');

  writeRel(dir, 'shared/contracts/src/commands/economy.ts', "export const Cmd = z.object({ kind: z.literal('OverchargeGrid') });\n");
  writeRel(dir, 'frontend/game/features/other/leak.ts', "const q = url.searchParams.get('undocFlag');\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'W02-01: partial');

  const wave = { id: 'W02', file: 'docs/plan/waves/W02-first-light.md', branch: 'wave/w02-first-light' };
  const audit = auditWaveTaskAndWiring(dir, dir, wave, {
    progress: { total: ['W02-01', 'W02-02'], done: ['W02-01'], remaining: ['W02-02'], complete: false },
  });
  const codes = new Set(audit.issues.map((i) => i.code));
  assert.ok(codes.has('ISSUES_INCOMPLETE'), 'expected ISSUES_INCOMPLETE');
  assert.ok(codes.has('MISSING_SCENARIO'), 'expected MISSING_SCENARIO');
  assert.ok(codes.has('MISSING_OWNER_GUIDE'), 'expected MISSING_OWNER_GUIDE');
  assert.ok(codes.has('OWNED_PATH_DRIFT'), 'expected OWNED_PATH_DRIFT');
  assert.ok(codes.has('CONTRACT_UNWIRED_SIM'), 'expected CONTRACT_UNWIRED_SIM');
  assert.ok(codes.has('CONTRACT_UNWIRED_CLIENT_SERVER'), 'expected CONTRACT_UNWIRED_CLIENT_SERVER');
  assert.ok(codes.has('DEV_TOOLS_UNDOCUMENTED'), 'expected DEV_TOOLS_UNDOCUMENTED');
}));

t('auditWaveTestPyramid passes when major sim + backend + frontend features have unit, integration, backend E2E, and pos/neg/corner cases', () => withTempDir((dir) => {
  const prodLines = Array.from({ length: 24 }, (_, i) => `export const c${i} = ${i};`).join('\n');
  writeRel(dir, 'shared/sim/src/systems/reactor/core.ts', `export function stepReactor(power: number) { return Math.max(0, power); }\n${prodLines}\n`);
  writeRel(dir, 'backend/app/src/reactor/reactor.service.ts', `export class ReactorService { async save(prisma: any) { return prisma.colony.findMany(); } }\n${prodLines}\n`);
  writeRel(dir, 'frontend/game/features/reactor-hud/ReactorHud.ts', `export class ReactorHud { mount() {} }\n${prodLines}\n`);

  writeRel(dir, 'shared/sim/test/systems/reactor.spec.ts', [
    "import { stepReactor } from '../../src/systems/reactor/core';",
    'describe("reactor unit & sim integration", () => {',
    '  it("computes positive output via step(state)", () => { step(state); expect(stepReactor(10)).toBe(10); });',
    '  it("rejects invalid negative overload when disabled", () => { expect({ ok: false, rejectReason: "wave_disabled" }.ok).toBe(false); });',
    '  it("clamps at zero and max cap boundary on snapshot restore", () => { restoreSnapshot(s); expect(stepReactor(0)).toBe(0); });',
    '});',
  ].join('\n'));
  writeRel(dir, 'backend/app/test/reactor/reactor.spec.ts', [
    "import { ReactorService } from '../../src/reactor/reactor.service';",
    'it("handles valid reactor state", () => { expect(new ReactorService()).toBeTruthy(); });',
    'it("rejects unauthorized call", () => { expect(() => { throw new Error("unauthorized"); }).toThrow(); });',
    'it("handles empty zero boundary", () => { expect([].length).toBe(0); });',
  ].join('\n'));
  writeRel(dir, 'backend/app/test/reactor/reactor.int.spec.ts', [
    "import { ReactorService } from '../../src/reactor/reactor.service';",
    'it("persists reactor state via createTestDatabase() and rolls back duplicate replay at cap", async () => {',
    '  createTestDatabase();',
    '  expect(ReactorService).toBeTruthy();',
    '  expect({ ok: false }.ok).toBe(false);',
    '});',
  ].join('\n'));
  writeRel(dir, 'frontend/game/features/reactor-hud/reactor-hud.spec.ts', [
    "import { ReactorHud } from './ReactorHud';",
    'it("mounts reactor-hud in OnlineSession", () => { OnlineSession; expect(new ReactorHud()).toBeTruthy(); });',
    'it("hides HUD when wave_disabled", () => { expect(null).toBeNull(); });',
    'it("clamps at zero and max cap threshold", () => { expect(0).toBe(0); });',
  ].join('\n'));
  writeRel(dir, 'tests/e2e/w02.spec.ts', [
    'test("1. reactor online", async ({ page }) => { await loadScenario(page, "w02"); await sendSimCmd(page, "ping", {}); expect(1).toBe(1); });',
  ].join('\n'));

  const res = auditWaveTestPyramid(dir, { id: 'W02' }, [
    'shared/sim/src/systems/reactor/core.ts',
    'backend/app/src/reactor/reactor.service.ts',
    'frontend/game/features/reactor-hud/ReactorHud.ts',
    'shared/sim/test/systems/reactor.spec.ts',
    'backend/app/test/reactor/reactor.spec.ts',
    'backend/app/test/reactor/reactor.int.spec.ts',
    'frontend/game/features/reactor-hud/reactor-hud.spec.ts',
    'tests/e2e/w02.spec.ts',
  ]);
  assert.equal(res.issues.length, 0, JSON.stringify(res.issues));
  assert.equal(res.testPyramid.majorFeatures, 3);
  assert.equal(res.testPyramid.unitCoveredFeatures, 3);
  assert.equal(res.testPyramid.integrationCoveredFeatures, 3);
  assert.equal(res.testPyramid.backendE2eOk, true);
}));

t('auditWaveTestPyramid catches missing unit/integration tests, missing backend E2E, missing negative/corner cases, and assertionless tests', () => withTempDir((dir) => {
  const prodLines = Array.from({ length: 24 }, (_, i) => `export const v${i} = ${i};`).join('\n');
  writeRel(dir, 'shared/sim/src/systems/untested/logic.ts', `export function runUntested() { return 1; }\n${prodLines}\n`);
  writeRel(dir, 'backend/app/src/vault/vault.service.ts', `export class VaultService { query(prisma: any) { return prisma.vault.findFirst(); } }\n${prodLines}\n`);
  writeRel(dir, 'backend/app/test/vault/vault.spec.ts', [
    "import { VaultService } from '../../src/vault/vault.service';",
    'describe("vault happy path only", () => {',
    '  it("returns vault", () => { expect(new VaultService()).toBeTruthy(); });',
    '  it("works normally", () => { expect(1 + 1).toBe(2); });',
    '  it("forgot assertion", () => { const x = 42; });',
    '});',
  ].join('\n'));
  writeRel(dir, 'tests/e2e/w02.spec.ts', [
    'test("local only", async ({ page }) => { await loadLocal(page, "w02"); expect(1).toBe(1); });',
  ].join('\n'));

  const res = auditWaveTestPyramid(dir, { id: 'W02' }, [
    'shared/sim/src/systems/untested/logic.ts',
    'backend/app/src/vault/vault.service.ts',
    'backend/app/test/vault/vault.spec.ts',
    'tests/e2e/w02.spec.ts',
  ]);
  const codes = new Set(res.issues.map((i) => i.code));
  assert.ok(codes.has('MISSING_FEATURE_UNIT_TESTS'), 'expected MISSING_FEATURE_UNIT_TESTS');
  assert.ok(codes.has('MISSING_FEATURE_INTEGRATION_TESTS'), 'expected MISSING_FEATURE_INTEGRATION_TESTS');
  assert.ok(codes.has('MISSING_BACKEND_E2E'), 'expected MISSING_BACKEND_E2E');
  assert.ok(codes.has('MISSING_NEGATIVE_TESTS'), 'expected MISSING_NEGATIVE_TESTS');
  assert.ok(codes.has('MISSING_CORNER_CASE_TESTS'), 'expected MISSING_CORNER_CASE_TESTS');
  assert.ok(codes.has('TEST_WITHOUT_ASSERTION'), 'expected TEST_WITHOUT_ASSERTION');
}));

t('waveValidationPrompt embeds the 6 pillars, test pyramid requirements, mandatory 2-iteration loop, and pre-audit leads', () => {
  const wave = { id: 'W02', file: 'docs/plan/waves/W02-first-light.md', branch: 'wave/w02-first-light', slug: 'w02-first-light' };
  const preset = { label: 'agy:argon', skills: ['procedural-kitbash-3d'] };
  const progress = { total: ['W02-01', 'W02-02'], done: ['W02-01', 'W02-02'], remaining: [], complete: true };
  const report = {
    waveId: 'W02',
    branch: 'wave/w02-first-light',
    progress,
    changedFilesCount: 4,
    errors: 0,
    warnings: 1,
    pass: true,
    touchedBackend: true,
    testPyramid: {
      majorFeatures: 2,
      unitCoveredFeatures: 2,
      integrationCoveredFeatures: 2,
      backendE2eOk: true,
      positiveCases: 12,
      negativeCases: 6,
      cornerCases: 5,
    },
    gateResults: [],
    issues: [{ code: 'GOD_ORCHESTRATOR', severity: 'warn', file: 'frontend/game/app/Big.ts', line: 1, message: 'Too big', fix: 'Split it' }],
  };
  const prompt = waveValidationPrompt(wave, 'First Light', { preset, progress, report });
  assert.match(prompt, /ITERATION 1 — Deep Audit, Gap Closure, Service\/Orchestrator Split, Test Pyramid & Fix Pass/);
  assert.match(prompt, /ITERATION 2 — Cold-Eye Re-Audit, Second-Order Regression Sweep & Final Polish/);
  assert.match(prompt, /Every major feature MUST be covered by BOTH Unit Tests AND Integration Tests/);
  assert.match(prompt, /Mandatory Positive, Negative & Corner\/Boundary Cases/);
  assert.match(prompt, /Backend E2E Requirement/);
  assert.match(prompt, /Orchestrators compose; Services & Parts do the work/);
  assert.match(prompt, /Client \+ Server \+ Shared Sim End-to-End Integration/);
  assert.match(prompt, /GOD_ORCHESTRATOR/);
  const formatted = formatWaveValidationReport(report);
  assert.match(formatted, /PASS \(with warnings\)/);
  assert.match(formatted, /Test Pyramid: 2\/2 features unit-tested · 2\/2 integration-tested · backend E2E ✔/);
  assert.match(formatted, /GOD_ORCHESTRATOR/);
});

t('wave:validate CLI runs in sandbox (--dry-run, --check-only, and --print-prompt)', () => {
  const sb = makeSandbox();
  const branch = openWaveBranch(sb, '00');
  sb.git('worktree', 'add', sb.wt('w00'), branch);

  const dry = sb.run(['validate', '00', '--dry-run']);
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /would validate W00/);

  const printed = sb.run(['validate', '00', '--print-prompt']);
  assert.equal(printed.status, 0, printed.out);
  assert.match(printed.out, /ITERATION 1/);
  assert.match(printed.out, /ITERATION 2/);

  const checkFail = sb.run(['validate', '00', '--check-only']);
  assert.equal(checkFail.status, 1, 'should fail when W00 issues are incomplete');
  assert.match(checkFail.out, /ISSUES_INCOMPLETE/);
  assert.ok(repoRoot);
});

let passed = 0;
for (const c of cases) {
  try {
    c.fn();
    passed++;
    console.log(`✔ ${c.name}`);
  } catch (err) {
    console.error(`✖ ${c.name}\n`, err);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${cases.length} wave-landing-validator self-tests passed`);
