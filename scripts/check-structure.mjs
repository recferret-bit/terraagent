#!/usr/bin/env node
// Enforces the architecture limits from AGENTS.md §6: no source file over 500 lines, no function over 100 lines.
//   npm run check:structure            (scans frontend/ and scripts/)
import ts from 'typescript';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MAX_FILE = 500, MAX_FUNC = 100;
const SKIP = new Set(['node_modules', 'dist']);
const FILE_EXT = /\.(ts|js|mjs|css|html)$/, CODE_EXT = /\.(ts|js|mjs)$/;
const problems = [];

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

for (const dir of ['frontend', 'scripts']) walk(join(ROOT, dir));
if (problems.length) { console.error(problems.join('\n') + `\n\n${problems.length} structure violation(s)`); process.exit(1); }
console.log('structure ok: every file ≤ 500 lines, every function ≤ 100 lines');
