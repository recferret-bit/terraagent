// Inline marks for the whitepaper renderer. Text is escaped; tags are emitted by the scanner.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (ch) => ESCAPES[ch]);
}

export function safeUrl(url) {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(?:\/|\.\.?\/|#)/.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(trimmed)) return trimmed;
  return '#';
}

function nextMark(src, from) {
  let at = src.length;
  for (const ch of ['`', '[', '*']) {
    const found = src.indexOf(ch, from);
    if (found >= 0 && found < at) at = found;
  }
  return at;
}

function takeCode(src, i) {
  if (src[i] !== '`') return null;
  const end = src.indexOf('`', i + 1);
  if (end < 0 || end === i + 1) return null;
  return { end: end + 1, html: `<code>${escapeHtml(src.slice(i + 1, end))}</code>` };
}

function takeLink(src, i) {
  if (src[i] !== '[') return null;
  const match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
  if (!match) return null;
  const html = `<a href="${escapeHtml(safeUrl(match[2]))}">${renderInline(match[1])}</a>`;
  return { end: i + match[0].length, html };
}

function takeBold(src, i) {
  if (!src.startsWith('**', i)) return null;
  const end = src.indexOf('**', i + 2);
  if (end < 0 || end === i + 2) return null;
  return { end: end + 2, html: `<strong>${renderInline(src.slice(i + 2, end))}</strong>` };
}

function takeEm(src, i) {
  if (src[i] !== '*' || src[i + 1] === '*') return null;
  const end = src.indexOf('*', i + 1);
  if (end < 0 || end === i + 1 || src[end + 1] === '*') return null;
  return { end: end + 1, html: `<em>${renderInline(src.slice(i + 1, end))}</em>` };
}

function takeMark(src, i) {
  return takeCode(src, i) || takeLink(src, i) || takeBold(src, i) || takeEm(src, i);
}

export function renderInline(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const at = nextMark(src, i);
    if (at > i) {
      out += escapeHtml(src.slice(i, at));
      i = at;
      continue;
    }
    const mark = takeMark(src, i);
    if (!mark) {
      out += escapeHtml(src[i]);
      i += 1;
      continue;
    }
    out += mark.html;
    i = mark.end;
  }
  return out;
}
