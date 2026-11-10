// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInHudBook, TabBook, type BookTabDef } from './TabBook';

type Id = 'a' | 'b' | 'c';
const TABS: readonly BookTabDef<Id>[] = [
  { id: 'a', label: 'ALPHA', hint: 'A' },
  { id: 'b', label: 'BRAVO' },
  { id: 'c', label: 'CHARLIE' },
];

function makeBook(side: 'left' | 'right' = 'right', tabs: readonly BookTabDef<Id>[] = TABS, className?: string): TabBook<Id> {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new TabBook<Id>(parent, {
    side, tabs, className, testId: 'book', tabTestIdPrefix: 'tab-', toggleTestId: 'book-toggle', ariaLabel: 'Test',
  });
}

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const tab = (id: string) => q(`[data-testid=tab-${id}]`)!;
const badgeOf = (id: string) => tab(id).querySelector<HTMLElement>('.ta-book__badge')!;
const attr = (el: Element | null, name: string) => el?.getAttribute(name) ?? null;

afterEach(() => document.body.replaceChildren());

describe('TabBook DOM contract', () => {
  it('renders the root with side, test ids, extra class and the tabs in spine order', () => {
    const book = makeBook('left', TABS, 'ta-extra');
    expect(book.el.dataset.side).toBe('left');
    expect(book.el.classList.contains('ta-book')).toBe(true);
    expect(book.el.classList.contains('ta-extra')).toBe(true);
    expect(attr(book.el, 'data-testid')).toBe('book');
    const spineTabs = [...book.el.querySelectorAll('.ta-book__tab')].map((t) => t.getAttribute('data-tab'));
    expect(spineTabs).toEqual(['a', 'b', 'c']);
    const panes = [...book.pageEl.querySelectorAll('[data-tab-pane]')].map((p) => p.getAttribute('data-tab-pane'));
    expect(panes).toEqual(['a', 'b', 'c']);
    expect(q('[data-testid=book-toggle]')).not.toBeNull();
    expect(attr(book.el.querySelector('[role=tablist]'), 'aria-label')).toBe('Test');
  });

  it('labels show the hotkey hint only when one is given', () => {
    makeBook();
    expect(tab('a').textContent).toContain('ALPHA [A]');
    expect(tab('b').querySelector('.ta-book__label')!.textContent).toBe('BRAVO');
  });

  it('right side has no extra class when none is passed and mirrors the toggle arrow', () => {
    const right = makeBook('right');
    expect(right.el.className).toBe('ta-book');
    expect(right.el.dataset.side).toBe('right');
    const toggle = q('[data-testid=book-toggle]')!;
    expect(toggle.textContent).toBe('▸');
    right.setCollapsed(true);
    expect(toggle.textContent).toBe('◂');
    document.body.replaceChildren();
    makeBook('left');
    expect(q('[data-testid=book-toggle]')!.textContent).toBe('◂');
  });

  it('only the tabs passed exist (filtering is the caller’s; a single tab book works)', () => {
    const book = makeBook('right', [TABS[1]!]);
    expect(book.has('b')).toBe(true);
    expect(book.has('a')).toBe(false);
    expect(book.getActiveTab()).toBe('b');
    expect(tab('a')).toBeNull();
  });

  it('the first tab is active and unfolded at start; only its pane is data-active', () => {
    const book = makeBook();
    expect(book.getActiveTab()).toBe('a');
    expect(book.isCollapsed()).toBe(false);
    expect(attr(book.el, 'data-active-tab')).toBe('a');
    expect(attr(book.el, 'data-collapsed')).toBe('false');
    expect(attr(tab('a'), 'data-active')).toBe('true');
    expect(attr(tab('a'), 'aria-selected')).toBe('true');
    expect(attr(tab('b'), 'data-active')).toBe('false');
    expect(attr(book.containerFor('a'), 'data-active')).toBe('true');
    expect(attr(book.containerFor('b'), 'data-active')).toBe('false');
  });
});

describe('TabBook select / toggle / fold', () => {
  it('selectTab switches the active pane and unfolds a folded book', () => {
    const book = makeBook();
    book.setCollapsed(true);
    book.selectTab('c');
    expect([book.getActiveTab(), book.isCollapsed()]).toEqual(['c', false]);
    expect(book.isShown('c')).toBe(true);
    expect(book.isShown('a')).toBe(false);
  });

  it('spine click: another tab switches, the active tab folds, a folded book opens on the clicked tab', () => {
    const book = makeBook();
    tab('b').click();
    expect([book.getActiveTab(), book.isCollapsed()]).toEqual(['b', false]);
    tab('b').click();
    expect([book.getActiveTab(), book.isCollapsed()]).toEqual(['b', true]);
    expect(attr(tab('b'), 'data-active')).toBe('false'); // a folded book shows no active spine
    expect(attr(book.el, 'data-active-tab')).toBe('b'); // but remembers which tab it folds on
    tab('c').click();
    expect([book.getActiveTab(), book.isCollapsed()]).toEqual(['c', false]);
  });

  it('the collapse button folds and unfolds on the same tab, with aria state', () => {
    const book = makeBook();
    book.selectTab('b');
    const toggle = q('[data-testid=book-toggle]')!;
    toggle.click();
    expect([book.getActiveTab(), book.isCollapsed()]).toEqual(['b', true]);
    expect(attr(toggle, 'aria-expanded')).toBe('false');
    expect(book.isShown('b')).toBe(false);
    toggle.click();
    expect([book.getActiveTab(), book.isCollapsed()]).toEqual(['b', false]);
    expect(attr(toggle, 'aria-expanded')).toBe('true');
  });

  it('unknown tabs are a no-op for select, toggle and badge; containerFor falls back to the page', () => {
    const book = makeBook('right', [TABS[0]!, TABS[1]!]);
    const fn = vi.fn();
    book.onChange(fn);
    book.selectTab('c');
    book.selectOrToggleTab('c');
    book.setBadge('c', 3);
    expect(fn).not.toHaveBeenCalled();
    expect([book.getActiveTab(), book.isCollapsed()]).toEqual(['a', false]);
    expect(book.containerFor('c')).toBe(book.pageEl);
    expect(book.isShown('c')).toBe(false);
  });
});

describe('TabBook badges', () => {
  it('shows numbers and strings, and clears on null, 0 and the empty string', () => {
    const book = makeBook();
    book.setBadge('b', 3);
    expect([badgeOf('b').hidden, badgeOf('b').textContent]).toEqual([false, '3']);
    book.setBadge('b', '!');
    expect([badgeOf('b').hidden, badgeOf('b').textContent]).toEqual([false, '!']);
    for (const clear of [0, '', null] as const) {
      book.setBadge('b', 5);
      book.setBadge('b', clear);
      expect([badgeOf('b').hidden, badgeOf('b').textContent]).toEqual([true, '']);
    }
  });

  it('keeps negative counts and the string "0" (only 0, "" and null clear) and touches only its own tab', () => {
    const book = makeBook();
    book.setBadge('c', -1);
    book.setBadge('a', '0');
    expect(badgeOf('c').textContent).toBe('-1');
    expect(badgeOf('a').hidden).toBe(false);
    expect(badgeOf('b').hidden).toBe(true);
  });
});

describe('TabBook onChange and dispose', () => {
  it('fires after every tab or fold change and stops after unsubscribe', () => {
    const book = makeBook();
    const seen: string[] = [];
    const off = book.onChange(() => seen.push(`${book.getActiveTab()}:${book.isCollapsed()}`));
    book.selectTab('b');
    book.selectOrToggleTab('b');
    book.setCollapsed(false);
    expect(seen).toEqual(['b:false', 'b:true', 'b:false']);
    off();
    book.selectTab('c');
    expect(seen).toHaveLength(3);
  });

  it('a badge change does not fire onChange', () => {
    const book = makeBook();
    const fn = vi.fn();
    book.onChange(fn);
    book.setBadge('a', 1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('dispose removes the element and drops listeners', () => {
    const book = makeBook();
    const fn = vi.fn();
    book.onChange(fn);
    book.dispose();
    expect(q('[data-testid=book]')).toBeNull();
    book.selectTab('b');
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeTab removes the spine and pane, advances activeTab, and isInHudBook detects pane children', () => {
    const book = makeBook();
    const child = book.containerFor('a').appendChild(document.createElement('span'));
    expect(isInHudBook(child)).toBe(true);
    expect(isInHudBook(document.body)).toBe(false);
    expect(book.tabCount).toBe(3);
    book.removeTab('a');
    expect(book.has('a')).toBe(false);
    expect(book.tabCount).toBe(2);
    expect(book.getActiveTab()).toBe('b');
    book.removeTab('unknown' as Id); // unknown tab is a no-op
    expect(book.tabCount).toBe(2);
    book.removeTab('b');
    book.removeTab('c');
    expect(book.tabCount).toBe(0);
    expect(book.getActiveTab()).toBe('');
  });
});
