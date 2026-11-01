// Block markdown for the whitepaper: headings, paragraphs, lists, tables, quotes, rules.

import { renderInline } from './md-inline.mjs';

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL = /^[-*+]\s+/;
const OL = /^\d+\.\s+/;
const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function isBlank(line) {
  return line.trim() === '';
}

function splitCells(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

function isTableStart(lines, i) {
  return lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim());
}

function startsBlock(lines, i) {
  const line = lines[i];
  return HEADING.test(line) || RULE.test(line) || line.startsWith('>') || UL.test(line) || OL.test(line) || isTableStart(lines, i);
}

function renderTable(lines, i) {
  const head = splitCells(lines[i]);
  const rows = [];
  let next = i + 2;
  while (next < lines.length && lines[next].trim().startsWith('|')) {
    rows.push(splitCells(lines[next]));
    next += 1;
  }
  const th = head.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('\n');
  const html = `<div class="table-wrap">\n<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>\n</div>`;
  return { html, next };
}

function renderList(lines, i, pattern, tag) {
  const items = [];
  let next = i;
  while (next < lines.length && pattern.test(lines[next])) {
    items.push(lines[next].replace(pattern, ''));
    next += 1;
  }
  const lis = items.map((item) => `<li>${renderInline(item)}</li>`).join('\n');
  return { html: `<${tag}>\n${lis}\n</${tag}>`, next };
}

function renderQuote(lines, i) {
  const parts = [];
  let next = i;
  while (next < lines.length && lines[next].startsWith('>')) {
    parts.push(lines[next].replace(/^>\s?/, ''));
    next += 1;
  }
  return { html: `<blockquote><p>${renderInline(parts.join(' '))}</p></blockquote>`, next };
}

function renderParagraph(lines, i) {
  const parts = [];
  let next = i;
  while (next < lines.length && !isBlank(lines[next]) && !startsBlock(lines, next)) {
    parts.push(lines[next]);
    next += 1;
  }
  return { html: `<p>${renderInline(parts.join(' '))}</p>`, next };
}

function renderBlock(lines, i) {
  const line = lines[i];
  const heading = HEADING.exec(line);
  if (heading) {
    const level = heading[1].length;
    return { html: `<h${level}>${renderInline(heading[2])}</h${level}>`, next: i + 1 };
  }
  if (RULE.test(line)) return { html: '<hr>', next: i + 1 };
  if (line.startsWith('>')) return renderQuote(lines, i);
  if (isTableStart(lines, i)) return renderTable(lines, i);
  if (UL.test(line)) return renderList(lines, i, UL, 'ul');
  if (OL.test(line)) return renderList(lines, i, OL, 'ol');
  return renderParagraph(lines, i);
}

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1;
      continue;
    }
    const block = renderBlock(lines, i);
    blocks.push(block.html);
    if (block.next <= i) throw new Error(`renderer stalled at line ${i + 1}`);
    i = block.next;
  }
  return blocks.join('\n');
}
