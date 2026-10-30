#!/usr/bin/env node
// Enforces the architecture limits from AGENTS.md §6: no source file over 500 lines, no function over 100 lines,
// and layering: frontend/render imports no app and no `@terra/sim`, an app imports no other app, and `shared/*`
// imports neither frontend nor backend code.
//   npm run check:structure            (scans frontend/, shared/, backend/, scenarios/, e2e/ and scripts/)
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MAX_FILE = 500, MAX_FUNC = 100;
const SKIP = new Set(['node_modules', 'dist', 'generated', 'test-results', 'playwright-report', '.out']);
const FILE_EXT = /\.(ts|js|mjs|css|html)$/, CODE_EXT = /\.(ts|js|mjs)$/;
const problems = [];
const APPS = ['game', 'landing', 'playground']; // design/ (tokens, base.css) is a shared layer any app may import
// frontend/<area>/… → area name ('render' or an app); anything else → null
const areaOf = (rel) => { const m = /^frontend\/([^/]+)\//.exec(rel); return m ? m[1] : null; };
// packages a shared/* package must never import (frontend apps, the render engine, the server)
const NOT_FROM_SHARED = /^@terra\/(app|game|landing|playground|render|design)(\/|$)/;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (FILE_EXT.test(name)) check(path);
  }
}

function check(path) {
  const rel = relative(ROOT, path), text = readFileSync(path, 'utf8');
  const lines = text.split('\n').length;
  if (lines > MAX_FILE) problems.push(`file  ${lines} lines (max ${MAX_FILE})  ${rel}`);
  if (!CODE_EXT.test(path)) return;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
  const visit = (node) => {
    const spec = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : null;
    if (spec && ts.isStringLiteral(spec)) checkLayer(rel, spec.text, sf.getLineAndCharacterOfPosition(spec.getStart()).line + 1);
    if (ts.isFunctionLike(node) && node.body) {
      const a = sf.getLineAndCharacterOfPosition(node.getStart()).line;
      const len = sf.getLineAndCharacterOfPosition(node.end).line - a + 1;
      if (len > MAX_FUNC) {
        const name = node.name?.getText() ?? node.parent?.name?.getText() ?? '(anonymous)';
        problems.push(`func  ${len} lines (max ${MAX_FUNC})  ${rel}:${a + 1} ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function checkLayer(rel, spec, line) {
  if (rel.startsWith('shared/')) {
    const target = spec.startsWith('.') ? relative(ROOT, resolve(ROOT, dirname(rel), spec)) : '';
    if (NOT_FROM_SHARED.test(spec) || /^(frontend|backend)\//.test(target)) problems.push(`layer shared imports app code '${spec}'  ${rel}:${line}`);
    return;
  }
  // render may use the presentation-safe hex math (CLIENT §7), nothing else of the engine
  if (areaOf(rel) === 'render' && /^@terra\/sim(\/|$)/.test(spec) && spec !== '@terra/sim/grid/hex') problems.push(`layer render imports '${spec}' (apps pass sim views in)  ${rel}:${line}`);
  const from = areaOf(rel);
  if (!from || !spec.startsWith('.')) return;
  const to = areaOf(relative(ROOT, resolve(ROOT, dirname(rel), spec)));
  if (!to || to === from) return;
  if (from === 'render' && APPS.includes(to)) problems.push(`layer render imports app '${to}'  ${rel}:${line}`);
  else if (APPS.includes(from) && APPS.includes(to)) problems.push(`layer app '${from}' imports app '${to}'  ${rel}:${line}`);
  else if (APPS.includes(from) && to === 'render') problems.push(`layer use '@terra/render/…', not a relative path  ${rel}:${line}`);
}

for (const dir of ['frontend', 'shared', 'backend', 'scenarios', 'e2e', 'scripts']) if (existsSync(join(ROOT, dir))) walk(join(ROOT, dir));
if (problems.length) { console.error(problems.join('\n') + `\n\n${problems.length} structure violation(s)`); process.exit(1); }
console.log('structure ok: every file ≤ 500 lines, every function ≤ 100 lines, layers point inward');
