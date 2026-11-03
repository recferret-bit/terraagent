import { isGameInputBlocked } from '../input/gameInputBlock';
import type { FeatureContext } from '../registry/types';

export type DockTabId = 'build' | 'production' | 'terraform' | 'queue';

/**
 * Whether `el` is on screen as far as the dock is concerned: its pane is the active tab of an expanded dock. An element
 * outside any dock pane (a standalone mount) counts as shown. A panel's hotkeys act only while this is true.
 */
export function isDockPaneShown(el: Element): boolean {
  const pane = el.closest('[data-tab-pane]');
  const dock = el.closest('[data-testid="command-dock"]');
  if (!pane || !dock) return true;
  return dock.getAttribute('data-collapsed') !== 'true' && pane.getAttribute('data-active') === 'true';
}

interface TabDef {
  readonly id: DockTabId;
  readonly label: string;
}

const TAB_DEFS: readonly TabDef[] = [
  { id: 'build', label: 'BUILD [B]' },
  { id: 'production', label: 'PRODUCTION [U]' },
  { id: 'terraform', label: 'TERRAFORM [T]' },
  { id: 'queue', label: 'QUEUE' },
];

export function resolveDockTabForFeature(featureId: string, flags: ReadonlySet<string>): DockTabId | null {
  if (featureId === 'construction-menu') return 'build';
  if (featureId === 'hub-placement' && !flags.has('W02')) return 'build';
  if (featureId === 'units-menu') return 'production';
  if (featureId === 'terraform-basic') return 'terraform';
  if (featureId === 'queue-panel') return 'queue';
  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
}

/** Unified collapsible tabbed command panel housing Building, Production, Terraforming, and Queue. */
export class CommandDock {
  readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly tabButtons = new Map<DockTabId, HTMLButtonElement>();
  private readonly panes = new Map<DockTabId, HTMLElement>();
  private activeTab: DockTabId;
  private collapsed = false;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    slotEl: HTMLElement,
    _ctx: FeatureContext,
    availableTabs: ReadonlySet<DockTabId>,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'ta-command-dock plate-sm';
    this.el.setAttribute('data-testid', 'command-dock');

    const bar = document.createElement('div');
    bar.className = 'ta-command-dock__bar';

    const tabsEl = document.createElement('div');
    tabsEl.className = 'ta-command-dock__tabs';
    tabsEl.setAttribute('role', 'tablist');

    const orderedTabs = TAB_DEFS.filter((d) => availableTabs.has(d.id));
    this.activeTab = orderedTabs[0]?.id ?? 'build';

    for (const def of orderedTabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-command-dock__tab';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-tab', def.id);
      btn.setAttribute('data-testid', `dock-tab-${def.id}`);
      btn.textContent = def.label;
      btn.onclick = () => this.selectOrToggleTab(def.id);
      tabsEl.appendChild(btn);
      this.tabButtons.set(def.id, btn);
    }

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'ta-command-dock__toggle';
    this.toggleBtn.setAttribute('data-testid', 'command-dock-toggle');
    this.toggleBtn.onclick = () => this.setCollapsed(!this.collapsed);

    bar.append(tabsEl, this.toggleBtn);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'ta-command-dock__body';

    for (const id of ['build', 'production', 'terraform'] as const) {
      const pane = document.createElement('div');
      pane.className = 'ta-command-dock__pane';
      pane.setAttribute('data-tab-pane', id);
      this.bodyEl.appendChild(pane);
      this.panes.set(id, pane);
    }

    const queuePane = document.createElement('div');
    queuePane.className = 'ta-command-dock__queue';
    queuePane.setAttribute('data-tab-pane', 'queue');
    this.bodyEl.appendChild(queuePane);
    this.panes.set('queue', queuePane);

    this.el.append(bar, this.bodyEl);
    slotEl.appendChild(this.el);

    this.onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDown, { capture: true });
    }

    this.syncDom();
  }

  containerFor(tab: DockTabId): HTMLElement {
    return this.panes.get(tab) ?? this.bodyEl;
  }

  selectTab(tab: DockTabId): void {
    if (!this.tabButtons.has(tab)) return;
    this.activeTab = tab;
    this.collapsed = false;
    this.syncDom();
  }

  selectOrToggleTab(tab: DockTabId): void {
    if (!this.tabButtons.has(tab)) return;
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

  getActiveTab(): DockTabId {
    return this.activeTab;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return; // a held key toggles once
    if (isGameInputBlocked()) return; // a modal (global map, pause) is up: B / U / T stay with it
    const key = (e.key ?? '').toLowerCase();
    if (key === 'b' && this.tabButtons.has('build')) {
      e.stopImmediatePropagation?.();
      this.selectOrToggleTab('build');
    } else if (key === 'u' && this.tabButtons.has('production')) {
      e.stopImmediatePropagation?.();
      this.selectOrToggleTab('production');
    } else if (key === 't' && this.tabButtons.has('terraform')) {
      e.stopImmediatePropagation?.();
      this.selectOrToggleTab('terraform');
    }
  }

  private syncDom(): void {
    this.el.setAttribute('data-collapsed', String(this.collapsed));
    this.el.setAttribute('data-active-tab', this.activeTab);
    this.toggleBtn.textContent = this.collapsed ? 'SHOW' : 'HIDE';
    this.toggleBtn.setAttribute('aria-expanded', String(!this.collapsed));

    for (const [id, btn] of this.tabButtons) {
      const isActive = !this.collapsed && this.activeTab === id;
      btn.setAttribute('data-active', String(isActive));
      btn.setAttribute('aria-selected', String(isActive));
    }

    for (const [id, pane] of this.panes) {
      if (id === 'queue') {
        pane.setAttribute('data-active', String(this.activeTab === 'queue'));
      } else {
        pane.setAttribute('data-active', String(this.activeTab === id));
      }
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    }
    this.el.remove();
  }
}
