import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.vite', 'test-results']);

function walkSource(dir, testRe, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkSource(abs, testRe, out);
    else if (testRe.test(name)) out.push(abs);
  }
  return out;
}

function readSafe(abs) {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
}

function extractObjectKeys(sourceText, varNames) {
  const sf = ts.createSourceFile('rules.ts', sourceText, ts.ScriptTarget.ES2022, true);
  const found = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && varNames.has(node.name.getText(sf)) && node.initializer) {
      let expr = node.initializer;
      while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) expr = expr.expression;
      if (ts.isObjectLiteralExpression(expr)) {
        for (const prop of expr.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const nameNode = prop.name;
            const key = ts.isStringLiteral(nameNode) || ts.isIdentifier(nameNode) ? nameNode.text : null;
            if (key) found.push({ varName: node.name.getText(sf), key });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPrefixAndClosestMatchers(sourceText) {
  const prefixes = [];
  const closestTestids = [];
  for (const m of sourceText.matchAll(/testid\.startsWith\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    prefixes.push({ varName: 'PREFIX_MATCHERS', key: m[1] });
  }
  for (const m of sourceText.matchAll(/closest\(\s*['"][^'"]*\[data-testid="([^"]+)"\][^'"]*['"]\s*\)/g)) {
    if (m[1] !== 'analytics-consent') closestTestids.push({ varName: 'CLOSEST_TESTID', key: m[1] });
  }
  return { prefixes, closestTestids };
}

function hasExactToken(files, token) {
  const re = new RegExp(`['"\`]${escapeRe(token)}['"\`]|(?:id|data-testid|data-action)=["']${escapeRe(token)}["']`);
  return files.some((text) => re.test(text));
}

function hasPrefixToken(files, prefix) {
  const re = new RegExp(`['"\`]${escapeRe(prefix)}`);
  return files.some((text) => re.test(text));
}

export function validateUiMatchers(root) {
  const analyticsDir = join(root, 'frontend/design/analytics');
  const ruleFiles = walkSource(analyticsDir, /\.(?:ts|js)$/).filter((p) => !/\.(?:spec|test)\./.test(p));
  const keys = [];
  const prefixes = [];
  const closestTestids = [];
  const varNames = new Set(['TESTID_MATCHERS', 'ID_MATCHERS', 'ACTION_MATCHERS']);
  for (const abs of ruleFiles) {
    const text = readSafe(abs);
    keys.push(...extractObjectKeys(text, varNames));
    const extra = extractPrefixAndClosestMatchers(text);
    prefixes.push(...extra.prefixes);
    closestTestids.push(...extra.closestTestids);
  }

  const frontendFiles = walkSource(join(root, 'frontend'), /\.(?:html|ts|js|mjs)$/)
    .filter((p) => {
      const rel = relative(root, p).split(sep).join('/');
      return !/\.(?:spec|test)\./.test(rel) && !rel.startsWith('frontend/design/analytics/');
    })
    .map((p) => readSafe(p));

  const deadMatchers = [];
  for (const { varName, key } of keys) {
    if (!hasExactToken(frontendFiles, key)) deadMatchers.push(`${varName}:${key}`);
  }
  for (const { varName, key } of prefixes) {
    if (!hasPrefixToken(frontendFiles, key)) deadMatchers.push(`${varName}:${key}`);
  }
  for (const { varName, key } of closestTestids) {
    if (!hasExactToken(frontendFiles, key)) deadMatchers.push(`${varName}:${key}`);
  }
  return { matcherCount: keys.length + prefixes.length + closestTestids.length, deadMatchers };
}

export function scanTrackedActions(root) {
  const trackedUiActions = [];
  const files = walkSource(join(root, 'frontend'), /\.(?:ts|js)$/).filter((p) => !/\.(?:spec|test)\./.test(p));
  for (const abs of files) {
    const text = readSafe(abs);
    for (const m of text.matchAll(/noteUiAction\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)) {
      trackedUiActions.push({ area: m[1], action: m[2] });
    }
    for (const m of text.matchAll(/area:\s*['"]([^'"]+)['"]\s*,\s*action:\s*['"]([^'"]+)['"]/g)) {
      trackedUiActions.push({ area: m[1], action: m[2] });
    }
    if (text.includes('classifyByDataAttr') || text.includes('classifyByTestIdPrefix') || text.includes('classifyClickedControl')) {
      for (const m of text.matchAll(/return\s*\{\s*area(?::\s*['"]([^'"]+)['"])?\s*,\s*action:\s*['"]([^'"]+)['"]/g)) {
        trackedUiActions.push({ area: m[1] ?? 'nav_or_cta', action: m[2] });
      }
    }
  }
  const seen = new Set();
  return trackedUiActions.filter((item) => {
    const key = `${item.area}:${item.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildAutoFunnels(controls) {
  const prod = { key: 'runtime', value: 'prod' };
  const step = (event, where) => (where ? { event, where } : { event });
  const hasPanel = (book, panel) => (book === 'dock' ? controls.dockTabs : controls.colonyTabs).includes(panel);

  const autoFunnels = [];
  if (hasPanel('dock', 'build') && controls.buildingButtons.length > 0) {
    autoFunnels.push({
      id: 'auto-funnel-build-button',
      title: 'TA · Auto · Build tab -> Building button -> First command',
      window: { interval: 1, unit: 'hour' },
      breakdown: 'target',
      dashboard: 'gameplay',
      pin: true,
      steps: [
        step('colony_entered', [prod]),
        step('hud_panel_opened', [{ key: 'book', value: 'dock' }, { key: 'panel', value: 'build' }, prod]),
        step('ui_action_clicked', [{ key: 'surface', value: 'play' }, { key: 'area', value: 'build' }, prod]),
        step('gameplay_first_command', [prod]),
      ],
    });
  }
  if (hasPanel('dock', 'production') && controls.unitButtons.length > 0) {
    autoFunnels.push({
      id: 'auto-funnel-units-button',
      title: 'TA · Auto · Production tab -> Unit button -> First command',
      window: { interval: 1, unit: 'hour' },
      breakdown: 'target',
      dashboard: 'gameplay',
      pin: true,
      steps: [
        step('colony_entered', [prod]),
        step('hud_panel_opened', [{ key: 'book', value: 'dock' }, { key: 'panel', value: 'production' }, prod]),
        step('ui_action_clicked', [{ key: 'surface', value: 'play' }, { key: 'area', value: 'units' }, prod]),
        step('gameplay_first_command', [prod]),
      ],
    });
  }
  if (hasPanel('dock', 'terraform') && controls.terraformOps.length > 0) {
    autoFunnels.push({
      id: 'auto-funnel-terraform-button',
      title: 'TA · Auto · Terraform tab -> Op button -> First command',
      window: { interval: 1, unit: 'hour' },
      breakdown: 'target',
      dashboard: 'gameplay',
      pin: true,
      steps: [
        step('colony_entered', [prod]),
        step('hud_panel_opened', [{ key: 'book', value: 'dock' }, { key: 'panel', value: 'terraform' }, prod]),
        step('ui_action_clicked', [{ key: 'surface', value: 'play' }, { key: 'area', value: 'terraform' }, prod]),
        step('gameplay_first_command', [prod]),
      ],
    });
  }
  if (hasPanel('colony', 'trade')) {
    autoFunnels.push({
      id: 'auto-funnel-in-game-trade-buttons',
      title: 'TA · Auto · Colony Trade panel -> Button -> Market order',
      window: { interval: 1, unit: 'hour' },
      breakdown: 'action',
      dashboard: 'economy',
      pin: true,
      steps: [
        step('colony_entered', [prod]),
        step('hud_panel_opened', [{ key: 'book', value: 'colony' }, { key: 'panel', value: 'trade' }, prod]),
        step('ui_action_clicked', [{ key: 'surface', value: 'play' }, { key: 'area', value: 'market' }, prod]),
        step('market_order_placed'),
      ],
    });
  }
  autoFunnels.push({
    id: 'auto-funnel-settings-pause',
    title: 'TA · Auto · Colony -> Pause / Settings button flow',
    window: { interval: 2, unit: 'hour' },
    breakdown: 'action',
    dashboard: 'gameplay',
    pin: true,
    steps: [
      step('colony_entered', [prod]),
      step('ui_action_clicked', [{ key: 'surface', value: 'play' }, { key: 'area', value: 'settings' }, prod]),
      step('gameplay_first_command', [prod]),
    ],
  });
  return autoFunnels;
}
