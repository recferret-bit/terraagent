/** Tiny DOM builder shared by the economy panel views. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function button(label: string, cls: string, onClick: () => void, id?: string): HTMLButtonElement {
  const b = el('button', `btn btn-sm ${cls}`, label);
  b.type = 'button';
  if (id) b.id = id;
  b.addEventListener('click', onClick);
  return b;
}

export function badge(label: string, tone: string): HTMLSpanElement {
  return el('span', `badge badge-${tone}`, label);
}

export function plate(title: string, eyebrow = ''): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'plate-sm xe-plate');
  const head = el('div', 'xe-head');
  if (eyebrow) head.append(el('p', 'eyebrow', eyebrow));
  head.append(el('h2', 'h3', title));
  const body = el('div', 'xe-body');
  root.append(head, body);
  return { root, body };
}

export function table(headers: readonly string[], rows: readonly (readonly (string | Node)[])[]): HTMLTableElement {
  const t = el('table', 'xt');
  const head = el('tr');
  headers.forEach((h) => head.append(el('th', '', h)));
  t.append(head);
  for (const r of rows) {
    const tr = el('tr');
    for (const c of r) {
      const td = el('td');
      td.append(typeof c === 'string' ? document.createTextNode(c) : c);
      tr.append(td);
    }
    t.append(tr);
  }
  return t;
}
