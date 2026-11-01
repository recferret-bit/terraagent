// Build-time renderer: docs/hackathon/public/whitepaper.md → frontend/whitepaper/index.html.
// The image runs this before vite so the HTML is not a second copy of the prose.

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './md-blocks.mjs';
import { escapeHtml } from './md-inline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../..');

const PAGE_CSS = `
.doc { padding-top: var(--ta-s8); padding-bottom: var(--ta-s9); }
.doc article { display: flex; flex-direction: column; gap: var(--ta-s5); }
.doc h1, .doc h2, .doc h3 { font-family: var(--ta-font-display); font-weight: 700; line-height: 1.15; margin: 0; }
.doc h1 { font-size: var(--ta-fs-h1); }
.doc h2 { font-size: var(--ta-fs-h3); margin-top: var(--ta-s3); }
.doc h3 { font-size: var(--ta-fs-body-l); }
.doc p { margin: 0; }
.doc ul, .doc ol { margin: 0; padding-left: var(--ta-s6); }
.doc li + li { margin-top: var(--ta-s3); }
.doc blockquote { margin: 0; padding: var(--ta-s4) var(--ta-s5); background: var(--ta-plate); border-left: 3px solid var(--ta-orange); }
.doc blockquote p { color: var(--ta-text-2); }
.doc code { font-family: var(--ta-font-mono); font-size: 0.92em; color: var(--ta-energy); }
.doc table { width: 100%; border-collapse: collapse; }
.doc th, .doc td { text-align: left; vertical-align: top; padding: var(--ta-s3) var(--ta-s4); border-bottom: 1px solid var(--ta-seam); }
.doc th { font-family: var(--ta-font-mono); font-size: var(--ta-fs-label); letter-spacing: var(--ta-track-label); color: var(--ta-orange); font-weight: 600; }
.doc td { color: var(--ta-text-2); }
.table-wrap { overflow-x: auto; }
.doc hr { border: 0; height: 1px; background: var(--ta-seam); margin: 0; }
`.trim();

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
  const body = renderMarkdown(markdown);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="../design/css/tokens.css">
<link rel="stylesheet" href="../design/css/base.css">
<style>
${PAGE_CSS}
</style>
</head>
<body>
<main class="container doc">
<article>
${body}
</article>
</main>
</body>
</html>
`;
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
