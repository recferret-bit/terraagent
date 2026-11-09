import { $ } from '../dom';

export type DockEdge = 'left' | 'right' | 'bottom' | 'top';

export interface DockSpec {
  id: string;
  panel: HTMLElement;
  edge: DockEdge;
  showLabel: string;
  showTitle: string;
  /** Fallback parent for `#pg-show-bar` when `#overlay` is missing. */
  mount?: HTMLElement;
}

const TAB_ORDER = ['side', 'info', 'bar', 'lights'];
const specs = new Map<string, DockSpec>();
const collapsed = new Set<string>();
const suppressed = new Set<string>();
let listening = false;

/** Header tabs toggle their dialog. The tab stays outside the panel so innerHTML refreshes keep it. */
export function bindDock(spec: DockSpec): void {
  specs.set(spec.id, spec);
  ensureListener();
  paint(spec.id);
}

export function setDockHidden(id: string, next: boolean): void {
  if (next) collapsed.add(id);
  else collapsed.delete(id);
  paint(id);
}

export function isDockHidden(id: string): boolean {
  return collapsed.has(id);
}

/** Hide the SHOW tab while a feature-gated dialog is off. The panel keeps its own `[hidden]`. */
export function setDockSuppressed(id: string, next: boolean): void {
  if (next) suppressed.add(id);
  else suppressed.delete(id);
  paint(id);
}

function ensureListener(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('click', onDockClick);
}

function onDockClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const show = target.closest<HTMLElement>('[data-dock-show]');
  if (show?.dataset.dockShow) setDockHidden(show.dataset.dockShow, !isDockHidden(show.dataset.dockShow));
}

function paint(id: string): void {
  const spec = specs.get(id);
  if (!spec) return;
  const tab = showTab(spec);
  const closed = collapsed.has(id);
  spec.panel.classList.toggle('is-dock-hidden', closed);
  tab.hidden = suppressed.has(id);
  tab.classList.toggle('on', !closed);
  tab.setAttribute('aria-selected', closed ? 'false' : 'true');
}

function showBar(fallback?: HTMLElement): HTMLElement {
  const existing = document.getElementById('pg-show-bar');
  if (existing) return existing;
  const bar = document.createElement('div');
  bar.id = 'pg-show-bar';
  bar.setAttribute('role', 'tablist');
  const parent = $('#overlay') ?? fallback ?? document.body;
  parent.appendChild(bar);
  return bar;
}

function showTab(spec: DockSpec): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-dock-show="${spec.id}"]`);
  if (found) return found;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pg-btn pg-dock-show';
  btn.dataset.dockShow = spec.id;
  btn.dataset.testid = `dock-show-${spec.id}`;
  btn.title = spec.showTitle;
  btn.textContent = spec.showLabel;
  btn.hidden = true;
  const bar = showBar(spec.mount);
  const rank = TAB_ORDER.indexOf(spec.id);
  const next = [...bar.children].find((el) => TAB_ORDER.indexOf((el as HTMLElement).dataset.dockShow ?? '') > rank);
  if (next) bar.insertBefore(btn, next);
  else bar.appendChild(btn);
  return btn;
}
