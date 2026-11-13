// Build-time renderer: docs/hackathon/public/whitepaper.md -> frontend/whitepaper/index.html.
// Wraps the compiled canonical markdown inside the interactive Faction Plate shell
// so Docker builds (`Dockerfile.frontend`) and tests keep both in sync.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './md-blocks.mjs';
import { buildWhitepaperHtml } from './renderTemplate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../..');

export function sourcePath() {
  return resolve(repoRoot, 'docs/hackathon/public/whitepaper.md');
}

export function pagePath() {
  return resolve(here, 'index.html');
}

export function firstHeading(markdown) {
  const line = markdown.split(/\r?\n/).find((row) => row.startsWith('# '));
  return line ? line.replace(/^#\s+/, '').trim() : 'Whitepaper';
}

export function renderPage(markdown) {
  const title = firstHeading(markdown);
  const canonicalBodyHtml = renderMarkdown(markdown).replace(/^<h1>[\s\S]*?<\/h1>\s*/, '');
  return buildWhitepaperHtml(title, canonicalBodyHtml);
}

export function writeWhitepaper() {
  const markdown = readFileSync(sourcePath(), 'utf8');
  const html = renderPage(markdown);
  writeFileSync(pagePath(), html);
  return html;
}

function runAsCli() {
  if (!process.argv[1]) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (runAsCli()) writeWhitepaper();
