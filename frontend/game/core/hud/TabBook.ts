import './tabBook.css';

export type BookSide = 'left' | 'right';

/** Whether a HUD panel element was mounted into a tab book pane (TabBook DOM contract: `[data-tab-pane]`). */
export function isInHudBook(el: Element): boolean {
  return el.closest('[data-tab-pane]') !== null;
}

export interface BookTabDef<T extends string = string> {
  readonly id: T;
  /** Spine label (rendered vertically). */
  readonly label: string;
  /** Optional hotkey hint shown under the label, e.g. `B`. */
  readonly hint?: string;
}

export interface TabBookOptions<T extends string> {
  /** `right`: tabs on the screen's right edge, page to their left; `left` mirrors it. */
  readonly side: BookSide;
  /** Tabs in spine order; only these exist (callers pass the enabled ones). */
  readonly tabs: readonly BookTabDef<T>[];
  /** Extra class on the root (e.g. `ta-command-dock`). */
  readonly className?: string;
  /** `data-testid` of the root, its tabs (`<prefix><id>`) and the collapse button. */
  readonly testId: string;
  readonly tabTestIdPrefix: string;
  readonly toggleTestId: string;
  /** Accessible name of the tab list. */
  readonly ariaLabel: string;
}

/**
 * Tab book: a column of horizontal-label tabs, one below another, beside one page. Exactly one tab is active and
 * shows its pane; the others are spines only. Clicking the active spine (or the collapse button) folds the page away
 * and leaves the spines. DOM contract (used by specs and hotkey gating): root `data-collapsed`, `data-active-tab`,
 * `data-side`; tabs `data-tab` + `data-active`; panes `data-tab-pane` + `data-active`.
 */
export class TabBook<T extends string> {
  readonly el: HTMLElement;
  readonly pageEl: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly tabButtons = new Map<T, HTMLButtonElement>();
  private readonly panes = new Map<T, HTMLElement>();
  private readonly badges = new Map<T, HTMLElement>();
  private activeTab: T;
  private collapsed = false;
  private readonly listeners = new Set<() => void>();

  constructor(parent: HTMLElement, private readonly opts: TabBookOptions<T>) {
    this.el = document.createElement('div');
    this.el.className = `ta-book${opts.className ? ` ${opts.className}` : ''}`;
    this.el.dataset.side = opts.side;
    this.el.setAttribute('data-testid', opts.testId);

    const spine = document.createElement('div');
    spine.className = 'ta-book__spine';
    spine.setAttribute('role', 'tablist');
    spine.setAttribute('aria-orientation', 'vertical');
    spine.setAttribute('aria-label', opts.ariaLabel);
    for (const def of opts.tabs) spine.appendChild(this.makeTab(def));

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'ta-book__toggle';
    this.toggleBtn.setAttribute('data-testid', opts.toggleTestId);
    this.toggleBtn.onclick = () => this.setCollapsed(!this.collapsed);
    spine.appendChild(this.toggleBtn);

    this.pageEl = document.createElement('div');
    this.pageEl.className = 'ta-book__page';
    for (const def of opts.tabs) {
      const pane = document.createElement('div');
      pane.className = 'ta-book__pane';
      pane.setAttribute('data-tab-pane', def.id);
      pane.setAttribute('role', 'tabpanel');
      this.pageEl.appendChild(pane);
      this.panes.set(def.id, pane);
    }

    this.activeTab = opts.tabs[0]?.id as T;
    this.el.append(spine, this.pageEl);
    parent.appendChild(this.el);
    this.syncDom();
  }

  private makeTab(def: BookTabDef<T>): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-book__tab';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-tab', def.id);
    btn.setAttribute('data-testid', `${this.opts.tabTestIdPrefix}${def.id}`);
    const label = document.createElement('span');
    label.className = 'ta-book__label';
    label.textContent = def.hint ? `${def.label} [${def.hint}]` : def.label;
    const badge = document.createElement('span');
    badge.className = 'ta-book__badge';
    badge.hidden = true;
    btn.append(label, badge);
    btn.onclick = () => this.selectOrToggleTab(def.id);
    this.tabButtons.set(def.id, btn);
    this.badges.set(def.id, badge);
    return btn;
  }

  has(tab: T): boolean {
    return this.tabButtons.has(tab);
  }

  /** Removes a tab and its pane (e.g. when every panel routed to it threw during mount). */
  removeTab(tab: T): void {
    const btn = this.tabButtons.get(tab);
    const pane = this.panes.get(tab);
    if (!btn && !pane) return;
    btn?.remove();
    pane?.remove();
    this.tabButtons.delete(tab);
    this.panes.delete(tab);
    this.badges.delete(tab);
    if (this.activeTab === tab) {
      this.activeTab = (this.tabButtons.keys().next().value ?? '') as T;
    }
    this.syncDom();
  }

  /** Number of tabs remaining in the book. */
  get tabCount(): number {
    return this.tabButtons.size;
  }

  /** The pane of `tab` (the page itself for an unknown tab). */
  containerFor(tab: T): HTMLElement {
    return this.panes.get(tab) ?? this.pageEl;
  }

  /** Opens the book on `tab` (unfolds it when collapsed). */
  selectTab(tab: T): void {
    if (!this.has(tab)) return;
    this.activeTab = tab;
    this.collapsed = false;
    this.syncDom();
  }

  /** Spine click: a folded book opens on `tab`, the active tab folds the book, another tab becomes active. */
  selectOrToggleTab(tab: T): void {
    if (!this.has(tab)) return;
    if (this.collapsed) {
      this.collapsed = false;
      this.activeTab = tab;
    } else if (this.activeTab === tab) {
      this.collapsed = true;
    } else {
      this.activeTab = tab;
    }
    this.syncDom();
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.syncDom();
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  getActiveTab(): T {
    return this.activeTab;
  }

  /** Whether `tab`'s pane is on screen (active tab of an unfolded book). */
  isShown(tab: T): boolean {
    return !this.collapsed && this.activeTab === tab;
  }

  /** A count / mark on a spine (combat alerts on a closed tab); null or 0 clears it. */
  setBadge(tab: T, value: number | string | null): void {
    const badge = this.badges.get(tab);
    if (!badge) return;
    const show = value !== null && value !== 0 && value !== '';
    badge.hidden = !show;
    badge.textContent = show ? String(value) : '';
  }

  /** Called after every tab / fold change. Returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private syncDom(): void {
    this.el.setAttribute('data-collapsed', String(this.collapsed));
    this.el.setAttribute('data-active-tab', this.activeTab);
    const folded = this.collapsed;
    this.toggleBtn.textContent = this.opts.side === 'right' ? (folded ? '◂' : '▸') : (folded ? '▸' : '◂');
    this.toggleBtn.title = folded ? 'Show' : 'Hide';
    this.toggleBtn.setAttribute('aria-label', folded ? 'Show panel' : 'Hide panel');
    this.toggleBtn.setAttribute('aria-expanded', String(!folded));
    for (const [id, btn] of this.tabButtons) {
      const on = this.isShown(id);
      btn.setAttribute('data-active', String(on));
      btn.setAttribute('aria-selected', String(on));
    }
    for (const [id, pane] of this.panes) pane.setAttribute('data-active', String(this.activeTab === id));
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    this.listeners.clear();
    this.el.remove();
  }
}
