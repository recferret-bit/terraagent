import type { PanelStatus } from '../model/state';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/** Tiny DOM builder: `h('button', { class: 'btn', onclick: fn }, 'Text')`. Never uses innerHTML, so server text cannot inject markup. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const svgEl = (tag: string, attrs: Record<string, string | number> = {}, ...children: Node[]): SVGElement => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
};

/** `replaceChildren` that skips null / false entries. */
export function fill(el: Element, ...children: Child[]): void { el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false)); }

export const clear = (el: Element): void => { el.replaceChildren(); };

/** A panel plate: title row (with optional actions) plus a body that shows loading / error / empty / content. */
export interface Panel { readonly root: HTMLElement; readonly body: HTMLElement; readonly actions: HTMLElement }

export function panel(id: string, title: string, hint?: string): Panel {
  const actions = h('div', { class: 'tr-actions' });
  const body = h('div', { class: 'tr-body', 'data-panel-body': id });
  const root = h('section', { class: 'tr-panel plate-sm', 'data-panel': id, 'aria-labelledby': `tr-h-${id}` },
    h('header', { class: 'tr-panel-head' },
      h('h2', { class: 'tr-h', id: `tr-h-${id}` }, title),
      hint ? h('span', { class: 'tr-hint' }, hint) : null,
      actions),
    body);
  return { root, body, actions };
}

export const note = (text: string, kind: 'info' | 'warn' | 'err' = 'info'): HTMLElement => h('p', { class: `tr-note tr-note-${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);

/** Renders the status placeholder when the panel is not ready; returns true when the caller should draw its content. */
export function gate(body: HTMLElement, st: PanelStatus, empty: string | null): boolean {
  if (st.status === 'loading' || st.status === 'idle') { body.replaceChildren(h('p', { class: 'tr-note tr-loading', role: 'status' }, 'Loading...')); return false; }
  if (st.status === 'error') { body.replaceChildren(note(st.error ?? 'Could not load this panel.', 'err')); return false; }
  if (empty !== null) { body.replaceChildren(note(empty)); return false; }
  return true;
}

export function copyText(text: string): Promise<boolean> {
  return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
}

export const badge = (text: string, kind: string): HTMLElement => h('span', { class: `tr-badge tr-badge-${kind}` }, text);

/** `stack`: under 640 px every row becomes a card (each cell shows its column label), so no column is pushed off-screen. */
export function table(headers: ReadonlyArray<{ label: string; num?: boolean }>, rows: HTMLElement[], caption: string, stack = false): HTMLElement {
  if (stack) for (const r of rows) [...(r as HTMLTableRowElement).cells].forEach((c, i) => { if (headers[i]?.label) c.setAttribute('data-label', headers[i]!.label); });
  return h('div', { class: 'tr-scroll', tabindex: 0, role: 'region', 'aria-label': caption },
    h('table', { class: stack ? 'tr-table tr-stack' : 'tr-table' },
      h('caption', { class: 'tr-sr' }, caption),
      h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', { scope: 'col', class: x.num ? 'num' : '' }, x.label)))),
      h('tbody', {}, ...rows)));
}

export const td = (content: Child, cls = ''): HTMLElement => h('td', { class: cls }, content);
