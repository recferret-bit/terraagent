// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { resetGameInputBlock, setGameInputBlocked } from '../input/gameInputBlock';
import { ColonyBook } from './ColonyBook';
import { CommandDock, isDockPaneShown, resolveDockTabForFeature, type DockTabId } from './CommandDock';

const ALL: readonly DockTabId[] = ['build', 'production', 'terraform', 'queue'];
let mounted: { dispose(): void }[] = [];

function makeDock(tabs: readonly DockTabId[] = ALL): CommandDock {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  const dock = new CommandDock(slot, {} as never, new Set(tabs));
  mounted.push(dock);
  return dock;
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

const state = (dock: CommandDock) => [dock.getActiveTab(), dock.isCollapsed()];

afterEach(() => {
  for (const m of mounted) m.dispose();
  mounted = [];
  resetGameInputBlock();
  document.body.replaceChildren();
});

describe('CommandDock (right tab book)', () => {
  it('keeps the DOM contract: test ids, right side, tab order, hotkey hints', () => {
    const dock = makeDock();
    expect(dock.el.getAttribute('data-testid')).toBe('command-dock');
    expect(dock.el.dataset.side).toBe('right');
    expect(dock.el.classList.contains('ta-command-dock')).toBe(true);
    const ids = [...dock.el.querySelectorAll('.ta-book__tab')].map((t) => t.getAttribute('data-testid'));
    expect(ids).toEqual(['dock-tab-build', 'dock-tab-production', 'dock-tab-terraform', 'dock-tab-queue']);
    expect(document.querySelector('[data-testid=dock-tab-build]')!.textContent).toContain('[B]');
    expect(document.querySelector('[data-testid=command-dock-toggle]')).not.toBeNull();
    expect(dock.containerFor('queue').classList.contains('ta-command-dock__queue')).toBe(true);
  });

  it('only the available tabs exist; the first available one opens', () => {
    const dock = makeDock(['terraform', 'build']);
    expect(dock.getActiveTab()).toBe('build'); // spine order, not set order
    expect(document.querySelector('[data-testid=dock-tab-production]')).toBeNull();
  });

  it('resolveDockTabForFeature maps the dock features; hub-placement only before W02; others → null', () => {
    const none = new Set<string>();
    const w02 = new Set(['W02']);
    expect(resolveDockTabForFeature('construction-menu', w02)).toBe('build');
    expect(resolveDockTabForFeature('hub-placement', none)).toBe('build');
    expect(resolveDockTabForFeature('hub-placement', w02)).toBeNull();
    expect(resolveDockTabForFeature('units-menu', none)).toBe('production');
    expect(resolveDockTabForFeature('terraform-basic', none)).toBe('terraform');
    expect(resolveDockTabForFeature('queue-panel', none)).toBe('queue');
    expect(resolveDockTabForFeature('maps', none)).toBeNull();
    expect(resolveDockTabForFeature('', none)).toBeNull();
  });
});

describe('CommandDock hotkeys B / U / T', () => {
  it('open their tab, fold it on a second press, and switch between tabs (case-insensitive)', () => {
    const dock = makeDock();
    press('t');
    expect(state(dock)).toEqual(['terraform', false]);
    press('T');
    expect(state(dock)).toEqual(['terraform', true]);
    press('u');
    expect(state(dock)).toEqual(['production', false]);
    press('b');
    expect(state(dock)).toEqual(['build', false]);
  });

  it('a handled key stops other listeners; an unrelated key passes through', () => {
    makeDock();
    let reached = 0;
    const later = () => { reached++; };
    window.addEventListener('keydown', later, { capture: true });
    press('u');
    expect(reached).toBe(0);
    press('x');
    expect(reached).toBe(1);
    window.removeEventListener('keydown', later, { capture: true });
  });

  it('are ignored with Ctrl / Meta / Alt, on auto-repeat, and for keys without a tab', () => {
    const dock = makeDock();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) press('t', mod);
    press('q'); // the queue tab has no hotkey
    press('');
    expect(state(dock)).toEqual(['build', false]);
  });

  it('are ignored while typing in an input, textarea or select', () => {
    const dock = makeDock();
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      document.body.appendChild(field);
      press('t', {}, field);
    }
    expect(state(dock)).toEqual(['build', false]);
  });

  it('are ignored while a modal blocks game input, and work again after', () => {
    const dock = makeDock();
    setGameInputBlocked('pause', true);
    press('t');
    expect(state(dock)).toEqual(['build', false]);
    setGameInputBlocked('pause', false);
    press('t');
    expect(state(dock)).toEqual(['terraform', false]);
  });

  it('a hotkey for a missing tab does nothing and does not swallow the key', () => {
    const dock = makeDock(['build', 'queue']);
    const e = press('t');
    press('u');
    expect(state(dock)).toEqual(['build', false]);
    expect(e.defaultPrevented).toBe(false);
  });

  it('dispose removes the key listener and the element', () => {
    const dock = makeDock();
    dock.dispose();
    mounted = [];
    press('t');
    expect(dock.getActiveTab()).toBe('build');
    expect(document.querySelector('[data-testid=command-dock]')).toBeNull();
  });
});

describe('isDockPaneShown (both books)', () => {
  const child = (pane: HTMLElement) => pane.appendChild(document.createElement('div'));

  it('dock: true only for the active pane of an unfolded book', () => {
    const dock = makeDock();
    const build = child(dock.containerFor('build'));
    const terra = child(dock.containerFor('terraform'));
    expect([isDockPaneShown(build), isDockPaneShown(terra)]).toEqual([true, false]);
    dock.selectTab('terraform');
    expect([isDockPaneShown(build), isDockPaneShown(terra)]).toEqual([false, true]);
    dock.setCollapsed(true);
    expect([isDockPaneShown(build), isDockPaneShown(terra)]).toEqual([false, false]);
  });

  it('dock: the queue pane counts as shown under Build / Production (CSS shows it there), hidden under Terraform or folded', () => {
    const dock = makeDock();
    const queue = child(dock.containerFor('queue'));
    expect(isDockPaneShown(queue)).toBe(true);
    dock.selectTab('production');
    expect(isDockPaneShown(queue)).toBe(true);
    dock.selectTab('terraform');
    expect(isDockPaneShown(queue)).toBe(false);
    dock.selectTab('queue');
    expect(isDockPaneShown(queue)).toBe(true);
    dock.setCollapsed(true);
    expect(isDockPaneShown(queue)).toBe(false);
  });

  it('dock without a queue tab does not tag the page as the queue pane', () => {
    const dock = makeDock(['build']);
    expect(dock.el.querySelector('.ta-command-dock__queue')).toBeNull();
  });

  it('colony book: same rule on the left book', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const colony = new ColonyBook(slot, new Set(['deed', 'director'] as const));
    mounted.push(colony);
    const deed = child(colony.containerFor('deed'));
    const director = child(colony.containerFor('director'));
    expect([isDockPaneShown(deed), isDockPaneShown(director)]).toEqual([true, false]);
    colony.book.selectOrToggleTab('director');
    expect([isDockPaneShown(deed), isDockPaneShown(director)]).toEqual([false, true]);
    colony.book.selectOrToggleTab('director');
    expect(isDockPaneShown(director)).toBe(false);
  });

  it('an element outside any book, or a pane outside a book, counts as shown', () => {
    const loose = document.createElement('div');
    document.body.appendChild(loose);
    expect(isDockPaneShown(loose)).toBe(true);
    const fakePane = document.createElement('div');
    fakePane.setAttribute('data-tab-pane', 'x');
    fakePane.setAttribute('data-active', 'false');
    document.body.appendChild(fakePane);
    expect(isDockPaneShown(child(fakePane))).toBe(true);
  });
});
