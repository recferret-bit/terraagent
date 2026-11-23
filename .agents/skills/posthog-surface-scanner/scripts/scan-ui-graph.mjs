#!/usr/bin/env node
// Scans frontend HTML, AST emitters, and game HUD registries into a UI/Button Analytics Graph.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { buildAutoFunnels, scanTrackedActions, validateUiMatchers } from './scan-ui-matchers.mjs';

const SKIP = new Set(['node_modules', 'dist', 'coverage', '.vite', 'test-results']);

function walk(dir, testRe, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, testRe, out);
    else if (testRe.test(name)) out.push(abs);
  }
  return out;
}

function readSafe(abs) {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
}

function extractConstIds(fileText, exportName, constValues = new Map()) {
  const sf = ts.createSourceFile('scan.ts', fileText, ts.ScriptTarget.ES2022, true);
  const ids = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === exportName && node.initializer) {
      visitPropIds(node.initializer, sf, ids, constValues);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return ids;
}

function visitPropIds(node, sf, out, constValues = new Map()) {
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop) || !/^(id|op)$/.test(prop.name.getText(sf))) continue;
      if (ts.isStringLiteral(prop.initializer)) out.push(prop.initializer.text);
      else if (ts.isIdentifier(prop.initializer) && constValues.has(prop.initializer.text)) {
        out.push(constValues.get(prop.initializer.text));
      }
    }
    return;
  }
  ts.forEachChild(node, (child) => visitPropIds(child, sf, out, constValues));
}

function extractStringConsts(fileText) {
  const sf = ts.createSourceFile('consts.ts', fileText, ts.ScriptTarget.ES2022, true);
  const map = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteral(node.initializer)) {
      map.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return map;
}

function scanStringArrayTupleKeys(text, re) {
  const out = [];
  for (const match of text.matchAll(re)) out.push(match[1]);
  return [...new Set(out)];
}

function collectSurfaceLiterals(node, out) {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    collectSurfaceLiterals(node.expression, out);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectSurfaceLiterals(node.whenTrue, out);
    collectSurfaceLiterals(node.whenFalse, out);
  }
}

function scanSurfaces(root) {
  const boots = new Map();
  for (const abs of walk(join(root, 'frontend'), /\.(?:ts|js)$/)) {
    if (/\.(?:spec|test)\./.test(abs)) continue;
    const rel = relative(root, abs).split(sep).join('/');
    const text = readSafe(abs);
    if (!text.includes('bootProductAnalytics')) continue;
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(sf) === 'bootProductAnalytics' && node.arguments.length > 0) {
        const literals = [];
        collectSurfaceLiterals(node.arguments[0], literals);
        for (const s of literals) {
          if (!boots.has(s)) boots.set(s, []);
          boots.get(s).push(rel);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const viteText = readSafe(join(root, 'frontend/vite.config.ts'));
  const entries = [];
  for (const m of viteText.matchAll(/(\w+)\s*:\s*resolve\([^,]+,\s*['"]([^'"]+\.html)['"]\)/g)) {
    const [, key, file] = m;
    if (file.startsWith('dev/')) continue;
    entries.push({ key, path: `frontend/${file}` });
  }
  return { entries, bootedSurfaces: Object.fromEntries(boots) };
}

function scanHtmlControls(root, viteEntries) {
  const entryPaths = new Set(viteEntries.map((e) => e.path));
  const htmlFiles = walk(join(root, 'frontend'), /\.html$/).filter((p) => entryPaths.has(relative(root, p).split(sep).join('/')));
  const controls = [];
  for (const abs of htmlFiles) {
    const rel = relative(root, abs).split(sep).join('/');
    const html = readSafe(abs);
    const surface = rel.includes('landing') ? 'landing'
      : rel.includes('whitepaper') ? 'whitepaper'
        : rel.includes('pitchdeck') ? 'pitchdeck'
          : rel.includes('play.html') ? 'play'
            : rel.includes('trade.html') ? 'trade'
              : rel.includes('me.html') ? 'me'
                : rel.includes('deed.html') ? 'deed'
                  : rel.includes('playground') ? 'playground'
                    : rel.includes('design/') ? 'design'
                      : rel.includes('404.html') ? 'not_found' : 'hub';
    const counts = {
      buttons: (html.match(/<button\b/gi) ?? []).length,
      ctaLinks: (html.match(/class=["'][^"']*\bbtn\b/gi) ?? []).length,
      tabs: (html.match(/role=["']tab["']/gi) ?? []).length,
      resourceTabs: [...html.matchAll(/data-res=["']([^"']+)["']/g)].map((m) => m[1]),
    };
    controls.push({ file: rel, surface, ...counts });
  }
  return controls;
}

function extractMenuKeys(fileText, exportName) {
  const sf = ts.createSourceFile('menu.ts', fileText, ts.ScriptTarget.ES2022, true);
  const keys = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === exportName && node.initializer) {
      node.initializer.forEachChild((item) => visitKeysArray(item, sf, keys));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys;
}

function visitKeysArray(node, sf, out) {
  if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'keys' && ts.isArrayLiteralExpression(node.initializer)) {
    for (const el of node.initializer.elements) {
      if (ts.isStringLiteral(el)) out.push(el.text);
    }
    return;
  }
  ts.forEachChild(node, (child) => visitKeysArray(child, sf, out));
}

function scanControlsAndActions(root) {
  const dockText = readSafe(join(root, 'frontend/game/core/hud/CommandDock.ts'));
  const colonyText = readSafe(join(root, 'frontend/game/core/hud/ColonyBook.ts'));
  const tfText = readSafe(join(root, 'frontend/game/features/terraform-basic/TerraformMenu.ts'));
  const menuText = readSafe(join(root, 'frontend/game/features/shared/menuSections.ts'));
  const tradeText = readSafe(join(root, 'frontend/trade/TradePage.ts'));
  const meText = readSafe(join(root, 'frontend/game/pages/me/MePage.ts'));
  const stakingConsts = extractStringConsts(readSafe(join(root, 'frontend/game/pages/me/sections/staking/stakingRoute.ts')));

  const dockTabs = extractConstIds(dockText, 'TAB_DEFS');
  const colonyTabs = extractConstIds(colonyText, 'TAB_DEFS');
  const terraformOps = extractConstIds(tfText, 'PRIMARY_OP_DEFS');
  const buildingButtons = extractMenuKeys(menuText, 'BUILD_GROUPS');
  const unitButtons = extractMenuKeys(menuText, 'UNIT_GROUPS');
  const tradeTabs = scanStringArrayTupleKeys(tradeText, /\[\s*'([a-z]+)'\s*,\s*'[A-Za-z /]+'\s*\]/g);
  const meTabs = [...extractConstIds(meText, 'ME_SECTION_TABS', stakingConsts), ...extractConstIds(meText, 'STAKING_TAB', stakingConsts)];
  const trackedUiActions = scanTrackedActions(root);

  return {
    dockTabs,
    colonyTabs,
    terraformOps,
    buildingButtons,
    unitButtons,
    tradeTabs,
    meTabs,
    trackedUiActions,
  };
}

function buildAutoInsights(controls) {
  const prod = { key: 'runtime', value: 'prod' };
  const autoTrends = [
    {
      id: 'auto-in-game-dock-tabs',
      title: 'TA · Auto · Command Dock tabs (Build / Units / Terraform / Queue)',
      event: 'hud_panel_opened',
      math: 'total',
      breakdown: 'panel',
      where: [{ key: 'book', value: 'dock' }, prod],
      display: 'ActionsBarValue',
      dashboard: 'gameplay',
      pin: true,
    },
    {
      id: 'auto-in-game-colony-tabs',
      title: 'TA · Auto · Colony Book tabs (Player / Away / Deed / HQ / Trade)',
      event: 'hud_panel_opened',
      math: 'total',
      breakdown: 'panel',
      where: [{ key: 'book', value: 'colony' }, prod],
      display: 'ActionsBarValue',
      dashboard: 'gameplay',
      pin: true,
    },
    {
      id: 'auto-build-buildings',
      title: 'TA · Auto · Building button selections',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'target',
      where: [{ key: 'surface', value: 'play' }, { key: 'area', value: 'build' }, prod],
      display: 'ActionsBarValue',
      dashboard: 'gameplay',
      pin: true,
    },
    {
      id: 'auto-units-queued',
      title: 'TA · Auto · Unit production button clicks',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'target',
      where: [{ key: 'surface', value: 'play' }, { key: 'area', value: 'units' }, prod],
      display: 'ActionsBarValue',
      dashboard: 'gameplay',
      pin: true,
    },
    {
      id: 'auto-terraform-ops',
      title: 'TA · Auto · Terraform op button clicks',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'target',
      where: [{ key: 'surface', value: 'play' }, { key: 'area', value: 'terraform' }, prod],
      display: 'ActionsBarValue',
      dashboard: 'gameplay',
      pin: true,
    },
    {
      id: 'auto-in-game-ui-areas',
      title: 'TA · Auto · In-game button clicks by HUD/feature area',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'area',
      where: [{ key: 'surface', value: 'play' }, prod],
      display: 'ActionsBarValue',
      dashboard: 'gameplay',
      pin: true,
    },
    {
      id: 'auto-in-game-actions-table',
      title: 'TA · Auto · In-game controls clicked (Pause, Queue, Army, Diplomacy, Map)',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'action',
      where: [{ key: 'surface', value: 'play' }, prod],
      display: 'ActionsTable',
      dashboard: 'gameplay',
      pin: true,
    },
    {
      id: 'auto-landing-cta-targets',
      title: 'TA · Auto · Landing CTA & tab targets',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'action',
      where: [{ key: 'surface', value: 'landing' }, prod],
      display: 'ActionsTable',
      dashboard: 'exec',
      pin: true,
    },
    {
      id: 'auto-trade-ui-actions',
      title: 'TA · Auto · Exchange trading controls clicked (/trade)',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'action',
      where: [{ key: 'surface', value: 'trade' }, prod],
      display: 'ActionsTable',
      dashboard: 'economy',
      pin: true,
    },
    {
      id: 'auto-profile-ui-actions',
      title: 'TA · Auto · Profile, Staking & BYOK NEAR.AI buttons (/me)',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'action',
      where: [{ key: 'surface', value: 'me' }, prod],
      display: 'ActionsTable',
      dashboard: 'economy',
      pin: true,
    },
    {
      id: 'auto-deed-ui-actions',
      title: 'TA · Auto · Colony Deed share & settle actions (/deed)',
      event: 'ui_action_clicked',
      math: 'total',
      breakdown: 'action',
      where: [{ key: 'surface', value: 'deed' }, prod],
      display: 'ActionsTable',
      dashboard: 'economy',
      pin: true,
    },
  ];
  const autoFunnels = buildAutoFunnels(controls);
  return { autoTrends, autoFunnels, discoveredTabCount: controls.dockTabs.length + controls.colonyTabs.length + controls.tradeTabs.length + controls.meTabs.length };
}

function buildGraph(surfaces, htmlControls, controls, catalog, funnelsMod, autoInsights) {
  const nodes = [];
  const edges = [];
  const addNode = (id, kind, meta = {}) => nodes.push({ id, kind, ...meta });
  const addEdge = (from, to, relation) => edges.push({ from, to, relation });

  for (const [surface, files] of Object.entries(surfaces.bootedSurfaces)) {
    addNode(`surface:${surface}`, 'surface', { files });
    addEdge(`surface:${surface}`, 'event:surface_viewed', 'boots');
  }
  for (const row of htmlControls) {
    addNode(`html:${row.file}`, 'page', { surface: row.surface, buttons: row.buttons, ctaLinks: row.ctaLinks, tabs: row.tabs });
    addEdge(`html:${row.file}`, `surface:${row.surface}`, 'mounts');
  }
  for (const tab of controls.dockTabs) {
    addNode(`hud:dock:${tab}`, 'hud_tab', { book: 'dock', panel: tab });
    addEdge('surface:play', `hud:dock:${tab}`, 'contains');
    addEdge(`hud:dock:${tab}`, 'event:hud_panel_opened', 'emits');
  }
  for (const tab of controls.colonyTabs) {
    addNode(`hud:colony:${tab}`, 'hud_tab', { book: 'colony', panel: tab });
    addEdge('surface:play', `hud:colony:${tab}`, 'contains');
    addEdge(`hud:colony:${tab}`, 'event:hud_panel_opened', 'emits');
  }
  for (const op of controls.terraformOps) {
    addNode(`btn:terraform:${op}`, 'button', { area: 'terraform', action: 'select_op', target: op });
    addEdge('hud:dock:terraform', `btn:terraform:${op}`, 'contains');
    addEdge(`btn:terraform:${op}`, 'event:ui_action_clicked', 'emits');
  }
  for (const building of controls.buildingButtons) {
    addNode(`btn:build:${building}`, 'button', { area: 'build', action: 'select_building', target: building });
    addEdge('hud:dock:build', `btn:build:${building}`, 'contains');
    addEdge(`btn:build:${building}`, 'event:ui_action_clicked', 'emits');
  }
  for (const unit of controls.unitButtons) {
    addNode(`btn:units:${unit}`, 'button', { area: 'units', action: 'queue_unit', target: unit });
    addEdge('hud:dock:production', `btn:units:${unit}`, 'contains');
    addEdge(`btn:units:${unit}`, 'event:ui_action_clicked', 'emits');
  }
  for (const { area, action } of controls.trackedUiActions) {
    addNode(`btn:${area}:${action}`, 'button', { area, action });
    addEdge(`btn:${area}:${action}`, 'event:ui_action_clicked', 'emits');
  }
  for (const ev of catalog.ANALYTICS_EVENTS) addNode(`event:${ev.name}`, 'event', { plane: ev.plane });
  const dashboards = [
    { id: 'exec', title: 'TerraAgent · Executive, Views & Countries' },
    { id: 'gameplay', title: 'TerraAgent · Gameplay, Planets & In-Game Buttons' },
    { id: 'economy', title: 'TerraAgent · Trading, Web3 & Profile' },
    { id: 'health', title: 'TerraAgent · Errors & Broken Steps' },
  ];
  for (const d of dashboards) addNode(`dashboard:${d.id}`, 'dashboard', { title: d.title });

  const allInsights = [
    ...funnelsMod.ANALYTICS_FUNNELS.map((f) => ({ id: f.id, kind: 'funnel', dashboard: f.dashboard ?? 'exec', events: f.steps.map((s) => s.event) })),
    ...funnelsMod.ANALYTICS_TRENDS.map((t) => ({ id: t.id, kind: 'trend', dashboard: t.dashboard ?? 'exec', events: [t.event] })),
    ...(funnelsMod.ANALYTICS_RETENTION ?? []).map((r) => ({ id: r.id, kind: 'retention', dashboard: r.dashboard ?? 'exec', events: [r.targetEvent, r.returningEvent] })),
    ...autoInsights.autoFunnels.map((f) => ({ id: f.id, kind: 'funnel', dashboard: f.dashboard, events: f.steps.map((s) => s.event) })),
    ...autoInsights.autoTrends.map((t) => ({ id: t.id, kind: 'trend', dashboard: t.dashboard, events: [t.event] })),
  ];
  for (const ins of allInsights) {
    addNode(`insight:${ins.id}`, 'insight', { insightKind: ins.kind, dashboard: ins.dashboard });
    for (const ev of new Set(ins.events)) addEdge(`event:${ev}`, `insight:${ins.id}`, 'feeds');
    addEdge(`insight:${ins.id}`, `dashboard:${ins.dashboard}`, 'pins_to');
  }
  return { dashboards, nodes, edges };
}

export async function scanUiGraph(root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')) {
  const catalog = await import(pathToFileURL(join(root, 'shared/contracts/src/analytics/catalog.ts')).href);
  const funnelsMod = await import(pathToFileURL(join(root, 'shared/contracts/src/analytics/funnels.ts')).href);
  const surfaces = scanSurfaces(root);
  const htmlControls = scanHtmlControls(root, surfaces.entries);
  const controls = scanControlsAndActions(root);
  const matchers = validateUiMatchers(root);
  const auto = buildAutoInsights(controls);
  const graph = buildGraph(surfaces, htmlControls, controls, catalog, funnelsMod, auto);
  const unbooted = htmlControls.filter((c) => !surfaces.bootedSurfaces[c.surface]).map((c) => c.file);
  return {
    generatedAt: new Date().toISOString(),
    surfaces,
    htmlControls,
    controls,
    matchers,
    autoFunnels: auto.autoFunnels,
    autoTrends: auto.autoTrends,
    dashboards: graph.dashboards,
    graph: { nodes: graph.nodes, edges: graph.edges },
    coverage: {
      publicHtmlPages: htmlControls.length,
      bootedSurfaces: Object.keys(surfaces.bootedSurfaces).length,
      unbootedPages: unbooted,
      matcherCount: matchers.matcherCount,
      deadMatchers: matchers.deadMatchers,
      hudDockTabs: controls.dockTabs.length,
      hudColonyTabs: controls.colonyTabs.length,
      trackedUiActions: controls.trackedUiActions.length,
      funnels: funnelsMod.ANALYTICS_FUNNELS.length + auto.autoFunnels.length,
      trends: funnelsMod.ANALYTICS_TRENDS.length + auto.autoTrends.length,
      retention: (funnelsMod.ANALYTICS_RETENTION ?? []).length,
    },
  };
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && fileURLToPath(import.meta.url) === resolve(entry);
}

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  const result = await scanUiGraph();
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const c = result.coverage;
    console.log(`ui-graph ok: ${c.publicHtmlPages} HTML pages, ${c.bootedSurfaces} booted surfaces, ${c.hudDockTabs + c.hudColonyTabs} in-game HUD tabs, ${c.trackedUiActions} UI actions, ${c.matcherCount} matchers -> ${c.funnels} funnels, ${c.trends} trends, ${c.retention} retention`);
    if (c.unbootedPages.length > 0) console.log(`unbooted: ${c.unbootedPages.join(', ')}`);
    if (c.deadMatchers.length > 0) console.log(`dead matchers: ${c.deadMatchers.join(', ')}`);
  }
  if (args.includes('--check') && (result.coverage.unbootedPages.length > 0 || result.coverage.deadMatchers.length > 0)) {
    process.exit(1);
  }
}
