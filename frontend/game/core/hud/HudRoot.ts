import { HUD_SLOTS, type Feature, type FeatureContext, type GameView, type HudPanelDef, type HudPanelInstance, type HudSlot } from '../registry/types';
import { ColonyBook, resolveColonyTab, type ColonyTabId } from './ColonyBook';
import { CommandDock, resolveDockTabForFeature, type DockTabId } from './CommandDock';
import type { TabBook } from './TabBook';
import './hud.css';

interface PanelDef { f: Feature; p: HudPanelDef }

/**
 * pointer-events:none overlay with five slot containers and two vertical tab books: the Command Dock (top right:
 * Build, Production, Terraform, Queue) and its mirror, the Colony book (top left, under the minimap: Player, Away,
 * Deed, Goals, HQ AI, Director, Combat, Supply, Trade). Mounts every enabled feature's HUD panels into their book
 * tab or slot, and gives features `services.hudOverlay` (un-clipped layer for modals) plus `revealHudPanel` /
 * `setHudTabBadge`.
 */
export class HudRoot {
  readonly el: HTMLElement;
  readonly overlay: HTMLElement;
  private slots = new Map<HudSlot, HTMLElement>();
  private panels: HudPanelInstance[] = [];
  private dock: CommandDock | null = null;
  private colony: ColonyBook | null = null;
  private readonly closers = new Set<() => void>();

  constructor(parent: HTMLElement, features: readonly Feature[], ctx: FeatureContext) {
    this.el = document.createElement('div');
    this.el.className = 'ta-hud';
    for (const s of HUD_SLOTS) {
      const slot = document.createElement('div');
      slot.className = 'ta-hud__slot';
      slot.dataset.slot = s;
      this.el.appendChild(slot);
      this.slots.set(s, slot);
    }
    this.overlay = document.createElement('div');
    this.overlay.className = 'ta-hud__overlay';
    this.el.appendChild(this.overlay);

    const defs = features.flatMap((f) => (f.hud ?? []).map((p) => ({ f, p })));
    defs.sort((a, b) => (a.p.order ?? 0) - (b.p.order ?? 0));
    this.mountBooks(defs, ctx);
    this.provideServices(ctx);

    for (const def of defs) this.mountPanel(def, ctx);
    this.pruneEmptyBookTabs();
    this.colony?.book.refresh();
    if (this.colony && (this.dock !== null || this.colony.book.isDialogOnlyTab(this.colony.book.getActiveTab()))) {
      this.colony.book.setCollapsed(true);
    }
    this.bindMutualCollapse();
    parent.appendChild(this.el);
  }

  private bindMutualCollapse(): void {
    this.dock?.book.onChange(() => {
      if (this.dock && !this.dock.isCollapsed() && this.colony && !this.colony.book.isCollapsed()) {
        this.colony.book.setCollapsed(true);
      }
    });
    this.colony?.book.onChange(() => {
      if (this.colony && !this.colony.book.isCollapsed() && this.dock && !this.dock.isCollapsed()) {
        this.dock.setCollapsed(true);
      }
    });
  }

  private pruneEmptyBookTabs(): void {
    const prune = (book: TabBook<string> | undefined): boolean => {
      if (!book) return false;
      for (const pane of [...book.pageEl.querySelectorAll<HTMLElement>('[data-tab-pane]')]) {
        const tab = pane.getAttribute('data-tab-pane');
        if (tab && pane.childElementCount === 0) book.removeTab(tab);
      }
      return book.tabCount === 0;
    };
    if (prune(this.dock?.book as TabBook<string> | undefined)) {
      this.dock?.dispose();
      this.dock = null;
    }
    if (prune(this.colony?.book as TabBook<string> | undefined)) {
      this.colony?.dispose();
      this.colony = null;
    }
  }

  private mountBooks(defs: readonly PanelDef[], ctx: FeatureContext): void {
    const dockTabs = new Set<DockTabId>();
    const colonyTabs = new Set<ColonyTabId>();
    for (const { f, p } of defs) {
      const dockTab = resolveDockTabForFeature(f.id, ctx.flags);
      if (dockTab) dockTabs.add(dockTab);
      const colonyTab = resolveColonyTab(f.id, p.id);
      if (colonyTab) colonyTabs.add(colonyTab);
    }
    const rightSlot = this.slots.get('top-right')!;
    if (dockTabs.size > 0) {
      this.dock = new CommandDock(rightSlot, ctx, dockTabs, () => {
        this.colony?.book.setCollapsed(true);
      });
    }
    if (colonyTabs.size > 0) {
      this.colony = new ColonyBook(rightSlot, colonyTabs, (tab) => {
        this.dock?.setCollapsed(true);
        if (this.colony && (this.colony.book.isCollapsed() || this.colony.book.getActiveTab() !== tab)) {
          if (this.colony.book.isDialogOnlyTab(tab)) {
            this.runClosers();
          } else {
            ctx.services.openPilotDialog?.(false);
            ctx.services.openDeedPanel?.(false);
            ctx.services.openTradeHubPanel?.(false);
          }
        }
      });
    }
  }

  private runClosers(): void {
    for (const close of [...this.closers]) {
      try { close(); } catch (e) { console.warn('HUD closer failed', e); }
    }
  }

  private bookOf(el: Element): TabBook<string> | null {
    const bookEl = el.closest('.ta-book');
    if (!bookEl) return null;
    if (this.dock?.el === bookEl) return this.dock.book as TabBook<string>;
    if (this.colony?.el === bookEl) return this.colony.book as TabBook<string>;
    return null;
  }

  private provideServices(ctx: FeatureContext): void {
    const s = ctx.services;
    s.hudOverlay = this.overlay;
    s.revealHudPanel = (el) => {
      const tab = el.closest('[data-tab-pane]')?.getAttribute('data-tab-pane');
      if (tab) this.bookOf(el)?.selectTab(tab);
    };
    s.setHudTabBadge = (el, value) => {
      const tab = el.closest('[data-tab-pane]')?.getAttribute('data-tab-pane');
      if (tab) this.bookOf(el)?.setBadge(tab, value);
    };
    s.registerHudCloser = (close) => {
      this.closers.add(close);
      return () => { this.closers.delete(close); };
    };
    s.closeHudMenus = () => this.closeAll();
  }

  /** Folds both books and runs every registered closer (one failing closer does not stop the others). */
  closeAll(): void {
    this.dock?.setCollapsed(true);
    this.colony?.book.setCollapsed(true);
    this.runClosers();
  }

  private containerFor({ f, p }: PanelDef, ctx: FeatureContext): HTMLElement {
    const dockTab = resolveDockTabForFeature(f.id, ctx.flags);
    if (dockTab && this.dock) return this.dock.containerFor(dockTab);
    const colonyTab = resolveColonyTab(f.id, p.id);
    if (colonyTab && this.colony) return this.colony.containerFor(colonyTab);
    return this.slots.get(p.slot) ?? this.slots.get('top-center')!;
  }

  private mountPanel(def: PanelDef, ctx: FeatureContext): void {
    const { f, p } = def;
    const el = document.createElement('div');
    el.className = 'ta-hud__panel';
    el.dataset.feature = f.id;
    el.dataset.panel = p.id;
    this.containerFor(def, ctx).appendChild(el);
    try { this.panels.push(p.mount(el, ctx)); } catch (e) { console.warn(`HUD panel ${f.id}/${p.id} failed`, e); el.remove(); }
  }

  setVisible(visible: boolean) {
    this.el.hidden = !visible;
  }

  update(view: GameView) {
    for (const p of this.panels) p.update?.(view);
  }

  dispose() {
    for (const p of this.panels) { try { p.dispose(); } catch (e) { console.warn(e); } }
    this.panels = [];
    this.closers.clear();
    this.dock?.dispose();
    this.dock = null;
    this.colony?.dispose();
    this.colony = null;
    this.el.remove();
  }
}
