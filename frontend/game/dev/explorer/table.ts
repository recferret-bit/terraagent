import type { Row } from './api';
import type { TabDef } from './columns';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Renders the rows of one tab; keys not in `seen` (when `seen` is non-null) get the `is-new` highlight. */
export function renderTable(tab: TabDef, rows: Row[], seen: Set<string> | null): HTMLElement {
  if (!rows.length) return el('p', 'empty muted', tab.empty);
  const table = el('table', 'xt');
  const head = table.createTHead().insertRow();
  for (const c of tab.columns) head.appendChild(el('th', c.cls, c.head));
  const body = table.createTBody();
  for (const r of rows) {
    const tr = body.insertRow();
    if (seen && !seen.has(tab.key(r))) tr.className = 'is-new';
    const status = tab.columns.findIndex((c) => c.cls === 'status');
    for (const [i, c] of tab.columns.entries()) {
      const td = tr.insertCell();
      td.className = c.cls ?? '';
      td.textContent = c.cell(r);
      if (i === status) td.dataset.status = c.cell(r).toLowerCase();
    }
  }
  return table;
}
