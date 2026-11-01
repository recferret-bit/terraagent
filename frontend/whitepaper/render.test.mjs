import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderMarkdown } from './md-blocks.mjs';
import { renderInline } from './md-inline.mjs';
import { pagePath, sourcePath, writeWhitepaper } from './render.mjs';

function firstAtxH1(markdown) {
  const line = markdown.split(/\r?\n/).find((row) => /^#\s+/.test(row));
  assert.ok(line, 'markdown has an ATX h1');
  return line.replace(/^#\s+/, '').trim();
}

function h1Text(html) {
  const match = html.match(/<h1>([\s\S]*?)<\/h1>/);
  assert.ok(match, 'html has an h1');
  return match[1].replace(/<[^>]+>/g, '');
}

test('rendered h1 equals the markdown heading', () => {
  const markdown = readFileSync(sourcePath(), 'utf8');
  const expected = firstAtxH1(markdown);
  const html = writeWhitepaper();
  assert.equal(h1Text(html), expected);
  assert.equal(readFileSync(pagePath(), 'utf8'), html);
  assert.equal(expected, 'TerraAgent — Whitepaper (draft v0.1, 2026-10-31)');
  assert.match(html, /class="container doc"/);
  assert.match(html, /href="\.\.\/design\/css\/tokens\.css"/);
  assert.match(html, /href="\.\.\/design\/css\/base\.css"/);
  assert.match(html, /<table>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<a href="\.\.\/economy-balance-simulation\.md">/);
  assert.match(html, /<strong>/);
  assert.match(html, /<em>/);
  assert.match(html, /<code>/);
  assert.doesNotMatch(html, /border-radius/);
  assert.doesNotMatch(html, /#[0-9A-Fa-f]{3,8}\b/);
});

test('inline marks escape text and keep links', () => {
  const html = renderInline('**bold** *em* `a<b` [go](../x.md)');
  assert.equal(html, '<strong>bold</strong> <em>em</em> <code>a&lt;b</code> <a href="../x.md">go</a>');
});

test('ordered lists and thematic breaks render', () => {
  const html = renderMarkdown('1. First\n2. Second\n\n---\n');
  assert.match(html, /<ol>\n<li>First<\/li>\n<li>Second<\/li>\n<\/ol>/);
  assert.match(html, /<hr>/);
});
