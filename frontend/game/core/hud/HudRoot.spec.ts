// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Feature, FeatureContext, FeatureServices, HudPanelDef, HudSlot } from '../registry/types';
import { HudRoot } from './HudRoot';

let roots: HudRoot[] = [];
afterEach(() => {
  for (const r of roots) r.dispose();
  roots = [];
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const panel = (id: string, slot: HudSlot = 'top-left', extra: Partial<HudPanelDef> = {}): HudPanelDef => ({
  id, slot, mount: (el) => { el.textContent = id; return { dispose() {} }; }, ...extra,
});
const feature = (id: string, ...hud: HudPanelDef[]): Feature => ({ id, wave: 'W00', hud });

function mount(features: Feature[], flags: string[] = []): { root: HudRoot; ctx: FeatureContext; services: FeatureServices } {
  const services: FeatureServices = { track: () => {} };
  const ctx: FeatureContext = { flags: new Set(flags), host: 'server', services };
  const root = new HudRoot(document.body, features, ctx);
  roots.push(root);
  return { root, ctx, services };
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const panelEl = (featureId: string, panelId: string) => $(`[data-feature="${featureId}"][data-panel="${panelId}"]`)!;
const paneOf = (el: Element) => el.closest('[data-tab-pane]')?.getAttribute('data-tab-pane') ?? null;
const bookOf = (el: Element) => el.closest('.ta-book')?.getAttribute('data-testid') ?? null;
const slotOf = (el: Element) => el.closest<HTMLElement>('.ta-hud__slot')?.dataset.slot ?? null;

const COLONY = [
  feature('deed', panel('colony-deed')),
  feature('director', panel('director-status', 'bottom-right')),
  feature('combat', panel('combat-alerts', 'top-center')),
];
const DOCK = [feature('construction-menu', panel('construction', 'bottom-left')), feature('queue-panel', panel('queue', 'bottom-left'))];

describe('HudRoot routing', () => {
  it('builds the five slots and the overlay, and puts book panels into their book pane', () => {
    mount([...COLONY, ...DOCK, feature('maps', panel('minimap', 'bottom-left'))]);
    expect([...document.querySelectorAll('.ta-hud__slot')].map((s) => (s as HTMLElement).dataset.slot))
      .toEqual(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-right']);
    expect([bookOf(panelEl('deed', 'colony-deed')), paneOf(panelEl('deed', 'colony-deed'))]).toEqual(['colony-book', 'deed']);
    expect(paneOf(panelEl('director', 'director-status'))).toBe('director');
    expect(paneOf(panelEl('combat', 'combat-alerts'))).toBe('combat');
    expect([bookOf(panelEl('construction-menu', 'construction')), paneOf(panelEl('construction-menu', 'construction'))])
      .toEqual(['command-dock', 'build']);
    expect(paneOf(panelEl('queue-panel', 'queue'))).toBe('queue');
    const minimap = panelEl('maps', 'minimap');
    expect([bookOf(minimap), slotOf(minimap)]).toEqual([null, 'bottom-left']);
  });

  it('places the dock in the top-right slot and the colony book in the top-left slot', () => {
    mount([...COLONY, ...DOCK]);
    expect(slotOf($('[data-testid=command-dock]')!)).toBe('top-right');
    expect(slotOf($('[data-testid=colony-book]')!)).toBe('top-left');
  });

  it('creates only the tabs whose panel is enabled, in book order', () => {
    mount([COLONY[2]!, COLONY[0]!]);
    const tabs = [...document.querySelectorAll('[data-testid^=colony-tab-]')].map((t) => t.getAttribute('data-testid'));
    expect(tabs).toEqual(['colony-tab-deed', 'colony-tab-combat']);
  });

  it('no book when no panel routes to one; a feature’s other panels keep their slot', () => {
    mount([feature('deed', panel('deed-toast', 'bottom-right')), feature('hud-min', panel('env', 'bottom-left'))]);
    expect($('[data-testid=colony-book]')).toBeNull();
    expect($('[data-testid=command-dock]')).toBeNull();
    expect(slotOf(panelEl('deed', 'deed-toast'))).toBe('bottom-right');
  });

  it('hub-placement goes to the dock only before W02', () => {
    mount([feature('hub-placement', panel('ghost', 'bottom-left'))]);
    expect(paneOf(panelEl('hub-placement', 'ghost'))).toBe('build');
    roots.pop()!.dispose();
    mount([feature('hub-placement', panel('ghost', 'bottom-left'))], ['W02']);
    expect($('[data-testid=command-dock]')).toBeNull();
    expect(slotOf(panelEl('hub-placement', 'ghost'))).toBe('bottom-left');
  });

  it('mounts panels in ascending order within a container', () => {
    mount([feature('hud-min', panel('b', 'bottom-right', { order: 5 }), panel('a', 'bottom-right', { order: -1 }), panel('c', 'bottom-right'))]);
    const slot = $('.ta-hud__slot[data-slot=bottom-right]')!;
    expect([...slot.children].map((c) => (c as HTMLElement).dataset.panel)).toEqual(['a', 'c', 'b']);
  });

  it('a panel whose mount throws is removed, its empty tab is pruned, and the others still mount', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount([feature('deed', panel('colony-deed', 'top-left', { mount: () => { throw new Error('boom'); } })), COLONY[1]!]);
    expect($('[data-feature=deed]')).toBeNull();
    expect($('[data-testid=colony-tab-deed]')).toBeNull();
    expect($('[data-testid=colony-book]')!.dataset.activeTab).toBe('director');
    expect(panelEl('director', 'director-status')).not.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('disposes the book entirely when every panel routed to it throws during mount', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount([feature('deed', panel('colony-deed', 'top-left', { mount: () => { throw new Error('boom'); } }))]);
    expect($('[data-testid=colony-book]')).toBeNull();
  });
});

describe('HudRoot services', () => {
  it('revealHudPanel opens the right tab in the right book and unfolds it', () => {
    const { root, services } = mount([...COLONY, ...DOCK]);
    const colony = $('[data-testid=colony-book]')!;
    const dock = $('[data-testid=command-dock]')!;
    (root as unknown as { colony: { book: { setCollapsed(c: boolean): void } } }).colony.book.setCollapsed(true);
    services.revealHudPanel!(panelEl('director', 'director-status').appendChild(document.createElement('span')));
    expect([colony.dataset.activeTab, colony.dataset.collapsed]).toEqual(['director', 'false']);
    expect(dock.dataset.activeTab).toBe('build'); // the other book is untouched
    services.revealHudPanel!(panelEl('queue-panel', 'queue'));
    expect(dock.dataset.activeTab).toBe('queue');
    expect(colony.dataset.activeTab).toBe('director');
  });

  it('revealHudPanel is a no-op outside a book', () => {
    const { services } = mount([...COLONY, feature('maps', panel('minimap', 'bottom-left'))]);
    const colony = $('[data-testid=colony-book]')!;
    services.revealHudPanel!(panelEl('maps', 'minimap'));
    services.revealHudPanel!(document.body);
    const stray = document.createElement('div');
    stray.setAttribute('data-tab-pane', 'combat'); // a pane-like element outside the books
    document.body.appendChild(stray);
    services.revealHudPanel!(stray);
    expect(colony.dataset.activeTab).toBe('deed');
  });

  it('setHudTabBadge marks the spine of the tab holding the element and clears it', () => {
    const { services } = mount(COLONY);
    const badge = () => $('[data-testid=colony-tab-combat] .ta-book__badge')!;
    services.setHudTabBadge!(panelEl('combat', 'combat-alerts'), 2);
    expect([badge().hidden, badge().textContent]).toEqual([false, '2']);
    services.setHudTabBadge!(panelEl('combat', 'combat-alerts'), 0);
    expect(badge().hidden).toBe(true);
    services.setHudTabBadge!(document.body, 5); // outside a book: nothing to mark
    expect($('[data-testid=colony-tab-deed] .ta-book__badge')!.hidden).toBe(true);
  });

  it('provides the overlay outside the slots and books; dispose removes the HUD, books, overlay and disposes panels', () => {
    const disposed: string[] = [];
    const tracked = (id: string, slot: HudSlot) => panel(id, slot, { mount: () => ({ dispose: () => disposed.push(id) }) });
    const { root, services } = mount([feature('deed', tracked('colony-deed', 'top-left')), feature('maps', tracked('minimap', 'bottom-left'))]);
    expect(services.hudOverlay).toBe(root.overlay);
    expect(root.overlay.parentElement).toBe(root.el);
    expect(root.overlay.closest('.ta-hud__slot, .ta-book')).toBeNull();
    roots = [];
    root.dispose();
    expect(disposed.sort()).toEqual(['colony-deed', 'minimap']);
    expect(document.querySelector('.ta-hud, .ta-hud__overlay, .ta-book')).toBeNull();
  });

  it('update forwards the view to every panel; setVisible hides the root', () => {
    const update = vi.fn();
    const { root } = mount([feature('deed', panel('colony-deed', 'top-left', { mount: () => ({ update, dispose() {} }) }))]);
    root.update({});
    expect(update).toHaveBeenCalledTimes(1);
    root.setVisible(false);
    expect(root.el.hidden).toBe(true);
    root.setVisible(true);
    expect(root.el.hidden).toBe(false);
  });
});

describe('HudRoot closeHudMenus (HQ respawn)', () => {
  it('folds both books and runs every registered closer', () => {
    const { services } = mount([...COLONY, ...DOCK]);
    const a = vi.fn();
    const b = vi.fn();
    services.registerHudCloser!(a);
    services.registerHudCloser!(b);
    services.closeHudMenus!();
    expect($('[data-testid=colony-book]')!.dataset.collapsed).toBe('true');
    expect($('[data-testid=command-dock]')!.dataset.collapsed).toBe('true');
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
  });

  it('an unregistered closer is not called; a throwing closer does not stop the others', () => {
    const { services } = mount([...COLONY]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = vi.fn();
    const after = vi.fn();
    const off = services.registerHudCloser!(gone);
    services.registerHudCloser!(() => { throw new Error('boom'); });
    services.registerHudCloser!(after);
    off();
    services.closeHudMenus!();
    expect([gone.mock.calls.length, after.mock.calls.length]).toEqual([0, 1]);
  });

  it('works with no books at all and drops closers on dispose', () => {
    const { root, services } = mount([feature('maps', panel('minimap', 'bottom-left'))]);
    const fn = vi.fn();
    services.registerHudCloser!(fn);
    root.dispose();
    roots = roots.filter((r) => r !== root);
    services.closeHudMenus!();
    expect(fn).not.toHaveBeenCalled();
  });
});
