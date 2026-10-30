#!/usr/bin/env node
// Code generation runner (PRODUCT_WAVES §4 "registries, not edits"). Every `scripts/gen/*.gen.mjs` exports
// `async function generate(root) → [{ path, content }]` (paths relative to the repo root). The runner writes them;
// with --check it writes nothing and fails when any generated file is missing or out of date (CI gate).
//   npm run gen          regenerate everything
//   npm run gen:check    fail on a stale or missing generated file
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');
const check = process.argv.includes('--check');
const gens = readdirSync(import.meta.dirname).filter((f) => f.endsWith('.gen.mjs')).sort();
const stale = [];
let written = 0;
for (const g of gens) {
  const mod = await import(pathToFileURL(join(import.meta.dirname, g)).href);
  for (const { path, content } of await mod.generate(ROOT)) {
    const abs = join(ROOT, path);
    const prev = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (prev === content) continue;
    if (check) stale.push(`${path}  (${g})`);
    else { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); written++; console.log(`gen  ${path}`); }
  }
}
if (stale.length) {
  console.error(`generated files are stale; run \`npm run gen\` and commit:\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? `gen ok: ${gens.length} generator(s), everything up to date` : `gen: ${gens.length} generator(s), ${written} file(s) written`);
