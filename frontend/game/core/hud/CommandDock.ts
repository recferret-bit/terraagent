import { isGameInputBlocked } from '../input/gameInputBlock';
import type { FeatureContext } from '../registry/types';
import { TabBook, type BookTabDef } from './TabBook';

export type DockTabId = 'build' | 'production' | 'terraform' | 'queue';

/**
 * Whether `el` is on screen as far as a tab book is concerned: its pane is the active tab of an unfolded book. An
 * element outside any book pane (a standalone mount) counts as shown. A panel's hotkeys act only while this is true.
 */
const QUEUE_RIDES_UNDER: ReadonlySet<string> = new Set(['build', 'production']);

export function isDockPaneShown(el: Element): boolean {
  const pane = el.closest('[data-tab-pane]');
  const book = el.closest('.ta-book');
  if (!pane || !book) return true;
  if (book.getAttribute('data-collapsed') === 'true') return false;
  if (pane.getAttribute('data-active') === 'true') return true;
  // The dock's queue pane also rides under Build / Production (hud.css), so it is on screen there too.
  return pane.classList.contains('ta-command-dock__queue') && QUEUE_RIDES_UNDER.has(book.getAttribute('data-active-tab') ?? '');
}

const TAB_DEFS: readonly BookTabDef<DockTabId>[] = [
  { id: 'build', label: 'BUILD', hint: 'B' },
  { id: 'production', label: 'PRODUCTION', hint: 'U' },
  { id: 'terraform', label: 'TERRAFORM', hint: 'T' },
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

const HOTKEYS: Readonly<Record<string, DockTabId>> = { b: 'build', u: 'production', t: 'terraform' };

/**
 * The Command Dock: the right-edge vertical tab book (top right, under the FPS counter) housing Build, Production,
 * Terraform and Queue. `B` / `U` / `T` open or fold their tab. The queue pane also shows (when it has entries) under
 * Build and Production, so an order's progress stays visible while you place more.
 */
export class CommandDock {
  readonly el: HTMLElement;
  readonly book: TabBook<DockTabId>;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    slotEl: HTMLElement,
    _ctx: FeatureContext,
    availableTabs: ReadonlySet<DockTabId>,
    onSpineClick?: (tab: DockTabId) => void,
  ) {
    this.book = new TabBook(slotEl, {
      side: 'right',
      tabs: TAB_DEFS.filter((d) => availableTabs.has(d.id)),
      className: 'ta-command-dock',
      testId: 'command-dock',
      tabTestIdPrefix: 'dock-tab-',
      toggleTestId: 'command-dock-toggle',
      ariaLabel: 'Commands',
      onSpineClick,
    });
    this.el = this.book.el;
    if (this.book.has('queue')) this.book.containerFor('queue').classList.add('ta-command-dock__queue');

    this.onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDown, { capture: true });
    }
  }

  containerFor(tab: DockTabId): HTMLElement {
    return this.book.containerFor(tab);
  }

  selectTab(tab: DockTabId): void {
    this.book.selectTab(tab);
  }

  selectOrToggleTab(tab: DockTabId): void {
    this.book.selectOrToggleTab(tab);
  }

  setCollapsed(collapsed: boolean): void {
    this.book.setCollapsed(collapsed);
  }

  isCollapsed(): boolean {
    return this.book.isCollapsed();
  }

  getActiveTab(): DockTabId {
    return this.book.getActiveTab();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return; // a held key toggles once
    if (isGameInputBlocked()) return; // a modal (global map, pause) is up: B / U / T stay with it
    const tab = HOTKEYS[(e.key ?? '').toLowerCase()];
    if (!tab || !this.book.has(tab)) return;
    e.stopImmediatePropagation?.();
    this.book.selectOrToggleTab(tab);
  }

  dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    }
    this.book.dispose();
  }
}
