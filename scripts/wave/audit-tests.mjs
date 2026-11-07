// Test pyramid coverage (Unit + Integration + Backend E2E per major feature) and Positive / Negative / Corner-case auditor.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';

const NEGATIVE_TITLE_RE = /\b(reject\w*|fail\w*|deni\w*|deny|invalid\w*|unauthori[sz]ed|unauthenticated|forbidden|unseated|insufficient|missing|unknown|not[_ -]?found|disabl\w*|wave[_ -]?disabled|off\b|cannot|can't|does\s+not|doesn't|never|blocked|block\w*|error\w*|throws?|exception|out[_ -]?of[_ -]?(?:range|bounds)|occupied|conflict|cooldown|locked|offline|brownout|no[_ -]?op|ignores?|refuses?|prevents?|without|bad|wrong|malformed|corrupt\w*|expired|exceed\w*|unpaid|unpowered|mismatch|stranger|tamper\w*|unowned|illegal|disallow\w*|hid(?:es|den)|drop\w*|shed\w*)\b/i;

const NEGATIVE_BODY_RE = /(\.toThrow|\.rejects|ok\)\.toBe\(false\)|ok:\s*false|success\)\.toBe\(false\)|success:\s*false|\.toBeNull\(\)|\.toBeUndefined\(\)|\.toHaveCount\(0\)|\.toBeHidden\(\)|status\)\.toBe\([45]\d\d\)|status\)\.toBeGreaterThanOrEqual\(400\)|rejectReason|wave_disabled|safeParse\(|coming_soon|brownout\)\.toBe\(true\)|offline|rejected)/;

const CORNER_TITLE_RE = /\b(zero|empty|boundar\w*|corner|edge|limit\w*|cap|capped|threshold\w*|clamp\w*|max\w*|min\w*|overflow\w*|underflow\w*|full|half|deplet\w*|exhaust\w*|exact\w*|tie\b|off[_ -]?by[_ -]?one|duplicat\w*|idempoten\w*|replay\w*|twice|repeated\w*|concurren\w*|parallel|race|atomic\w*|rollback|recovery|recover\w*|restart\w*|reconnect\w*|disconnect\w*|resync\w*|snapshot\w*|restor\w*|round[_ -]?trip|cancel\w*|partial\w*|mid[_ -]|brownout|overload\w*|night|stale|orphan\w*|wrap\w*|extreme|negative|batch|lag|timeout|lease|collision|monotonic|floor|ceil|rounding|precision)\b/i;

const CORNER_BODY_RE = /(Promise\.all\(|takeSnapshot|restoreSnapshot|toBeCloseTo\(|MAX_SAFE_INTEGER|Infinity|NaN|\.toBe\(0\)|\.toEqual\(\[\]\)|\.toHaveLength\(0\)|cap\b|threshold\b|clamp|idempoten|replay|rollback|cancelTask|brownout|waves:\s*['"]\.\.|-\d+)/;

const ASSERTION_RE = /\b(expect|expectNoPageErrors|assert|fail)\b|throw\s+new\s+Error\(/;
const SIM_INTEGRATION_RE = /\b(SimHost|createSimHost|createState|createRegistryPipeline|step\(|stepKernel|applyCommand|enqueueCommand|takeSnapshot|restoreSnapshot|compileScenario|loadScenario|runTicks|createWorld)\b/;
const BACKEND_INTEGRATION_RE = /\b(createApp|createTestDatabase|PlanetHost|WebSocket|Test\.createTestingModule|fetch\(|supertest)\b/;
const FRONTEND_INTEGRATION_RE = /\b(OnlineSession|ReplicaStore|createStore|CommandBus|document\.createElement|mount[A-Z]\w*|render[A-Z]\w*|dispatchEvent)\b/;
const BACKEND_E2E_SIGNAL_RE = /\b(loadScenario|sendSimCmd|devConsole|fetch\(|request\.|goto\(\s*['"`]\/(?:me|v1|dev|play)|WebSocket)\b/;
const DB_QUERY_RE = /\b(prisma\.[a-zA-Z0-9_$]+|\$transaction|\$queryRaw|\$executeRaw)\b/;
const PLUMBING_BACKEND_DIRS = new Set(['di', 'bus', 'flags', 'ports', 'common', 'config']);

const isSpecFile = (rel) => /\.(spec|test)\.[cm]?[jt]s$/.test(rel);
const isIntSpecFile = (rel) => /\.(int|contract|e2e)\.spec\.[cm]?[jt]s$|^tests\/(e2e\/parity|scenarios\/test)\//.test(rel);
const isE2eFile = (rel) => /^tests\/e2e\/w\d{2}\.spec\.ts$/.test(rel);
const isProdSource = (rel) => /\.(ts|js|mjs)$/.test(rel)
  && !isSpecFile(rel)
  && !/\/data\/|\/generated\/|\.d\.ts$|^docs\/|^scripts\/|^tests\/|^infra\//.test(rel)
  && basename(rel) !== 'index.ts';

function classifyFeatureGroup(rel) {
  let m = /^shared\/sim\/src\/systems\/([^/]+)\//.exec(rel);
  if (m) return { id: `sim:${m[1]}`, layer: 'sim', name: m[1], prefix: `shared/sim/src/systems/${m[1]}` };
  m = /^shared\/sim\/src\/(economy|units|grid|world|gen)\//.exec(rel);
  if (m) return { id: `sim:${m[1]}`, layer: 'sim', name: m[1], prefix: `shared/sim/src/${m[1]}` };
  m = /^backend\/app\/src\/([^/]+)\//.exec(rel);
  if (m) return { id: `backend:${m[1]}`, layer: 'backend', name: m[1], prefix: `backend/app/src/${m[1]}` };
  m = /^frontend\/game\/features\/([^/]+)\//.exec(rel);
  if (m && m[1] !== 'shared') return { id: `frontend:${m[1]}`, layer: 'frontend', name: m[1], prefix: `frontend/game/features/${m[1]}` };
  m = /^frontend\/game\/pages\/([^/]+)\//.exec(rel);
  if (m) return { id: `frontend:page-${m[1]}`, layer: 'frontend', name: m[1], prefix: `frontend/game/pages/${m[1]}` };
  m = /^frontend\/game\/(maps|descent|ui|store)\//.exec(rel);
  if (m) return { id: `frontend:${m[1]}`, layer: 'frontend', name: m[1], prefix: `frontend/game/${m[1]}` };
  if (/^shared\/ledger\/src\//.test(rel)) return { id: 'ledger:core', layer: 'ledger', name: 'ledger', prefix: 'shared/ledger/src' };
  return null;
}

function extractExportedSymbols(text) {
  const out = [];
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|class|const)\s+([A-Za-z0-9_]{4,})/g)) {
    out.push(m[1]);
  }
  return out;
}

export function detectTouchedMajorFeatures(cwd, changedFiles) {
  const groups = new Map();
  let touchedBackend = false;
  let touchedBackendDb = false;
  let touchedSimOrClient = false;
  const backendControllers = [];

  for (const rel of changedFiles) {
    if (/^(shared\/sim|frontend\/game|tests\/scenarios)\//.test(rel)) touchedSimOrClient = true;
    if (/^(backend\/app\/src|shared\/db)\//.test(rel) && isProdSource(rel)) touchedBackend = true;
    if (!isProdSource(rel)) continue;

    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const lines = text.split('\n').length;

    if (rel.startsWith('backend/app/src/')) {
      if (DB_QUERY_RE.test(text)) touchedBackendDb = true;
      const ctrl = /@Controller\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(text);
      if (ctrl) backendControllers.push({ file: rel, route: ctrl[1] });
    }

    const meta = classifyFeatureGroup(rel);
    if (!meta) continue;
    const entry = groups.get(meta.id) ?? {
      ...meta,
      files: [],
      totalLines: 0,
      symbols: new Set(),
      usesDb: false,
    };
    entry.files.push(rel);
    entry.totalLines += lines;
    if (DB_QUERY_RE.test(text)) entry.usesDb = true;
    for (const sym of extractExportedSymbols(text)) entry.symbols.add(sym);
    groups.set(meta.id, entry);
  }

  const majorFeatures = [...groups.values()].filter((g) => {
    if (g.layer === 'backend' && PLUMBING_BACKEND_DIRS.has(g.name)) {
      return g.files.length >= 2 && g.totalLines >= 50;
    }
    return g.totalLines >= 20 || g.files.length >= 2;
  });

  return { majorFeatures, touchedBackend, touchedBackendDb, touchedSimOrClient, backendControllers };
}

function walkSpecFiles(rootDir, subRel, acc) {
  const dir = join(rootDir, subRel);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.out') continue;
    const rel = `${subRel}/${entry.name}`;
    if (entry.isDirectory()) walkSpecFiles(rootDir, rel, acc);
    else if (isSpecFile(rel)) acc.add(rel);
  }
}

export function analyzeTestFileCases(rel, text) {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);
  const helperHasAssert = new Set();

  const scanHelpers = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name) {
      const bodyText = node.getText(sf);
      if (ASSERTION_RE.test(bodyText)) helperHasAssert.add(node.name.getText(sf));
    }
    ts.forEachChild(node, scanHelpers);
  };
  scanHelpers(sf);

  let totalTests = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let cornerCount = 0;
  const assertionless = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const exprText = node.expression.getText(sf);
      const isTestCall = /^(?:it|test)(?:\.(?:only|concurrent|serial))?$/.test(exprText)
        || /^(?:it|test)\.each\b/.test(exprText);
      if (isTestCall && node.arguments.length >= 2) {
        const titleArg = node.arguments[0];
        const fnArg = node.arguments[node.arguments.length - 1];
        if (ts.isFunctionLike(fnArg) && fnArg.body) {
          const title = titleArg.getText(sf);
          const body = fnArg.body.getText(sf);
          if (/\b(?:test|it)\.skip\s*\(/.test(body)) return;
          totalTests++;
          const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
          const callsHelper = [...helperHasAssert].some((h) => body.includes(`${h}(`));
          if (!ASSERTION_RE.test(body) && !callsHelper) {
            assertionless.push({ line, title: title.slice(0, 60) });
          }
          const isNeg = NEGATIVE_TITLE_RE.test(title) || NEGATIVE_BODY_RE.test(body);
          const isCorner = CORNER_TITLE_RE.test(title) || CORNER_BODY_RE.test(body);
          if (isNeg) negativeCount++;
          if (isCorner) cornerCount++;
          if (!isNeg || /expect\(/.test(body)) positiveCount++;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { totalTests, positiveCount, negativeCount, cornerCount, assertionless };
}

function collectTestCorpus(cwd, changedFiles) {
  const allPaths = new Set(changedFiles.filter(isSpecFile));
  for (const dir of ['shared/sim/test', 'shared/ledger/test', 'shared/contracts/test', 'backend/app/test', 'frontend/game', 'tests/scenarios/test', 'tests/e2e']) {
    walkSpecFiles(cwd, dir, allPaths);
  }
  const changedSet = new Set(changedFiles);
  const specs = [];
  for (const rel of allPaths) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const e2e = isE2eFile(rel);
    const intSpec = isIntSpecFile(rel);
    specs.push({
      rel,
      text,
      changed: changedSet.has(rel),
      isE2e: e2e,
      isIntFile: intSpec,
      isUnitFile: !e2e && !intSpec,
      hasSimIntegration: intSpec || SIM_INTEGRATION_RE.test(text),
      hasBackendIntegration: intSpec || BACKEND_INTEGRATION_RE.test(text),
      hasFrontendIntegration: e2e || intSpec || FRONTEND_INTEGRATION_RE.test(text),
      cases: changedSet.has(rel) ? analyzeTestFileCases(rel, text) : null,
    });
  }
  return specs;
}

function specCoversFeature(spec, feature) {
  const normName = feature.name.toLowerCase();
  const baseName = normName.replace(/-(menu|panel|hud|page|basic|core|claim)$/, '');
  const relLower = spec.rel.toLowerCase();
  if (relLower.includes(`/${normName}`) || relLower.includes(`-${normName}`) || relLower.includes(`${normName}.`) || relLower.includes(`${normName}-`)) {
    return true;
  }
  if (baseName.length >= 4 && (relLower.includes(`/${baseName}`) || relLower.includes(`-${baseName}`) || relLower.includes(`${baseName}-`))) {
    return true;
  }
  if (spec.text.includes(feature.prefix) || spec.text.includes(feature.name)) {
    return true;
  }
  for (const f of feature.files) {
    const stem = basename(f).replace(/\.[cm]?[jt]s$/, '');
    if (stem.length >= 5 && spec.text.includes(stem)) return true;
  }
  for (const sym of feature.symbols) {
    if (spec.text.includes(sym)) return true;
  }
  return false;
}

function checkFeaturePyramidAndCases(feature, corpus, issues) {
  const matching = corpus.filter((s) => specCoversFeature(s, feature));
  const unitSpecs = matching.filter((s) => s.isUnitFile);
  const intSpecs = matching.filter((s) => {
    if (feature.layer === 'backend') return s.hasBackendIntegration;
    if (feature.layer === 'sim') return s.hasSimIntegration;
    if (feature.layer === 'frontend') return s.hasFrontendIntegration;
    return s.isIntFile || s.isUnitFile;
  });

  if (unitSpecs.length === 0) {
    issues.push({
      code: 'MISSING_FEATURE_UNIT_TESTS',
      severity: 'error',
      file: feature.files[0],
      line: 1,
      message: `Major ${feature.layer} feature '${feature.name}' (${feature.files.length} file(s), ${feature.totalLines} lines) has no unit test coverage (*.spec.ts).`,
      fix: `Add unit tests covering '${feature.name}' (positive, negative, and corner cases).`,
    });
  }

  const needsDbInt = feature.layer === 'backend' && feature.usesDb;
  const hasRealDbInt = matching.some((s) => s.isIntFile);
  if (intSpecs.length === 0 || (needsDbInt && !hasRealDbInt)) {
    issues.push({
      code: 'MISSING_FEATURE_INTEGRATION_TESTS',
      severity: 'error',
      file: feature.files[0],
      line: 1,
      message: needsDbInt && !hasRealDbInt
        ? `Major backend feature '${feature.name}' uses database persistence but has no '*.int.spec.ts' integration test.`
        : `Major ${feature.layer} feature '${feature.name}' has no integration test coverage across module/host boundaries.`,
      fix: feature.layer === 'backend'
        ? `Add a '${feature.name}.int.spec.ts' integration test exercising HTTP/WS/DB persistence with @terra/db/testing or createApp().`
        : feature.layer === 'sim'
          ? `Add an integration spec exercising '${feature.name}' through SimHost / stepKernel / command dispatch / snapshot round-trip.`
          : `Add an integration or wave E2E test exercising '${feature.name}' with store/session/DOM command wiring.`,
    });
  }

  let negTotal = 0;
  let cornerTotal = 0;
  for (const s of matching) {
    const c = s.cases ?? analyzeTestFileCases(s.rel, s.text);
    negTotal += c.negativeCount;
    cornerTotal += c.cornerCount;
  }

  if (matching.length > 0 && negTotal === 0) {
    issues.push({
      code: 'MISSING_NEGATIVE_TESTS',
      severity: 'error',
      file: matching[0].rel,
      line: 1,
      message: `Tests for major ${feature.layer} feature '${feature.name}' only cover positive happy paths (0 negative/rejection/error test cases found).`,
      fix: `Add negative test cases for '${feature.name}' (invalid inputs, rejected commands, unauthorized/unseated calls, wave_disabled, or insufficient resources).`,
    });
  }

  if (matching.length > 0 && cornerTotal === 0) {
    issues.push({
      code: 'MISSING_CORNER_CASE_TESTS',
      severity: 'error',
      file: matching[0].rel,
      line: 1,
      message: `Tests for major ${feature.layer} feature '${feature.name}' have 0 boundary/corner test cases.`,
      fix: `Add corner/boundary test cases for '${feature.name}' (0/empty/max cap boundaries, idempotent replay, concurrency, mid-progress cancel, or snapshot restore).`,
    });
  }

  return {
    id: feature.id,
    unitCount: unitSpecs.length,
    intCount: intSpecs.length,
    negativeCount: negTotal,
    cornerCount: cornerTotal,
  };
}

function checkChangedSpecFilesQuality(corpus, coveredSpecs, issues) {
  let posTotal = 0;
  let negTotal = 0;
  let cornerTotal = 0;

  for (const spec of corpus.filter((s) => s.changed && s.cases)) {
    const { totalTests, positiveCount, negativeCount, cornerCount, assertionless } = spec.cases;
    posTotal += positiveCount;
    negTotal += negativeCount;
    cornerTotal += cornerCount;

    for (const bad of assertionless) {
      issues.push({
        code: 'TEST_WITHOUT_ASSERTION',
        severity: 'warn',
        file: spec.rel,
        line: bad.line,
        message: `Test case ${bad.title} has no expect(...) or assert* verification.`,
        fix: 'Add explicit assertions verifying the expected state, return value, DOM element, or rejection.',
      });
    }

    if (coveredSpecs.has(spec.rel) || spec.isE2e || totalTests < 2 || spec.text.split('\n').length < 25) continue;

    if (negativeCount === 0) {
      issues.push({
        code: 'MISSING_NEGATIVE_TESTS',
        severity: 'warn',
        file: spec.rel,
        line: 1,
        message: `Spec file '${spec.rel}' (${totalTests} tests) contains only positive happy-path tests and 0 negative/error/rejection cases.`,
        fix: 'Add negative test cases (invalid inputs, rejected commands, unauthorized access, or error handling).',
      });
    }
    if (cornerCount === 0) {
      issues.push({
        code: 'MISSING_CORNER_CASE_TESTS',
        severity: 'warn',
        file: spec.rel,
        line: 1,
        message: `Spec file '${spec.rel}' (${totalTests} tests) contains 0 corner or boundary cases.`,
        fix: 'Add boundary/corner test cases (0/empty/max limits, duplicate/idempotent calls, cancel/rollback, or snapshot round-trip).',
      });
    }
  }

  return { posTotal, negTotal, cornerTotal };
}

function checkBackendE2eCoverage(cwd, wave, touchedBackend, changedFiles, issues) {
  if (!touchedBackend) return true;
  const nn = wave.id.slice(1);
  const e2eRel = `tests/e2e/w${nn}.spec.ts`;
  const e2eAbs = join(cwd, e2eRel);
  const backendFiles = changedFiles.filter((f) => f.startsWith('backend/app/src/') && isProdSource(f));

  if (!existsSync(e2eAbs)) {
    issues.push({
      code: 'MISSING_BACKEND_E2E',
      severity: 'error',
      file: e2eRel,
      line: 1,
      message: `Wave ${wave.id} modifies backend code (${backendFiles.slice(0, 3).join(', ')}${backendFiles.length > 3 ? '…' : ''}), but '${e2eRel}' is missing.`,
      fix: `Create '${e2eRel}' with end-to-end Playwright tests exercising the online backend server (HTTP /v1/* routes, WS commands, and persistence).`,
    });
    return false;
  }

  let combinedE2e = readFileSync(e2eAbs, 'utf8');
  for (const entry of existsSync(join(cwd, 'tests/e2e')) ? readdirSync(join(cwd, 'tests/e2e')) : []) {
    if (entry.startsWith(`w${nn}-`) && entry.endsWith('.ts')) {
      combinedE2e += '\n' + readFileSync(join(cwd, 'tests/e2e', entry), 'utf8');
    }
  }

  const hasServerFlow = BACKEND_E2E_SIGNAL_RE.test(combinedE2e);
  const skipsServer = /test\.skip\(\s*(?:hostMode\(\)\s*===\s*['"]server['"]|!local)\b/.test(combinedE2e);
  if (!hasServerFlow || skipsServer) {
    issues.push({
      code: 'MISSING_BACKEND_E2E',
      severity: 'error',
      file: e2eRel,
      line: 1,
      message: `Wave ${wave.id} modifies backend code, but '${e2eRel}' does not test the backend server end-to-end (local-only or missing server HTTP/WS flows).`,
      fix: `Ensure '${e2eRel}' runs against the online backend server (loadScenario, sendSimCmd, fetch '/v1/...', or server-backed pages).`,
    });
    return false;
  }
  return true;
}

export function auditWaveTestPyramid(cwd, wave, changedFiles) {
  const issues = [];
  const {
    majorFeatures,
    touchedBackend,
    touchedBackendDb,
    touchedSimOrClient,
  } = detectTouchedMajorFeatures(cwd, changedFiles);

  const corpus = collectTestCorpus(cwd, changedFiles);
  const coveredSpecs = new Set();
  const featureResults = [];

  for (const feat of majorFeatures) {
    for (const s of corpus) {
      if (specCoversFeature(s, feat)) coveredSpecs.add(s.rel);
    }
    featureResults.push(checkFeaturePyramidAndCases(feat, corpus, issues));
  }

  const caseTotals = checkChangedSpecFilesQuality(corpus, coveredSpecs, issues);
  const backendE2eOk = checkBackendE2eCoverage(cwd, wave, touchedBackend, changedFiles, issues);

  return {
    issues,
    touchedBackend,
    touchedBackendDb,
    touchedSimOrClient,
    testPyramid: {
      majorFeatures: majorFeatures.length,
      unitCoveredFeatures: featureResults.filter((f) => f.unitCount > 0).length,
      integrationCoveredFeatures: featureResults.filter((f) => f.intCount > 0).length,
      backendE2eOk,
      positiveCases: caseTotals.posTotal,
      negativeCases: caseTotals.negTotal,
      cornerCases: caseTotals.cornerTotal,
    },
  };
}
